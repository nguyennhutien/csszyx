/**
 * `sz` lowering microbenchmark, on the `vitest bench` lane.
 *
 * Why this lane exists alongside the standalone harnesses in `scripts/`: those
 * measure a whole pipeline (a docs build, a Vite build, an HMR round trip) and
 * each carries its own runner, its own report and its own report format. A
 * per-function measurement needs none of that. `vitest bench` runs it inside the
 * test runner already configured for this package, on `tinybench`, which was
 * already in the dependency tree — so a new microbenchmark costs one file, not a
 * harness.
 *
 * What this lane is NOT: a gate. `vitest bench` reports wall clock, and wall
 * clock on a shared machine cannot be gated on an absolute threshold — the same
 * test suite in this repo has been measured at 187 ms alone and 17 197 ms under
 * load. Read the `rme` (relative margin of error) column before comparing two
 * runs at all; a figure with a wide margin has not measured a difference. The
 * way to gate a per-function cost is to move the metric off wall clock entirely,
 * onto instruction counts.
 *
 * Run: `pnpm --filter @csszyx/compiler bench`
 */
import { bench, describe } from 'vitest';
import type { SzObject } from '../src/transform-core.js';
import { deepMergeSzObjects, transform } from '../src/transform-core.js';

/** A flat object of plain utility keys — the shape most `sz` props have. */
const FLAT: SzObject = {
    p: 4,
    px: 2,
    m: 2,
    w: 'full',
    h: 'screen',
    bg: 'blue-500',
    text: 'white',
    rounded: 'lg',
};

/** The same properties behind variants, which is where prefixing work happens. */
const VARIANTS: SzObject = {
    p: 4,
    hover: { bg: 'blue-600', text: 'white' },
    md: { p: 8, w: 'auto' },
    dark: { bg: 'slate-900', hover: { bg: 'slate-800' } },
};

/** Nesting deep enough that prefix accumulation dominates the work. */
const DEEP: SzObject = {
    md: { dark: { hover: { focus: { p: 4, bg: 'blue-500' } } } },
};

/** A merge target, kept separate so the merge bench does not mutate the others. */
const MERGE_BASE: SzObject = { p: 4, hover: { bg: 'blue-600' }, md: { p: 8 } };
const MERGE_PATCH: SzObject = { m: 2, hover: { text: 'white' }, md: { w: 'auto' } };

describe('sz lowering', () => {
    bench('flat object, 8 keys', () => {
        transform(FLAT);
    });

    bench('variant groups, 3 levels wide', () => {
        transform(VARIANTS);
    });

    bench('four nested variants over 2 keys', () => {
        transform(DEEP);
    });
});

describe('sz merge', () => {
    bench('deepMergeSzObjects, disjoint keys', () => {
        deepMergeSzObjects(structuredClone(MERGE_BASE), MERGE_PATCH);
    });
});
