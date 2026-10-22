/**
 * Spellings both lanes write the same way, on every Tailwind v4.
 *
 * One csszyx release serves every Tailwind v4 a project may have (ADR 0023),
 * so a class the lowering writes must be spelled by a convention every v4
 * serves the same. Each case below was measured against Tailwind 4.0.0,
 * 4.0.17, 4.1.0, 4.1.18, 4.2.0, 4.2.4, 4.3.0 and 4.3.3: the class is served on
 * all eight with the CSS 4.3.3 gives it. The runtime lowering, the wasm engine
 * and the native engine must write the same bytes and report the same kinds.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSzWarnDedupForTests, setSzWarnLocation, transform } from '../src/transform-core.js';
import { engineMessage, productionMessage } from './engine-message.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';
import { szReportedCodes } from './helpers/sz-console-line.js';

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
 * The runtime lowering, its console warnings read back as their codes.
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
                (sz: Sz): LaneResult => {
                    // JSON is a JSX expression, so the engines read the same object.
                    const run = captureWarnings(
                        engine,
                        `export const A = () => <p sz={${JSON.stringify(sz)}} />;`,
                        '/p/src/Spelling.jsx',
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

describe.each(LANES)('logical inline insets — %s', (_name, lower) => {
    // `inset-s-*` / `inset-e-*` exist from Tailwind 4.2 only; `start-*` /
    // `end-*` are served on every v4 with the same declaration.
    it.each([
        [{ start: 2 }, 'start-2'],
        [{ end: 2 }, 'end-2'],
        [{ insetS: 4 }, 'start-4'],
        [{ insetE: '1/2' }, 'end-1/2'],
        [{ start: -2 }, '-start-2'],
        [{ insetE: '-1/2' }, '-end-1/2'],
        [{ start: 'px' }, 'start-px'],
        [{ end: 'auto' }, 'end-auto'],
        [{ insetE: 'full' }, 'end-full'],
        [{ start: '10px' }, 'start-[10px]'],
        [{ insetS: '--x' }, 'start-(--x)'],
        [{ start: 'inherit' }, 'start-[inherit]'],
        [{ hover: { insetS: 2 } }, 'hover:start-2'],
    ])('%j writes %s', (sz, className) => {
        const result = lower(sz);

        expect(result.className).toBe(className);
        expect(result.kinds).toEqual([]);
    });
});

describe.each(LANES)('background size — %s', (_name, lower) => {
    // `bg-size-*` exists from Tailwind 4.1 only; the `length:` hint inside
    // `bg-[…]` / `bg-(…)` is served on every v4 with the same declaration.
    it.each([
        [{ bgSize: 'cover' }, 'bg-cover'],
        [{ bgSize: 'auto' }, 'bg-auto'],
        [{ bgSize: '10px' }, 'bg-[length:10px]'],
        [{ bgSize: '8px 8px' }, 'bg-[length:8px_8px]'],
        [{ bgSize: 'calc(100% - 2px)' }, 'bg-[length:calc(100%_-_2px)]'],
        [{ bgSize: 'inherit' }, 'bg-[length:inherit]'],
        [{ bgSize: '50%!' }, 'bg-[length:50%]!'],
        [{ bgSize: '--x' }, 'bg-(length:--x)'],
        [{ before: { bgSize: '24px 24px' } }, 'before:bg-[length:24px_24px]'],
    ])('%j writes %s', (sz, className) => {
        const result = lower(sz);

        expect(result.className).toBe(className);
        expect(result.kinds).toEqual([]);
    });
});

describe.each(LANES)(
    'background position, repeat and the important modifier — %s',
    (_name, lower) => {
        // `bg-(--x)` sets background-color, so a custom property on `bgPos` takes
        // the `position:` hint, served on every v4 like `length:` on `bgSize`. The
        // important modifier is split off before a value is read, as on every
        // other key: `bgRepeat: 'repeat!'` is `bg-repeat!`, not `bg-repeat-repeat!`.
        it.each([
            [{ bgPos: '--x' }, 'bg-(position:--x)'],
            [{ bgPos: '--x!' }, 'bg-(position:--x)!'],
            [{ bgPos: '10px 20px!' }, 'bg-[10px_20px]!'],
            [{ bgPos: 'center!' }, 'bg-center!'],
            [{ bgRepeat: 'repeat!' }, 'bg-repeat!'],
            [{ bgRepeat: 'no-repeat!' }, 'bg-no-repeat!'],
            [{ bgRepeat: 'space!' }, 'bg-repeat-space!'],
            [{ bgSize: 'cover!' }, 'bg-cover!'],
        ])('%j writes %s', (sz, className) => {
            const result = lower(sz);

            expect(result.className).toBe(className);
            expect(result.kinds).toEqual([]);
        });
    },
);

describe.each(LANES)('mask keys and the important modifier — %s', (_name, lower) => {
    // Tailwind serves the mask utilities from 4.1; each class below is served
    // with `!important` on 4.1.0 through 4.3.3. The important modifier is split
    // off before a value is read, so a keyword the formatter renames or keeps
    // bare is still recognised.
    it.each([
        [{ maskRepeat: 'space!' }, 'mask-repeat-space!'],
        [{ maskRepeat: 'repeat!' }, 'mask-repeat!'],
        [{ maskSize: '50%!' }, 'mask-size-[50%]!'],
        [{ maskSize: 'cover!' }, 'mask-cover!'],
        [{ maskSize: '--x!' }, 'mask-size-(--x)!'],
        [{ maskPos: 'center!' }, 'mask-center!'],
        [{ maskPos: '10px 20px!' }, 'mask-position-[10px_20px]!'],
        [{ maskPos: '--x!' }, 'mask-position-(--x)!'],
        [{ maskMode: 'match-source!' }, 'mask-match!'],
        [{ maskMode: 'alpha!' }, 'mask-alpha!'],
        [{ maskClip: 'no-clip!' }, 'mask-no-clip!'],
        [{ maskClip: 'border!' }, 'mask-clip-border!'],
        [{ maskType: 'alpha!' }, 'mask-type-alpha!'],
        [{ maskComposite: 'add!' }, 'mask-add!'],
    ])('%j writes %s', (sz, className) => {
        const result = lower(sz);

        expect(result.className).toBe(className);
        expect(result.kinds).toEqual([]);
    });
});

describe.each(ENGINES)(
    'a runtime value on a key whose variable takes a hint — %s',
    (_name, engine) => {
        // The hoisted variable is spelled as a static `--x` value is: without the
        // hint Tailwind reads `bg-(--v)` as a colour and `shadow-(--v)` as the
        // shadow itself. Served with the hint on every v4 that has the utility.
        it.each([
            ['bgPos', 'bg-(position:--_sz-bg-pos)'],
            ['shadowColor', 'shadow-(color:--_sz-shadow-color)'],
            ['insetShadowColor', 'inset-shadow-(color:--_sz-inset-shadow-color)'],
            ['textShadowColor', 'text-shadow-(color:--_sz-text-shadow-color)'],
            ['dropShadowColor', 'drop-shadow-(color:--_sz-drop-shadow-color)'],
            // `font-(--v)` is the weight on every v4, so it takes none.
            ['weight', 'font-(--_sz-weight)'],
        ])('%s writes %s', (key, className) => {
            const run = captureWarnings(
                engine,
                `export const A = ({ x }) => <p sz={{ ${key}: x }} />;`,
                '/p/src/Spelling.jsx',
            );

            expect(run.className).toBe(className);
            expect(run.warnings).toEqual([]);
        });
    },
);

describe.each(LANES)('a variant key the project names — %s', (_name, lower) => {
    // The variant namespace is open (`@custom-variant`, `--breakpoint-*`), so a
    // key no table claims is a variant, spelled in kebab-case like every other
    // camelCase key. The runtime always did; the engines wrote it as typed.
    it.each([
        [{ tabletLarge: { p: 1 } }, 'tablet-large:p-1'],
        [{ hoverFocus: { p: 1 } }, 'hover-focus:p-1'],
        [{ maskT: { p: 1 } }, 'mask-t:p-1'],
        [{ md: { tabletLarge: { p: 1 } } }, 'md:tablet-large:p-1'],
        [{ tablet: { p: 1 } }, 'tablet:p-1'],
        [{ 'desktop-sm': { p: 1 } }, 'desktop-sm:p-1'],
        [{ '[& > li]': { p: 1 } }, '[&>li]:p-1'],
        [{ '@md': { p: 1 } }, '@md:p-1'],
    ])('%j writes %s and reports nothing', (sz, className) => {
        const result = lower(sz);

        expect(result.className).toBe(className);
        expect(result.kinds).toEqual([]);
    });

    it('spells a property key holding an object the same way, and reports it', () => {
        const result = lower({ minW: { p: 1 } });

        expect(result.className).toBe('min-w:p-1');
        expect(result.kinds).toEqual(['property-object']);
    });
});

describe.each(ENGINES)('a project variant around a runtime value — %s', (_name, engine) => {
    it('spells the variant of the css-variable class in kebab-case', () => {
        const run = captureWarnings(
            engine,
            'export const A = ({ x }) => <p sz={{ md: { tabletLarge: { p: x } } }} />;',
            '/p/src/Spelling.jsx',
        );

        expect(run.className).toBe('md:tablet-large:p-(--_sz-md-tablet-large-p)');
        expect(run.result.code).toContain('"--_sz-md-tablet-large-p": __szSpacingVar(x, "p")');
    });
});

describe.each(LANES)('a slash opacity string — %s', (_name, lower) => {
    // A colour utility takes Tailwind's `/opacity` modifier on every v4. On a
    // key whose prefix also takes a colour the class is the one Tailwind
    // serves; the lanes write it rather than drop it with nothing said.
    it.each([
        [{ decoration: 'red-500/50' }, 'decoration-red-500/50'],
        [{ text: 'red-500/50' }, 'text-red-500/50'],
        [{ text: 'red-500/50!' }, 'text-red-500/50!'],
        [{ border: 'red-500/50' }, 'border-red-500/50'],
        [{ ring: 'red-500/50' }, 'ring-red-500/50'],
        [{ outline: 'red-500/50' }, 'outline-red-500/50'],
        [{ hover: { text: 'white/50' } }, 'hover:text-white/50'],
    ])('%j writes %s', (sz, className) => {
        const result = lower(sz);

        expect(result.className).toBe(className);
        expect(result.kinds).toEqual([]);
    });

    it('writes the class as given on a key that takes no colour', () => {
        // Whether the project's Tailwind serves `p-red-500/50` (or an
        // `@utility p-*` of its own) is the build-time oracle's verdict, not a
        // lane's; both lanes write the same class and leave it to the oracle.
        const result = lower({ p: 'red-500/50' });

        expect(result.className).toBe('p-red-500/50');
        expect(result.kinds).toEqual([]);
    });

    it.each([
        [{ bg: 'red-500/50' }],
        [{ color: 'red-500/50' }],
        [{ borderColor: 'red-500/50!' }],
        [{ hover: { from: 'red-500/50' } }],
    ])('drops %j on a colour key, which takes the object form, and says so', sz => {
        // Nothing is emitted, so the drop is missing output (ADR 0011): every
        // lane reports it, the engines with the code the runtime text maps to.
        const result = lower(sz);

        expect(result.className).toBe('');
        expect(result.kinds).toEqual(['slash-opacity-string']);
    });

    it('reports nothing for the object form or a key the slash is served on', () => {
        expect(lower({ bg: { color: 'red-500', op: 50 } }).kinds).toEqual([]);
        expect(lower({ text: 'red-500/50' }).kinds).toEqual([]);
    });
});

describe('the slash opacity diagnostic', () => {
    // Both lanes render the registry's text; the runtime has no column.
    const lines = [
        "`bg: 'red-500/50'` emits nothing: a string value cannot carry a slash opacity.",
        "help: use the object form: `{ color: 'red-500', op: 50 }`.",
    ];
    const expected = engineMessage('slash-opacity-string', '/p/src/Spelling.jsx:1', ...lines);
    const engineExpected = engineMessage(
        'slash-opacity-string',
        '/p/src/Spelling.jsx:1:33',
        ...lines,
    );

    it.each(ENGINES)('%s renders the registry text, bang removed', (_name, engine) => {
        const run = captureWarnings(
            engine,
            "export const A = () => <p sz={{ bg: 'red-500/50!', p: 2 }} />;",
            '/p/src/Spelling.jsx',
        );

        expect(run.className).toBe('p-2');
        expect(run.warnings).toEqual([engineExpected]);
        expect(run.result.issues?.map(issue => [issue.code, issue.args])).toEqual([
            ['slash-opacity-string', { key: 'bg', color: 'red-500', opacity: '50' }],
        ]);
    });

    it('the runtime prints the same text once, and its code in production too', () => {
        // The class is missing, so it is not a development nudge (ADR 0011).
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setSzWarnLocation('/p/src/Spelling.jsx:1');
        try {
            expect(transform({ bg: 'red-500/50!', p: 2 }).className).toBe('p-2');
            transform({ bg: 'red-500/50' });
            expect(warn.mock.calls).toEqual([[expected]]);

            warn.mockClear();
            __resetSzWarnDedupForTests();
            vi.stubEnv('NODE_ENV', 'production');
            transform({ bg: 'red-500/50' });
            transform({ bg: 'red-500/50' });
            expect(warn.mock.calls).toEqual([
                [
                    productionMessage('slash-opacity-string', {
                        key: 'bg',
                        color: 'red-500',
                        opacity: '50',
                    }),
                ],
            ]);
        } finally {
            setSzWarnLocation(undefined);
            vi.unstubAllEnvs();
            warn.mockRestore();
        }
    });
});

describe.each(LANES)('a slash opacity in a colour object — %s', (_name, lower) => {
    // A colour object takes its opacity in `op`, the one spelling (user
    // decision). A slash in `color` still writes a class Tailwind serves, and
    // the lanes point at `op`; with both, `op` is the opacity, so
    // `{ color: 'red-500/50', op: 20 }` no longer writes `bg-red-500/50/50`.
    it.each([
        [{ bg: { color: 'red-500/50' } }, 'bg-red-500/50'],
        [{ bg: { color: 'red-500/50', op: 20 } }, 'bg-red-500/20'],
        [{ hover: { bg: { color: 'red-500/50', op: 20 } } }, 'hover:bg-red-500/20'],
        [{ borderColor: { color: 'blue-600/75', op: 20 } }, 'border-blue-600/20'],
    ])('%j writes %s and points at op', (sz, className) => {
        const result = lower(sz);

        expect(result.className).toBe(className);
        expect(result.kinds).toEqual(['color-slash-opacity']);
    });

    it('reports nothing for the object form', () => {
        const result = lower({ bg: { color: 'red-500', op: 20 } });

        expect(result.className).toBe('bg-red-500/20');
        expect(result.kinds).toEqual([]);
    });

    // The important modifier ends the class: `bg-red-500!/20` is a class no
    // Tailwind serves, `bg-red-500/20!` is the important one.
    it.each([
        [{ bg: { color: 'red-500!', op: 20 } }, 'bg-red-500/20!', []],
        [{ bg: { color: 'red-500/50!' } }, 'bg-red-500/50!', ['color-slash-opacity']],
        [{ bg: { color: 'red-500/50!', op: 20 } }, 'bg-red-500/20!', ['color-slash-opacity']],
    ])('%j keeps the important modifier at the end: %s', (sz, className, kinds) => {
        const result = lower(sz);

        expect(result.className).toBe(className);
        expect(result.kinds).toEqual(kinds);
    });

    // Only a plain opacity after the slash is one `op` can take; anything else
    // is written as given and judged by the project's Tailwind at build.
    it.each([
        [{ bg: { color: 'red-500/' } }, 'bg-red-500/'],
        [{ bg: { color: 'red-500/50/30' } }, 'bg-red-500/50/30'],
    ])('%j is not an opacity op can take, and is written as given', (sz, className) => {
        const result = lower(sz);

        expect(result.className).toBe(className);
        expect(result.kinds).toEqual([]);
    });
});

describe('the colour-object slash opacity diagnostic', () => {
    // Both lanes render the registry's text; the runtime has no column.
    const withOpLines = [
        "`bg: { color: 'red-500/50', op: 20 }` sets opacity twice; a colour object takes its opacity in `op`, not in `color`.",
        "help: write `{ color: 'red-500', op: 20 }`.",
        'note: the class uses `op: 20`; the `/50` in `color` is ignored.',
    ];
    const runtimeWithOp = engineMessage(
        'color-slash-opacity',
        '/p/src/Spelling.jsx:1',
        ...withOpLines,
    );
    const withOp = engineMessage('color-slash-opacity', '/p/src/Spelling.jsx:1:33', ...withOpLines);
    const withoutOp = engineMessage(
        'color-slash-opacity',
        '/p/src/Spelling.jsx:1:33',
        "`bg: { color: 'red-500/50' }` puts the opacity in `color`; a colour object takes it in `op`.",
        "help: write `{ color: 'red-500', op: 50 }`.",
        'note: the class still applies opacity 50.',
    );

    it.each(ENGINES)('%s renders the registry text', (_name, engine) => {
        const run = captureWarnings(
            engine,
            "export const A = () => <p sz={{ bg: { color: 'red-500/50', op: 20 } }} />;",
            '/p/src/Spelling.jsx',
        );

        expect(run.className).toBe('bg-red-500/20');
        expect(run.warnings).toEqual([withOp]);
        expect(run.result.issues?.map(issue => [issue.code, issue.args])).toEqual([
            [
                'color-slash-opacity',
                { form: 'op-given', key: 'bg', base: 'red-500', opacity: '50', op: '20' },
            ],
        ]);
    });

    it.each(ENGINES)('%s names the opacity it read from color', (_name, engine) => {
        const run = captureWarnings(
            engine,
            "export const A = () => <p sz={{ bg: { color: 'red-500/50' } }} />;",
            '/p/src/Spelling.jsx',
        );

        expect(run.className).toBe('bg-red-500/50');
        expect(run.warnings).toEqual([withoutOp]);
        expect(run.result.issues?.map(issue => [issue.code, issue.args])).toEqual([
            [
                'color-slash-opacity',
                { form: 'op-absent', key: 'bg', base: 'red-500', opacity: '50' },
            ],
        ]);
    });

    it.each(ENGINES)(
        '%s names the important modifier and a string op as written',
        (_name, engine) => {
            const run = captureWarnings(
                engine,
                "export const A = () => <p sz={{ bg: { color: 'red-500/50!', op: '20' } }} />;",
                '/p/src/Spelling.jsx',
            );

            expect(run.warnings).toEqual([
                engineMessage(
                    'color-slash-opacity',
                    '/p/src/Spelling.jsx:1:33',
                    "`bg: { color: 'red-500/50!', op: '20' }` sets opacity twice; a colour object takes its opacity in `op`, not in `color`.",
                    "help: write `{ color: 'red-500!', op: '20' }`.",
                    "note: the class uses `op: '20'`; the `/50` in `color` is ignored.",
                ),
            ]);
            expect(run.result.issues?.[0]?.args).toEqual({
                form: 'op-given',
                key: 'bg',
                base: 'red-500',
                opacity: '50',
                important: '!',
                op: "'20'",
            });
        },
    );

    it('the runtime says the same for a string op, and nothing in production', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setSzWarnLocation('/p/src/Spelling.jsx:1');
        try {
            transform({ bg: { color: 'red-500/50!', op: '20' } });
            vi.stubEnv('NODE_ENV', 'production');
            transform({ bg: { color: 'blue-500/50' } });

            expect(warn.mock.calls).toEqual([
                [
                    engineMessage(
                        'color-slash-opacity',
                        '/p/src/Spelling.jsx:1',
                        "`bg: { color: 'red-500/50!', op: '20' }` sets opacity twice; a colour object takes its opacity in `op`, not in `color`.",
                        "help: write `{ color: 'red-500!', op: '20' }`.",
                        "note: the class uses `op: '20'`; the `/50` in `color` is ignored.",
                    ),
                ],
            ]);
        } finally {
            vi.unstubAllEnvs();
            setSzWarnLocation(undefined);
            warn.mockRestore();
        }
    });

    it('the runtime prints the same text once', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setSzWarnLocation('/p/src/Spelling.jsx:1');
        try {
            expect(transform({ bg: { color: 'red-500/50', op: 20 } }).className).toBe(
                'bg-red-500/20',
            );
            transform({ bg: { color: 'red-500/50', op: 20 } });

            expect(warn.mock.calls).toEqual([[runtimeWithOp]]);
        } finally {
            setSzWarnLocation(undefined);
            warn.mockRestore();
        }
    });
});

describe.each(LANES)('a colour string the runtime does not judge — %s', (_name, lower) => {
    // Whether the project's Tailwind serves a colour class is its verdict at
    // build (ADR 0022), so the runtime writes what the engines write and the
    // build's dead-class check reports a dead one. Only a rule about csszyx's
    // own input — slash opacity in a string, above — emits nothing.
    it.each([
        [{ bg: 'white/50' }, 'bg-white/50'],
        [{ hover: { bg: 'black/25' } }, 'hover:bg-black/25'],
        [{ bg: '50%' }, 'bg-[50%]'],
        [{ bg: '1/2' }, 'bg-[1/2]'],
        [{ bg: '4/2.5' }, 'bg-4/2.5'],
        [{ bg: 'calc(100/5)' }, 'bg-[calc(100/5)]'],
        [{ color: 'var(--x)' }, 'text-[var(--x)]'],
        [{ borderColor: '(--x)' }, 'border-(--x)'],
        [{ fill: 'white/50!' }, 'fill-white/50!'],
    ])('%j writes %s and reports nothing', (sz, className) => {
        const result = lower(sz);

        expect(result.className).toBe(className);
        expect(result.kinds).toEqual([]);
    });
});

describe.each(LANES)('a gradient layer on mask — %s', (_name, lower) => {
    // The layers moved to maskLinear / maskRadial / maskConic, so `mask` writes
    // nothing for one. That is missing output (ADR 0011): every lane says so,
    // with the code `moved-value`.
    it.each([
        [{ mask: 'linear-45' }],
        [{ mask: 'linear!' }],
        [{ mask: 'conic' }],
        [{ hover: { mask: '-radial' } }],
        [{ data: { 'state=open': { mask: 'radial-at-top' } } }],
    ])('drops %j and says so', sz => {
        const result = lower(sz);

        expect(result.className).toBe('');
        expect(result.kinds).toEqual(['moved-value']);
    });

    it('keeps a gradient function, which is a mask image', () => {
        const result = lower({ mask: 'linear-gradient(red,blue)' });

        expect(result.className).toBe('mask-[linear-gradient(red,blue)]');
        expect(result.kinds).toEqual([]);
    });
});

describe('the mask layer diagnostic', () => {
    // Both lanes render the registry's text; the runtime has no column.
    const expected = engineMessage(
        'moved-value',
        '/p/src/Spelling.jsx:1',
        "`mask: 'linear-45'` names a gradient layer, which moved to `maskLinear`, and nothing is emitted for it.",
        'help: write this layer on `maskLinear`; `mask` takes only `none`, a `url()` or a CSS variable.',
    );

    it.each(ENGINES)('%s renders the registry text, bang removed', (_name, engine) => {
        const run = captureWarnings(
            engine,
            "export const A = () => <p sz={{ mask: 'linear-45!', p: 2 }} />;",
            '/p/src/Spelling.jsx',
        );

        expect(run.className).toBe('p-2');
        expect(run.warnings).toEqual([
            engineMessage(
                'moved-value',
                '/p/src/Spelling.jsx:1:33',
                "`mask: 'linear-45'` names a gradient layer, which moved to `maskLinear`, and nothing is emitted for it.",
                'help: write this layer on `maskLinear`; `mask` takes only `none`, a `url()` or a CSS variable.',
            ),
        ]);
        expect(run.result.issues?.map(issue => [issue.code, issue.args])).toEqual([
            [
                'moved-value',
                { form: 'mask-layer', key: 'mask', value: 'linear-45', layerKey: 'maskLinear' },
            ],
        ]);
    });

    it('the runtime prints the same text once, and its code in production too', () => {
        // The mask is missing, so it is not a development nudge (ADR 0011).
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setSzWarnLocation('/p/src/Spelling.jsx:1');
        try {
            expect(transform({ mask: 'linear-45!', p: 2 }).className).toBe('p-2');
            transform({ mask: 'linear-45' });
            expect(warn.mock.calls).toEqual([[expected]]);

            warn.mockClear();
            __resetSzWarnDedupForTests();
            vi.stubEnv('NODE_ENV', 'production');
            transform({ mask: 'linear-45' });
            transform({ mask: 'linear-45' });
            expect(warn.mock.calls).toEqual([
                [
                    productionMessage('moved-value', {
                        form: 'mask-layer',
                        key: 'mask',
                        value: 'linear-45',
                        layerKey: 'maskLinear',
                    }),
                ],
            ]);
        } finally {
            setSzWarnLocation(undefined);
            vi.unstubAllEnvs();
            warn.mockRestore();
        }
    });
});

describe.each(LANES)(
    'a variable on a key whose prefix reads it as another type — %s',
    (_name, lower) => {
        // Tailwind infers no type from `var(--x)` or `(--x)`, so it gives the value
        // to the prefix's default utility: `bg-[var(--x)]` is a background colour,
        // `border-(--x)` a border colour. The key's own type goes in front as a
        // hint, as on a bare `--x`. Each class was measured on Tailwind 4.0.0,
        // 4.0.17, 4.1.0, 4.1.18, 4.2.0, 4.2.4, 4.3.0 and 4.3.3 to set the key's
        // property on every one that has the utility.
        it.each([
            [{ bgPos: 'var(--x)' }, 'bg-[position:var(--x)]'],
            [{ bgPos: '(--x)' }, 'bg-(position:--x)'],
            [{ bgPos: 'var(--x)!' }, 'bg-[position:var(--x)]!'],
            [{ decorationThickness: 'var(--x)!' }, 'decoration-[length:var(--x)]!'],
            [{ bgImg: 'var(--x)!' }, 'bg-[image:var(--x)]!'],
            [{ bgImg: 'url(/a.png)!' }, 'bg-[url(/a.png)]!'],
            [{ hover: { bgPos: 'var(--x, 50%)' } }, 'hover:bg-[position:var(--x,_50%)]'],
            [{ bgSize: '(--x)' }, 'bg-(length:--x)'],
            [{ bgImg: 'var(--x)' }, 'bg-[image:var(--x)]'],
            [{ bgImg: '(--x)' }, 'bg-(image:--x)'],
            [{ text: 'var(--x)' }, 'text-[length:var(--x)]'],
            [{ text: '(--x)' }, 'text-(length:--x)'],
            [{ border: '--x' }, 'border-(length:--x)'],
            [{ border: 'var(--x)' }, 'border-[length:var(--x)]'],
            [{ borderT: '(--x)' }, 'border-t-(length:--x)'],
            [{ borderX: 'var(--x)' }, 'border-x-[length:var(--x)]'],
            [{ outline: '--x' }, 'outline-(length:--x)'],
            [{ ring: 'var(--x)' }, 'ring-[length:var(--x)]'],
            [{ insetRing: '--x' }, 'inset-ring-(length:--x)'],
            [{ ringOffset: '(--x)' }, 'ring-offset-(length:--x)'],
            [{ decorationThickness: 'var(--x)' }, 'decoration-[length:var(--x)]'],
            [{ strokeWidth: '--x' }, 'stroke-(length:--x)'],
            [{ fontFamily: '(--x)' }, 'font-(family-name:--x)'],
            [{ shadowColor: 'var(--x)' }, 'shadow-[color:var(--x)]'],
            [{ insetShadowColor: '(--x)' }, 'inset-shadow-(color:--x)'],
            [{ textShadowColor: 'var(--x)' }, 'text-shadow-[color:var(--x)]'],
            [{ dropShadowColor: '(--x)' }, 'drop-shadow-(color:--x)'],
            [{ fromPos: '--x' }, 'from-(length:--x)'],
            [{ viaPos: 'var(--x)' }, 'via-[length:var(--x)]'],
            [{ toPos: '(--x)' }, 'to-(length:--x)'],
        ])('%j writes %s', (sz, className) => {
            const result = lower(sz);

            expect(result.className).toBe(className);
            expect(result.kinds).toEqual([]);
        });

        it.each([
            [{ bg: 'var(--x)' }, 'bg-[var(--x)]'],
            [{ color: '(--x)' }, 'text-(--x)'],
            [{ shadow: 'var(--x)' }, 'shadow-[var(--x)]'],
            [{ p: '(--x)' }, 'p-(--x)'],
            [{ borderColor: 'var(--x)' }, 'border-[var(--x)]'],
            [{ weight: 'var(--x)' }, 'font-[var(--x)]'],
            [{ weight: '--x' }, 'font-(--x)'],
            // What migrate reads `border-t-(--v)` and `decoration-(--v)` back to.
            [{ borderTColor: '--x' }, 'border-t-(--x)'],
            [{ borderXColor: 'var(--x)' }, 'border-x-[var(--x)]'],
            [{ decorationColor: '--x' }, 'decoration-(--x)'],
            [{ decorationColor: 'var(--x)' }, 'decoration-[var(--x)]'],
        ])('leaves %j on the prefix default, which is its own type', (sz, className) => {
            expect(lower(sz).className).toBe(className);
        });
    },
);

describe.each(ENGINES)('a runtime value on a width key — %s', (_name, engine) => {
    // The hoisted variable takes the hint a static `--x` takes, or Tailwind
    // reads `stroke-(--v)` as the stroke colour.
    it.each([
        ['strokeWidth', 'stroke-(length:--_sz-stroke-width)'],
        ['decorationThickness', 'decoration-(length:--_sz-decoration-thickness)'],
        ['ringOffset', 'ring-offset-(length:--_sz-ring-offset)'],
        ['insetRing', 'inset-ring-(length:--_sz-inset-ring)'],
    ])('%s writes %s', (key, className) => {
        const run = captureWarnings(
            engine,
            `export const A = ({ x }) => <p sz={{ ${key}: x }} />;`,
            '/p/src/Spelling.jsx',
        );

        expect(run.className).toBe(className);
    });
});
