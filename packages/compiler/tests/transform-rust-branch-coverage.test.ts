/**
 * Branch coverage for transform-rust.ts's REAL native path (this container ships
 * the addon). Drives the alias-table normalizer through all three input shapes
 * (Map / array / plain object) and the native-result conversion, asserting the
 * transformed code. The unavailable/error mappings are exercised separately in
 * transform-rust-unavailable.test.ts (which mocks the native module).
 */
import { describe, expect, it } from 'vitest';
import {
    ensureRustTransformAvailable,
    isRustTransformAvailable,
    transformRust,
    transformRustBatch,
} from '../src/transform-rust.js';

const SZ_SOURCE = 'export const A = <div sz={{ p: 4 }} />;';

describe('transform-rust with the real native addon', () => {
    it('probe reports the addon is available and ensure* does not throw', () => {
        expect(isRustTransformAvailable()).toBe(true);
        expect(() => ensureRustTransformAvailable()).not.toThrow();
    });

    it('transformRust lowers a single sz object', () => {
        const result = transformRust(SZ_SOURCE, 'a.tsx');
        expect(result.code).toContain('p-4');
        expect(result.classes.has('p-4')).toBe(true);
        expect(result.transformed).toBe(true);
    });

    it('transformRustBatch keeps input order and fills a default filename', () => {
        const results = transformRustBatch([
            { source: SZ_SOURCE, filename: 'a.tsx' },
            { source: 'export const B = <span sz={{ m: 2 }} />;' },
        ]);
        expect(results).toHaveLength(2);
        expect(results[0].code).toContain('p-4');
        expect(results[1].code).toContain('m-2');
    });

    it('normalizes a Map alias table', () => {
        const result = transformRustBatch([{ source: SZ_SOURCE }], {
            globalVarAliases: new Map([
                ['--brand', '--b'],
                // filtered out: not a `--` custom-property pair
                ['brand', 'b'] as unknown as [string, string],
            ]),
        });
        expect(result[0].code).toContain('p-4');
    });

    it('normalizes an array alias table', () => {
        const result = transformRustBatch([{ source: SZ_SOURCE }], {
            globalVarAliases: [
                ['--brand', '--b'],
                ['nope', '--b'],
            ],
        });
        expect(result[0].code).toContain('p-4');
    });

    it('normalizes a plain-object alias table', () => {
        const result = transformRustBatch([{ source: SZ_SOURCE }], {
            globalVarAliases: { '--brand': '--b', bad: 'x' },
        });
        expect(result[0].code).toContain('p-4');
    });

    it('handles an empty/absent alias table and returns a css-variable map', () => {
        const result = transformRustBatch([{ source: SZ_SOURCE }], {});
        expect(result[0].cssVariableMap).toBeInstanceOf(Map);
        const noOpts = transformRustBatch([{ source: SZ_SOURCE }]);
        expect(noOpts[0].code).toContain('p-4');
    });

    it('surfaces CSS-variable mangling metadata when mangleVars is on', () => {
        const source =
            'export const C = () => { const v = { "--gap": "4px" }; return <div sz={{ css: v }} />; };';
        const result = transformRustBatch([{ source, filename: 'c.tsx' }], { mangleVars: true });
        // Whatever the engine emits, the conversion must yield a real Map.
        expect(result[0].cssVariableMap).toBeInstanceOf(Map);
    });
});
