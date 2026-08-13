/**
 * The wasm lane is the SAME engine as the napi lane — `parser.rs` compiled to
 * wasm32 instead of the host — so its oracle here is `transformRust` itself:
 * every option the JS wrapper plumbs through (registries, mangling, aliases,
 * AST budget) must produce the identical `SourceTransformResult`, field for
 * field, or the wrapper lost something at the boundary.
 *
 * Requires `pnpm --filter @csszyx/core build` (pkg-parser) and the native
 * binding (the oracle side).
 */
import { describe, expect, it } from 'vitest';
import type { SourceTransformResult, TransformSourceCodeOptions } from '../src/transform.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';

type WasmLane = {
    transformWasm(
        source: string,
        filename?: string,
        options?: TransformSourceCodeOptions,
    ): SourceTransformResult;
    isWasmTransformAvailable(): boolean;
};

const lane: WasmLane | null = await import('../src/transform-wasm.js').catch(() => null);

const MISSING = 'transform-wasm lane is not implemented yet';
const nativeReady = isRustTransformAvailable();

/**
 * Compare the fields a build consumes, as plain JSON for readable diffs.
 *
 * @param result - Lane output to flatten.
 * @returns JSON-friendly projection of the result.
 */
function comparable(result: SourceTransformResult): unknown {
    return {
        code: result.code,
        transformed: result.transformed,
        usesRuntime: result.usesRuntime,
        usesSzvPick: result.usesSzvPick,
        classes: [...result.classes].sort(),
        rawClassNames: [...result.rawClassNames].sort(),
        diagnostics: result.diagnostics,
        recoveryTokens: [...result.recoveryTokens.entries()],
        cssVariableMap: [...result.cssVariableMap.entries()],
    };
}

/**
 * Run one source through both artifacts of the engine.
 *
 * @param source - Module source.
 * @param options - Compiler options passed identically to each lane.
 * @returns Comparable projections from the wasm and napi lanes.
 */
function bothLanes(
    source: string,
    options?: TransformSourceCodeOptions,
): { wasm: unknown; native: unknown } {
    if (!lane) throw new Error(MISSING);
    return {
        wasm: comparable(lane.transformWasm(source, '/p/t.tsx', options)),
        native: comparable(transformRust(source, '/p/t.tsx', options)),
    };
}

describe('transform-wasm lane', () => {
    it('names its unavailable error after the loader detail', async () => {
        // The degrade path prints this error's message when an EXPLICIT wasm
        // choice cannot load — the wording is the contract worth pinning.
        const { WasmTransformUnavailableError } = await import('../src/transform-wasm.js');
        const err = new WasmTransformUnavailableError('artifact not found');
        expect(err.name).toBe('WasmTransformUnavailableError');
        expect(err.message).toBe('transformWasm: wasm engine unavailable - artifact not found');
        expect(err).toBeInstanceOf(Error);
    });

    it('exists and reports availability', () => {
        expect(lane, MISSING).not.toBeNull();
        expect(lane?.isWasmTransformAvailable()).toBe(true);
    });

    it.runIf(nativeReady)('matches the native lane on a static sz object', () => {
        expect(lane, MISSING).not.toBeNull();
        const { wasm, native } = bothLanes(
            'export const A = () => <div sz={{ p: 4, bg: "red-500", hover: { m: 2 } }} />;',
        );
        expect(wasm).toEqual(native);
    });

    it.runIf(nativeReady)('matches the native lane through a cross-module szv registry', () => {
        expect(lane, MISSING).not.toBeNull();
        const source =
            "import { szr } from '@csszyx/runtime';\n" +
            "import { cardSz } from './styles';\n" +
            "export const cls = szr(cardSz({ pad: 'lg' }));";
        const options: TransformSourceCodeOptions = {
            rootDir: '/p',
            crossModuleStatics: {
                './styles': {
                    cardSz: {
                        base: { rounded: 'lg' },
                        variants: { pad: { sm: { p: 2 }, lg: { p: 8 } } },
                    },
                },
            },
        };
        const { wasm, native } = bothLanes(source, options);
        expect(wasm).toEqual(native);
        expect(JSON.stringify(wasm)).toContain('rounded-lg p-8');
    });

    it.runIf(nativeReady)('matches the native lane with var mangling and aliases', () => {
        expect(lane, MISSING).not.toBeNull();
        const { wasm, native } = bothLanes(
            "export const M = ({ c }) => <div sz={{ bg: c, p: 4, m: '#ff0000' }} />;",
            { mangleVars: true, globalVarAliases: { '--brand': '--b' } },
        );
        expect(wasm).toEqual(native);
    });

    it.runIf(nativeReady)('matches the native lane when the AST budget trips', () => {
        expect(lane, MISSING).not.toBeNull();
        const big =
            'export const Big = () => <div>' +
            Array.from({ length: 200 }, (_, i) => `<i sz={{ p: ${i % 9} }} />`).join('') +
            '</div>;';
        const { wasm, native } = bothLanes(big, { astBudget: 40 });
        expect(wasm).toEqual(native);
    });

    it.runIf(nativeReady)('matches the native lane on recovery tokens', () => {
        expect(lane, MISSING).not.toBeNull();
        const { wasm, native } = bothLanes(
            "export const R = () => <><Card szRecover='csr' sz={{ p: 4 }} /><Panel szRecover='dev-only' /></>;",
        );
        expect(wasm).toEqual(native);
    });
});
