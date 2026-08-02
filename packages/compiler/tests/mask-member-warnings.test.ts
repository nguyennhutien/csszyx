/**
 * Unknown members inside a mask slot warn on every engine.
 *
 * A typo like `{ maskLinear: { form: '20%' } }` emits NOTHING — worse than an
 * unknown top-level key, which at least leaves a dead class in the DOM to
 * find. The slot shapes are closed, so member NAMES are fully checkable;
 * member VALUES stay unvalidated by design (the compiler is a prefix-mapping
 * engine). The JS lanes share `warnMaskSlotMember` in transform-core (console
 * channel), the native engine mirrors it as a diagnostic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transformSourceCode } from '../src/transform.js';
import { __resetSzWarnDedupForTests, setSzWarnLocation, transform } from '../src/transform-core.js';
import { transformOxc } from '../src/transform-oxc.js';
import { captureWarnings, ENGINES, type TriEngine } from './tri-engine-harness.js';

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

    it('suppresses slot and migration warnings in production', () => {
        vi.stubEnv('NODE_ENV', 'production');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        transform({ maskLinear: { typo: 1 }, mask: 'linear-45' });
        expect(warn).not.toHaveBeenCalled();
    });
    it.each(ENGINES)('%s warns for a top-level typo inside maskLinear', (_lane, engine) => {
        const tsx = "export const A = () => <div sz={{ maskLinear: { form: '20%' } }} />;";
        const { warnings } = captureWarnings(engine, tsx);
        const hit = warnings.find(message => message.includes('maskLinear: unknown field "form"'));
        expect(hit, warnings.join('\n')).toBeDefined();
        expect(hit).toContain('nothing is emitted for it');
        expect(hit).toContain('maskLinear takes { angle, from, to, t, r, b, l, x, y }');
    });

    it.each(ENGINES)('%s warns inside a linear edge object', (_lane, engine) => {
        const tsx = "export const A = () => <div sz={{ maskLinear: { b: { form: '0%' } } }} />;";
        const { warnings } = captureWarnings(engine, tsx);
        const hit = warnings.find(message =>
            message.includes('maskLinear.b: unknown field "form"'),
        );
        expect(hit, warnings.join('\n')).toBeDefined();
        expect(hit).toContain('maskLinear.b takes { from, to }');
    });

    it.each(ENGINES)('%s rejects a side key on the conic slot', (_lane, engine) => {
        // Sides belong to the linear slot only; conic silently dropped them.
        const tsx = "export const A = () => <div sz={{ maskConic: { t: { from: '0%' } } }} />;";
        const { warnings } = captureWarnings(engine, tsx);
        const hit = warnings.find(message => message.includes('maskConic: unknown field "t"'));
        expect(hit, warnings.join('\n')).toBeDefined();
        expect(hit).toContain('maskConic takes { angle, from, to }');
    });

    it.each(ENGINES)('%s warns for an unknown radial member', (_lane, engine) => {
        const tsx = "export const A = () => <div sz={{ maskRadial: { bogus: 1, at: 'top' } }} />;";
        const { warnings } = captureWarnings(engine, tsx);
        const hit = warnings.find(message => message.includes('maskRadial: unknown field "bogus"'));
        expect(hit, warnings.join('\n')).toBeDefined();
        expect(hit).toContain('maskRadial takes { at, size, shape, from, to }');
    });

    it.each(ENGINES)('%s stays silent for a fully legal slot', (_lane, engine) => {
        const tsx =
            "export const A = () => <div sz={{ maskLinear: { angle: 45, b: { from: '0%' } } }} />;";
        const warnings = captureWarnings(engine, tsx).warnings.filter(message =>
            message.includes('unknown field'),
        );
        expect(warnings).toEqual([]);
    });
});

describe('removed mask keys carry migration notes', () => {
    it('names the shape that replaced maskVia', () => {
        const { warnings } = captureWarnings(
            transformSourceCode as TriEngine,
            "export const A = () => <div sz={{ maskVia: '50%' }} />;",
        );
        const hit = warnings.find(message => message.includes('"maskVia" was removed'));
        expect(hit, warnings.join('\n')).toBeDefined();
        expect(hit).toContain('masks have no via stop in Tailwind');
    });

    it('points maskShape at maskRadial', () => {
        const { warnings } = captureWarnings(
            transformOxc as TriEngine,
            "export const A = () => <div sz={{ maskShape: 'circle' }} />;",
        );
        const hit = warnings.find(message => message.includes('"maskShape" was removed'));
        expect(hit, warnings.join('\n')).toBeDefined();
        expect(hit).toContain('maskRadial');
    });
});

describe('the mask layer-value warning fires in a browser dev context', () => {
    it('is not silenced by a defined window', () => {
        // The generic sz warnings gate on `typeof window === 'undefined'`; the
        // mask migration warning must NOT, because runtime `_sz` in a prop-API
        // component is exactly where a migrated value shows up.
        (globalThis as { window?: object }).window = {};
        try {
            const { warnings } = captureWarnings(
                transformSourceCode as TriEngine,
                "export const A = () => <div sz={{ mask: 'linear-45' }} />;",
            );
            const hit = warnings.find(message => message.includes('gradient layers moved to'));
            expect(hit, warnings.join('\n')).toBeDefined();
            expect(hit).toContain('maskLinear');
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
