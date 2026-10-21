/**
 * An `important` Tailwind entry builds quietly.
 *
 * `@import "tailwindcss" important` makes every utility `!important`, csszyx's
 * classes included: they reach Tailwind through the same compile (the
 * safelist `@source`), land in the same `@layer utilities` in the same order,
 * so the cascade between a `sz` class and a project class is the one it is
 * without `important`. Measured with tailwindcss 4.3.3. The build used to warn
 * that a csszyx class "cannot override" one the project applies; that was
 * false, and its help (drop `important`) would have made every Tailwind class
 * lose to the third-party CSS the project added `important` to beat.
 *
 * A prefix needs no word either: the build reads it and the engine writes it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

/**
 * Build a project and collect what the plugin printed.
 *
 * @param css - The entry stylesheet's contents.
 * @param source - A module to transform, or none at all.
 * @returns Everything passed to `console.warn`, joined.
 */
async function warningsFrom(css: string, source?: string): Promise<string> {
    const root = tailwindProject('csszyx-prefix-warn-', { 'src/theme.css': css });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugins = vitePlugin({ production: { mangle: false } }) as unknown as Record<
        string,
        unknown
    >[];
    const call = callHooks(plugins);

    await call('configResolved', { root, command: 'build' });
    if (source !== undefined) await call('transform', source, `${root}/src/A.tsx`);
    await call('renderStart');

    return warn.mock.calls.map(args => args.join(' ')).join('\n');
}

describe('an entry whose import line sets important or a prefix', () => {
    it.each([
        ['important, nothing authored', '@import "tailwindcss" important;\n', undefined],
        [
            'important, with authored classes',
            '@import "tailwindcss" important;\n',
            'export const A = () => <div className="card p-4" />;',
        ],
        [
            'a stock entry',
            '@import "tailwindcss";\n',
            'export const A = () => <div className="card p-4" />;',
        ],
        [
            'a prefixed entry',
            '@import "tailwindcss" prefix(tw);\n',
            'export const A = () => <div className="tw:card tw:p-4" />;',
        ],
    ])(
        'builds without a word about it: %s',
        async (_label, css, source) => {
            const printed = await warningsFrom(css, source);

            expect(printed).not.toMatch(/important|cannot override|does not emit for yet/);
        },
        60_000,
    );
});
