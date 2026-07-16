/**
 * Phase D parity harness — runs both `transformSourceCode` (Babel) and
 * `transformOxc` (oxc-parser + magic-string) on the same input and
 * reports where they diverge. Used by `oxc-parity.test.ts` to track
 * how many fixtures each D2.x slice unlocks.
 *
 * The harness is intentionally tolerant of the oxc skeleton throwing
 * `OxcNotImplementedError` — that is the expected state for any
 * fixture marked `expected: 'pending'`. Real parity assertions kick
 * in only when a fixture is marked `expected: 'parity'`.
 */

import { transformSourceCode } from '../src/transform.js';
import {
    OxcNotImplementedError,
    type TransformOxcResult,
    transformOxc,
} from '../src/transform-oxc.js';

/**
 * Side-by-side comparison of Babel and oxc transform output for one
 * fixture. Every field is populated even when one side errored, so the
 * harness can log meaningful diffs without further branching.
 */
export interface ParityComparison {
    /** Did both implementations agree on the class set? */
    classesEqual: boolean;
    /** Did both implementations agree on the rewritten source? */
    codeEqual: boolean;
    /** Did both implementations agree on the diagnostic strings? */
    diagnosticsEqual: boolean;
    /** Did both implementations agree on the `transformed` flag? */
    transformedEqual: boolean;
    /** Babel output (always populated unless Babel itself throws). */
    babel: {
        code: string;
        classes: string[];
        diagnostics: string[];
        transformed: boolean;
    };
    /** oxc output — null when the oxc skeleton threw. */
    oxc: TransformOxcResult | null;
    /** Error message when oxc threw, otherwise null. */
    oxcError: string | null;
    /** True when the oxc error was the expected skeleton throw. */
    oxcIsSkeleton: boolean;
}

/**
 * Run both implementations on the same source and produce a
 * {@link ParityComparison}. Never throws — Babel errors propagate via
 * an empty comparison; oxc errors are captured in the result.
 *
 * @param source Source TSX/JSX text.
 * @param filename Filename passed to both implementations.
 * @returns Comparison of the two implementations' output.
 */
export function compareImpls(source: string, filename: string): ParityComparison {
    const babel = transformSourceCode(source, filename);
    const babelView = {
        code: babel.code,
        classes: [...babel.classes].sort(),
        diagnostics: [...babel.diagnostics],
        transformed: babel.transformed,
    };

    let oxc: TransformOxcResult | null = null;
    let oxcError: string | null = null;
    let oxcIsSkeleton = false;
    try {
        oxc = transformOxc(source, filename);
    } catch (err) {
        oxcError = err instanceof Error ? err.message : String(err);
        oxcIsSkeleton = err instanceof OxcNotImplementedError;
    }

    if (!oxc) {
        return {
            classesEqual: false,
            codeEqual: false,
            diagnosticsEqual: false,
            transformedEqual: false,
            babel: babelView,
            oxc: null,
            oxcError,
            oxcIsSkeleton,
        };
    }

    const oxcClassesSorted = [...oxc.classes].sort();
    return {
        classesEqual: arraysEqual(babelView.classes, oxcClassesSorted),
        codeEqual: babelView.code === oxc.code,
        diagnosticsEqual: arraysEqual(babelView.diagnostics, oxc.diagnostics),
        transformedEqual: babelView.transformed === oxc.transformed,
        babel: babelView,
        oxc,
        oxcError: null,
        oxcIsSkeleton: false,
    };
}

/**
 * One fixture for the parity suite. `expected` tracks the state the
 * fixture should currently produce, so D2.x slices flip entries from
 * `pending` to `parity` as the oxc implementation grows.
 */
export interface ParityFixture {
    /** Human-readable test name. */
    name: string;
    /** TSX/JSX source for the harness. */
    source: string;
    /** Filename passed to both parsers (drives JSX detection). */
    filename: string;
    /**
     * Expected current parity state:
     * - `pending`: oxc skeleton throws OR diverges. D2.0 baseline.
     * - `classes-only-parity`: oxc must extract the same class set, but
     *   may leave `code` unchanged (read-only D2.1). Babel rewrites,
     *   oxc just reports — `codeEqual` is intentionally skipped.
     * - `surgical-parity`: classes match Babel; code DIFFERS because
     *   magic-string surgical edits preserve formatting (parens,
     *   indentation) that Babel's code generator strips during
     *   pretty-print. This divergence is INTENDED — surgical preservation
     *   is the whole point of pairing oxc-parser with magic-string per
     *   `.agent/workflows/future-roadmap.md` § Phase D.
     * - `parity`: full match — classes + code + diagnostics + transformed.
     *   D2.2+ once the magic-string rewrite path lands.
     */
    expected: 'pending' | 'classes-only-parity' | 'surgical-parity' | 'parity';
    /** Why this fixture is pending — link to the slice that lands it. */
    pendingReason?: string;
}

/**
 * Assert the intentionally divergent contract of one pending fixture.
 *
 * @param fixture Pending parity fixture.
 * @param comparison Current Babel/Oxc comparison.
 */
function assertPendingParity(fixture: ParityFixture, comparison: ParityComparison): void {
    if (comparison.oxcError && comparison.oxcIsSkeleton) return;
    if (!comparison.classesEqual || !comparison.codeEqual) return;
    throw new Error(
        `Fixture "${fixture.name}" marked as pending but oxc matched Babel exactly. ` +
            'Flip its `expected` to "parity" and remove `pendingReason`.',
    );
}

/**
 * Assert that a comparison matches the fixture's expected state.
 * Throws a descriptive error when the actual state differs.
 *
 * @param fixture The fixture under test.
 * @param comparison Output from {@link compareImpls}.
 */
export function assertExpectedParity(fixture: ParityFixture, comparison: ParityComparison): void {
    if (fixture.expected === 'pending') {
        assertPendingParity(fixture, comparison);
        return;
    }
    if (comparison.oxcError) {
        throw new Error(
            `Fixture "${fixture.name}" marked as ${fixture.expected} but oxc threw: ${comparison.oxcError}`,
        );
    }
    if (!comparison.classesEqual) {
        throw new Error(
            `Fixture "${fixture.name}" marked as ${fixture.expected} but class sets differ.\n` +
                `  babel: [${comparison.babel.classes.join(', ')}]\n` +
                `  oxc:   [${comparison.oxc ? [...comparison.oxc.classes].sort().join(', ') : ''}]`,
        );
    }
    if (fixture.expected === 'classes-only-parity') {
        // codeEqual + transformedEqual intentionally NOT asserted —
        // D2.1 extracts classes only, magic-string rewrite is D2.2.
        // But warn upgrade-eligible: if codeEqual is also true, the
        // fixture should be flipped to full `parity` so a future
        // regression in the rewrite path is caught.
        if (comparison.codeEqual) {
            throw new Error(
                `Fixture "${fixture.name}" marked as classes-only-parity but code also matches Babel. ` +
                    'Flip its `expected` to "parity".',
            );
        }
        return;
    }
    if (fixture.expected === 'surgical-parity') {
        // Codes MUST differ — that is the assertion. If they match
        // byte-for-byte, the fixture is full parity and the label is
        // misleading; flip to "parity".
        if (comparison.codeEqual) {
            throw new Error(
                `Fixture "${fixture.name}" marked as surgical-parity but code matches Babel byte-for-byte. ` +
                    'Flip its `expected` to "parity".',
            );
        }
        return;
    }
    if (!comparison.codeEqual) {
        throw new Error(
            `Fixture "${fixture.name}" marked as parity but rewritten code differs.\n` +
                `  babel: ${JSON.stringify(comparison.babel.code)}\n` +
                `  oxc:   ${JSON.stringify(comparison.oxc?.code ?? '')}`,
        );
    }
}

/**
 * Compute a one-line parity progress summary across all fixtures.
 *
 * @param fixtures All fixtures the suite tracks.
 * @returns Human-readable summary string for console output.
 */
export function summarise(fixtures: readonly ParityFixture[]): string {
    const total = fixtures.length;
    const parity = fixtures.filter(f => f.expected === 'parity').length;
    const surgical = fixtures.filter(f => f.expected === 'surgical-parity').length;
    const classesOnly = fixtures.filter(f => f.expected === 'classes-only-parity').length;
    const pending = fixtures.filter(f => f.expected === 'pending').length;
    const pct = total === 0 ? 0 : Math.round(((parity + surgical + classesOnly) / total) * 100);
    return (
        `Phase D parity: ${pct}% — ${parity} full, ${surgical} surgical, ` +
        `${classesOnly} classes-only, ${pending} pending (${total} total)`
    );
}

/**
 * Array equality for string arrays (preserves order).
 *
 * @param a First array.
 * @param b Second array.
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
