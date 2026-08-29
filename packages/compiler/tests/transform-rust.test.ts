import { describe, expect, it } from 'vitest';

import {
    ensureRustTransformAvailable,
    isRustTransformAvailable,
    OxcRustNotImplementedError,
    transformRust,
    transformRustBatch,
    transformWasm,
} from '../src/index.js';

describe('isRustTransformAvailable — non-throwing native probe', () => {
    it('returns a boolean and never throws (the whole point vs ensureRustTransformAvailable)', () => {
        let value: unknown;
        expect(() => {
            value = isRustTransformAvailable();
        }).not.toThrow();
        expect(typeof value).toBe('boolean');
    });

    it('is stable across repeated calls (memoized — no per-call reprobe flakiness)', () => {
        const first = isRustTransformAvailable();
        for (let i = 0; i < 5; i++) {
            expect(isRustTransformAvailable()).toBe(first);
        }
    });

    it('agrees with ensureRustTransformAvailable: true ⇔ ensure does not throw', () => {
        const available = isRustTransformAvailable();
        if (available) {
            expect(() => ensureRustTransformAvailable()).not.toThrow();
        } else {
            // false MUST mean the loud path throws the documented error — otherwise
            // graceful degradation would mask a binary that is actually present.
            expect(() => ensureRustTransformAvailable()).toThrow(OxcRustNotImplementedError);
        }
    });
});

describe('transformRust native wrapper', () => {
    it('transforms through native when available and otherwise fails explicitly', () => {
        try {
            const result = transformRust(
                'const App = () => <div sz={{ p: 4 }} />;',
                '/repo/src/App.tsx',
            );
            expect(result.code).toContain('className="p-4"');
            expect(result.transformed).toBe(true);
        } catch (err) {
            expect(err).toBeInstanceOf(OxcRustNotImplementedError);
            expect((err as Error).message).toContain('native engine unavailable');
        }
    });

    it('keeps batch wrapper on the same native execution path', () => {
        try {
            const [result] = transformRustBatch([
                {
                    filename: '/repo/src/App.tsx',
                    source: 'const App = () => <div sz={{ p: 4 }} />;',
                },
            ]);
            expect(result?.code).toContain('className="p-4"');
        } catch (err) {
            expect(err).toBeInstanceOf(OxcRustNotImplementedError);
            expect((err as Error).message).toContain('native engine unavailable');
        }
    });

    it('keeps the compatibility error name for callers and benchmarks', () => {
        const err = new OxcRustNotImplementedError('test detail');

        expect(err.name).toBe('OxcRustNotImplementedError');
        expect(err.message).toContain('transformRust: native engine unavailable');
        expect(err.message).toContain('test detail');
    });
});

describe('AST budget — rust plumbing and no-partial-classes contract', () => {
    // Big enough to exceed the default 50 000-node budget under every engine.
    // The szv catalog sits at the TOP so a partial IR walk WOULD have collected
    // it — silent partial safelists were a field-reported parser-flip
    // divergence (classes present under oxc, missing under rust).
    const bigSource = `import { szv } from 'csszyx';
const controlSz = szv({ variants: { layout: { a: { mx: 0, my: 4 } } } });
export const App = () => (<div>${'<span className="cell">x</span>'.repeat(30_000)}</div>);
`;

    it('drops ALL classes (no silent partial safelist) when the default budget trips', () => {
        let result: ReturnType<typeof transformRust>;
        try {
            result = transformRust(bigSource, '/repo/src/Big.tsx');
        } catch (err) {
            expect(err).toBeInstanceOf(OxcRustNotImplementedError);
            return;
        }
        expect(result.transformed).toBe(false);
        expect(result.classes.size).toBe(0);
        expect(result.rawClassNames.size).toBe(0);
        expect([...result.diagnostics].some(d => d.includes('AST budget exceeded'))).toBe(true);
    });

    it('honours options.astBudget end to end (build.astBudgetLimit reaches the native parser)', () => {
        let result: ReturnType<typeof transformRust>;
        try {
            result = transformRust(bigSource, '/repo/src/Big.tsx', { astBudget: 2_000_000 });
        } catch (err) {
            expect(err).toBeInstanceOf(OxcRustNotImplementedError);
            return;
        }
        expect(result.classes.has('mx-0')).toBe(true);
        expect(result.classes.has('my-4')).toBe(true);
        expect([...result.diagnostics].some(d => d.includes('AST budget exceeded'))).toBe(false);
    });

    it('the wasm artifact obeys the same budget knob', () => {
        const tripped = transformWasm(bigSource, '/repo/src/Big.tsx');
        expect(tripped.diagnostics.some(d => d.includes('AST budget exceeded'))).toBe(true);
        expect(tripped.classes.size).toBe(0);
        const raised = transformWasm(bigSource, '/repo/src/Big.tsx', { astBudget: 2_000_000 });
        expect(raised.classes.has('mx-0')).toBe(true);
    });
});
