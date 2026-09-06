/**
 * A key csszyx owns, carrying an object, is named — and only that key.
 *
 * The object path turns an unrecognised key into a class PREFIX verbatim, so
 * `{ '--v-x': { p: 4 } }` emits `--v-x:p-4` and `{ container: { sm: {…} } }`
 * emits `container:sm:p-4`. Tailwind serves neither.
 *
 * The line this suite draws is the whole design. Tailwind's variant namespace
 * is OPEN — a project declares its own with `@custom-variant` and its
 * breakpoints with `--breakpoint-*` in `@theme` — so a compiler that cannot
 * read the project's CSS cannot tell `{ tablet: … }` from `{ 'tablt': … }`.
 * Warning on both was measured in the field as worse than silence and is
 * locked out by `custom-theme-variant-keys.test.ts`; the cases below repeat a
 * few of those names so this suite cannot re-introduce it either.
 *
 * `--*` and `container` are decidable because csszyx defines what they mean and
 * neither meaning is a variant. The class is still emitted — dropping it would
 * be a second behaviour change on a shape that is already reported.
 */
import { describe, expect, it } from 'vitest';

import { ENGINES, type ParityEngine } from './engine-parity-harness.js';

/** sz shapes whose outer key csszyx owns, and cannot mean a variant. */
const REPORTED: ReadonlyArray<readonly [string, string]> = [
    ['--v-x', "{ '--v-x': { p: 4 } }"],
    ['container', '{ container: { sm: { p: 4 } } }'],
    // Under a `min` / `max` breakpoint, whose name is the project's own: the
    // name is not judged, but what it holds is.
    ['--v-y', "{ min: { md: { '--v-y': { p: 2 } } } }"],
];

/** sz shapes that must stay silent, including keys only the project's CSS knows. */
const SILENT: ReadonlyArray<readonly [string, string]> = [
    ['a state variant', '{ hover: { p: 4 } }'],
    ['a built-in breakpoint', '{ md: { p: 4 } }'],
    ['a custom @theme breakpoint', '{ tablet: { p: 4 } }'],
    ['a hyphenated custom breakpoint', "{ 'desktop-sm': { p: 4 } }"],
    ['a container query', "{ '@sm': { p: 4 } }"],
    ['an arbitrary variant', "{ 'data-[open]': { p: 4 } }"],
    ['a scoped variant', '{ group: { hover: { p: 4 } } }'],
    ['the has variant', '{ has: { img: { p: 4 } } }'],
    ['the supports variant', "{ supports: { 'display:grid': { p: 4 } } }"],
    ['the css escape hatch', '{ css: { zIndex: -1 } }'],
    ['a colour with opacity', "{ bg: { color: 'red-500', op: 50 } }"],
    ['a property holding an object', "{ p: { bg: 'red-500' } }"],
    ['a custom property with a declaration value', "{ '--v-x': '0.18' }"],
    ['the container utility', '{ container: true }'],
];

/** Every (artifact, shape) pair, named so a failure says which lane and which shape. */
const reported = ENGINES.flatMap(([lane, engine]) =>
    REPORTED.map(([key, sz]) => ({ lane, engine, key, sz })),
);
const silent = ENGINES.flatMap(([lane, engine]) =>
    SILENT.map(([what, sz]) => ({ lane, engine, what, sz })),
);

/** The marker every object-in-variant-position diagnostic carries. */
const MARKER = 'it holds an object';

/**
 * Emit one sz object through one engine artifact.
 *
 * @param engine - The artifact under test.
 * @param sz - The sz object source, as written in JSX.
 * @returns The emitted className and the result's diagnostics.
 */
function run(engine: ParityEngine, sz: string): { emitted: string; diagnostics: string[] } {
    const result = engine(`export const A = () => <div sz={${sz}} />;`, 'owned-key.tsx');
    return {
        emitted: /className="([^"]*)"/.exec(result.code ?? '')?.[1] ?? '',
        diagnostics: result.diagnostics ?? [],
    };
}

describe('csszyx-owned keys holding an object', () => {
    it.each(reported)('$lane names $key', ({ engine, key, sz }) => {
        const { diagnostics } = run(engine, sz);
        const hit = diagnostics.find(
            message => message.includes(`"${key}"`) && message.includes(MARKER),
        );
        expect(hit, diagnostics.join('\n')).toBeDefined();
    });

    it.each(reported)('$lane still emits the $key prefix', ({ engine, key, sz }) => {
        expect(run(engine, sz).emitted).toContain(`${key}:`);
    });

    it.each(silent)('$lane stays silent for $what', ({ engine, sz }) => {
        expect(run(engine, sz).diagnostics.filter(m => m.includes(MARKER))).toEqual([]);
    });
});
