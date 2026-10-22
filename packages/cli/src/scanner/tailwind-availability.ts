/**
 * Whether `generate-types` can run: is Tailwind CSS v3 there for it to call?
 *
 * The command turns a v3 JavaScript config into TypeScript declarations by
 * handing the config to Tailwind's own `resolveConfig`. Tailwind v3 is 12 MB
 * across 37 packages and `generate-types` is the only command that touches
 * it, so it is an optional peer of this package rather than a dependency:
 * it arrives when a project asks for this command and not before. No package
 * manager warns about a missing optional peer at install time, so the
 * message printed here is the whole of what a user gets.
 *
 * Three states need three answers. An absent install wants v3 added. A v4
 * install wants nothing at all — v4 removed the JavaScript config and the
 * helper, so the command has no job there, and telling that project to
 * install v3 would be telling it to downgrade. A v3 whose entry does not
 * load is a broken install, not a missing one, and a reinstall is the fix.
 *
 * The probe reads the PROJECT's Tailwind first and the one next to this
 * module second. `npx @csszyx/cli generate-types` runs the CLI from a tree
 * that has no Tailwind in it, and the project's own install is the one the
 * command is asked about; the module-local copy answers when the CLI is
 * installed in the project and hoisted beside its peer. Both are located
 * through the resolver and loaded by absolute path, so a pnpm strict layout
 * — where this module cannot see the project's copy by name — still loads
 * the right file.
 *
 * @module scanner/tailwind-availability
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CsszyxError } from '@csszyx/compiler/errors';

import { registryMessage } from '../utils/registry-words.js';

/** Tailwind v3's `resolveConfig`: fills a user config with the defaults. */
export type ResolveConfig = (config: unknown) => unknown;

/** How the helper reaches Tailwind; injectable so the three states can be tested. */
export interface TailwindLoader {
    /**
     * The installed version, resolved from this package.
     *
     * @returns The `version` field of Tailwind's `package.json`.
     * @throws A module-not-found error when nothing is installed.
     */
    version(): Promise<string>;
    /**
     * The `resolveConfig` entry.
     *
     * @returns The default export of `tailwindcss/resolveConfig.js`.
     * @throws Whatever loading the entry throws.
     */
    resolveConfig(): Promise<unknown>;
}

/**
 * Whether a thrown value is a module-resolution failure.
 *
 * Two codes, because two resolvers answer. Node's ESM resolver throws
 * `ERR_MODULE_NOT_FOUND` under npm, pnpm and Yarn's node_modules linker;
 * Yarn PnP throws `MODULE_NOT_FOUND` with a message of its own. Reading only
 * the first would let a PnP install fall through to a raw stack trace.
 *
 * @param error - The thrown value.
 * @returns True for either resolver's not-found code.
 */
export function isModuleNotFound(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
}

/** One located Tailwind installation. */
export interface LocatedTailwind {
    /** Absolute path of the install's `package.json`. */
    manifest: string;
    /** The version that manifest declares. */
    version: string;
}

/**
 * The one install to answer for, from anchors in preference order.
 *
 * A v3 anywhere in the list wins, because v3 is the only major the command
 * can use: a workspace root on v4 must not hide the v3 that the documented
 * `npx -p tailwindcss@3` invocation puts beside the CLI. With no v3 the first
 * anchor's install answers, so the diagnostic names the version the project
 * itself has rather than one it never installed.
 *
 * @param anchors - Module or file URLs to resolve `tailwindcss` from, project first.
 * @returns The chosen install, with its manifest and version kept together so
 * an entry-load failure is never reported against another install's version.
 * @throws The first anchor's failure when it is not an absence — that anchor is
 * the project being asked about, and a hidden manifest is a fact about it. When
 * no anchor yielded an install, the first failure seen, so an absence reads as
 * one.
 */
export function locateTailwind(anchors: readonly string[]): LocatedTailwind {
    const seen = new Set<string>();
    const candidates: LocatedTailwind[] = [];
    let failure: unknown;
    for (const [index, anchor] of anchors.entries()) {
        try {
            const manifest = createRequire(anchor).resolve('tailwindcss/package.json');
            if (seen.has(manifest)) continue;
            seen.add(manifest);
            const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version: string };
            candidates.push({ manifest, version });
        } catch (error) {
            // A later anchor is a fallback: it may improve on the project's
            // answer and never replaces it with a failure of its own.
            if (index === 0 && !isModuleNotFound(error)) throw error;
            failure ??= error;
        }
    }
    const chosen =
        candidates.find(candidate => Number.parseInt(candidate.version, 10) === 3) ?? candidates[0];
    if (chosen) return chosen;
    throw failure;
}

/**
 * The loader the command uses for one project.
 *
 * @param projectRoot - The project the command runs against.
 * @param alsoNextToCli - Whether to fall back to the Tailwind next to this
 * module; off only in tests, which have one beside them.
 * @returns A loader whose two answers come from the same install.
 */
export function tailwindLoaderFor(projectRoot: string, alsoNextToCli = true): TailwindLoader {
    const anchors = [pathToFileURL(join(projectRoot, 'package.json')).href];
    if (alsoNextToCli) anchors.push(import.meta.url);
    let selected: LocatedTailwind | undefined;
    const install = (): LocatedTailwind => {
        selected ??= locateTailwind(anchors);
        return selected;
    };
    return {
        version() {
            // Deferred so a failed lookup rejects, as the contract says,
            // rather than throwing at the call.
            return Promise.resolve().then(() => install().version);
        },
        async resolveConfig() {
            // Beside the manifest, so both steps answer for one package. The
            // file is CommonJS, so the ESM view always carries the function
            // as `default`; a shape that does not is reported by the caller
            // as an entry that did not export a function.
            const entry = join(dirname(install().manifest), 'resolveConfig.js');
            if (!existsSync(entry)) {
                throw Object.assign(new Error(`Cannot find module '${entry}'`), {
                    code: 'MODULE_NOT_FOUND',
                });
            }
            const module = (await import(pathToFileURL(entry).href)) as { default?: unknown };
            return module.default;
        },
    };
}

/** Which of the install states the probe found. */
export type TailwindState = 'absent' | 'wrong-major' | 'broken';

/** The registry's form for each install state. */
const FORM_OF_STATE = {
    absent: 'absent',
    'wrong-major': 'wrong-major',
    broken: 'broken-entry',
} as const satisfies Record<TailwindState, string>;

/**
 * Thrown by `resolveTailwindV3`: the message is the registry's words for the
 * state, and the fields let a caller that prints its own line — `doctor` —
 * read the state instead of the prose. A csszyx error,
 * `tailwind-v3-unavailable`, whose `args` carry the state's form, the
 * version and the reason, and whose `cause` is what loading the entry threw.
 */
export class TailwindUnavailableError extends CsszyxError {
    /** The install state. */
    readonly state: TailwindState;
    /** The installed version, when one was found. */
    readonly version?: string;
    /** What loading the entry threw, for a broken install. */
    readonly reason?: string;

    /**
     * @param state - The install state.
     * @param fields - What the state carries.
     * @param fields.version - The installed version, when one was found.
     * @param fields.reason - What loading the entry threw, for a broken install.
     * @param fields.cause - What loading the entry threw, as it was thrown.
     */
    constructor(
        state: TailwindState,
        fields: { version?: string; reason?: string; cause?: unknown } = {},
    ) {
        const { version, reason, cause } = fields;
        const args = {
            form: FORM_OF_STATE[state],
            ...(version === undefined ? {} : { version }),
            ...(reason === undefined ? {} : { reason }),
        };
        const code = 'tailwind-v3-unavailable';
        super({ code, args, message: registryMessage({ code, args }), cause });
        this.name = 'TailwindUnavailableError';
        this.state = state;
        this.version = fields.version;
        this.reason = fields.reason;
    }
}

/** What a successful probe hands back. */
export interface TailwindV3 {
    /** The installed version. */
    version: string;
    /** Tailwind's `resolveConfig`. */
    resolveConfig: ResolveConfig;
}

/**
 * Load Tailwind v3's `resolveConfig`, or throw the message for the state
 * the install is in.
 *
 * @param loader - How to reach Tailwind; the working directory's unless a
 * caller or a test passes another.
 * @returns The version and the `resolveConfig` function.
 * @throws A `TailwindUnavailableError` for one of the three states. A
 * version probe that fails for a reason other than resolution is rethrown:
 * nothing has been located yet, so there is no install to say anything about.
 */
export async function resolveTailwindV3(
    loader: TailwindLoader = tailwindLoaderFor(process.cwd()),
): Promise<TailwindV3> {
    let version: string;
    try {
        version = await loader.version();
    } catch (error) {
        if (isModuleNotFound(error)) throw new TailwindUnavailableError('absent');
        throw error;
    }
    const major = Number.parseInt(version, 10);
    if (major !== 3) {
        throw new TailwindUnavailableError('wrong-major', { version });
    }
    let entry: unknown;
    try {
        entry = await loader.resolveConfig();
    } catch (error) {
        // A v3 has been located, so whatever its entry throws — a code-less
        // SyntaxError from a damaged file included — is a fact about that
        // install, and the reinstall is its remedy.
        throw brokenEntry(version, error instanceof Error ? error.message : String(error), error);
    }
    if (typeof entry !== 'function')
        throw brokenEntry(version, 'the entry did not export a function');
    return { version, resolveConfig: entry as ResolveConfig };
}

/**
 * The error for state (c′).
 *
 * @param version - The installed version.
 * @param reason - What loading the entry threw.
 * @param cause - What it threw, as thrown; absent when it threw nothing.
 * @returns The error, carrying both.
 */
function brokenEntry(version: string, reason: string, cause?: unknown): TailwindUnavailableError {
    return new TailwindUnavailableError('broken', { version, reason, cause });
}
