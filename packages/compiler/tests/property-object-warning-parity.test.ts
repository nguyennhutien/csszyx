/**
 * The property-key-receives-an-object warning fires on every engine.
 *
 * `sz={{ p: { bg: 'red-500' } }}` compiles to `p:bg-red-500` — `p:` matches no
 * Tailwind variant, so the styles silently generate no CSS. The removed JS
 * lanes shared `warnPropertyObjectValue` in transform-core (console channel);
 * the Rust engine reports it as a per-result diagnostic.
 *
 * The trap this suite documents: the transform-core warning DE-DUPLICATES by
 * property key process-wide, so measuring lanes in sequence with the SAME key
 * made whichever ran second look silent. That artifact was once filed as "oxc
 * lacks the warning" — it did not. Each artifact therefore probes a DISTINCT
 * property key here.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { __resetSzWarnDedupForTests } from '../src/transform-core.js';
import { transformWasm } from '../src/transform-wasm.js';
import { captureWarnings, ENGINES, type ParityEngine } from './engine-parity-harness.js';

/**
 * Both artifacts of the one engine, each probing a DIFFERENT property key so
 * the dedup case below can still observe a genuine second-lane silence. The
 * shared list drops the `auto` selector — `transform-select.test.ts` owns
 * that — and refuses to run in CI with the native artifact missing.
 */
const LANES: ReadonlyArray<readonly [string, ParityEngine, string]> = ENGINES.map(
    ([lane, engine], index) => [lane, engine, (['p', 'm'] as const)[index] ?? 'w'] as const,
);

beforeEach(() => {
    // The warning set is process-wide by design; without the reset the
    // suite would depend on no earlier test having probed these keys.
    __resetSzWarnDedupForTests();
});

describe('property-object warning parity', () => {
    it.each(LANES)('%s warns for a property key holding an object', (_lane, engine, key) => {
        const source = `export const A = () => <div sz={{ ${key}: { bg: 'red-500' } }} />;`;
        const { warnings, result } = captureWarnings(engine, source);
        expect(result.issues?.map(issue => [issue.code, issue.args])).toEqual([
            ['property-object', expect.objectContaining({ key })],
        ]);
        const [hit] = warnings;
        expect(hit).toContain(
            `\`${key}\` sets a property and is not a variant, so its object \`{ bg }\` emits \`${key}:*\` classes that produce no CSS.`,
        );
    });

    it('reports through per-result diagnostics, identically on both artifacts', () => {
        // The deduplicating shared JS channel left with the JS lanes: the
        // engine reports per RESULT, so the same source always carries its
        // warning — no cross-call latch for a cache or a re-run to trip over.
        const source = "export const A = () => <div sz={{ mx: { bg: 'red-500' } }} />;";
        const wasm = transformWasm(source, '/p/t.tsx');
        expect(
            wasm.issues.map(issue => [issue.code, (issue.args as { key?: string }).key]),
        ).toEqual([['property-object', 'mx']]);
        for (const [name, engine] of ENGINES) {
            expect(engine(source, '/p/t.tsx').diagnostics, name).toEqual(wasm.diagnostics);
        }
    });
});
