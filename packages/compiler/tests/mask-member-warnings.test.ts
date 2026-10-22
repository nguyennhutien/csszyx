/**
 * Unknown members inside a mask slot warn on every engine.
 *
 * A typo like `{ maskLinear: { form: '20%' } }` emits NOTHING — worse than an
 * unknown top-level key, which at least leaves a dead class in the DOM to
 * find. The slot shapes are closed, so member NAMES are fully checkable;
 * member VALUES stay unvalidated by design (the compiler is a prefix-mapping
 * engine). The runtime lowering warns through `warnMaskSlotMember` in
 * transform-core (console channel); the Rust engine mirrors it as a diagnostic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSzWarnDedupForTests, setSzWarnLocation, transform } from '../src/transform-core.js';
import { productionMessage, runtimeMessage } from './engine-message.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

/**
 * Collect console warnings emitted synchronously by one runtime call.
 *
 * @param action - Call that may warn through the runtime dev channel.
 * @returns Captured warning strings.
 */
function captureRuntimeWarnings(action: () => void): string[] {
    const calls: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation(m => {
        calls.push(String(m));
    });
    try {
        action();
    } finally {
        spy.mockRestore();
    }
    return calls;
}

beforeEach(() => {
    // The shared JS warning set de-duplicates process-wide; without the reset,
    // lane order would decide which lane looks silent.
    __resetSzWarnDedupForTests();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    setSzWarnLocation(undefined);
});

describe('mask slot member warnings', () => {
    it('deduplicates direct warnings and omits a location when none is set', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        transform({ maskLinear: { typo: 1 } });
        transform({ maskLinear: { typo: 2 } });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).not.toContain(' at ');
    });

    it('suppresses the slot warning in production, not the moved layer', () => {
        // A layer on `mask` emits nothing, which is missing output (ADR 0011),
        // so it prints in every mode, as the engines report it.
        vi.stubEnv('NODE_ENV', 'production');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        transform({ maskLinear: { typo: 1 }, mask: 'linear-45' });
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
    });
    it.each(ENGINES)('%s warns for a top-level typo inside maskLinear', (_lane, engine) => {
        const tsx = "export const A = () => <div sz={{ maskLinear: { form: '20%' } }} />;";
        const { warnings, result } = captureWarnings(engine, tsx);
        expect(result.issues?.map(issue => [issue.code, issue.args])).toEqual([
            [
                'unknown-field',
                {
                    owner: 'maskLinear',
                    member: 'form',
                    allowed: ['angle', 'from', 'to', 't', 'r', 'b', 'l', 'x', 'y'],
                },
            ],
        ]);
        const [hit] = warnings;
        expect(hit).toContain('`maskLinear` has no field `form`, and nothing is emitted for it.');
        expect(hit).toContain('help: `maskLinear` takes `{ angle, from, to, t, r, b, l, x, y }`.');
    });

    it.each(ENGINES)('%s warns inside a linear edge object', (_lane, engine) => {
        const tsx = "export const A = () => <div sz={{ maskLinear: { b: { form: '0%' } } }} />;";
        const { warnings, result } = captureWarnings(engine, tsx);
        expect(result.issues?.map(issue => [issue.code, issue.args])).toEqual([
            ['unknown-field', { owner: 'maskLinear.b', member: 'form', allowed: ['from', 'to'] }],
        ]);
        const [hit] = warnings;
        expect(hit).toContain('`maskLinear.b` has no field `form`');
        expect(hit).toContain('help: `maskLinear.b` takes `{ from, to }`.');
    });

    it.each(ENGINES)('%s rejects a side key on the conic slot', (_lane, engine) => {
        // Sides belong to the linear slot only; conic silently dropped them.
        const tsx = "export const A = () => <div sz={{ maskConic: { t: { from: '0%' } } }} />;";
        const { warnings, result } = captureWarnings(engine, tsx);
        expect(result.issues?.map(issue => [issue.code, issue.args])).toEqual([
            [
                'unknown-field',
                { owner: 'maskConic', member: 't', allowed: ['angle', 'from', 'to'] },
            ],
        ]);
        const [hit] = warnings;
        expect(hit).toContain('`maskConic` has no field `t`');
        expect(hit).toContain('help: `maskConic` takes `{ angle, from, to }`.');
    });

    it.each(ENGINES)('%s warns for an unknown radial member', (_lane, engine) => {
        const tsx = "export const A = () => <div sz={{ maskRadial: { bogus: 1, at: 'top' } }} />;";
        const { warnings, result } = captureWarnings(engine, tsx);
        expect(result.issues?.map(issue => [issue.code, issue.args])).toEqual([
            [
                'unknown-field',
                {
                    owner: 'maskRadial',
                    member: 'bogus',
                    allowed: ['at', 'size', 'shape', 'from', 'to'],
                },
            ],
        ]);
        const [hit] = warnings;
        expect(hit).toContain('`maskRadial` has no field `bogus`');
        expect(hit).toContain('help: `maskRadial` takes `{ at, size, shape, from, to }`.');
    });

    it.each(ENGINES)('%s stays silent for a fully legal slot', (_lane, engine) => {
        const tsx =
            "export const A = () => <div sz={{ maskLinear: { angle: 45, b: { from: '0%' } } }} />;";
        const { result } = captureWarnings(engine, tsx);
        expect(result.issues?.filter(issue => issue.code === 'unknown-field')).toEqual([]);
    });

    // The documented mask-layer rows (`docs/specs/snippets/effects.md`) and
    // what migrate writes for `mask-linear-45`. A slot member is geometry, so
    // the generic key walk must not read `angle` / `at` / `shape` as an sz key
    // either: `unknown-key` is an error by default, and `csszyx check` failed
    // on the documented syntax while the class was emitted.
    const documentedMaskForms: ReadonlyArray<readonly [string, string]> = [
        ['{ maskLinear: { angle: 45 } }', 'mask-linear-45'],
        ['{ maskLinear: { angle: -45 } }', '-mask-linear-45'],
        ["{ maskLinear: { angle: '--a' } }", 'mask-linear-(--a)'],
        ["{ maskRadial: { at: 'center' } }", 'mask-radial-at-center'],
        ["{ maskRadial: { shape: 'circle' } }", 'mask-circle'],
        ["{ maskRadial: { size: 'closest-side' } }", 'mask-radial-closest-side'],
        ['{ maskConic: { angle: 90 } }', 'mask-conic-90'],
        ['{ md: { maskLinear: { angle: 45 } } }', 'md:mask-linear-45'],
    ];

    it.each(
        ENGINES.flatMap(([lane, engine]) =>
            documentedMaskForms.map(([sz, expected]) => [lane, sz, expected, engine] as const),
        ),
    )('%s emits %s with no diagnostic', (_lane, sz, expected, engine) => {
        const tsx = `export const A = () => <div sz={${sz}} />;`;
        const run = captureWarnings(engine, tsx);
        expect(run.className).toBe(expected);
        expect(run.warnings).toEqual([]);
        expect(run.result.issues ?? []).toEqual([]);
    });

    it.each(ENGINES)('%s reports an unknown slot member once, as a field', (_lane, engine) => {
        const tsx = 'export const A = () => <div sz={{ maskRadial: { angle: 45 } }} />;';
        const codes = (captureWarnings(engine, tsx).result.issues ?? []).map(issue => issue.code);
        expect(codes).toEqual(['unknown-field']);
    });
});

// The runtime lowering names a removed key with its migration note as the
// help, as the engine does (`removed-key`, form `removed`).
describe('removed mask keys carry migration notes', () => {
    it('names the shape that replaced maskVia', () => {
        expect(captureRuntimeWarnings(() => transform({ maskVia: '50%' }))).toEqual([
            runtimeMessage(
                'removed-key',
                '`maskVia` was removed, and nothing is emitted for it.',
                'help: write `{ from, to }` on `maskLinear`, `maskRadial` or `maskConic`; Tailwind masks have no via stop.',
            ),
        ]);
    });

    it('points maskShape at maskRadial', () => {
        expect(captureRuntimeWarnings(() => transform({ maskShape: 'circle' }))).toEqual([
            runtimeMessage(
                'removed-key',
                '`maskShape` was removed, and nothing is emitted for it.',
                "help: write the shape on `maskRadial`: `{ shape: 'circle' }` or `{ shape: 'ellipse' }`.",
            ),
        ]);
    });
});

describe('the mask layer-value warning fires in a browser dev context', () => {
    it('is not silenced by a defined window', () => {
        // The generic sz warnings gate on `typeof window === 'undefined'`; the
        // mask migration warning must NOT, because runtime `_sz` in a prop-API
        // component is exactly where a migrated value shows up.
        (globalThis as { window?: object }).window = {};
        try {
            expect(captureRuntimeWarnings(() => transform({ mask: 'linear-45' }))).toEqual([
                runtimeMessage(
                    'moved-value',
                    "`mask: 'linear-45'` names a gradient layer, which moved to `maskLinear`, and nothing is emitted for it.",
                    'help: write this layer on `maskLinear`; `mask` takes only `none`, a `url()` or a CSS variable.',
                ),
            ]);
        } finally {
            delete (globalThis as { window?: object }).window;
        }
    });
});

describe('revived value mappings', () => {
    it.each(ENGINES)('%s lowers ring none to ring-0', (_lane, engine) => {
        const tsx = "export const A = () => <div sz={{ ring: 'none' }} />;";
        expect(engine(tsx, '/p/t.tsx').code).toContain('ring-0');
    });

    it.each(ENGINES)('%s lowers fontFeatures normal to the bracketed form', (_lane, engine) => {
        const tsx = "export const A = () => <div sz={{ fontFeatures: 'normal' }} />;";
        expect(engine(tsx, '/p/t.tsx').code).toContain('font-features-[normal]');
    });
});
