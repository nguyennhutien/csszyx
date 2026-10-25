/**
 * A value wrapped in the brackets csszyx writes itself, on every lane.
 *
 * Both lanes took the brackets off and put them back, so `w: '[100px]'` wrote
 * `w-[100px]`, while `w: '[1/2]'` wrote `w-[1/2]`, `width: 1/2`, and
 * `m: '-[var(--v)]'` nested them. One spelling is supported, the value
 * without its brackets: a wrapped one writes nothing and `bracketed-value`
 * names the key and what to write. Grid line names at both ends read as
 * wrapped too; they are written in `css: {…}`, which is never read so.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { escapeUnsafeChars } from '../../core/tests/helpers/sz-fuzz.js';
import { __resetSzWarnDedupForTests, transform } from '../src/transform-core.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';
import { szReportedCodes } from './helpers/sz-console-line.js';

/** What one lane wrote for an sz object, and the kinds it reported. */
interface LaneResult {
    className: string;
    kinds: string[];
}

/** One lane: an sz object in, its class and kinds out. */
type Lane = (sz: Record<string, unknown>) => LaneResult;

/**
 * The runtime lowering, its console warnings read back as their codes.
 *
 * @param sz - The sz object.
 * @returns What it wrote and reported.
 */
function runtimeLane(sz: Record<string, unknown>): LaneResult {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
    try {
        return { className: transform(sz as never).className, kinds: szReportedCodes(warnings) };
    } finally {
        console.warn = original;
    }
}

const LANES: ReadonlyArray<readonly [string, Lane]> = [
    ['runtime', runtimeLane],
    ...ENGINES.map(
        ([name, engine]) =>
            [
                name,
                (sz: Record<string, unknown>): LaneResult => {
                    const run = captureWarnings(
                        engine,
                        `export const A = () => <p sz={${escapeUnsafeChars(JSON.stringify(sz))}} />;`,
                        '/p/src/Bracketed.jsx',
                    );
                    return {
                        className: run.className ?? '',
                        kinds: (run.result.issues ?? []).map(issue => issue.code),
                    };
                },
            ] as const,
    ),
];

beforeEach(() => {
    __resetSzWarnDedupForTests();
});

describe.each(LANES)('a value wrapped in brackets — %s', (_name, lower) => {
    it.each([
        [{ w: '[100px]' }],
        [{ w: '[1/2]' }],
        [{ top: '-[1px]' }],
        [{ m: '-[var(--v)]' }],
        [{ w: '[calc(100% - 2px)]' }],
        [{ hover: { w: '[10px]' } }],
        [{ gridCols: '[a] 1fr [b]' }],
        // The important modifier sits outside the brackets.
        [{ w: '[10px]!' }],
        [{ top: '-[1px]!' }],
    ])('%j writes nothing and names the key', sz => {
        expect(lower(sz)).toEqual({ className: '', kinds: ['bracketed-value'] });
    });

    it.each([
        [{ gridCols: '[a] 1fr' }, 'grid-cols-[[a]_1fr]'],
        [{ css: { gridTemplateColumns: '[a] 1fr [b]' } }, '[grid-template-columns:[a]_1fr_[b]]'],
        [{ w: '100px' }, 'w-[100px]'],
        [{ '--cols': '[a]' }, '[--cols:[a]]'],
        // A bracket that never closes wraps nothing.
        [{ content: '[x' }, 'content-[[x]'],
    ])('%j is not wrapped, so it writes %s', (sz, className) => {
        expect(lower(sz)).toEqual({ className, kinds: [] });
    });
});
