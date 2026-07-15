/**
 * Pure parsing helpers for sz prop expressions — no VS Code APIs.
 *
 * Recognizes four syntactic forms, treating them uniformly once the "object
 * body" has been located:
 *
 *   1. JSX:               `sz={{ ... }}`
 *   2. HTML explicit dq:  `sz="{ ... }"`
 *   3. HTML explicit sq:  `sz='{ ... }'`
 *   4. HTML implicit:     `sz="a: 1, b: 2"`  or  `sz='a: 1'`
 *
 * The implicit form is accepted by the runtime (see `csszyx.js`:
 *   `n.startsWith('{') ? n : '{' + n + '}'`
 * ) and so must also light up completions/hover/diagnostics in the extension.
 *
 * All helpers work on plain strings so they can be unit-tested in Node.
 */

/**
 *
 */
export type ContextType = 'none' | 'key' | 'value' | 'variant-key' | 'variant-value';

/** Which csszyx surface the expression belongs to. */
export type SzForm = 'sz' | 'szs' | 'szv' | 'szr';

/**
 *
 */
export interface SzContext {
    type: ContextType;
    /** The key whose value is being completed — undefined for key position. */
    currentKey: string | undefined;
    /** Object brace depth: 1 = top-level, 2 = inside a variant object. */
    depth: number;
    /** Surface the expression belongs to (`sz` for `none`). */
    form: SzForm;
    /** Keys owning each nested brace, outer→inner, from depth 2 down to the
     * cursor's object ('' = unknown owner). Depth-1 has no owner. */
    parents: readonly string[];
    /** Keys already assigned at the cursor's depth since its `{` opened. */
    siblings: readonly string[];
}

const NONE: SzContext = {
    type: 'none',
    currentKey: undefined,
    depth: 0,
    form: 'sz',
    parents: [],
    siblings: [],
};

/** Strip one pair of matching quotes so `'color':` reads as `color`.
 * @param segment - Raw text between the segment start and a colon.
 * @returns The key name, or '' when the segment is not a static key.
 */
function normalizeKeySegment(segment: string): string {
    let seg = segment.trim();
    const singleQuoted = seg.startsWith("'") && seg.endsWith("'");
    const doubleQuoted = seg.startsWith('"') && seg.endsWith('"');
    if (seg.length >= 2 && (singleQuoted || doubleQuoted)) {
        seg = seg.slice(1, -1);
    }
    return /^[a-z_$][\w$]*$/i.test(seg) ? seg : '';
}

/**
 * Description of a sz expression's opening.
 *
 * Explicit forms (JSX / `"{...}"` / `'{...}'`):
 *   - `bodyStart` points to the literal `{`
 *   - `explicit` = true, `terminator` = null
 *   - the walker counts braces starting at depth 0
 *
 * Implicit forms (`"..."` / `'...'` without a leading `{`):
 *   - `bodyStart` points one past the opening quote (first content char)
 *   - `explicit` = false, `terminator` = the matching closing quote
 *   - the walker starts at depth 1 (already "inside" the virtual object) and
 *     treats the closing quote as the implicit `}`
 */
interface SzStart {
    bodyStart: number;
    explicit: boolean;
    terminator: string | null;
    form: SzForm;
}

/** Locate the rightmost `szv(`/`szr(`/`szs={{` opening in `text`, if any.
 * @param text - Source text to scan.
 * @returns Marker index + start description, or null.
 */
function findCsszyxCallStart(text: string): { idx: number; start: SzStart } | null {
    let best: { idx: number; start: SzStart } | null = null;
    for (const form of ['szv', 'szr'] as const) {
        const candidate = findCallFormStart(text, form);
        if (candidate && (best === null || candidate.idx > best.idx)) best = candidate;
    }
    const szs = text.lastIndexOf('szs={{');
    if (szs !== -1 && (best === null || szs > best.idx)) {
        best = {
            idx: szs,
            start: { bodyStart: szs + 5, explicit: true, terminator: null, form: 'szs' },
        };
    }
    return best;
}

/**
 * Locate the rightmost valid object argument for one csszyx call form.
 * @param text - Source text to scan.
 * @param form - Call form to locate.
 * @returns Marker index and opening description, or null.
 */
function findCallFormStart(
    text: string,
    form: 'szv' | 'szr',
): { idx: number; start: SzStart } | null {
    const marker = `${form}(`;
    let from = text.length;
    while (from >= 0) {
        const idx = text.lastIndexOf(marker, from);
        if (idx === -1) return null;
        from = idx - 1;
        const before = idx > 0 ? (text[idx - 1] ?? '') : '';
        if (/[\w$]/.test(before)) continue;
        let bodyStart = idx + marker.length;
        while (bodyStart < text.length && /\s/.test(text[bodyStart] ?? '')) bodyStart++;
        if (text[bodyStart] === '{') {
            return {
                idx,
                start: { bodyStart, explicit: true, terminator: null, form },
            };
        }
    }
    return null;
}

/**
 * Find the rightmost quoted sz attribute.
 *
 * @param text Source text to scan.
 * @param quote Attribute quote style.
 * @returns Marker index and opening description, or null.
 */
function findLastQuotedSz(text: string, quote: '"' | "'"): { idx: number; start: SzStart } | null {
    const marker = `sz=${quote}`;
    const idx = text.lastIndexOf(marker);
    if (idx === -1) {
        return null;
    }
    let bodyStart = idx + marker.length;
    while (bodyStart < text.length && /\s/.test(text[bodyStart] ?? '')) {
        bodyStart++;
    }
    const start: SzStart =
        text[bodyStart] === '{'
            ? { bodyStart, explicit: true, terminator: null, form: 'sz' }
            : {
                  bodyStart: idx + marker.length,
                  explicit: false,
                  terminator: quote,
                  form: 'sz',
              };
    return { idx, start };
}

/**
 * Return the rightmost sz-expression opening in `text`, or null.
 * @param text - Source text to scan.
 * @returns Description of the opening, or null if no sz expression is present.
 */
function findSzStart(text: string): SzStart | null {
    const jsx = text.lastIndexOf('sz={{');
    const candidates = [
        jsx === -1
            ? null
            : {
                  idx: jsx,
                  start: { bodyStart: jsx + 4, explicit: true, terminator: null, form: 'sz' },
              },
        findLastQuotedSz(text, '"'),
        findLastQuotedSz(text, "'"),
        findCsszyxCallStart(text),
    ].filter((candidate): candidate is { idx: number; start: SzStart } => candidate !== null);
    return (
        candidates.reduce<{ idx: number; start: SzStart } | null>(
            (best, candidate) => (best === null || candidate.idx > best.idx ? candidate : best),
            null,
        )?.start ?? null
    );
}

/**
 * Parse the sz context at the end of `text` (caller ensures cursor is at end).
 * @param text - Source slice ending at the cursor position.
 * @returns Context describing key/value position and current key if any.
 */
export function parseSzContext(text: string): SzContext {
    const start = findSzStart(text);
    if (start === null) {
        return NONE;
    }

    const afterOpen = text.slice(start.bodyStart);

    const state = createSzContextScanState(start);

    for (let i = 0; i < afterOpen.length; i++) {
        const step = scanSzContextCharacter(afterOpen, i, start, state);
        if (step.closed) return NONE;
        i = step.index;
    }

    if (state.depth <= 0) return NONE;

    // Owners of depth 2..current, outer→inner (depth 1 — the root — has none).
    const parents = state.keyStack.slice(2, state.depth + 1);
    const siblings = [...(state.siblingsAt[state.depth] ?? [])];

    if (state.lastColon >= (state.segStart[state.depth] ?? 0)) {
        return {
            type: state.depth === 1 ? 'value' : 'variant-value',
            currentKey: state.keyAtColon || undefined,
            depth: state.depth,
            form: start.form,
            parents,
            siblings,
        };
    }
    return {
        type: state.depth === 1 ? 'key' : 'variant-key',
        currentKey: undefined,
        depth: state.depth,
        form: start.form,
        parents,
        siblings,
    };
}

/** Mutable state for one sz context scan. */
interface SzContextScanState {
    depth: number;
    segStart: number[];
    keyStack: string[];
    siblingsAt: Array<Set<string>>;
    lastColon: number;
    keyAtColon: string;
}

/**
 * Creates context state for explicit and virtual implicit objects.
 *
 * @param start - Expression opening description.
 * @returns Initialized scanner state.
 */
function createSzContextScanState(start: SzStart): SzContextScanState {
    if (start.explicit) {
        return {
            depth: 0,
            segStart: [0],
            keyStack: [],
            siblingsAt: [],
            lastColon: -1,
            keyAtColon: '',
        };
    }
    const siblingsAt: Array<Set<string>> = [];
    siblingsAt[1] = new Set();
    return {
        depth: 1,
        segStart: [0, 0],
        keyStack: ['', ''],
        siblingsAt,
        lastColon: -1,
        keyAtColon: '',
    };
}

/** Result of scanning one context character. */
interface SzContextScanStep {
    closed: boolean;
    index: number;
}

/**
 * Applies one structural character to the context scanner state.
 *
 * @param source - Expression body.
 * @param index - Current source offset.
 * @param start - Expression opening description.
 * @param state - Mutable scanner state.
 * @returns Updated source offset and whether the expression has closed.
 */
function scanSzContextCharacter(
    source: string,
    index: number,
    start: SzStart,
    state: SzContextScanState,
): SzContextScanStep {
    const character = source[index];
    if (!start.explicit && character === start.terminator && state.depth === 1) {
        return { closed: true, index };
    }
    if (character === '{') openSzContextObject(state, index);
    else if (character === '}') closeSzContextObject(state);
    else if (character === ',' && state.depth >= 1) resetSzContextSegment(state, index + 1);
    else if (character === ':' && state.depth >= 1) recordSzContextKey(source, index, state);
    else if ((character === '"' || character === "'") && state.depth >= 1) {
        return { closed: false, index: skipQuotedText(source, index, character) };
    } else if (character === '[' && state.depth >= 1) {
        return { closed: false, index: skipBracketText(source, index) };
    }
    return { closed: state.depth < 0, index };
}

/**
 * Opens a nested object owned by the current key.
 *
 * @param state - Mutable scanner state.
 * @param index - Opening brace offset.
 */
function openSzContextObject(state: SzContextScanState, index: number): void {
    const owner = state.lastColon >= (state.segStart[state.depth] ?? 0) ? state.keyAtColon : '';
    state.depth++;
    state.keyStack[state.depth] = owner;
    state.siblingsAt[state.depth] = new Set();
    state.segStart[state.depth] = index + 1;
    state.lastColon = -1;
    state.keyAtColon = '';
}

/**
 * Closes the current object and discards its tracking state.
 *
 * @param state - Mutable scanner state.
 */
function closeSzContextObject(state: SzContextScanState): void {
    if (state.depth === 0) {
        state.depth = -1;
        return;
    }
    state.segStart.length = state.depth;
    state.keyStack.length = state.depth;
    state.siblingsAt.length = state.depth;
    state.depth--;
    state.lastColon = -1;
    state.keyAtColon = '';
}

/**
 * Starts a new sibling segment.
 *
 * @param state - Mutable scanner state.
 * @param segmentStart - Offset after the comma.
 */
function resetSzContextSegment(state: SzContextScanState, segmentStart: number): void {
    state.segStart[state.depth] = segmentStart;
    state.lastColon = -1;
    state.keyAtColon = '';
}

/**
 * Records a normalized key before a colon.
 *
 * @param source - Expression body.
 * @param index - Colon offset.
 * @param state - Mutable scanner state.
 */
function recordSzContextKey(source: string, index: number, state: SzContextScanState): void {
    const segment = normalizeKeySegment(source.slice(state.segStart[state.depth] ?? 0, index));
    if (segment === '') return;
    state.lastColon = index;
    state.keyAtColon = segment;
    state.siblingsAt[state.depth]?.add(segment);
}

/**
 * Skips a quoted fragment and its escaped characters.
 *
 * @param source - Source text.
 * @param start - Opening quote offset.
 * @param quote - Quote delimiter.
 * @returns Closing quote offset, or source length when unterminated.
 */
function skipQuotedText(source: string, start: number, quote: string): number {
    let index = start + 1;
    while (index < source.length && source[index] !== quote) {
        index += source[index] === '\\' ? 2 : 1;
    }
    return index;
}

/**
 * Skips a balanced square-bracket fragment.
 *
 * @param source - Source text.
 * @param start - Opening bracket offset.
 * @returns Closing bracket offset, or final source offset when unterminated.
 */
function skipBracketText(source: string, start: number): number {
    let depth = 1;
    let index = start + 1;
    while (index < source.length && depth > 0) {
        if (source[index] === '[') depth++;
        else if (source[index] === ']') depth--;
        index++;
    }
    return index - 1;
}

/**
 *
 */
export interface SzExpression {
    /**
     * Raw object text AS IT APPEARS IN SOURCE.
     *   - explicit: the `{ ... }` slice including both braces.
     *   - implicit: the attribute body (no braces) — callers must wrap before eval.
     */
    objText: string;
    /** Offset (in the source text) of the first character of `objText`. */
    startOffset: number;
    /** True when `objText` must be wrapped in `{ ... }` before `new Function` eval. */
    needsWrap: boolean;
}

/** Generic “is there a sz= at/after `from`?” — returns match info or null. */
interface MarkerHit {
    idx: number;
    start: SzStart;
}

/**
 * Find one quoted sz attribute and classify its explicit or implicit body.
 *
 * @param text Source text to scan.
 * @param from Offset to start searching from.
 * @param quote Attribute quote style.
 * @returns Marker hit or null when absent.
 */
function findQuotedSz(text: string, from: number, quote: '"' | "'"): MarkerHit | null {
    const marker = `sz=${quote}`;
    const idx = text.indexOf(marker, from);
    if (idx === -1) {
        return null;
    }
    let bodyStart = idx + marker.length;
    while (bodyStart < text.length && /\s/.test(text[bodyStart] ?? '')) {
        bodyStart++;
    }
    const start: SzStart =
        text[bodyStart] === '{'
            ? { bodyStart, explicit: true, terminator: null, form: 'sz' }
            : { bodyStart: idx + marker.length, explicit: false, terminator: quote, form: 'sz' };
    return { idx, start };
}

/**
 * Find the next sz expression opening at or after `from`.
 * @param text - Source text to scan.
 * @param from - Offset to start searching from.
 * @returns Hit info (source idx + start description), or null if none.
 */
function findNextSz(text: string, from: number): MarkerHit | null {
    const jsx = text.indexOf('sz={{', from);
    const candidates = [
        jsx === -1
            ? null
            : {
                  idx: jsx,
                  start: { bodyStart: jsx + 4, explicit: true, terminator: null, form: 'sz' },
              },
        findQuotedSz(text, from, '"'),
        findQuotedSz(text, from, "'"),
    ].filter((candidate): candidate is MarkerHit => candidate !== null);
    return candidates.reduce<MarkerHit | null>(
        (earliest, candidate) =>
            earliest === null || candidate.idx < earliest.idx ? candidate : earliest,
        null,
    );
}

/**
 * Find every sz expression (JSX, HTML explicit, HTML implicit) in `text`.
 * Skips string contents so braces and terminators inside quoted values don't
 * confuse the scanner.
 * @param text - Full source text to scan.
 * @returns Array of expressions with source-relative offsets.
 */
export function findSzExpressions(text: string): SzExpression[] {
    const results: SzExpression[] = [];
    let searchFrom = 0;

    while (searchFrom < text.length) {
        const hit = findNextSz(text, searchFrom);
        if (hit === null) {
            break;
        }

        const scan = hit.start.explicit
            ? scanExplicitSzExpression(text, hit)
            : scanImplicitSzExpression(text, hit);
        if (scan.expression) results.push(scan.expression);
        searchFrom = scan.nextSearchFrom;
    }

    return results;
}

/** Result of scanning one located sz expression. */
interface SzExpressionScanResult {
    expression?: SzExpression;
    nextSearchFrom: number;
}

/**
 * Reads a balanced explicit sz object.
 *
 * @param text - Full source text.
 * @param hit - Located expression opening.
 * @returns Extracted expression and next search offset.
 */
function scanExplicitSzExpression(text: string, hit: MarkerHit): SzExpressionScanResult {
    const end = findExplicitSzObjectEnd(text, hit.start.bodyStart);
    if (end === -1) return { nextSearchFrom: hit.idx + 4 };
    return {
        expression: {
            objText: text.slice(hit.start.bodyStart, end),
            startOffset: hit.start.bodyStart,
            needsWrap: false,
        },
        nextSearchFrom: end,
    };
}

/**
 * Finds the end offset after a balanced explicit object.
 *
 * @param text - Full source text.
 * @param start - Opening brace offset.
 * @returns Offset after the closing brace, or -1 when unterminated.
 */
function findExplicitSzObjectEnd(text: string, start: number): number {
    let depth = 0;
    for (let index = start; index < text.length; index++) {
        const character = text[index];
        if (character === '"' || character === "'") {
            index = skipQuotedText(text, index, character);
        } else if (character === '{') {
            depth++;
        } else if (character === '}' && --depth === 0) {
            return index + 1;
        }
    }
    return -1;
}

/**
 * Reads an implicit sz attribute body.
 *
 * @param text - Full source text.
 * @param hit - Located expression opening.
 * @returns Extracted expression and next search offset.
 */
function scanImplicitSzExpression(text: string, hit: MarkerHit): SzExpressionScanResult {
    const end = findImplicitSzEnd(text, hit.start.bodyStart, hit.start.terminator ?? '"');
    if (end === -1) return { nextSearchFrom: hit.idx + 4 };
    return {
        expression: {
            objText: text.slice(hit.start.bodyStart, end),
            startOffset: hit.start.bodyStart,
            needsWrap: true,
        },
        nextSearchFrom: end + 1,
    };
}

/**
 * Finds an implicit attribute terminator while skipping nested strings.
 *
 * @param text - Full source text.
 * @param start - Attribute body offset.
 * @param terminator - Attribute quote delimiter.
 * @returns Terminator offset, or -1 when unterminated.
 */
function findImplicitSzEnd(text: string, start: number, terminator: string): number {
    for (let index = start; index < text.length; index++) {
        const character = text[index];
        if (character === terminator) return index;
        if (character === '"' || character === "'") {
            index = skipQuotedText(text, index, character);
        }
    }
    return -1;
}

/**
 * Return the sz expression that contains the cursor, or null if none.
 * Includes the `needsWrap` flag so callers can wrap implicit forms before eval.
 * @param text - Source text (typically a windowed slice around the cursor).
 * @param cursorOffset - Cursor offset relative to `text`.
 * @returns The enclosing expression, or null.
 */
export function findSzExpressionAt(text: string, cursorOffset: number): SzExpression | null {
    for (const expr of findSzExpressions(text)) {
        const end = expr.startOffset + expr.objText.length;
        if (cursorOffset >= expr.startOffset && cursorOffset <= end) {
            return expr;
        }
    }
    return null;
}

/**
 * Convenience: return the JS object literal text that contains the cursor,
 * wrapped with `{...}` if the source used the implicit form. Returns null
 * when the cursor is outside every sz expression.
 * @param text - Source text (windowed slice).
 * @param cursorOffset - Cursor offset relative to `text`.
 * @returns JS-object-literal string ready for eval, or null.
 */
export function extractSzObjectAt(text: string, cursorOffset: number): string | null {
    const expr = findSzExpressionAt(text, cursorOffset);
    if (expr === null) {
        return null;
    }
    return expr.needsWrap ? `{ ${expr.objText} }` : expr.objText;
}
