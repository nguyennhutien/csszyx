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
import { transformSourceCode } from '../src/transform.js';
import { __resetSzWarnDedupForTests } from '../src/transform-core.js';
import { transformOxc } from '../src/transform-oxc.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';
import { captureWarnings, type TriEngine } from './tri-engine-harness.js';

/** [lane, engine, property key]. Keys stay distinct so the dedup case
 * below can still observe a genuine second-lane silence. */
const LANES: ReadonlyArray<readonly [string, TriEngine, string]> = [
    ['babel', transformSourceCode, 'p'],
    ['oxc', transformOxc as TriEngine, 'm'],
    ...(isRustTransformAvailable() ? ([['rust', transformRust as TriEngine, 'w']] as const) : []),
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

    it('deduplicates per property key across the shared JS channel', () => {
        // Both JS lanes route through one transform-core warning set: the
        // second lane probing the SAME key is silent BY DESIGN. This is the
        // artifact that once read as a missing oxc warning.
        const source = "export const A = () => <div sz={{ mx: { bg: 'red-500' } }} />;";
        const first = captureWarnings(transformSourceCode as TriEngine, source);
        expect(first.warnings.some(m => m.includes('"mx" is a property'))).toBe(true);
        const second = captureWarnings(transformOxc as TriEngine, source);
        expect(second.warnings.some(m => m.includes('"mx" is a property'))).toBe(false);
    });
});
