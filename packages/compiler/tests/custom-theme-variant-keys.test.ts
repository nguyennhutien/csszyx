/**
 * Custom `@theme` variant keys must not be reported as typos.
 *
 * A `--breakpoint-*` token declared in the app's CSS becomes a variant key
 * (`{ tablet: { p: 4 } }`), and the lowering handles it: variant names are
 * open-ended, so any key carrying an OBJECT value is treated as a variant.
 * Field report (0.11.11): the native engine — the default parser — warned
 * "Unknown property …" for every such key while emitting
 * the class anyway. A warning that contradicts what the compiler did is worse
 * than silence, and it fired only on that one engine.
 *
 * The guard that must survive the fix: a genuine typo NESTED inside a custom
 * variant still has to be caught. Silencing the whole subtree would trade a
 * false positive for a false negative.
 */
import { describe, expect, it } from 'vitest';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

/** Breakpoint names taken from a real `@theme inline` block, verbatim. */
const CUSTOM_VARIANT_SOURCES: ReadonlyArray<readonly [string, string]> = [
    ['{ mobile: { p: 4 } }', 'mobile:p-4'],
    ['{ tablet: { p: 4 } }', 'tablet:p-4'],
    ["{ 'desktop-sm': { p: 4 } }", 'desktop-sm:p-4'],
    ['{ desktop: { p: 4 } }', 'desktop:p-4'],
    // Purely numeric token names (`--breakpoint-1280`) also hit the
    // numeric-key heuristic, which assumes an array or spread leaked in.
    ["{ '1280': { p: 4 } }", '1280:p-4'],
    ["{ '1440': { p: 4 } }", '1440:p-4'],
    ['{ hd: { p: 4 } }', 'hd:p-4'],
    ['{ wqhd: { p: 4 } }', 'wqhd:p-4'],
    ["{ '4k': { p: 4 } }", '4k:p-4'],
    ["{ '5k': { p: 4 } }", '5k:p-4'],
    // Nesting a known variant under a custom one must stay clean too.
    ['{ tablet: { hover: { p: 4 } } }', 'tablet:hover:p-4'],
];

/**
 * Transform one sz object and count warnings on BOTH channels.
 *
 * transform-core emits dev warnings through `console.warn` while the engine
 * returns them as diagnostics, so a comparison that reads only one channel
 * would call two identical behaviours a divergence.
 *
 * @param engine - The lane under test.
 * @param szObject - Source text of the sz object literal.
 * @returns The emitted className and how many warnings the lane produced.
 */
function warningCount(
    engine: (typeof ENGINES)[number][1],
    szObject: string,
): { className: string | undefined; warnings: number } {
    const source = `export const A = () => <div sz={${szObject}} />;`;
    const { className, warnings } = captureWarnings(engine, source);
    return { className, warnings: warnings.length };
}

describe.each(ENGINES)('%s lane', (_lane, engine) => {
    it.each(CUSTOM_VARIANT_SOURCES)('emits the variant class for %s', (szObject, expected) => {
        expect(warningCount(engine, szObject).className).toBe(expected);
    });

    it.each(CUSTOM_VARIANT_SOURCES)('stays silent for %s', szObject => {
        expect(warningCount(engine, szObject).warnings).toBe(0);
    });

    it('still reports a typo nested inside a custom variant', () => {
        // The false-positive fix must not silence the subtree: this is the
        // assertion that keeps it a targeted change.
        const result = warningCount(engine, '{ tablet: { zzznope: 4 } }');
        expect(result.warnings).toBeGreaterThan(0);
        expect(result.className).toBe('tablet:zzznope-4');
    });

    it('still reports a typo at the top level', () => {
        expect(warningCount(engine, '{ zzznope: 4 }').warnings).toBeGreaterThan(0);
    });

    it('still reports a typo two variants deep', () => {
        expect(
            warningCount(engine, '{ tablet: { hover: { zzznope: 4 } } }').warnings,
        ).toBeGreaterThan(0);
    });
});

describe.each(ENGINES)('%s lane, a block only the runtime can read', (_lane, engine) => {
    // A conditional spread makes the block a runtime fallback; the classes the
    // spread can add still reach the safelist under a known variant, and must
    // under the project's own (vui, 0.17.2: `desktop-sm:mt-19` had no CSS).
    const source = `const flag = Number(globalThis.location?.search?.length) > 3;
export const A = () => <>
<div sz={{ md: { mb: 15, ...(flag ? {} : { mt: 15 }) } }} />
<div sz={{ 'desktop-sm': { mb: 19, ...(flag ? {} : { mt: 19 }) } }} />
<div sz={{ tablet: { hover: { mb: 21, ...(flag ? {} : { mt: 21 }) } } }} />
</>;`;

    // The groups the build reads to merge and to place a dead class name the
    // classes the file emits: a spread's group under `hover` once named a bare
    // `mt-13` beside `hover:mb-13`.
    it('names in its merge groups only classes the file emits', () => {
        const result = engine(source, { filename: '/p/src/A.tsx' }) as {
            classes: Iterable<string>;
            mergeGroups?: ReadonlyArray<{ classes: string[] }>;
            singleClassGroups?: ReadonlyArray<{ classes: string[] }>;
        };
        const emitted = new Set(result.classes);
        const named = [...(result.mergeGroups ?? []), ...(result.singleClassGroups ?? [])].flatMap(
            group => group.classes,
        );
        expect(named.filter(className => !emitted.has(className))).toEqual([]);
        expect(named).toContain('tablet:hover:mt-21');
    });

    it('collects the spread classes under a custom variant as under a known one', () => {
        const classes = [
            ...(engine(source, { filename: '/p/src/A.tsx' }).classes as Iterable<string>),
        ].sort();
        expect(classes).toEqual([
            'desktop-sm:mb-19',
            'desktop-sm:mt-19',
            'md:mb-15',
            'md:mt-15',
            'tablet:hover:mb-21',
            'tablet:hover:mt-21',
        ]);
    });
});
