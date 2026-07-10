import type ts from 'typescript/lib/tsserverlibrary';

import { completionDetails } from './completions';
import { parseConfig } from './config';
import { computeSzEntries } from './core';
import { mergeCompletions } from './merge';

/** Re-arm an open circuit after this idle period so a transient slow spell
 * (a cold checker on a large project, a loaded machine) recovers on its own
 * instead of disabling csszyx completions for the rest of the session. */
const CIRCUIT_HALF_OPEN_MS = 30_000;

/** Initialize the CommonJS tsserver plugin.
 * @param modules - Modules supplied by the host.
 * @param modules.typescript - Host-owned TypeScript instance.
 * @returns Language-service plugin hooks.
 */
function init(modules: { typescript: typeof ts }): ts.server.PluginModule {
    const tsMod = modules.typescript;
    let configurationGeneration = 0;
    let changedConfiguration: unknown;

    /** Create one fail-open project proxy.
     * @param info - Project service and base language service.
     * @returns A bound language-service proxy.
     */
    function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
        const service = info.languageService;
        const projectService = info.project.projectService as unknown as {
            cancellationToken?: { isCancellationRequested?: () => boolean };
        };
        const isCancellationRequested = (): boolean => {
            try {
                return projectService.cancellationToken?.isCancellationRequested?.() === true;
            } catch {
                return true;
            }
        };
        let config = parseConfig(info.config);
        let failures = 0;
        let circuitOpen = false;
        let circuitOpenedAt = 0;
        let lastLog = 0;
        let disposed = false;
        let seenConfigurationGeneration = configurationGeneration;
        const syncConfiguration = (): void => {
            if (seenConfigurationGeneration === configurationGeneration) return;
            config = parseConfig(changedConfiguration);
            seenConfigurationGeneration = configurationGeneration;
            failures = 0;
            circuitOpen = false;
        };
        const recordFailure = (error: unknown): void => {
            failures += 1;
            if (failures >= config.failureThreshold) {
                circuitOpen = true;
                circuitOpenedAt = performance.now();
            }
            logFailure(error);
        };
        // Half-open: after the cooldown, allow exactly one trial request through
        // so a recovered service re-enables completions without a config change.
        const circuitBlocks = (): boolean => {
            if (!circuitOpen) return false;
            if (performance.now() - circuitOpenedAt < CIRCUIT_HALF_OPEN_MS) return true;
            circuitOpen = false;
            failures = config.failureThreshold - 1;
            return false;
        };

        const logFailure = (error: unknown): void => {
            const now = Date.now();
            if (now - lastLog < 60_000) return;
            lastLog = now;
            try {
                info.project.projectService.logger.info(
                    `[csszyx-ts-plugin] completion failed (${error instanceof Error ? error.name : 'unknown'}); circuit=${circuitOpen ? 'open' : 'closed'}`,
                );
            } catch {
                // Logging is diagnostic only and must never break the base service.
            }
        };

        const proxy: ts.LanguageService = Object.create(null);
        for (const key of Object.keys(service) as (keyof ts.LanguageService)[]) {
            const member = service[key];
            if (typeof member === 'function') {
                // biome-ignore lint/suspicious/noExplicitAny: the language-service surface is heterogeneous.
                (proxy as any)[key] = (...args: unknown[]) =>
                    (member as (...input: unknown[]) => unknown).apply(service, args);
            } else {
                // biome-ignore lint/suspicious/noExplicitAny: preserve optional non-method surface.
                (proxy as any)[key] = member;
            }
        }

        proxy.getCompletionsAtPosition = (fileName, position, options, formattingSettings) => {
            // The base service call must precede any csszyx work: it warms the
            // program/type-checker, so the plugin's bounded scan runs against a
            // hot program and stays inside the deadline. Reordering this would
            // move a synchronous multi-hundred-millisecond first getProgram()
            // inside our deadline accounting and trip the circuit on cold start.
            const prior = service.getCompletionsAtPosition(
                fileName,
                position,
                options,
                formattingSettings,
            );
            syncConfiguration();
            if (disposed || !config.enabled || circuitBlocks() || isCancellationRequested())
                return prior;
            try {
                const deadline = performance.now() + config.deadlineMs;
                const additions = computeSzEntries(
                    tsMod,
                    service,
                    fileName,
                    position,
                    config,
                    deadline,
                    isCancellationRequested,
                );
                if (isCancellationRequested()) return prior;
                // A deadline overrun still yields whatever bounded entries were
                // computed — late results are correct, not garbage, so merge
                // them — but it counts toward the (now auto-recovering) circuit.
                if (performance.now() > deadline) recordFailure(new Error('DeadlineExceeded'));
                else failures = 0;
                return mergeCompletions(prior, additions, config.maxEntries * 4);
            } catch (error) {
                recordFailure(error);
                return prior;
            }
        };

        proxy.getCompletionEntryDetails = (
            fileName,
            position,
            name,
            formattingOptions,
            source,
            preferences,
            data,
        ) => {
            let details: ts.CompletionEntryDetails | undefined;
            try {
                details = completionDetails(tsMod, name, data);
            } catch (error) {
                logFailure(error);
            }
            return (
                details ??
                service.getCompletionEntryDetails(
                    fileName,
                    position,
                    name,
                    formattingOptions,
                    source,
                    preferences,
                    data,
                )
            );
        };

        const originalDispose = service.dispose?.bind(service);
        proxy.dispose = () => {
            if (disposed) return;
            disposed = true;
            originalDispose?.();
        };

        // Deterministic activation marker: lets a developer confirm the plugin
        // loaded (search the TS Server log for "csszyx-ts-plugin") and tells a
        // healthy-but-quiet install apart from an unsupported host.
        try {
            info.project.projectService.logger.info(
                `[csszyx-ts-plugin] activated (completions ${config.enabled ? 'on' : 'off'}, values ${config.values ? 'on' : 'off'})`,
            );
        } catch {
            // Logging is diagnostic only and must never break activation.
        }

        return proxy;
    }

    /** Atomically update active project snapshots and reset their circuits.
     * @param raw - Raw tsserver plugin configuration.
     */
    function onConfigurationChanged(raw: unknown): void {
        changedConfiguration = raw;
        configurationGeneration += 1;
    }

    return { create, onConfigurationChanged };
}

export = init;
