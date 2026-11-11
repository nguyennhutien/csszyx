/**
 * A colour object (`{ color, op }`) reads two members. Any other member wrote
 * nothing and said nothing: `ring: { 2: true, color: 'rose-500' }` emitted
 * `ring-rose-500` alone, the width gone without a word, on every lane. It is
 * named as the field the structured value does not take (`unknown-field`),
 * as a mask layer's stray member is, and the class the object writes is kept.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { __resetSzWarnDedupForTests, transform } from '../src/transform-core.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

/** One lane: an sz object's source in, its class and warnings out. */
type Lane = (sz: string) => { className: string; warnings: string[] };

const LANES: ReadonlyArray<readonly [string, Lane]> = [
    [
        'runtime',
        sz => {
            const warnings: string[] = [];
            const original = console.warn;
            console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
            try {
                const object = new Function(`return (${sz});`)() as never;
                return { className: transform(object).className, warnings };
            } finally {
                console.warn = original;
            }
        },
    ],
    ...ENGINES.map(
        ([name, engine]) =>
            [
                name,
                (sz: string) => {
                    const run = captureWarnings(
                        engine,
                        `export const A = () => <p sz={${sz}} />;`,
                        '/p/src/Ring.jsx',
                    );
                    return { className: run.className ?? '', warnings: run.warnings };
                },
            ] as const,
    ),
];

beforeEach(() => {
    __resetSzWarnDedupForTests();
});

describe.each(LANES)('a colour object member it does not read — %s', (_name, lower) => {
    it.each([
        ["{ ring: { 2: true, color: 'rose-500' } }", 'ring-rose-500', 'ring', '2'],
        ["{ ring: { width: 2, color: 'rose-500' } }", 'ring-rose-500', 'ring', 'width'],
        [
            "{ hover: { bg: { color: 'red-500', op: 50, size: 'cover' } } }",
            'hover:bg-red-500/50',
            'bg',
            'size',
        ],
    ])('%s writes %s and names `%s` field `%s`', (sz, className, owner, member) => {
        const run = lower(sz);
        expect(run.className).toBe(className);
        const line = run.warnings.find(warning => warning.includes('unknown-field'));
        expect(line).toContain(`\`${owner}\` has no field \`${member}\``);
        expect(line).toContain('`{ color, op }`');
    });

    it.each([
        ["{ ring: { color: 'rose-500' } }"],
        ["{ bg: { color: 'red-500', op: 50 } }"],
        ["{ ring: 2, ringColor: 'rose-500' }"],
    ])('%s says nothing', sz => {
        expect(lower(sz).warnings.filter(w => w.includes('unknown-field'))).toEqual([]);
    });
});

describe('an object whose `color` is not a string', () => {
    // The engine reads a colour object only when `color` is a string
    // (`is_color_object`); the runtime read any `color` member, so the two
    // lowered `{ bg: { color: 5 } }` differently.
    it.each([
        ['{ bg: { color: 5 } }'],
        ['{ bg: { color: true, op: 50 } }'],
        ['{ ring: { color: null } }'],
    ])('%s lowers alike on every lane', sz => {
        const runs = LANES.map(([, lower]) => {
            const run = lower(sz);
            // The code each warning carries, the first word after `[csszyx]`.
            const codes = run.warnings.map(line => /\[csszyx\] ([a-z-]+)/.exec(line)?.[1]);
            // `dev-warnings-partial` is the runtime's own line about where a
            // warning came from, not a finding.
            const findings = codes.filter(code => code !== 'dev-warnings-partial');
            return { className: run.className, codes: [...new Set(findings)].sort() };
        });
        const [runtime, ...engines] = runs;
        for (const engine of engines) expect(runtime).toEqual(engine);
    });
});

describe('the member check in production', () => {
    // The check is development only, its key walk with it: a production build
    // drops the block, so a colour object costs no key walk there. Counted on
    // the object's own `ownKeys`, which nothing else in the lowering calls.
    it.each([
        ['development', 1],
        ['production', 0],
    ])('walks a colour object’s keys %s: %i time(s)', (env, expected) => {
        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = env;
        const original = console.warn;
        console.warn = () => {};
        try {
            let walks = 0;
            const ring = new Proxy(
                { width: 2, color: 'rose-500' },
                {
                    ownKeys(target) {
                        walks++;
                        return Reflect.ownKeys(target);
                    },
                },
            );
            expect(transform({ ring } as never).className).toBe('ring-rose-500');
            expect(walks).toBe(expected);
        } finally {
            console.warn = original;
            process.env.NODE_ENV = previous;
        }
    });
});
