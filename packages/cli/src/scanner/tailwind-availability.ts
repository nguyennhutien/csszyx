/**
 * Whether `generate-types` can run: is Tailwind CSS v3 there for it to call?
 *
 * The command turns a v3 JavaScript config into TypeScript declarations by
 * handing the config to Tailwind's own `resolveConfig`. Tailwind v3 is 12 MB
 * across 44 packages and `generate-types` is the only command that touches
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
 * The probe resolves from THIS module, not from the working directory,
 * because peer resolution is what the package manager guarantees for this
 * package. A probe from the working directory would say "present" in a pnpm
 * strict layout where this package still cannot see it.
 *
 * @module scanner/tailwind-availability
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

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

const require = createRequire(import.meta.url);

/** The loader the command uses: bare specifiers, resolved from this module. */
const realLoader: TailwindLoader = {
    async version() {
        const manifest = require('tailwindcss/package.json') as { version: string };
        return manifest.version;
    },
    async resolveConfig() {
        // Resolve first, then import by file URL, so both steps answer for
        // the same package this module can see.
        // `resolveConfig.js` is CommonJS, so the ESM view always carries the
        // function as `default`; a shape that does not is reported by the
        // caller as an entry that did not export a function.
        const entry = require.resolve('tailwindcss/resolveConfig.js');
        const module = (await import(pathToFileURL(entry).href)) as { default?: unknown };
        return module.default;
    },
};

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
 * @param loader - How to reach Tailwind; the real one unless a test injects another.
 * @returns The version and the `resolveConfig` function.
 * @throws An `Error` whose message is the complete explanation for one of
 * the three states; anything that is not a resolution failure is rethrown.
 */
export async function resolveTailwindV3(loader: TailwindLoader = realLoader): Promise<TailwindV3> {
    let version: string;
    try {
        version = await loader.version();
    } catch (error) {
        if (isModuleNotFound(error)) throw new Error(absentMessage());
        throw error;
    }
    const major = Number.parseInt(version, 10);
    if (major !== 3) throw new Error(wrongMajorMessage(version));
    let entry: unknown;
    try {
        entry = await loader.resolveConfig();
    } catch (error) {
        if (isModuleNotFound(error)) throw new Error(absentMessage());
        if (error instanceof Error && 'code' in error) {
            throw new Error(brokenEntryMessage(version, error.message));
        }
        throw error;
    }
    if (typeof entry !== 'function') {
        throw new Error(brokenEntryMessage(version, 'the entry did not export a function'));
    }
    return { version, resolveConfig: entry as ResolveConfig };
}

/**
 * State (a): no Tailwind at all.
 *
 * @returns The complete message.
 */
function absentMessage(): string {
    return [
        'generate-types needs Tailwind CSS v3, and this project has none installed.',
        '',
        '  This command turns a v3 JavaScript config into TypeScript declarations, and',
        "  reading that config is Tailwind's own job — the command calls Tailwind's",
        '  resolveConfig to do it. With no Tailwind installed there is nothing to call,',
        '  so it stops here rather than guessing at your theme.',
        '',
        '  Install it next to the config:',
        '',
        '    npm  install -D tailwindcss@3',
        '    pnpm add     -D tailwindcss@3',
        '    yarn add     -D tailwindcss@3',
        '',
        '  Why it was not installed for you: Tailwind v3 pulls in 12 MB across 44',
        '  packages, and generate-types is the only csszyx command that touches it.',
        '  Shipping it as a hard dependency would put those 12 MB into every install of',
        '  @csszyx/cli — including a CI runner that only ever runs csszyx check. It is',
        '  declared as an optional peer instead, so it arrives when you ask for this',
        '  command and not before.',
        '',
        '  If your project is on Tailwind v4 there is no tailwind.config.js for this',
        '  command to read: v4 moved the theme into CSS (@theme { … }). Do not install v3',
        '  to get past this message — you do not need generate-types at all.',
    ].join('\n');
}

/**
 * State (b): Tailwind is installed, but not v3.
 *
 * @param version - The installed version.
 * @returns The complete message.
 */
function wrongMajorMessage(version: string): string {
    return [
        `generate-types needs Tailwind CSS v3, and this project has ${version}.`,
        '',
        '  Nothing is broken. This command exists to read a v3 JavaScript config',
        '  (tailwind.config.js) out of an older project, and Tailwind v4 removed both',
        '  that config format and the resolveConfig helper the command calls. There is',
        '  no version of generate-types that works against a v4 install.',
        '',
        '  On v4 the theme lives in CSS and needs no generated declarations:',
        '',
        '    @import "tailwindcss";',
        '    @theme { --color-brand: oklch(0.7 0.15 250); }',
        '',
        '  If you are part-way through migrating and still have a v3 tailwind.config.js',
        '  you want typed, run the command in an environment that has v3 rather than',
        '  downgrading this project:',
        '',
        '    npx -p tailwindcss@3 -p @csszyx/cli csszyx generate-types --config ./tailwind.config.js',
        '',
        '  Why csszyx did not install v3 for you: it is 12 MB across 44 packages for one',
        '  command, so it is an optional peer rather than a dependency.',
    ].join('\n');
}

/**
 * State (c′): v3 is there and its entry did not load.
 *
 * @param version - The installed version.
 * @param reason - What loading the entry threw.
 * @returns The complete message.
 */
function brokenEntryMessage(version: string, reason: string): string {
    return [
        `generate-types found Tailwind CSS ${version} but could not load its`,
        `  resolveConfig entry: ${reason}`,
        '',
        '  The version is right, so this is not a missing install — the package is there',
        '  and the entry point it advertises did not load. A reinstall usually clears it:',
        '',
        '    npm  install --force tailwindcss@3',
        '    pnpm add -D tailwindcss@3',
        '',
        '  If it persists, the config cannot be read and generate-types has nothing to',
        '  generate from. Open an issue with the version above and this line.',
    ].join('\n');
}
