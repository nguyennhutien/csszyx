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
 * Every lane, for an sz object that holds `op` where `wrap` puts it.
 *
 * @param wrap - The sz object's JS source, given `op`'s.
 * @returns The runtime lowering and each engine.
 */
function lanes(wrap: (op: string) => string): ReadonlyArray<readonly [string, Lane]> {
    const runtime: Lane = op => {
        const warnings: string[] = [];
        const original = console.warn;
        console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
        try {
            const sz = new Function(`return (${wrap(op)});`)() as never;
            return { className: transform(sz).className, kinds: szReportedCodes(warnings) };
        } finally {
            console.warn = original;
        }
    };
    return [
        ['runtime', runtime],
        ...ENGINES.map(
            ([name, engine]) =>
                [
                    name,
                    (op: string): LaneResult => {
                        const run = captureWarnings(
                            engine,
                            `export const A = () => <p sz={${wrap(op)}} />;`,
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
}

const LANES = lanes(op => `{ bg: { color: 'red-500', op: ${op} } }`);
const runtimeLane = (LANES[0] as readonly [string, Lane])[1];

beforeEach(() => {
    __resetSzWarnDedupForTests();
});

describe.each(LANES)('the opacity of a colour object — %s', (_name, lower) => {
    it.each([
        ['0', 'bg-red-500/0'],
        ['5', 'bg-red-500/5'],
        ['88', 'bg-red-500/88'],
        ['100', 'bg-red-500/100'],
        ['12.25', 'bg-red-500/12.25'],
        ['88.75', 'bg-red-500/88.75'],
        ['33.3', 'bg-red-500/[33.3%]'],
    ])('op: %s writes %s', (op, className) => {
        expect(lower(op)).toEqual({ className, kinds: [] });
    });

    it.each(['-20', '150', '100.5', '1e21', "'20'", "'150%'", "'-5%'", 'true'])(
        'op: %s is not an opacity, so the colour is written without one',
        op => {
            expect(lower(op)).toEqual({ className: 'bg-red-500', kinds: ['opacity-value'] });
        },
    );

    // 0.17 bracketed a decimal below 1 and Tailwind read it as a fraction of
    // one (`op: 0.05` was 5%); a percent says so, with the percent to write.
    it.each([
        ['0.05', 'bg-red-500/[0.05%]'],
        ['0.25', 'bg-red-500/0.25'],
        ['0.5', 'bg-red-500/0.5'],
    ])('op: %s writes %s and says it is a percent', (op, className) => {
        expect(lower(op)).toEqual({ className, kinds: ['opacity-value'] });
    });

    it.each([
        ['0', 'bg-red-500/0'],
        ['1', 'bg-red-500/1'],
    ])('op: %s is no fraction to report', (op, className) => {
        expect(lower(op)).toEqual({ className, kinds: [] });
    });

    it('reads a null op as no op, as any null value', () => {
        expect(lower('null')).toEqual({ className: 'bg-red-500', kinds: [] });
    });

    it('writes a small decimal without an exponent', () => {
        expect(lower('1e-7')).toEqual({
            className: 'bg-red-500/[0.0000001%]',
            kinds: ['opacity-value'],
        });
    });

    it('keeps a percent string from 0 to 100 as written', () => {
        expect(lower("'78%'")).toEqual({ className: 'bg-red-500/[78%]', kinds: [] });
        expect(lower("'33.3%'")).toEqual({ className: 'bg-red-500/[33.3%]', kinds: [] });
    });

    it('keeps a custom property as the opacity', () => {
        expect(lower("'--a'")).toEqual({ className: 'bg-red-500/(--a)', kinds: [] });
    });
});

describe.each(lanes(op => `{ maskLinear: { from: { color: 'red-500', op: ${op} } } }`))(
    'the opacity of a mask stop colour — %s',
    (_name, lower) => {
        // The same spelling as a colour object's (vui pattern audit): the stop
        // wrote `/${op}` as given, `/33.3` and `/--x`.
        it.each([
            ['50', 'mask-linear-from-red-500/50'],
            ['33.3', 'mask-linear-from-red-500/[33.3%]'],
            ["'--x'", 'mask-linear-from-red-500/(--x)'],
            ["'40%'", 'mask-linear-from-red-500/[40%]'],
        ])('op: %s writes %s', (op, className) => {
            expect(lower(op).className).toBe(className);
        });

        it('op: 0.05 is said to be a percent at a stop too', () => {
            expect(lower('0.05')).toEqual({
                className: 'mask-linear-from-red-500/[0.05%]',
                kinds: ['opacity-value'],
            });
        });

        it.each(['150', 'true', "'abc'"])(
            'op: %s is not an opacity, so the colour stands alone',
            op => {
                expect(lower(op)).toEqual({
                    className: 'mask-linear-from-red-500',
                    kinds: ['opacity-value'],
                });
            },
        );
    },
);

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
