/**
 * Print one Next Turbopack loader run's engine diagnostics.
 *
 * The policy is the plugin's ({@link routeTransformDiagnostics}); only the
 * channel differs. Turbopack's loader context implements `emitWarning`, which
 * it turns into an issue on the module: Next prints it in the terminal under
 * the file it belongs to, shows it in the dev overlay, drops it again once a
 * re-run of the module no longer emits it, and dedupes the copies a module
 * compiled for several layers produces. So that channel gets every listed line
 * on every run — deduplicating it here would make Turbopack drop the issue on
 * the next re-run. A console line has none of that — it is printed once per
 * layer and outlives the fix — so it is only the fallback for a runner without
 * the channel, and goes through the same dedupe and cap as the plugin's lines.
 *
 * The loader cannot import `csszyx.config.ts`; it reads the policy
 * `csszyx next prebuild` or `next watch` resolved into
 * `.csszyx/diagnostic-policy.json`, and the built-in levels without one.
 *
 * @module
 */
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import path from 'node:path';

import { diagnosticPolicyStatePath, readDiagnosticPolicyState } from './csszyx-config-file.js';
import { createCapFlush, createDiagnosticLimiter } from './diagnostic-limiter.js';
import type { DiagnosticPolicy } from './diagnostic-policy.js';
import {
    type DiagnosticIssue,
    resolveQuietMode,
    routeTransformDiagnostics,
    shouldHoldAdvisories,
} from './transform-diagnostics.js';

/** What the loader needs to print one run's diagnostics. */
export interface NextLoaderDiagnosticsInput {
    /** The engine's diagnostics for the module, in order. */
    diagnostics: readonly string[];
    /** The code and position of each, index-parallel to `diagnostics`. */
    issues?: ReadonlyArray<DiagnosticIssue | undefined>;
    /** The project root, where the policy state file and `overrides` are read from. */
    root?: string;
    /** The module path, named in every line. */
    resourcePath: string;
    /** The module source, which identifies one version of the module for dedupe. */
    source: string;
    /** The Next build mode the loader runs under. */
    mode: 'development' | 'production';
    /** The environment the loader reads its switches from. */
    env: Record<string, string | undefined>;
    /** Turbopack's loader warning channel, when the runner offers one. */
    emitWarning?: (warning: Error | string) => void;
}

/** The console fallback's dedupe record and cap, for the life of the loader process. */
const consoleLimiter = createDiagnosticLimiter();

/** A loader has no build end to print the capped counts at. */
const capFlush = createCapFlush(consoleLimiter);

/** The policy read per root, kept while its state file is unchanged. */
const policies = new Map<string, { stamp: number; policy: DiagnosticPolicy }>();

/**
 * The policy a Next command resolved for a project.
 *
 * Read again only when the state file's modification time moves, so a module
 * pays one `stat` for it.
 *
 * @param root - The project root.
 * @returns The policy; the built-in levels when no command wrote one.
 */
function policyFor(root: string): DiagnosticPolicy {
    let stamp = -1;
    try {
        stamp = statSync(diagnosticPolicyStatePath(root)).mtimeMs;
    } catch {
        // No state file: the built-in levels, cached under the same stamp.
    }
    const known = policies.get(root);
    if (known?.stamp === stamp) return known.policy;
    const policy = readDiagnosticPolicyState(root);
    policies.set(root, { stamp, policy });
    return policy;
}

/**
 * Print one loader run's diagnostics through the loader's warning channel.
 *
 * `CSSZYX_QUIET_SZ_WARNINGS=1` is the Turbopack lane's mute: the loader takes
 * no `quiet` option, and that switch is the one documented to silence every
 * sz key and value warning. It mutes what the plugin's `quiet: true` mutes and
 * no more, so an unresolvable spread and a skipped file still print.
 *
 * @param input - The run's diagnostics and where to print them.
 */
export function reportNextLoaderDiagnostics(input: NextLoaderDiagnosticsInput): void {
    const root = input.root;
    const file =
        root === undefined
            ? undefined
            : path.relative(root, input.resourcePath).split(path.sep).join('/');
    const emitWarning = input.emitWarning;
    const limiter = emitWarning === undefined ? consoleLimiter : undefined;
    // Every version, clean ones too: an undo back to a version that had
    // findings must read as an edit, not as the version already said.
    limiter?.version(
        file ?? input.resourcePath,
        createHash('sha256').update(input.source).digest('hex'),
    );
    if (input.diagnostics.length === 0) return;
    const quiet = resolveQuietMode(input.env.CSSZYX_QUIET_SZ_WARNINGS === '1');
    // A dev server lists `info` findings; a build holds them. Next sets
    // NODE_ENV to its mode, so the mode answers the plugin's NODE_ENV question.
    const routed = routeTransformDiagnostics({
        diagnostics: input.diagnostics,
        issues: input.issues,
        id: input.resourcePath,
        file,
        quiet,
        holdInfo: shouldHoldAdvisories(quiet, input.mode === 'development', input.mode),
        policy: root === undefined ? undefined : policyFor(root),
        limiter,
    });
    const lines = [
        ...routed.immediate,
        ...routed.spread.map(warning => `[csszyx] ${warning}`),
        ...routed.advisories,
    ];
    if (emitWarning !== undefined) {
        for (const line of lines) emitWarning(loaderWarning(line));
        return;
    }
    for (const line of lines) console.warn(line);
    capFlush.schedule();
}

/**
 * A warning Turbopack reports as the message alone.
 *
 * The runner serializes the stack it is given and Next prints it, so a stack
 * would point every csszyx warning at csszyx's own source.
 *
 * @param message - The warning text.
 * @returns An error carrying the message and no stack frames.
 */
function loaderWarning(message: string): Error {
    const warning = new Error(message);
    warning.name = 'CsszyxWarning';
    warning.stack = `${warning.name}: ${message}`;
    return warning;
}
