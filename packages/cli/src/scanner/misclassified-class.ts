/**
 * Find a className the class toolkit reads with false confidence.
 *
 * `classify` matches a token by class PREFIX, so an app's own
 * `tab-items-wrapper` is read as a `tab-size` utility and routed to a node by a
 * rule rather than by the fallback. The runtime warns about a class it cannot
 * classify; it cannot warn about this one, because from inside the runtime the
 * answer looks certain — the table has no knowledge of which VALUES a prefix
 * accepts, and measured against `tailwindcss@4.3.3`, all 267 prefixes in it
 * accept at least one suffix Tailwind does not serve.
 *
 * Only an oracle can tell the two apart, and this command already builds one:
 * the project's own design system, which sees its `@theme` tokens and its
 * `@utility` definitions. That last point is why the check cannot be a static
 * table — `@utility tab-items-wrapper` makes the very same string legitimate.
 *
 * The pass is deliberately narrow. It fires only when BOTH hold: `classify`
 * answered confidently, and the project's Tailwind produces no CSS for the
 * token. A class nothing classifies is the runtime's warning, not this one.
 *
 * @module
 */
import { classify, normalizeBase, stripVariant } from '@csszyx/runtime';

/** One className the toolkit placed by a rule that does not apply. */
export interface MisclassifiedClass {
    /** The class as written in the source. */
    readonly token: string;
    /** Project-relative file it was read from. */
    readonly file: string;
    /** 1-based line. */
    readonly line: number;
    /** The node `splitBox` would send it to. */
    readonly role: 'outer' | 'inner';
    /** The category the toolkit believed it belonged to. */
    readonly category: string;
}

/**
 * The start of a `className` attribute, up to and including the opening quote —
 * `className="`, `className='`, and the braced forms. The brace group is
 * optional as a unit rather than `\{?\s*`, which puts two `\s*` next to each
 * other and backtracks polynomially on a run of whitespace. The value is read by
 * scanning to the matching quote rather than by a second alternation: one
 * expression covering both quoting styles and the braced form scored 24 against
 * Sonar's regex-complexity limit of 20, and the split reads better anyway.
 *
 * A className built by concatenation has no literal to read here; that case
 * belongs to the runtime warning.
 */
const CLASS_NAME_ATTR = /className\s*=\s*(?:\{\s*)?(["'])/g;

/**
 * Read every literal className token out of one source file, with its line.
 *
 * @param source - File contents.
 * @returns Each token paired with the 1-based line it appears on.
 */
export function classNameTokens(source: string): Array<{ token: string; line: number }> {
    const found: Array<{ token: string; line: number }> = [];
    for (const match of source.matchAll(CLASS_NAME_ATTR)) {
        const quote = match[1] as string;
        const start = match.index + match[0].length;
        const end = source.indexOf(quote, start);
        // An unterminated string is a file the bundler rejects anyway, and
        // reading past it would attribute tokens to the wrong line.
        if (end < 0) continue;
        const value = source.slice(start, end);
        if (value.trim() === '') continue;
        const line = source.slice(0, match.index).split('\n').length;
        // `value` is non-blank and trimmed before splitting, so no element of
        // the split can be empty — a guard here would be an unreachable branch.
        for (const token of value.trim().split(/\s+/)) {
            found.push({ token, line });
        }
    }
    return found;
}

/**
 * Which of these tokens the toolkit classifies confidently although the
 * project's Tailwind serves nothing for them.
 *
 * @param tokens - Tokens read from source, with their file and line.
 * @param isDead - Asks the project's Tailwind; true when the class emits no CSS.
 * @returns One finding per distinct token, in the order first seen.
 */
export function findMisclassified(
    tokens: readonly { token: string; file: string; line: number }[],
    isDead: (classes: readonly string[]) => string[],
): MisclassifiedClass[] {
    const candidates = new Map<
        string,
        { file: string; line: number; role: 'outer' | 'inner'; category: string }
    >();
    for (const { token, file, line } of tokens) {
        // The base is what `classify` reads and what Tailwind is asked about,
        // so a variant or an important marker never splits one class in two.
        const base = normalizeBase(stripVariant(token));
        if (base === '' || candidates.has(base)) continue;
        const info = classify(token);
        // No answer is the runtime's warning, not this one.
        if (info === undefined) continue;
        candidates.set(base, { file, line, role: info.role, category: info.category });
    }
    if (candidates.size === 0) return [];
    const dead = new Set(isDead([...candidates.keys()]));
    const findings: MisclassifiedClass[] = [];
    for (const [token, where] of candidates) {
        if (dead.has(token)) findings.push({ token, ...where });
    }
    return findings;
}
