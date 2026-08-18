/**
 * The property-key-receives-an-object warning fires on every engine.
 *
 * `sz={{ p: { bg: 'red-500' } }}` compiles to `p:bg-red-500` — `p:` matches no
 * Tailwind variant, so the styles silently generate no CSS. The JS lanes share
 * `warnPropertyObjectValue` in transform-core (console channel), the native
 * engine mirrors it as a diagnostic.
 *
 * The trap this suite exists to document: the shared warning DE-DUPLICATES by
 * property key process-wide, so measuring the lanes in sequence with the SAME
 * key makes whichever runs second look silent. That artifact was once filed as
 * "oxc lacks the warning" — it does not. Each lane therefore probes a DISTINCT
 * property key here.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { __resetSzWarnDedupForTests } from '../src/transform-core.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';
import { transformSource } from '../src/transform-select.js';
import { transformWasm } from '../src/transform-wasm.js';
import { captureWarnings, type ParityEngine } from './engine-parity-harness.js';

/** [lane, engine, property key]. Keys stay distinct so the dedup case
 * below can still observe a genuine second-lane silence. */
const LANES: ReadonlyArray<readonly [string, ParityEngine, string]> = [
    ['babel', transformSource, 'p'],
    ['oxc', transformWasm as ParityEngine, 'm'],
    ...(isRustTransformAvailable()
        ? ([['rust', transformRust as ParityEngine, 'w']] as const)
        : []),
];

beforeEach(() => {
    // The warning set is process-wide by design; without the reset the
    // suite would depend on no earlier test having probed these keys.
    __resetSzWarnDedupForTests();
});

describe('property-object warning parity', () => {
    it.each(LANES)('%s warns for a property key holding an object', (_lane, engine, key) => {
        const source = `export const A = () => <div sz={{ ${key}: { bg: 'red-500' } }} />;`;
        const { warnings } = captureWarnings(engine, source);
        const hit = warnings.find(message =>
            message.includes(`"${key}" is a property, not a variant`),
        );
        expect(hit, warnings.join('\n')).toBeDefined();
        expect(hit).toContain('generate no CSS');
    });

    it('reports through per-result diagnostics, identically on both artifacts', () => {
        // The deduplicating shared JS channel left with the JS lanes: the
        // engine reports per RESULT, so the same source always carries its
        // warning — no cross-call latch for a cache or a re-run to trip over.
        const source = "export const A = () => <div sz={{ mx: { bg: 'red-500' } }} />;";
        const first = transformSource(source, '/p/t.tsx');
        const second = transformWasm(source, '/p/t.tsx');
        expect(first.diagnostics.some(m => m.includes('"mx" is a property'))).toBe(true);
        expect(second.diagnostics).toEqual(first.diagnostics);
    });
});
