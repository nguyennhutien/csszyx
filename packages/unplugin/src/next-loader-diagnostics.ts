/**
 * Print one Next Turbopack loader run's engine diagnostics.
 *
 * The policy is the plugin's ({@link routeTransformDiagnostics}); only the
 * channel differs. Turbopack's loader context implements `emitWarning`, which
 * it turns into an issue on the module: Next prints it in the terminal under
 * the file it belongs to, shows it in the dev overlay, drops it again once a
 * re-run of the module no longer emits it, and dedupes the copies a module
 * compiled for several layers produces. A console line has none of that — it
 * is printed once per layer and outlives the fix — so it is only the fallback
 * for a runner without the channel, deduplicated here per module source.
 *
 * @module
 */
import { createHash } from 'node:crypto';

import {
    resolveQuietMode,
    routeTransformDiagnostics,
    shouldHoldAdvisories,
} from './transform-diagnostics.js';

/** What the loader needs to print one run's diagnostics. */
export interface NextLoaderDiagnosticsInput {
    /** The engine's diagnostics for the module, in order. */
    diagnostics: readonly string[];
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

/** Console lines already printed, for runners without `emitWarning`. */
const printed = new Set<string>();

/** Bound on {@link printed}; a long dev session restarts the record past it. */
const PRINTED_LIMIT = 10_000;

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
    if (input.diagnostics.length === 0) return;
    const quiet = resolveQuietMode(input.env.CSSZYX_QUIET_SZ_WARNINGS === '1');
    // A dev server lists advisories; a build holds them. Next sets NODE_ENV to
    // its mode, so the mode answers the plugin's NODE_ENV question here.
    const hold = shouldHoldAdvisories(quiet, input.mode === 'development', input.mode);
    const routed = routeTransformDiagnostics(input.diagnostics, input.resourcePath, quiet, hold);
    const lines = [
        ...routed.immediate,
        ...routed.spread.map(warning => `[csszyx] ${warning}`),
        ...routed.advisories,
    ];
    const emitWarning = input.emitWarning;
    if (emitWarning !== undefined) {
        for (const line of lines) emitWarning(loaderWarning(line));
        return;
    }
    const version = createHash('sha256').update(input.source).digest('hex');
    for (const line of lines) {
        const key = `${input.resourcePath}\0${version}\0${line}`;
        if (printed.has(key)) continue;
        if (printed.size >= PRINTED_LIMIT) printed.clear();
        printed.add(key);
        console.warn(line);
    }
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
