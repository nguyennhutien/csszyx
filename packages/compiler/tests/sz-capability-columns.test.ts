/**
 * The four capability columns closed in 0.18.0, on every lane.
 *
 * Each case is one sz object and the class every lane writes for it. The
 * runtime lowering, the wasm engine and the native engine must write the same
 * bytes. The table decides spelling only (`sz-capabilities.generated.ts`,
 * measured on the Tailwind this repo pins and gated across Tailwind versions in
 * this repo's CI); whether the project's Tailwind serves a class is the
 * build-time oracle's verdict, never a lane's. The oracle suite
 * `sz-capability-differential.test.ts` checks every key against Tailwind; this
 * file pins the decisions by example, so a failure names one.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { szDiagnosticKindOf } from '../src/sz-diagnostic-kind.js';
import { __resetSzWarnDedupForTests, transform } from '../src/transform-core.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

/** What one lane wrote for an sz object, and the kinds it reported. */
interface LaneResult {
    className: string;
    kinds: string[];
}

/** One sz object, as the runtime receives it and the engines read it. */
type Sz = Record<string, unknown>;

/** One lane: an sz object in, its class and diagnostic kinds out. */
type Lane = (sz: Sz) => LaneResult;

/**
 * The runtime lowering, its console warnings read back as kinds.
 *
 * @param sz - The sz object.
 * @returns What it wrote and reported.
 */
function runtimeLane(sz: Sz): LaneResult {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
    try {
        return {
            className: transform(sz as never).className,
            kinds: warnings.map(message => szDiagnosticKindOf(message)),
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
                (sz: Sz): LaneResult => {
                    // JSON is a JSX expression, so the engines read the same object.
                    const run = captureWarnings(
                        engine,
                        `export const A = () => <p sz={${JSON.stringify(sz)}} />;`,
                        '/p/src/Capability.jsx',
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

describe.each(LANES)('a sign on any key — %s', (_name, lower) => {
    // The sign goes onto the utility on every key (`-X-v`, Tailwind's spelling
    // on every v4). Whether the project's Tailwind serves that negative is the
    // build-time oracle's verdict (ADR 0012, 0022), so no lane judges it here.
    it.each([
        [{ p: -2 }, '-p-2'],
        [{ p: '-2' }, '-p-2'],
        [{ p: '-4!' }, '-p-4!'],
        [{ w: '-1/2' }, '-w-1/2'],
        [{ mt: '-1/2' }, '-mt-1/2'],
        [{ tracking: -2 }, '-tracking-2'],
        [{ hover: { p: -2 } }, 'hover:-p-2'],
        [{ colSpan: -2 }, '-col-span-2'],
        [{ mt: -2 }, '-mt-2'],
        [{ mt: '-2' }, '-mt-2'],
        [{ translateX: '-1/2' }, '-translate-x-1/2'],
        [{ insetS: '-1/2' }, '-start-1/2'],
        [{ mt: 2 }, 'mt-2'],
        // A length keeps its sign inside the bracket; nothing is hoisted.
        [{ p: '-10px' }, 'p-[-10px]'],
    ])('%j writes %s and reports nothing', (sz, className) => {
        const result = lower(sz);

        expect(result.className).toBe(className);
        expect(result.kinds).toEqual([]);
    });
});

describe.each(LANES)(
    'a CSS-wide keyword on a key whose bracket is its own property — %s',
    (_name, lower) => {
        it.each([
            [{ cursor: 'inherit' }, 'cursor-[inherit]'],
            [{ roundedT: 'unset' }, 'rounded-t-[unset]'],
            [{ delay: 'initial' }, 'delay-[initial]'],
            // A shared prefix: `object-[inherit]` sets `object-position`.
            [{ objectPos: 'inherit' }, 'object-[inherit]'],
            // Keys with a formatter of their own read the same column.
            [{ perspective: 'inherit' }, 'perspective-[inherit]'],
            [{ textShadow: 'unset' }, 'text-shadow-[unset]'],
            // Tailwind's own name still wins over the bracket.
            [{ accent: 'inherit' }, 'accent-inherit'],
            [{ textShadow: 'inherit' }, 'text-shadow-inherit'],
        ])('%j writes %s', (sz, className) => {
            expect(lower(sz).className).toBe(className);
        });

        it.each([
            // `space-x-[inherit]` writes `calc(inherit * …)`, invalid CSS.
            [{ spaceX: 'inherit' }, 'space-x-inherit'],
            // `hue-rotate-[inherit]` writes `hue-rotate(inherit)`, invalid CSS.
            [{ hueRotate: 'inherit' }, 'hue-rotate-inherit'],
            // `translate-x-[inherit]` sets a variable, not `translate`.
            [{ translateX: 'inherit' }, 'translate-x-inherit'],
        ])(
            '%j does not bracket, since the bracket would not set the property (%s)',
            (sz, className) => {
                expect(lower(sz).className).toBe(className);
            },
        );

        it('does not bracket on a key it does not know, which has no property to set', () => {
            // An unknown key is still written as a literal class (a project may
            // serve it with `@utility`), so the keyword stays as written.
            const result = lower({ fooBar: 'inherit' });

            expect(result.className).toBe('foo-bar-inherit');
            expect(result.kinds).toContain('unknown-key');
        });
    },
);

describe.each(LANES)('decoration with a value that is not a line keyword — %s', (_name, lower) => {
    it.each([
        [{ decoration: 'red-500' }, 'decoration-red-500'],
        [{ decoration: 'wavy' }, 'decoration-wavy'],
        [{ decoration: 'inherit' }, 'decoration-inherit'],
        [{ decoration: '2px' }, 'decoration-[2px]'],
        [{ decoration: 'underline' }, 'underline'],
        [{ decoration: 'none' }, 'no-underline'],
    ])('%j writes %s', (sz, className) => {
        expect(lower(sz).className).toBe(className);
    });
});

describe.each(LANES)('the important suffix on a scale or filter value — %s', (_name, lower) => {
    it.each([
        [{ scale: '1.5!' }, 'scale-[1.5]!'],
        [{ scale: 'none!' }, 'scale-none!'],
        [{ brightness: '1.25!' }, 'brightness-[1.25]!'],
        [{ backdropSaturate: '2!' }, 'backdrop-saturate-[2]!'],
        [{ contrast: '--c!' }, 'contrast-(--c)!'],
        [{ scale: '1.5' }, 'scale-[1.5]'],
    ])('%j writes %s', (sz, className) => {
        expect(lower(sz).className).toBe(className);
    });
});
