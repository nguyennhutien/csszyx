/**
 * Load a framework's own compiler from the package that needs it, the first
 * time it is needed. The Vue and Svelte adapters read a file with Vue's and
 * Svelte's parsers, which the project installs; the build plugin imports both
 * adapters, so loading either parser up front would fail every React build.
 *
 * @module peer-module
 */

import { createRequire } from 'node:module';

/** Input to {@link requirePeer}. */
export interface RequirePeerInput {
    /** `import.meta.url` of the module asking: the peer resolves from there. */
    from: string;
    /** What to load, e.g. `svelte/compiler`. */
    request: string;
    /** Who needs it, for the message, e.g. `@csszyx/svelte-adapter`. */
    requiredBy: string;
    /** The package to install, with its version range, e.g. `svelte@5`. */
    install: string;
}

const loaded = new Map<string, unknown>();

/**
 * Load a peer's module, once per asker and request.
 *
 * @param input - Where to resolve from, what to load and how to name it.
 * @returns The module.
 * @throws {Error} naming the package to install when it does not resolve.
 */
export function requirePeer<T>(input: RequirePeerInput): T {
    const key = `${input.from}\0${input.request}`;
    if (loaded.has(key)) return loaded.get(key) as T;
    let module: T;
    try {
        module = createRequire(input.from)(input.request) as T;
    } catch (error) {
        // A module the peer itself fails to find is the peer's error, not a
        // missing install: only the request's own name means the latter.
        const missing =
            (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND' &&
            (error as Error).message.includes(`'${input.request}'`);
        if (!missing) throw error;
        throw new Error(
            `[csszyx] ${input.requiredBy} reads templates with \`${input.request}\`, which does not resolve from it\n` +
                `help: install ${input.install} in the project`,
        );
    }
    loaded.set(key, module);
    return module;
}
