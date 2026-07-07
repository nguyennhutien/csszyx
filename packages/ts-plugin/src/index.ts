/**
 * `@csszyx/ts-plugin` — a TypeScript language-service plugin that adds sz / szv /
 * szs key completions inside `tsserver`, so any editor that embeds TypeScript
 * (VS Code, JetBrains, Neovim, Zed, …) gets csszyx autocomplete from
 * `npm install` plus one tsconfig line, with no editor extension:
 *
 * ```jsonc
 * { "compilerOptions": { "plugins": [{ "name": "@csszyx/ts-plugin" }] } }
 * ```
 *
 * The plugin is strictly ADDITIVE: it proxies the real language service, and only
 * appends csszyx entries to the base completion result. Any failure falls back to
 * the untouched base result, so it can never break the editor's TypeScript
 * support.
 */
import type ts from 'typescript/lib/tsserverlibrary';

import { computeSzEntries } from './core';

/**
 * tsserver plugin entry point.
 *
 * @param modules - injected modules from the server.
 * @param modules.typescript - the TypeScript the server runs.
 * @returns the plugin module with a `create` hook.
 */
function init(modules: { typescript: typeof ts }): ts.server.PluginModule {
    const tsMod = modules.typescript;

    /**
     * Wrap the project's language service so completions gain csszyx entries.
     *
     * @param info - the plugin create info (language service, project).
     * @returns the proxied language service.
     */
    function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
        const ls = info.languageService;

        // Proxy every method straight through, then override completions.
        const proxy: ts.LanguageService = Object.create(null);
        for (const key of Object.keys(ls) as (keyof ts.LanguageService)[]) {
            const member = ls[key];
            // biome-ignore lint/suspicious/noExplicitAny: uniform passthrough of the LS surface.
            (proxy as any)[key] = (...args: unknown[]) =>
                (member as (...a: unknown[]) => unknown).apply(ls, args);
        }

        proxy.getCompletionsAtPosition = (fileName, position, options, settings) => {
            const prior = ls.getCompletionsAtPosition(fileName, position, options, settings);
            let szEntries: ts.CompletionEntry[] = [];
            try {
                szEntries = computeSzEntries(tsMod, ls, fileName, position);
            } catch (error) {
                info.project.projectService.logger.info(
                    `[csszyx-ts-plugin] completion failed, falling back: ${String(error)}`,
                );
                return prior;
            }
            if (szEntries.length === 0) {
                return prior;
            }
            const base: ts.CompletionInfo = prior ?? {
                isGlobalCompletion: false,
                isMemberCompletion: true,
                isNewIdentifierLocation: true,
                entries: [],
            };
            // Drop base entries a csszyx entry would duplicate, then append.
            const szNames = new Set(szEntries.map(entry => entry.name));
            const merged = base.entries.filter(entry => !szNames.has(entry.name));
            return { ...base, entries: [...merged, ...szEntries] };
        };

        return proxy;
    }

    return { create };
}

export = init;
