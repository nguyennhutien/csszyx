/**
 * Rust transform parity harness — compares `transformRust` output against
 * `transformWasm` (the v0.8.0 default) on the same fixture set. Catches
 * silent drift as the Rust native engine grows coverage. Sister harness
 * to `oxc-parity-harness.ts`; same state model but the baseline is
 * `transformWasm` instead of `transformSource` because the JavaScript pipeline is the
 * production parser that Rust must match before it can take over.
 *
 * When the Rust native binding is not available (`@csszyx/core/native`
 * cannot load a platform addon), `transformRust` throws
 * `OxcRustNotImplementedError`. The harness records that as
 * `rustIsUnavailable`; fixtures expected to be `pending` still pass.
 * Non-pending fixtures fail with a descriptive error so CI surfaces a
 * missing-build situation instead of silently green-lighting.
 */

import {
    type CssVariableMangleValue,
    OxcRustNotImplementedError,
    type SourceTransformResult,
    type TransformSourceCodeOptions,
    transformRust,
    transformWasm,
} from '../src/index.js';

/**
 * Side-by-side Rust vs the JavaScript pipeline comparison for one fixture.
 */
export interface RustParityComparison {
    /** Did Rust and the JavaScript pipeline agree on the class set? */
    classesEqual: boolean;
    /** Did Rust and the JavaScript pipeline agree on the rewritten source? */
    codeEqual: boolean;
    /** Did Rust and the JavaScript pipeline agree on the `transformed` flag? */
    transformedEqual: boolean;
    /** Did Rust and the JavaScript pipeline agree on emitted CSS custom-property metadata? */
    cssVariableMapEqual: boolean;
    /** the JavaScript pipeline output — always populated unless oxc itself throws. */
    oxc: {
        code: string;
        classes: string[];
        transformed: boolean;
        cssVariableMap: [string, CssVariableMangleValue][];
    };
    /** Rust output — null when the Rust path threw. */
    rust: SourceTransformResult | null;
    /** Error message when Rust threw, otherwise null. */
    rustError: string | null;
    /** True when the Rust error was the unavailable-binding throw. */
    rustIsUnavailable: boolean;
}

/**
 * Fixture descriptor for the Rust parity suite. Mirrors the oxc-parity
 * `ParityFixture` shape but `expected` describes Rust's relationship to
 * the JavaScript pipeline (the v0.8.0 baseline), not Babel.
 */
export interface RustParityFixture {
    /** Human-readable test name. */
    name: string;
    /** TSX/JSX source for the harness. */
    source: string;
    /** Filename passed to both implementations. */
    filename: string;
    /** Optional transform options passed to both parser implementations. */
    options?: TransformSourceCodeOptions;
    /**
     * Expected current parity state:
     * - `pending`: Rust throws `OxcRustNotImplementedError` (native unavailable
     *   OR fixture exercises a path the Rust engine has not yet ported).
     * - `classes-only-parity`: Rust produces the same class set, code may
     *   differ. Reserved for paths where Rust intentionally leaves source
     *   unchanged (e.g. dynamic sz fail-closed) while the JavaScript pipeline emits a
     *   runtime helper call.
     * - `surgical-parity`: classes match, code differs by formatting (rare
     *   for Rust vs the JavaScript pipeline since both go through magic-string-equivalent
     *   surgical edits; included for symmetry).
     * - `rust-ahead`: Rust intentionally produces stricter static output than
     *   the JavaScript pipeline for this fixture. Rust's class set must be a superset of the JavaScript pipeline.
     * - `parity`: full match — classes + code + transformed flag.
     */
    expected: 'pending' | 'classes-only-parity' | 'surgical-parity' | 'rust-ahead' | 'parity';
    /** Why this fixture is pending — link to the slice that lands it. */
    pendingReason?: string;
}

/**
 * Run Rust and the JavaScript pipeline on the same source. Never throws — Rust failures
 * are captured in the return value, oxc failures propagate.
 *
 * @param source Source TSX/JSX text.
 * @param filename Filename passed to both implementations.
 * @param options Optional transform options passed to both implementations.
 * @returns Side-by-side comparison.
 */
export function compareRustVsOxc(
    source: string,
    filename: string,
    options?: TransformSourceCodeOptions,
): RustParityComparison {
    const oxc = transformWasm(source, filename, options);
    const oxcView = {
        code: oxc.code,
        classes: [...oxc.classes].sort(),
        transformed: oxc.transformed,
        cssVariableMap: sortedMapEntries(oxc.cssVariableMap),
    };

    let rust: SourceTransformResult | null = null;
    let rustError: string | null = null;
    let rustIsUnavailable = false;
    try {
        rust = transformRust(source, filename, options);
    } catch (err) {
        rustError = err instanceof Error ? err.message : String(err);
        rustIsUnavailable = err instanceof OxcRustNotImplementedError;
    }

    if (!rust) {
        return {
            classesEqual: false,
            codeEqual: false,
            transformedEqual: false,
            cssVariableMapEqual: false,
            oxc: oxcView,
            rust: null,
            rustError,
            rustIsUnavailable,
        };
    }

    const rustClassesSorted = [...rust.classes].sort();
    return {
        classesEqual: arraysEqual(oxcView.classes, rustClassesSorted),
        codeEqual: oxcView.code === rust.code,
        transformedEqual: oxcView.transformed === rust.transformed,
        cssVariableMapEqual: mapEntriesEqual(
            oxcView.cssVariableMap,
            sortedMapEntries(rust.cssVariableMap),
        ),
        oxc: oxcView,
        rust,
        rustError: null,
        rustIsUnavailable: false,
    };
}

/**
 * Assert the intentionally divergent contract of one pending Rust fixture.
 *
 * @param fixture Pending Rust parity fixture.
 * @param comparison Current Oxc/Rust comparison.
 */
function assertPendingRustParity(
    fixture: RustParityFixture,
    comparison: RustParityComparison,
): void {
    if (comparison.rustError) return;
    if (!comparison.classesEqual || !comparison.codeEqual) return;
    throw new Error(
        `Fixture "${fixture.name}" marked as pending but Rust matched the JavaScript pipeline exactly. ` +
            'Flip its `expected` to "parity" and drop `pendingReason`.',
    );
}

/**
 * Assert that a comparison matches the fixture's expected state. Throws
 * a descriptive error when the actual state differs.
 *
 * @param fixture The fixture under test.
 * @param comparison Output from {@link compareRustVsOxc}.
 */
export function assertExpectedRustParity(
    fixture: RustParityFixture,
    comparison: RustParityComparison,
): void {
    if (fixture.expected === 'pending') {
        assertPendingRustParity(fixture, comparison);
        return;
    }
    if (comparison.rustError) {
        throw new Error(
            `Fixture "${fixture.name}" marked as ${fixture.expected} but Rust threw: ${comparison.rustError}`,
        );
    }
    if (fixture.expected === 'rust-ahead') {
        assertRustAhead(fixture, comparison);
        return;
    }
    if (!comparison.classesEqual) {
        throw new Error(
            `Fixture "${fixture.name}" marked as ${fixture.expected} but class sets differ.\n` +
                `  oxc:  [${comparison.oxc.classes.join(', ')}]\n` +
                `  rust: [${comparison.rust ? [...comparison.rust.classes].sort().join(', ') : ''}]`,
        );
    }
    if (!comparison.cssVariableMapEqual) {
        throw new Error(
            `Fixture "${fixture.name}" marked as ${fixture.expected} but cssVariableMap differs.\n` +
                `  oxc:  ${JSON.stringify(comparison.oxc.cssVariableMap)}\n` +
                `  rust: ${JSON.stringify(sortedMapEntries(comparison.rust?.cssVariableMap ?? new Map()))}`,
        );
    }
    if (fixture.expected === 'classes-only-parity') {
        if (comparison.codeEqual) {
            throw new Error(
                `Fixture "${fixture.name}" marked as classes-only-parity but code also matches the JavaScript pipeline. ` +
                    'Flip its `expected` to "parity".',
            );
        }
        return;
    }
    if (fixture.expected === 'surgical-parity') {
        if (comparison.codeEqual) {
            throw new Error(
                `Fixture "${fixture.name}" marked as surgical-parity but code matches the JavaScript pipeline byte-for-byte. ` +
                    'Flip its `expected` to "parity".',
            );
        }
        return;
    }
    if (!comparison.codeEqual) {
        throw new Error(
            `Fixture "${fixture.name}" marked as parity but rewritten code differs.\n` +
                `  oxc:  ${JSON.stringify(comparison.oxc.code)}\n` +
                `  rust: ${JSON.stringify(comparison.rust?.code ?? '')}`,
        );
    }
}

/**
 * One-line progress summary across all fixtures.
 *
 * @param fixtures All fixtures the suite tracks.
 * @returns Human-readable summary.
 */
export function summariseRust(fixtures: readonly RustParityFixture[]): string {
    const total = fixtures.length;
    const parity = fixtures.filter(f => f.expected === 'parity').length;
    const surgical = fixtures.filter(f => f.expected === 'surgical-parity').length;
    const classesOnly = fixtures.filter(f => f.expected === 'classes-only-parity').length;
    const rustAhead = fixtures.filter(f => f.expected === 'rust-ahead').length;
    const pending = fixtures.filter(f => f.expected === 'pending').length;
    const covered = parity + surgical + classesOnly + rustAhead;
    const pct = total === 0 ? 0 : Math.round((covered / total) * 100);
    return (
        `Rust vs the JavaScript pipeline coverage: ${pct}% — ${parity} full, ${surgical} surgical, ` +
        `${classesOnly} classes-only, ${rustAhead} rust-ahead, ${pending} pending (${total} total)`
    );
}

function assertRustAhead(fixture: RustParityFixture, comparison: RustParityComparison): void {
    if (!comparison.rust?.transformed) {
        throw new Error(
            `Fixture "${fixture.name}" marked as rust-ahead but Rust did not transform source.`,
        );
    }
    if (comparison.codeEqual) {
        throw new Error(
            `Fixture "${fixture.name}" marked as rust-ahead but code matches the JavaScript pipeline. ` +
                'Flip its `expected` to "parity".',
        );
    }
    const rustClasses = [...comparison.rust.classes].sort();
    if (!isSuperset(rustClasses, comparison.oxc.classes)) {
        throw new Error(
            `Fixture "${fixture.name}" marked as rust-ahead but Rust lost the JavaScript pipeline classes.\n` +
                `  oxc:  [${comparison.oxc.classes.join(', ')}]\n` +
                `  rust: [${rustClasses.join(', ')}]`,
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

function isSuperset(a: readonly string[], b: readonly string[]): boolean {
    const seen = new Set(a);
    return b.every(item => seen.has(item));
}
