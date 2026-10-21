/**
 * The runtime lowering and the engine say the same thing about the same `sz`
 * literal (ADR 0031 PR C).
 *
 * Each id the browser lane shares with the engine, in each form it can print,
 * is driven through the runtime `transform()` and through the engine
 * (`transformWasmUnrendered`, and the native addon when it loads), and the
 * development body of every line — the sentence, `help:` and `note:` — must be
 * equal. The header's place is left out by design: the runtime has no file
 * position. The engine's args go through `renderEngineDiagnostic`, which
 * completes them as a build does (an unknown key's suggestion), so the two
 * lanes are compared as a user reads them.
 *
 * The cases cover every (id, form) the registry declares on both surfaces; a
 * form added to the registry without a case fails here. A case either lane is
 * known to miss is listed in {@link KNOWN_GAPS} with the side that is silent,
 * so fixing the gap fails the test until the entry is removed.
 *
 * Runs in the `node` environment: the runtime's development warnings that
 * stay out of a browser console (`szNodeWarningsUnmuted`) would otherwise be
 * silent on both sides and every case would pass empty.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SZ_DIAGNOSTIC_REGISTRY } from '../src/diagnostic-spec.generated.js';
import { isRustTransformAvailable } from '../src/engine.js';
import type { SzDiagnosticIssue } from '../src/engine-spans.js';
import {
    renderEngineDiagnostic,
    transformRustUnrendered,
    transformWasmUnrendered,
    type UnrenderedTransformResult,
} from '../src/internal.js';
import {
    __resetSzWarnDedupForTests,
    ARIA_STATES,
    REMOVED_BOOLEAN_SUGAR,
    type SzObject,
    transform,
} from '../src/transform-core.js';
import { szBodyOf, szCodeOf } from './helpers/sz-console-line.js';

/** One engine artifact's transform that leaves its diagnostics unrendered. */
type Unrendered = (source: string, filename: string) => UnrenderedTransformResult;

/**
 * The native addon, when it loads and answers for this engine version. A
 * stale addon (built from an older engine) refuses every call; the suite then
 * runs on wasm and says why, instead of failing on a local build step.
 *
 * @returns The lane, or the reason it is skipped.
 */
function nativeLane(): Unrendered | string {
    if (!isRustTransformAvailable()) return 'the native addon is not built';
    try {
        transformRustUnrendered('export const A = () => <p sz={{ p: 1 }} />;', '/p/probe.jsx');
        return transformRustUnrendered;
    } catch (error) {
        return `the native addon refused a call: ${String(error).slice(0, 160)}`;
    }
}

const NATIVE = nativeLane();
if (typeof NATIVE === 'string') {
    console.info(`runtime/engine differential: native lane skipped — ${NATIVE}`);
}

/** The engine artifacts this run compares against. */
const ENGINES: ReadonlyArray<readonly [string, Unrendered]> = [
    ['wasm', transformWasmUnrendered],
    ...(typeof NATIVE === 'string' ? [] : ([['native', NATIVE]] as const)),
];

/** The ids both lanes report, each with the forms it can print. */
const SHARED = SZ_DIAGNOSTIC_REGISTRY.filter(
    spec => spec.surfaces.engine !== undefined && spec.surfaces.runtime?.host === 'browser',
);

/** Every (id, form) both lanes can report, as `id` or `id/form`. */
const SHARED_FORMS = SHARED.flatMap(spec =>
    spec.forms === undefined ? [spec.id] : spec.forms.map(form => `${spec.id}/${form}`),
);

/**
 * The objects each (id, form) is driven by, each unique across the table so
 * no case leans on another's dedup state. The engine reads each as the JSON
 * of an `sz` attribute.
 */
const CASES: Readonly<Record<string, readonly SzObject[]>> = {
    'unknown-key': [
        { dispaly: 'flex' },
        { xyzzy: 1 },
        // A parametric variant's bodies are sz objects; its parameters are not.
        { group: { hover: { dispaly: 'flex' } } },
        { data: { foo: { dispaly: 'block' } } },
        { group: { card: { hover: { dispaly: 'grid' } } } },
        // Removed sugar is known only in its `true` form.
        { tabularNums: 'x' },
    ],
    'canonical-key/alias': [
        { backgroundColor: 'red-500' },
        { peer: { hover: { backgroundColor: 'red-500' } } },
    ],
    'canonical-key/font': [{ font: 'bold' }, { md: { font: 'mono' } }],
    'canonical-key/scrollbar-color': [{ scrollbarColor: 'red-500' }],
    'removed-key/sugar-replaced': [{ tabularNums: true }],
    'removed-key/sugar': [{ inlineFlex: true }],
    'removed-key/removed': [{ fontVariant: 'x' }, { has: { img: { fontVariant: 'x' } } }],
    'removed-key/replaced': [{ ordinal: true }],
    'numeric-key': [{ 0: 'p-4' }],
    'closed-enum-value/sibling-group': [
        { contain: 'paint' },
        { contain: 'size', containPaint: true },
        { hover: { contain: 'layout', containStyle: true } },
    ],
    'closed-enum-value/dead': [{ display: 'flx' }, { aria: { checked: { display: 'flx' } } }],
    'closed-enum-value/css-value': [
        { justify: 'flex-start' },
        { items: 'flex-end!' },
        { supports: { 'display:grid': { justify: 'flex-start' } } },
    ],
    'closed-enum-value/font-style': [{ fontStyle: 'oblique' }],
    'closed-enum-value/font-smoothing': [{ fontSmoothing: 'none' }],
    'slash-opacity-string': [{ bg: 'red-500/50' }],
    'off-scale-value': [
        { p: 1.4 },
        { has: { img: { p: 1.3 } } },
        { group: { has: { img: { p: 1.1 } } } },
    ],
    'numeric-font-weight': [
        { weight: '700' },
        { peer: { focus: { weight: '600' } } },
        { not: { supports: { 'display:grid': { weight: '500' } } } },
    ],
    'per-side-border-style': [{ borderB: 'none' }, { not: { first: { borderT: 'dashed' } } }],
    'property-object': [
        { p: { a: 1, b: 2, c: 3, d: 4 } },
        { group: { focus: { p: { a: 1, b: 2, c: 3, d: 4 } } } },
    ],
    'non-variant-object': [{ container: { p: 4 } }, { data: { open: { container: { p: 4 } } } }],
    'unknown-field': [{ maskLinear: { form: 'black' } }],
    'moved-value/value': [
        { touch: 'pan-x' },
        { touchAction: 'pan-y' },
        { touch: 'pan-x!' },
        { touchAction: 'pan-y!' },
    ],
    'moved-value/mask-layer': [{ mask: 'linear-45' }],
    'global-before-group': [
        { contain: 'none', containPaint: true },
        // A number or a boolean is written bare, a string quoted.
        { contain: 3, containLayout: true },
        { touch: true, touchPanX: 'x' },
    ],
    'color-slash-opacity/op-given': [{ bg: { color: 'red-500/50', op: 30 } }],
    'color-slash-opacity/op-absent': [{ bg: { color: 'blue-500/40!' } }],
};

/**
 * Forms only one lane can reach at all, so no literal drives both: an entry
 * that disappears from the registry fails the completeness check.
 */
const ONE_LANE_FORMS: Readonly<Record<string, string>> = {
    // A runtime value on a removed alias: the engine sees the opaque
    // expression, the runtime only ever sees the value it holds.
    'removed-key/runtime-alias': 'the runtime never sees an opaque value',
};

/**
 * Literals one lane reports and the other does not, with the side that is
 * silent. Each is a known bug; fixing it fails the case here, which forces
 * this entry out.
 */
const KNOWN_GAPS: ReadonlyArray<{
    sz: SzObject;
    code: string;
    silent: 'engine' | 'runtime';
    reason: string;
}> = [];

/**
 * The runtime lowering's lines for one object, the project-scan tip aside.
 *
 * @param sz - The object.
 * @returns The lines, as printed.
 */
function runtimeLines(sz: SzObject): string[] {
    __resetSzWarnDedupForTests();
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
        lines.push(String(args[0]));
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(capture);
    const error = vi.spyOn(console, 'error').mockImplementation(capture);
    try {
        transform(sz);
    } finally {
        warn.mockRestore();
        error.mockRestore();
    }
    return lines.filter(line => szCodeOf(line) !== 'dev-warnings-partial');
}

/**
 * One engine artifact's messages for one object, written as an `sz`
 * attribute, rendered as a build renders them.
 *
 * @param engine - The artifact's unrendered transform.
 * @param sz - The object.
 * @returns The messages.
 */
function engineLines(engine: Unrendered, sz: SzObject): string[] {
    const result = engine(
        `export const A = () => <p sz={${JSON.stringify(sz)}} />;`,
        '/p/src/A.jsx',
    );
    return (result.issues as SzDiagnosticIssue[]).map(issue => renderEngineDiagnostic(issue, ''));
}

/**
 * The bodies of some lines, sorted: the lanes visit an object in different
 * orders, so they are compared as multisets.
 *
 * @param lines - The lines.
 * @returns The bodies.
 */
function bodies(lines: readonly string[]): string[] {
    return lines.map(szBodyOf).sort();
}

describe('runtime and engine diagnostics', () => {
    beforeEach(() => {
        // The lane the runtime's development warnings print in.
        expect(typeof window).toBe('undefined');
    });
    afterEach(() => {
        __resetSzWarnDedupForTests();
    });

    it('has a case for every (id, form) both lanes report', () => {
        expect(SHARED.map(spec => spec.id)).toHaveLength(15);
        expect([...Object.keys(CASES), ...Object.keys(ONE_LANE_FORMS)].sort()).toEqual(
            [...SHARED_FORMS].sort(),
        );
    });

    const inputs = Object.entries(CASES).flatMap(([form, list]) =>
        list.map(sz => [form, sz, JSON.stringify(sz)] as const),
    );
    it('drives each case with a literal of its own', () => {
        const all = [
            ...inputs.map(([, , json]) => json),
            ...KNOWN_GAPS.map(gap => JSON.stringify(gap.sz)),
        ];
        expect(new Set(all).size).toBe(all.length);
    });

    for (const [form, sz, json] of inputs) {
        for (const [name, engine] of ENGINES) {
            it(`${form}: ${json} prints the ${name} engine's words`, () => {
                const runtime = runtimeLines(sz);
                const built = engineLines(engine, sz);
                const code = form.split('/')[0];
                expect(runtime.map(szCodeOf), 'the runtime reports it').toContain(code);
                expect(built.map(szCodeOf), 'the engine reports it').toContain(code);
                expect(bodies(runtime)).toEqual(bodies(built));
            });
        }
    }

    for (const gap of KNOWN_GAPS) {
        for (const [name, engine] of ENGINES) {
            it(`known gap, ${gap.silent} silent (${name}): ${JSON.stringify(gap.sz)} — ${gap.reason}`, () => {
                const runtime = runtimeLines(gap.sz).map(szCodeOf);
                const built = engineLines(engine, gap.sz).map(szCodeOf);
                const [silent, loud] =
                    gap.silent === 'engine' ? [built, runtime] : [runtime, built];
                expect(loud, 'the other lane reports it').toContain(gap.code);
                expect(silent, 'fixed: remove it from KNOWN_GAPS').not.toContain(gap.code);
            });
        }
    }

    // An ARIA state name is the `aria` variant's parameter. Written as a key
    // holding a scalar it is a key no table owns, unless a table owns it in
    // its own right (`checked` is a variant).
    for (const key of ARIA_STATES) {
        for (const value of ['x', 1, true] as const) {
            const sz = { [key]: value };
            for (const [name, engine] of ENGINES) {
                it(`ARIA state ${JSON.stringify(sz)} is unknown to the ${name} engine as at runtime`, () => {
                    const runtime = runtimeLines(sz);
                    const built = engineLines(engine, sz);
                    expect(built.map(szCodeOf)).toEqual(runtime.map(szCodeOf));
                    expect(bodies(built)).toEqual(bodies(runtime));
                });
            }
        }
    }
    it('reports a scalar on an ARIA state name no table owns', () => {
        expect(runtimeLines({ expanded: 'x' }).map(szCodeOf)).toEqual(['unknown-key']);
    });

    // The documented form, the `aria` variant's parameter, reports nothing and
    // lowers alike on every lane.
    for (const [sz, className] of [
        [{ aria: { expanded: { bg: 'red-500' } } }, 'aria-expanded:bg-red-500'],
        [{ aria: { hidden: { p: 4 } } }, 'aria-hidden:p-4'],
        [{ aria: { sort: { p: 4 } } }, 'aria-[sort]:p-4'],
        [{ group: { aria: { pressed: { p: 4 } } } }, 'group-aria-pressed:p-4'],
    ] as const) {
        for (const [name, engine] of ENGINES) {
            it(`${JSON.stringify(sz)} is the aria variant to the ${name} engine as at runtime`, () => {
                expect(runtimeLines(sz)).toEqual([]);
                expect(engineLines(engine, sz)).toEqual([]);
                expect(transform(sz).className).toBe(className);
                const built = engine(
                    `export const A = () => <p sz={${JSON.stringify(sz)}} />;`,
                    '/p/src/A.jsx',
                );
                expect(built.code).toContain(`"${className}"`);
            });
        }
    }

    // A removed boolean-sugar key holding anything but `true` is no sugar: it
    // is a key in its own right where a table owns it (`flex: 1`), and unknown
    // where none does (`tabularNums: 'x'`).
    const gapped = new Set(KNOWN_GAPS.map(gap => JSON.stringify(gap.sz)));
    for (const key of Object.keys(REMOVED_BOOLEAN_SUGAR)) {
        const sz = { [key]: 'x' };
        if (gapped.has(JSON.stringify(sz))) continue;
        for (const [name, engine] of ENGINES) {
            it(`removed sugar ${key} holding a value is unknown to the ${name} engine as at runtime`, () => {
                const unknown = (lines: readonly string[]) =>
                    lines.map(szCodeOf).includes('unknown-key');
                expect(unknown(engineLines(engine, sz))).toBe(unknown(runtimeLines(sz)));
            });
        }
    }
});
