/**
 * Native-vs-wasm parity harness — compares `transformRust` (the native napi
 * artifact of the Rust engine) against `transformWasm` (the wasm artifact of
 * the same engine) on one source. Both are builds of one engine, so the only
 * acceptable relationship is identical output: same rewritten code, same
 * class set, same `transformed` flag, same CSS custom-property metadata.
 *
 * When the native binding is not available (`@csszyx/core/native` cannot load
 * a platform addon), `transformRust` throws `RustTransformUnavailableError`.
 * The comparison records that as `rustIsUnavailable`, and
 * {@link assertNativeMatchesWasm} fails with the error text so CI surfaces a
 * missing build instead of passing on one artifact.
 */

import { RustTransformUnavailableError, transformRust, transformWasm } from '../src/engine.js';
import type {
    CssVariableMangleValue,
    SourceTransformResult,
    TransformSourceCodeOptions,
} from '../src/index.js';

/**
 * Side-by-side native vs wasm comparison for one source.
 */
export interface RustParityComparison {
    /** Did the two artifacts agree on the class set? */
    classesEqual: boolean;
    /** Did the two artifacts agree on the rewritten source? */
    codeEqual: boolean;
    /** Did the two artifacts agree on the `transformed` flag? */
    transformedEqual: boolean;
    /** Did the two artifacts agree on emitted CSS custom-property metadata? */
    cssVariableMapEqual: boolean;
    /** Wasm output — always populated unless the wasm artifact itself throws. */
    wasm: {
        code: string;
        classes: string[];
        transformed: boolean;
        cssVariableMap: [string, CssVariableMangleValue][];
    };
    /** Native output — null when the native path threw. */
    rust: SourceTransformResult | null;
    /** Error message when the native path threw, otherwise null. */
    rustError: string | null;
    /** True when the native error was the unavailable-binding throw. */
    rustIsUnavailable: boolean;
}

/**
 * Fixture descriptor for the native-vs-wasm parity suite.
 */
export interface RustParityFixture {
    /** Human-readable test name. */
    name: string;
    /** TSX/JSX source for the harness. */
    source: string;
    /** Filename passed to both artifacts. */
    filename: string;
    /** Optional transform options passed to both artifacts. */
    options?: TransformSourceCodeOptions;
}

/**
 * Run the native and wasm artifacts on the same source. Never throws — native
 * failures are captured in the return value, wasm failures propagate.
 *
 * @param source Source TSX/JSX text.
 * @param filename Filename passed to both artifacts.
 * @param options Optional transform options passed to both artifacts.
 * @returns Side-by-side comparison.
 */
export function compareNativeVsWasm(
    source: string,
    filename: string,
    options?: TransformSourceCodeOptions,
): RustParityComparison {
    const wasmResult = transformWasm(source, { filename: filename, ...options });
    const wasm = {
        code: wasmResult.code,
        classes: [...wasmResult.classes].sort(),
        transformed: wasmResult.transformed,
        cssVariableMap: sortedMapEntries(wasmResult.cssVariableMap),
    };

    let rust: SourceTransformResult | null = null;
    let rustError: string | null = null;
    let rustIsUnavailable = false;
    try {
        rust = transformRust(source, { filename: filename, ...options });
    } catch (err) {
        rustError = err instanceof Error ? err.message : String(err);
        rustIsUnavailable = err instanceof RustTransformUnavailableError;
    }

    if (!rust) {
        return {
            classesEqual: false,
            codeEqual: false,
            transformedEqual: false,
            cssVariableMapEqual: false,
            wasm,
            rust: null,
            rustError,
            rustIsUnavailable,
        };
    }

    const rustClassesSorted = [...rust.classes].sort();
    return {
        classesEqual: arraysEqual(wasm.classes, rustClassesSorted),
        codeEqual: wasm.code === rust.code,
        transformedEqual: wasm.transformed === rust.transformed,
        cssVariableMapEqual: mapEntriesEqual(
            wasm.cssVariableMap,
            sortedMapEntries(rust.cssVariableMap),
        ),
        wasm,
        rust,
        rustError: null,
        rustIsUnavailable: false,
    };
}

/**
 * Assert that the native and wasm artifacts agreed completely on one fixture.
 * Throws a descriptive error naming the first field that differs.
 *
 * @param fixture The fixture under test.
 * @param comparison Output from {@link compareNativeVsWasm}.
 */
export function assertNativeMatchesWasm(
    fixture: RustParityFixture,
    comparison: RustParityComparison,
): void {
    if (comparison.rustError) {
        throw new Error(`Fixture "${fixture.name}": native threw: ${comparison.rustError}`);
    }
    if (!comparison.classesEqual) {
        throw new Error(
            `Fixture "${fixture.name}": class sets differ.\n` +
                `  wasm:   [${comparison.wasm.classes.join(', ')}]\n` +
                `  native: [${comparison.rust ? [...comparison.rust.classes].sort().join(', ') : ''}]`,
        );
    }
    if (!comparison.cssVariableMapEqual) {
        throw new Error(
            `Fixture "${fixture.name}": cssVariableMap differs.\n` +
                `  wasm:   ${JSON.stringify(comparison.wasm.cssVariableMap)}\n` +
                `  native: ${JSON.stringify(sortedMapEntries(comparison.rust?.cssVariableMap ?? new Map()))}`,
        );
    }
    if (!comparison.transformedEqual) {
        throw new Error(
            `Fixture "${fixture.name}": transformed flag differs.\n` +
                `  wasm:   ${comparison.wasm.transformed}\n` +
                `  native: ${comparison.rust?.transformed}`,
        );
    }
    if (!comparison.codeEqual) {
        throw new Error(
            `Fixture "${fixture.name}": rewritten code differs.\n` +
                `  wasm:   ${JSON.stringify(comparison.wasm.code)}\n` +
                `  native: ${JSON.stringify(comparison.rust?.code ?? '')}`,
        );
    }
}

/**
 * Element-wise string array equality.
 *
 * @param a First sorted array.
 * @param b Second sorted array.
 * @returns True iff arrays are element-wise equal.
 */
function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

function mapEntriesEqual(
    a: readonly [string, CssVariableMangleValue][],
    b: readonly [string, CssVariableMangleValue][],
): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i]?.[0] !== b[i]?.[0] || JSON.stringify(a[i]?.[1]) !== JSON.stringify(b[i]?.[1])) {
            return false;
        }
    }
    return true;
}

function sortedMapEntries(
    map: ReadonlyMap<string, CssVariableMangleValue>,
): [string, CssVariableMangleValue][] {
    return [...map.entries()]
        .map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value] as const)
        .sort(([a], [b]) => a.localeCompare(b));
}
