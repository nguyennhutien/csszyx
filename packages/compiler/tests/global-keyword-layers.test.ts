/**
 * A stand-alone keyword key and its group keys across layers, spreads,
 * duplicate keys and runtime values.
 *
 * In one object the later key wins (`global-keyword-order.property.test.ts`).
 * These are the shapes that hand the lowering an order the author did not
 * write: an sz array or an `szv` merge, where a later layer overrides a key an
 * earlier layer already holds; a spread override, which keeps the overridden
 * key at its old place; duplicate keys in a `.jsx` file; a moved value the
 * static collectors used to miss; and a runtime value, whose order the build
 * cannot settle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deepMergeSzObjects, setSzWarnLocation, transform } from '../src/transform-core.js';
import { engineMessage, productionMessage, runtimeMessage } from './engine-message.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

/**
 * Run one JSX module through an engine artifact.
 * @param engine - The artifact.
 * @param sz - The `sz` attribute expression, as written.
 * @returns The captured run.
 */
function jsx(engine: Parameters<typeof captureWarnings>[0], sz: string) {
    return captureWarnings(
        engine,
        `export const A = ({ c, m }) => <p sz={${sz}} />;`,
        '/p/src/Layers.jsx',
    );
}

describe('a later layer overrides a key an earlier layer holds', () => {
    it('the merge settles the family, and every key keeps its place', () => {
        const merged = deepMergeSzObjects(
            { contain: 'strict', containPaint: true },
            { contain: 'none' },
        );

        expect(Object.keys(merged)).toEqual(['contain']);
        expect(merged.contain).toBe('none');
        expect(
            Object.keys(
                deepMergeSzObjects({ touchPanX: 'x', touchPanY: 'up' }, { touchPanX: 'left' }),
            ),
        ).toEqual(['touchPanX', 'touchPanY']);
        // Merging an object with itself changes nothing it lowers to.
        expect(
            Object.keys(
                deepMergeSzObjects({ p: 2, m: 1, hover: { p: 1 } }, { p: 4, hover: { m: 2 } }),
            ),
        ).toEqual(['p', 'm', 'hover']);
    });

    it('the merge keeps the stand-alone keyword beside an inactive later group', () => {
        expect(deepMergeSzObjects({ contain: 'strict' }, { containPaint: false })).toEqual({
            contain: 'strict',
            containPaint: false,
        });
    });

    it('the merge drops the stand-alone keyword a later group replaces', () => {
        const merged = deepMergeSzObjects({ touch: 'auto' }, { touchPanX: 'x' });

        expect(merged).toEqual({ touchPanX: 'x' });
        expect(
            deepMergeSzObjects({ md: { contain: 'strict' } }, { md: { containPaint: true } }),
        ).toEqual({ md: { containPaint: true } });
    });

    it.each(ENGINES)('%s lets a later stand-alone keyword win in an sz array', (_name, engine) => {
        const contain = jsx(
            engine,
            "[{ contain: 'strict', containPaint: true }, { contain: 'none' }]",
        );
        const touch = jsx(engine, "[{ touch: 'auto' }, { touchPanX: 'x' }, { touch: 'none' }]");
        const group = jsx(engine, "[{ contain: 'strict' }, { containPaint: true }]");

        expect(contain.className).toBe('contain-none');
        expect(touch.className).toBe('touch-none');
        expect(group.className).toBe('contain-paint');
        expect([...contain.warnings, ...touch.warnings, ...group.warnings]).toEqual([]);
    });

    it.each(ENGINES)(
        '%s keeps the layers of a conditional array in order for szcn',
        (_name, engine) => {
            const run = jsx(
                engine,
                "[{ contain: 'strict', containPaint: true }, c && { contain: 'none' }]",
            );

            // Later wins in szcn's merge, so `c` true settles on `contain-none`,
            // as the static array does. Each layer is lowered, and checked, on
            // its own: in the first one `containPaint` replaces `contain`.
            expect(run.result.code).toContain('_szcn("contain-paint", c && "contain-none")');
            expect(run.warnings).toEqual([engineSpread('contain', 'strict', 'containPaint', 42)]);
        },
    );

    it('runtime lowers an sz array the same way', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const layers: Array<[object[], string]> = [
            [[{ contain: 'strict', containPaint: true }, { contain: 'none' }], 'contain-none'],
            [[{ touch: 'auto' }, { touchPanX: 'x' }, { touch: 'none' }], 'touch-none'],
            [[{ contain: 'strict' }, { containPaint: true }], 'contain-paint'],
        ];
        for (const [sz, want] of layers) {
            const merged = sz.reduce((a, b) => deepMergeSzObjects(a as never, b as never));
            expect(transform(merged as never).className, JSON.stringify(sz)).toBe(want);
        }
        expect(warn).not.toHaveBeenCalled();
    });
});

/**
 * The body of the report a stand-alone key before one of its groups produces.
 * @param global - The stand-alone key.
 * @param value - Its value: a string prints quoted, a number or boolean bare,
 *   as the author wrote it.
 * @param group - The group key written after it.
 * @returns The sentence, the help and the note.
 */
const spreadLines = (global: string, value: string | number | boolean, group: string) => {
    const literal = typeof value === 'string' ? `'${value}'` : String(value);
    return [
        `\`${global}: ${literal}\` comes before \`${group}\` in one sz object, so \`${group}\` replaces it and the \`${global}\` value styles nothing.`,
        `help: to override the group, layer it: \`sz={[base, { ${global}: ${literal} }]}\`.`,
        `note: a spread such as \`{ ...base, ${global}: ${literal} }\` keeps the same key order, so it does not fix this.`,
    ];
};

/**
 * The engine's message for a stand-alone key before one of its groups.
 * @param global - The stand-alone key.
 * @param value - Its value.
 * @param group - The group key written after it.
 * @param column - The column of the stand-alone key on line 1.
 * @returns The message.
 */
const engineSpread = (
    global: string,
    value: string | number | boolean,
    group: string,
    column: number,
) =>
    engineMessage(
        'global-before-group',
        `/p/src/Layers.jsx:1:${column}`,
        ...spreadLines(global, value, group),
    );

describe('a stand-alone key written before a group key of its family', () => {
    it('runtime names the shape a spread override leaves, once, in production too', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('NODE_ENV', 'production');
        const base = { contain: 'strict', containPaint: true };

        expect(transform({ ...base, contain: 'content' }).className).toBe('contain-paint');
        transform({ ...base, contain: 'content' });

        expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
            productionMessage('global-before-group', {
                global: 'contain',
                value: 'content',
                valueType: 'string',
                group: 'containPaint',
            }),
        ]);
    });

    it('runtime names the location when it knows it', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setSzWarnLocation('src/Over.tsx:9');
        try {
            transform({ touch: 'auto', touchPinchZoom: true });
            transform({ normalCase: true });
        } finally {
            setSzWarnLocation(undefined);
        }

        expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
            engineMessage(
                'global-before-group',
                'src/Over.tsx:9',
                ...spreadLines('touch', 'auto', 'touchPinchZoom'),
            ),
            engineMessage(
                'removed-key',
                'src/Over.tsx:9',
                'The boolean shorthand `normalCase` was removed, and nothing is emitted for it.',
                "help: write `{ textTransform: 'none' }` instead, or run `csszyx migrate`.",
            ),
        ]);
    });

    it('runtime names a literal that is not a string by its text', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('NODE_ENV', 'production');

        transform({ contain: 7, containPaint: true });

        expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
            productionMessage('global-before-group', {
                global: 'contain',
                value: '7',
                valueType: 'number',
                group: 'containPaint',
            }),
        ]);
    });

    it('runtime writes a number or a boolean bare, as the author wrote it', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setSzWarnLocation('src/Bare.tsx:3');
        try {
            transform({ contain: 8, containPaint: true });
            transform({ touch: true, touchPanY: 'up' });
        } finally {
            setSzWarnLocation(undefined);
        }

        expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
            engineMessage(
                'global-before-group',
                'src/Bare.tsx:3',
                ...spreadLines('contain', 8, 'containPaint'),
            ),
            engineMessage(
                'global-before-group',
                'src/Bare.tsx:3',
                ...spreadLines('touch', true, 'touchPanY'),
            ),
        ]);
    });

    it('runtime stays quiet under CSSZYX_QUIET_SZ_WARNINGS', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('CSSZYX_QUIET_SZ_WARNINGS', '1');

        expect(transform({ nums: 'normal', numFigure: 'lining' }).className).toBe('lining-nums');
        expect(warn).not.toHaveBeenCalled();
    });

    it.each(ENGINES)('%s names it with the position', (_name, engine) => {
        const run = jsx(
            engine,
            "{ touch: 'manipulation', touchPanY: 'up', md: { nums: 'normal', numSpacing: 'tabular' } }",
        );

        expect(run.className).toBe('touch-pan-up md:tabular-nums');
        expect(run.warnings).toEqual([
            engineSpread('touch', 'manipulation', 'touchPanY', 41),
            engineSpread('nums', 'normal', 'numSpacing', 87),
        ]);
    });

    it.each(ENGINES)('%s says nothing when the stand-alone key comes last', (_name, engine) => {
        const run = jsx(engine, "{ touchPanY: 'up', touch: 'manipulation' }");

        expect(run.className).toBe('touch-manipulation');
        expect(run.warnings).toEqual([]);
    });
});

describe('duplicate keys in a .jsx object', () => {
    // `{ contain: 'strict', containPaint: true, contain: 'none' }` is, in
    // JavaScript, `{ contain: 'none', containPaint: true }`: the first place,
    // the last value. The model then lets `containPaint`, written after it,
    // replace `contain`.
    it.each(ENGINES)('%s reads the last value at the first place', (_name, engine) => {
        const run = jsx(engine, "{ contain: 'strict', containPaint: true, contain: 'none' }");
        // JSON reads a repeated key as an object literal does.
        const runtime = JSON.parse('{"contain":"strict","containPaint":true,"contain":"none"}');

        expect(runtime).toEqual({ contain: 'none', containPaint: true });
        expect(Object.keys(runtime)).toEqual(['contain', 'containPaint']);
        expect(run.className).toBe('contain-paint');
        expect(run.warnings).toEqual([engineSpread('contain', 'none', 'containPaint', 80)]);
    });

    it.each(ENGINES)('%s emits only the last value of a repeated keyword key', (_name, engine) => {
        const run = jsx(engine, "{ containLayout: true, contain: 'none', contain: 'strict' }");

        expect(run.className).toBe('contain-strict');
        expect(run.warnings).toEqual([]);
    });
});

describe('a moved value where the static pass used to miss it', () => {
    // The sentence names the key it moved to; the help line names the value to write.
    const moved = (value: string, key: string, replacement: string) =>
        `\`touch: '${value}'\` moved to \`${key}\`, and nothing is emitted for it.\n` +
        `  help: write \`{ ${key}: ${replacement} }\`, or run \`csszyx migrate\`.`;

    it.each(ENGINES)('%s names it in a property-level ternary', (_name, engine) => {
        const run = jsx(
            engine,
            "{ touch: m ? 'pan-x' : 'auto', md: { touch: m ? 'none' : 'pan-y' } }",
        );

        expect(run.warnings.join('\n')).toContain(moved('pan-x', 'touchPanX', "'x'"));
        expect(run.warnings.join('\n')).toContain(moved('pan-y', 'touchPanY', "'y'"));
    });

    it.each(ENGINES)('%s names it in a nullable ternary', (_name, engine) => {
        const run = jsx(engine, "{ touch: m ? 'pan-left' : undefined }");

        expect(run.warnings.join('\n')).toContain(moved('pan-left', 'touchPanX', "'left'"));
    });

    it.each(ENGINES)('%s names it in a parametric variant', (_name, engine) => {
        const run = jsx(
            engine,
            "{ group: { hover: { touch: 'pan-right' } }, peer: { focus: { touch: 'pan-up' } }, data: { open: { touch: 'pan-down' } }, aria: { expanded: { touch: 'pinch-zoom' } }, has: { img: { md: { touch: 'pan-x' } } }, not: { hover: { touch: 'pan-y' } } }",
        );
        const warnings = run.warnings.join('\n');

        expect(warnings).toContain(moved('pan-right', 'touchPanX', "'right'"));
        expect(warnings).toContain(moved('pan-up', 'touchPanY', "'up'"));
        expect(warnings).toContain(moved('pan-down', 'touchPanY', "'down'"));
        expect(warnings).toContain(moved('pinch-zoom', 'touchPinchZoom', 'true'));
        expect(warnings).toContain(moved('pan-x', 'touchPanX', "'x'"));
        expect(warnings).toContain(moved('pan-y', 'touchPanY', "'y'"));
    });

    it.each(ENGINES)('%s names it in a conditional object branch', (_name, engine) => {
        const run = jsx(engine, "{ hover: m ? { touch: 'pan-x' } : {} }");

        expect(run.warnings.join('\n')).toContain(moved('pan-x', 'touchPanX', "'x'"));
    });
});

describe('a runtime value beside the other side of its family', () => {
    const layered = (
        dynamic: string,
        other: string,
        first: string,
        second: string,
        column: number,
    ) =>
        engineMessage(
            'runtime-family-conflict',
            `/p/src/Layers.jsx:1:${column}`,
            `\`${dynamic}\` takes a runtime value beside \`${other}\` in one sz object, so both classes can be emitted and Tailwind's stylesheet order decides which applies, whatever the object's order.`,
            `help: layer them, later wins: \`sz={[{ ${first}: … }, { ${second}: … }]}\`.`,
        );

    it.each(ENGINES)('%s reports a group key with a runtime value', (_name, engine) => {
        const run = jsx(engine, "{ touch: 'none', touchPanX: c ? 'x' : undefined }");

        expect(run.warnings).toEqual([layered('touchPanX', 'touch', 'touch', 'touchPanX', 56)]);
    });

    it.each(ENGINES)('%s reports a runtime boolean on a group flag', (_name, engine) => {
        const run = jsx(engine, "{ md: { contain: 'strict', containPaint: c } }");

        expect(run.warnings).toEqual([
            layered('containPaint', 'contain', 'contain', 'containPaint', 66),
        ]);
    });

    it.each(ENGINES)('%s reports a stand-alone key with a runtime value', (_name, engine) => {
        const run = jsx(engine, "{ contain: c ? 'strict' : 'none', containPaint: true }");

        expect(run.warnings).toEqual([
            layered('contain', 'containPaint', 'contain', 'containPaint', 41),
        ]);
    });

    it.each(ENGINES)('%s reports two runtime values once', (_name, engine) => {
        const run = jsx(
            engine,
            "{ numSpacing: m ? 'tabular' : 'proportional', nums: c ? 'normal' : undefined }",
        );

        expect(run.warnings).toEqual([layered('numSpacing', 'nums', 'numSpacing', 'nums', 41)]);
    });

    it.each(ENGINES)('%s stays quiet without the other side', (_name, engine) => {
        const run = jsx(
            engine,
            "{ touchPanX: c ? 'x' : undefined, touchPanY: 'up', containPaint: c }",
        );

        expect(run.warnings).toEqual([]);
    });

    // A key with no variable form ships no class, so nothing is left for
    // Tailwind's order to decide: `runtime-value` is the whole story.
    it.each([
        ['group', "{ touch: 'auto', touchPanX: c }", 'touch-auto'],
        ['stand-alone', "{ touch: c, touchPanX: 'x' }", 'touch-pan-x'],
    ])('stays quiet when the runtime %s key ships no class', (_side, sz, className) => {
        for (const [name, engine] of ENGINES) {
            const run = jsx(engine, sz);

            expect(run.className, name).toBe(className);
            expect(
                run.result.issues?.map(issue => issue.code),
                name,
            ).toEqual(['runtime-value']);
        }
    });
});

describe('a value that belongs to a sibling group', () => {
    const siblingLines = (
        key: string,
        value: string,
        bare: string,
        fix: string,
        values: string,
    ) => [
        `\`${key}: '${value}'\` is not a \`${key}\` value; its class \`${bare}\` belongs to \`{ ${fix} }\`.`,
        `help: write \`{ ${fix} }\`, so it combines with the other groups instead of resetting them.`,
        `note: \`${key}\` takes one of: ${values}.`,
    ];

    const engineSibling = (
        key: string,
        value: string,
        bare: string,
        fix: string,
        values: string,
        column: number,
    ) =>
        engineMessage(
            'closed-enum-value',
            `/p/src/Layers.jsx:1:${column}`,
            ...siblingLines(key, value, bare, fix, values),
        );

    it.each(ENGINES)('%s names the group key', (_name, engine) => {
        const run = jsx(
            engine,
            "{ contain: 'paint', md: { nums: 'tabular' }, lg: { contain: 'inline-size' } }",
        );

        expect(run.className).toBe('contain-paint md:tabular-nums lg:contain-inline-size');
        expect(run.warnings).toEqual([
            engineSibling(
                'contain',
                'paint',
                'contain-paint',
                'containPaint: true',
                'none, strict, content',
                41,
            ),
            engineSibling('nums', 'tabular', 'tabular-nums', "numSpacing: 'tabular'", 'normal', 65),
            engineSibling(
                'contain',
                'inline-size',
                'contain-inline-size',
                "containSize: 'inline-size'",
                'none, strict, content',
                90,
            ),
        ]);
        expect(run.result.issues?.map(issue => issue.args)).toEqual([
            {
                form: 'sibling-group',
                key: 'contain',
                value: 'paint',
                groupKey: 'containPaint',
                groupValue: 'true',
            },
            {
                form: 'sibling-group',
                key: 'nums',
                value: 'tabular',
                groupKey: 'numSpacing',
                groupValue: 'tabular',
            },
            {
                form: 'sibling-group',
                key: 'contain',
                value: 'inline-size',
                groupKey: 'containSize',
                groupValue: 'inline-size',
            },
        ]);
    });

    // Replaced by a later group, the value still belongs to a group of its
    // own: layering it, as the order report would say, leaves the same wrong
    // key, so the report names the group key, and claims no emitted class.
    it.each(ENGINES)(
        '%s names the group key of a value a later group replaced',
        (_name, engine) => {
            const run = jsx(engine, "{ contain: 'layout', containSize: 'size' }");

            expect(run.className).toBe('contain-size');
            expect(run.warnings).toEqual([
                engineSibling(
                    'contain',
                    'layout',
                    'contain-layout',
                    'containLayout: true',
                    'none, strict, content',
                    41,
                ),
            ]);
        },
    );

    it.each(ENGINES)('%s gives help that compiles clean', (_name, engine) => {
        const written = jsx(engine, "{ contain: 'size', containPaint: true }");
        expect(written.result.issues?.map(issue => issue.args)).toEqual([
            {
                form: 'sibling-group',
                key: 'contain',
                value: 'size',
                groupKey: 'containSize',
                groupValue: 'size',
            },
        ]);

        const fixed = jsx(engine, "{ containSize: 'size', containPaint: true }");
        expect(fixed.className).toBe('contain-size contain-paint');
        expect(fixed.warnings).toEqual([]);
    });

    it('runtime names the group key', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setSzWarnLocation('src/Sibling.tsx:3');
        try {
            expect(transform({ nums: 'oldstyle' }).className).toBe('oldstyle-nums');
            expect(String(warn.mock.calls[0]?.[0])).toBe(
                engineMessage(
                    'closed-enum-value',
                    'src/Sibling.tsx:3',
                    ...siblingLines(
                        'nums',
                        'oldstyle',
                        'oldstyle-nums',
                        "numFigure: 'oldstyle'",
                        'normal',
                    ),
                ),
            );
            warn.mockClear();
            expect(transform({ contain: 'style' }).className).toBe('contain-style');
        } finally {
            setSzWarnLocation(undefined);
        }

        expect(String(warn.mock.calls[0]?.[0])).toBe(
            engineMessage(
                'closed-enum-value',
                'src/Sibling.tsx:3',
                ...siblingLines(
                    'contain',
                    'style',
                    'contain-style',
                    'containStyle: true',
                    'none, strict, content',
                ),
            ),
        );
    });

    it('runtime names the group of a value written before that group, in production too', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(transform({ contain: 'size', containPaint: true }).className).toBe('contain-paint');
        expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
            runtimeMessage(
                'closed-enum-value',
                ...siblingLines(
                    'contain',
                    'size',
                    'contain-size',
                    "containSize: 'size'",
                    'none, strict, content',
                ),
            ),
        ]);

        // The value styles nothing, so a production page in a browser says so.
        warn.mockClear();
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubGlobal('window', {});
        try {
            expect(transform({ hover: { contain: 'paint', containLayout: true } }).className).toBe(
                'hover:contain-layout',
            );
        } finally {
            vi.unstubAllGlobals();
        }
        expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
            productionMessage('closed-enum-value', {
                form: 'sibling-group',
                key: 'contain',
                value: 'paint',
                groupKey: 'containPaint',
                groupValue: 'true',
            }),
        ]);
    });

    it('runtime names it once, and not under CSSZYX_QUIET_SZ_WARNINGS', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        transform({ nums: 'lining', numSpacing: 'tabular' });
        transform({ nums: 'lining', numSpacing: 'tabular' });
        expect(warn).toHaveBeenCalledTimes(1);

        warn.mockClear();
        vi.stubEnv('CSSZYX_QUIET_SZ_WARNINGS', '1');
        expect(transform({ nums: 'stacked', numFigure: 'oldstyle' }).className).toBe(
            'oldstyle-nums',
        );
        expect(warn).not.toHaveBeenCalled();
    });
});

describe('replaced, moved and removed keys print everywhere, once', () => {
    it('runtime warns about a replaced flag in a browser production build', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubGlobal('window', {});
        try {
            expect(transform({ ordinal: true }).className).toBe('');
            transform({ ordinal: true });
            expect(transform({ touch: 'pan-left' }).className).toBe('');
            expect(transform({ inlineFlex: true }).className).toBe('');
        } finally {
            vi.unstubAllGlobals();
        }

        expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
            productionMessage('removed-key', {
                form: 'replaced',
                key: 'ordinal',
                replacement: 'numOrdinal: true',
            }),
            productionMessage('moved-value', { form: 'value', key: 'touch', value: 'pan-left' }),
            productionMessage('removed-key', {
                form: 'sugar',
                key: 'inlineFlex',
                replacement: "display: 'inline-flex'",
            }),
        ]);
    });

    it('runtime stays quiet about them under CSSZYX_QUIET_SZ_WARNINGS', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('CSSZYX_QUIET_SZ_WARNINGS', '1');

        expect(transform({ slashedZero: true, touch: 'pan-right', tableRow: true }).className).toBe(
            '',
        );
        expect(warn).not.toHaveBeenCalled();
    });

    it.each(ENGINES)('%s says a replaced flag was replaced', (_name, engine) => {
        const run = jsx(engine, '{ slashedZero: true }');

        expect(run.warnings).toEqual([
            engineMessage(
                'removed-key',
                '/p/src/Layers.jsx:1:41',
                '`slashedZero` was replaced, and nothing is emitted for it.',
                'help: write `{ numSlashedZero: true }` instead, or run `csszyx migrate`.',
            ),
        ]);
        expect(run.result.issues?.[0]?.args).toEqual({
            form: 'replaced',
            key: 'slashedZero',
            replacement: 'numSlashedZero: true',
        });
    });
});

describe('an alias holding a value that moved', () => {
    it.each(ENGINES)('%s names where the value went', (_name, engine) => {
        const run = jsx(engine, "{ touchAction: 'pan-x' }");

        expect(run.className ?? '').toBe('');
        expect(run.warnings).toEqual([
            engineMessage(
                'moved-value',
                '/p/src/Layers.jsx:1:41',
                "`touchAction: 'pan-x'` moved to `touchPanX`, and nothing is emitted for it.",
                "help: write `{ touchPanX: 'x' }`, or run `csszyx migrate`.",
            ),
        ]);
    });

    it('runtime names where the value went', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(transform({ touchAction: 'pan-down' }).className).toBe('');
        expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
            runtimeMessage(
                'moved-value',
                "`touchAction: 'pan-down'` moved to `touchPanY`, and nothing is emitted for it.",
                "help: write `{ touchPanY: 'down' }`, or run `csszyx migrate`.",
            ),
        ]);
    });
});

describe('a removed key prints everywhere, once', () => {
    it('runtime names a removed key in a browser production build', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubGlobal('window', {});
        try {
            expect(transform({ fontVariant: 'tabular-nums' }).className).toBe('');
            transform({ fontVariant: 'tabular-nums' });
        } finally {
            vi.unstubAllGlobals();
        }

        expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
            productionMessage('removed-key', { form: 'removed', key: 'fontVariant' }),
        ]);
    });

    it('runtime stays quiet about it under CSSZYX_QUIET_SZ_WARNINGS', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('CSSZYX_QUIET_SZ_WARNINGS', '1');

        expect(transform({ maskVia: 'black' }).className).toBe('');
        expect(warn).not.toHaveBeenCalled();
    });
});

describe('a family conflict inside an sz array element', () => {
    const layered = (
        dynamic: string,
        other: string,
        first: string,
        second: string,
        column: number,
    ) =>
        engineMessage(
            'runtime-family-conflict',
            `/p/src/Layers.jsx:1:${column}`,
            `\`${dynamic}\` takes a runtime value beside \`${other}\` in one sz object, so both classes can be emitted and Tailwind's stylesheet order decides which applies, whatever the object's order.`,
            `help: layer them, later wins: \`sz={[{ ${first}: … }, { ${second}: … }]}\`.`,
        );

    it.each(ENGINES)('%s names it in one element', (_name, engine) => {
        const run = jsx(engine, "[{ p: 1 }, { touchPanX: c ? 'x' : undefined, touch: 'none' }]");

        expect(run.warnings).toEqual([layered('touchPanX', 'touch', 'touchPanX', 'touch', 52)]);
    });

    it.each(ENGINES)('%s names it under a variant of one element', (_name, engine) => {
        const run = jsx(engine, "[{ md: { contain: 'strict', containPaint: c } }, { p: 1 }]");

        expect(run.warnings).toEqual([
            layered('containPaint', 'contain', 'contain', 'containPaint', 67),
        ]);
    });

    // Layers keep their order through szcn, so this is the fix, not a conflict.
    it.each(ENGINES)('%s says nothing across layers', (_name, engine) => {
        const run = jsx(engine, "[{ touch: 'none' }, { touchPanX: c ? 'x' : undefined }]");

        expect(run.warnings).toEqual([]);
    });
});

describe('an alias of a stand-alone key with a runtime value', () => {
    const at = '/p/src/Layers.jsx:1:41';

    it.each(ENGINES)('%s names the moved form of a literal branch', (_name, engine) => {
        const run = jsx(engine, "{ touchAction: m ? 'pan-x' : 'auto' }");

        expect(run.warnings).toEqual([
            engineMessage(
                'moved-value',
                at,
                "`touchAction: 'pan-x'` moved to `touchPanX`, and nothing is emitted for it.",
                "help: write `{ touchPanX: 'x' }`, or run `csszyx migrate`.",
            ),
        ]);
    });

    it.each(ENGINES)(
        '%s names the stand-alone key when every branch belongs to it',
        (_name, engine) => {
            const run = jsx(engine, "{ touchAction: m ? 'none' : 'auto' }");

            expect(run.warnings).toEqual([
                engineMessage(
                    'canonical-key',
                    at,
                    '`touchAction` is an alias of `touch`, and nothing is emitted for it.',
                    'help: write `touch`.',
                ),
            ]);
        },
    );

    it.each(ENGINES)('%s names both sides for a runtime value', (_name, engine) => {
        const run = jsx(engine, '{ touchAction: c }');

        expect(run.warnings).toEqual([
            engineMessage(
                'removed-key',
                at,
                '`touchAction` is an alias of `touch`, and nothing is emitted for its runtime value.',
                'help: write the values auto, none, manipulation on `touch`, and any other value on its own key: touchPanX, touchPanY, touchPinchZoom.',
            ),
        ]);
    });
});

describe('a stand-alone key of any literal type before its group', () => {
    it.each(ENGINES)('%s names a number or a boolean too', (_name, engine) => {
        const run = jsx(
            engine,
            "{ contain: 1, containPaint: true, md: { touch: true, touchPanX: 'x' } }",
        );

        expect(run.warnings).toEqual([
            engineSpread('contain', 1, 'containPaint', 41),
            engineSpread('touch', true, 'touchPanX', 79),
        ]);
        // The value travels as text; its type says how the line spells it.
        expect(run.result.issues?.map(issue => issue.args)).toEqual([
            { global: 'contain', value: '1', valueType: 'number', group: 'containPaint' },
            { global: 'touch', value: 'true', valueType: 'boolean', group: 'touchPanX' },
        ]);
    });
});

describe('the runtime names these with their location', () => {
    it('names a removed key at its location, and no object as a stand-alone value', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setSzWarnLocation('src/Gone.tsx:2');
        try {
            transform({ maskTo: 'black' });
            transform({ nums: { a: 1 } as never, numFigure: 'lining' });
        } finally {
            setSzWarnLocation(undefined);
        }

        const messages = warn.mock.calls.map(([message]) => String(message));
        expect(messages[0]).toBe(
            engineMessage(
                'removed-key',
                'src/Gone.tsx:2',
                '`maskTo` was removed, and nothing is emitted for it.',
                'help: write the to stop on its layer: `maskLinear`, `maskRadial` or `maskConic` take `{ to }`.',
            ),
        );
        expect(messages.some(message => message.includes('global-before-group'))).toBe(false);
    });
});
