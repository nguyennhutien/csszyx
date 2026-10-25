/**
 * The opacity of a colour object, on every lane.
 *
 * Tailwind reads a bracketed modifier as a fraction of one: `bg-red-500/[33.3]`
 * is 3,330% and `/[20]` is 2,000%, both clamped to an opaque colour with no
 * warning, since the class is served. A quarter step is served bare on every
 * Tailwind v4 (4.0.0 measured), and any other number in range keeps its percent
 * in the brackets (`/[33.3%]`), as a percent string does. Anything else is not an opacity: the colour is written without
 * one and `opacity-value` names the key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSzWarnDedupForTests, transform } from '../src/transform-core.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';
import { szReportedCodes } from './helpers/sz-console-line.js';

/** What one lane wrote for an sz object, and the kinds it reported. */
interface LaneResult {
    className: string;
    kinds: string[];
}

/** One lane: an `op` written as JS source in, its class and kinds out. */
type Lane = (op: string) => LaneResult;

/**
 * The runtime lowering of `{ bg: { color: 'red-500', op } }`.
 *
 * @param op - The `op` value as JS source.
 * @returns What it wrote and reported.
 */
function runtimeLane(op: string): LaneResult {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
    try {
        const value = new Function(`return (${op});`)() as unknown;
        return {
            className: transform({ bg: { color: 'red-500', op: value } } as never).className,
            kinds: szReportedCodes(warnings),
        };
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
                (op: string): LaneResult => {
                    const run = captureWarnings(
                        engine,
                        `export const A = () => <p sz={{ bg: { color: 'red-500', op: ${op} } }} />;`,
                        '/p/src/Opacity.jsx',
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

describe.each(LANES)('the opacity of a colour object — %s', (_name, lower) => {
    it.each([
        ['0', 'bg-red-500/0'],
        ['5', 'bg-red-500/5'],
        ['88', 'bg-red-500/88'],
        ['100', 'bg-red-500/100'],
        ['0.5', 'bg-red-500/0.5'],
        ['12.25', 'bg-red-500/12.25'],
        ['88.75', 'bg-red-500/88.75'],
        ['33.3', 'bg-red-500/[33.3%]'],
        ['0.05', 'bg-red-500/[0.05%]'],
    ])('op: %s writes %s', (op, className) => {
        expect(lower(op)).toEqual({ className, kinds: [] });
    });

    it.each(['-20', '150', '100.5', '1e21', "'20'", "'150%'", "'-5%'", 'true'])(
        'op: %s is not an opacity, so the colour is written without one',
        op => {
            expect(lower(op)).toEqual({ className: 'bg-red-500', kinds: ['opacity-value'] });
        },
    );

    it('reads a null op as no op, as any null value', () => {
        expect(lower('null')).toEqual({ className: 'bg-red-500', kinds: [] });
    });

    it('writes a small decimal without an exponent', () => {
        expect(lower('1e-7')).toEqual({ className: 'bg-red-500/[0.0000001%]', kinds: [] });
    });

    it('keeps a percent string from 0 to 100 as written', () => {
        expect(lower("'78%'")).toEqual({ className: 'bg-red-500/[78%]', kinds: [] });
        expect(lower("'33.3%'")).toEqual({ className: 'bg-red-500/[33.3%]', kinds: [] });
    });

    it('keeps a custom property as the opacity', () => {
        expect(lower("'--a'")).toEqual({ className: 'bg-red-500/(--a)', kinds: [] });
    });
});

describe('the runtime opacity-value warning', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('is said once per key and op, in development only, and not when muted', () => {
        const first = runtimeLane('150');
        const again = runtimeLane('150');
        vi.stubEnv('CSSZYX_QUIET_SZ_WARNINGS', '1');
        const muted = runtimeLane('151');
        vi.unstubAllEnvs();
        vi.stubEnv('NODE_ENV', 'production');
        const production = runtimeLane('152');

        expect(first.kinds).toEqual(['opacity-value']);
        expect(again.kinds).toEqual([]);
        expect(muted).toEqual({ className: 'bg-red-500', kinds: [] });
        expect(production).toEqual({ className: 'bg-red-500', kinds: [] });
    });
});
