import { describe, expect, it } from 'vitest';

import { OxcRustNotImplementedError, transformRust, transformRustBatch } from '../src/index.js';

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

    it('includes the native loader diagnostic when the addon is unavailable', () => {
        try {
            const result = transformRust(
                'const App = () => <div sz={{ p: 4 }} />;',
                '/repo/src/App.tsx',
            );
            expect(result.code).toContain('className="p-4"');
        } catch (err) {
            expect(err).toBeInstanceOf(OxcRustNotImplementedError);
            expect((err as Error).message).toContain('Use build.parser: "oxc" or "babel"');
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
