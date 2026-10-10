/**
 * A stylesheet the build cannot read is an environment warning, and `quiet`
 * is the one switch for those (ADR 0011): `quiet: true` mutes it like every
 * other build warning, and without `quiet` it is printed in every mode.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { rollupPlugin } from '../src/unplugin.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

const UNRESOLVED = "imports `@/gen/tokens.css`, which this build's Tailwind cannot resolve";

/**
 * Read the stylesheets of a project whose entry imports through an alias the
 * build does not follow.
 *
 * @param quiet - The plugin's `quiet` option.
 * @returns What csszyx printed.
 */
async function warnedWith(quiet: boolean | undefined): Promise<string[]> {
    const root = tailwindProject('csszyx-unresolved-quiet-', {
        'src/index.css': '@import "tailwindcss";\n@import "@/gen/tokens.css";\n',
        'src/gen/tokens.css': '@theme { --color-brand: #123456; }\n',
    });
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const warned: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
        warned.push(String(message));
    });
    const plugins = [
        rollupPlugin({
            build: { cache: false },
            production: { mangle: false },
            ...(quiet === undefined ? {} : { quiet }),
        }),
    ].flat() as Array<{ buildStart?: (this: unknown) => unknown }>;
    const context = { warn() {}, error() {}, meta: {}, addWatchFile() {} };
    await plugins.find(plugin => plugin.buildStart)?.buildStart?.call(context);
    return warned;
}

describe('the warning for a stylesheet import the build cannot resolve', () => {
    it('is printed without `quiet`', async () => {
        expect((await warnedWith(undefined)).join('\n')).toContain(UNRESOLVED);
    }, 60_000);

    it('is muted by `quiet: true`', async () => {
        expect((await warnedWith(true)).join('\n')).not.toContain(UNRESOLVED);
    }, 60_000);
});
