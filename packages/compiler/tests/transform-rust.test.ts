import { describe, expect, it } from 'vitest';

import { OxcRustNotImplementedError, transformRust, transformRustBatch } from '../src/index.js';

describe('transformRust scaffold', () => {
    it('throws an explicit not-implemented error instead of falling back', () => {
        expect(() =>
            transformRust('const App = () => <div sz={{ p: 4 }} />;', '/repo/src/App.tsx'),
        ).toThrow(OxcRustNotImplementedError);
    });

    it('includes the native loader diagnostic in the scaffold error', () => {
        expect(() =>
            transformRust('const App = () => <div sz={{ p: 4 }} />;', '/repo/src/App.tsx'),
        ).toThrow('Use build.parser: "oxc" or "babel"');
    });

    it('keeps batch wrapper on the same unavailable-native error path', () => {
        expect(() =>
            transformRustBatch([
                {
                    filename: '/repo/src/App.tsx',
                    source: 'const App = () => <div sz={{ p: 4 }} />;',
                },
            ]),
        ).toThrow(OxcRustNotImplementedError);
    });

    it('names the scaffold error for callers and benchmarks', () => {
        const err = new OxcRustNotImplementedError('test detail');

        expect(err.name).toBe('OxcRustNotImplementedError');
        expect(err.message).toContain('transformRust: not implemented yet');
        expect(err.message).toContain('test detail');
    });
});
