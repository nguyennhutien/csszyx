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
import { describe, expect, it } from 'vitest';
import { transformSourceCode } from '../src/transform.js';
import { transformOxc } from '../src/transform-oxc.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';

type Engine = (source: string, filename?: string) => { diagnostics?: string[] };

/** [lane, engine, distinct property key] — one key per lane, dodging dedup. */
const LANES: ReadonlyArray<readonly [string, Engine, string]> = [
    ['babel', transformSourceCode, 'p'],
    ['oxc', transformOxc as Engine, 'm'],
    ...(isRustTransformAvailable() ? ([['rust', transformRust as Engine, 'w']] as const) : []),
];

/**
 * Collect warnings from both channels for one source.
 *
 * @param engine - Engine entry under test.
 * @param source - Full module source.
 * @returns Non-noise warnings from diagnostics and console.
 */
function warningsFor(engine: Engine, source: string): string[] {
    const logged: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
    };
    let result: { diagnostics?: string[] };
    try {
        result = engine(source, '/p/t.tsx');
    } finally {
        console.warn = original;
    }
    return [...(result.diagnostics ?? []).map(String), ...logged].filter(
        message => !message.includes('Tip: run'),
    );
}

describe('property-object warning parity', () => {
    it.each(LANES)('%s warns for a property key holding an object', (_lane, engine, key) => {
        const source = `export const A = () => <div sz={{ ${key}: { bg: 'red-500' } }} />;`;
        const warnings = warningsFor(engine, source);
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
        const first = warningsFor(transformSourceCode, source);
        expect(first.some(m => m.includes('"mx" is a property'))).toBe(true);
        const second = warningsFor(transformOxc as Engine, source);
        expect(second.some(m => m.includes('"mx" is a property'))).toBe(false);
    });
});
