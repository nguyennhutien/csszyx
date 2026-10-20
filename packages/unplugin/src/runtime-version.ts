/**
 * Refuse a `@csszyx/runtime` from another release than the plugin.
 *
 * The build and the runtime split one job: the build lowers every static `sz`
 * object, and the runtime lowers what is left — `szr`, `szv`, objects built at
 * run time — and merges classes with the table the build wrote. Each half
 * carries its own copy of the lowering rules, so a runtime from another
 * release writes other classes for the same object than the build did, and
 * nothing in either output says so. The plugin therefore reads the runtime
 * the project resolves and stops the build when its version differs.
 *
 * @module runtime-version
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { CsszyxError } from '@csszyx/compiler/errors';

const RUNTIME = '@csszyx/runtime';

/** The runtime a project resolves. */
export interface InstalledRuntime {
    /** Its `version`. */
    version: string;
    /** The directory of its `package.json`. */
    dir: string;
}

/** What a {@link RuntimeVersionSkewError} names, by the registry's arg names. */
export interface RuntimeVersionSkewArgs {
    /** The plugin's own version. */
    readonly pluginVersion: string;
    /** The version of the runtime the project resolves. */
    readonly runtimeVersion: string;
    /** The directory of that runtime's `package.json`. */
    readonly runtimeDir: string;
}

/**
 * Thrown when the project's runtime is not the plugin's release. A csszyx
 * error: `runtime-version-skew`.
 */
export class RuntimeVersionSkewError extends CsszyxError {
    declare readonly code: 'runtime-version-skew';

    /**
     * @param message - The full message.
     * @param args - Both versions and where the runtime is; csszyx always passes them.
     */
    constructor(message: string, args: Partial<RuntimeVersionSkewArgs> = {}) {
        super({ code: 'runtime-version-skew', args, message });
        this.name = 'RuntimeVersionSkewError';
    }
}

/**
 * The `@csszyx/runtime` a project resolves, found by walking up from its entry
 * to the manifest that names it (the package does not export `package.json`).
 *
 * @param root - The project root.
 * @returns The runtime, or null when the project resolves none.
 */
export function installedRuntime(root: string): InstalledRuntime | null {
    let entry: string;
    try {
        entry = createRequire(path.join(root, 'package.json')).resolve(RUNTIME);
    } catch {
        return null;
    }
    for (let dir = path.dirname(entry); ; dir = path.dirname(dir)) {
        const manifest = readManifest(path.join(dir, 'package.json'));
        if (manifest?.name === RUNTIME && typeof manifest.version === 'string') {
            return { version: manifest.version, dir };
        }
        if (path.dirname(dir) === dir) return null;
    }
}

/**
 * A `package.json`, or null when it cannot be read.
 *
 * @param file - Its path.
 * @returns Its `name` and `version` fields.
 */
function readManifest(file: string): { name?: unknown; version?: unknown } | null {
    try {
        return JSON.parse(readFileSync(file, 'utf8')) as { name?: unknown; version?: unknown };
    } catch {
        return null;
    }
}

/** Input to {@link assertRuntimeMatchesPlugin}. */
export interface AssertRuntimeMatchesPluginInput {
    /** The project root the runtime resolves from. */
    root: string;
    /** The plugin's own version; `0.0.0` when it could not be read, which skips the check. */
    pluginVersion: string;
}

/**
 * Throw when the project's runtime is from another release than the plugin.
 * A project that resolves no runtime imports none, so there is nothing to
 * disagree with.
 *
 * @param input - The project root and the plugin's version.
 * @throws {RuntimeVersionSkewError} naming both versions and what to install.
 */
export function assertRuntimeMatchesPlugin(input: AssertRuntimeMatchesPluginInput): void {
    const { root, pluginVersion } = input;
    if (pluginVersion === '0.0.0') return;
    const runtime = installedRuntime(root);
    if (runtime === null || runtime.version === pluginVersion) return;
    throw new RuntimeVersionSkewError(
        `[csszyx] runtime-version-skew: @csszyx/unplugin ${pluginVersion} found @csszyx/runtime ${runtime.version} at ${runtime.dir}\n` +
            `help: install @csszyx/runtime@${pluginVersion}; the build and the runtime lower sz objects with rules from the same release`,
        { pluginVersion, runtimeVersion: runtime.version, runtimeDir: runtime.dir },
    );
}
