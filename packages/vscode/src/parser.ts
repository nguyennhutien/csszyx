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
    if (seg.length >= 2 && (seg[0] === "'" || seg[0] === '"') && seg[seg.length - 1] === seg[0]) {
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
        const marker = `${form}(`;
        let from = text.length;
        while (from >= 0) {
            const idx = text.lastIndexOf(marker, from);
            if (idx === -1) break;
            from = idx - 1;
            // Word boundary: `myszv(` is not a csszyx call; `csszyx.szv(` is.
            const before = idx > 0 ? (text[idx - 1] ?? '') : '';
            if (/[\w$]/.test(before)) continue;
            let j = idx + marker.length;
            while (j < text.length && /\s/.test(text[j] ?? '')) j++;
            if (text[j] !== '{') continue;
            if (best === null || idx > best.idx) {
                best = {
                    idx,
                    start: { bodyStart: j, explicit: true, terminator: null, form },
                };
            }
            break;
        }
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
 * Return the rightmost sz-expression opening in `text`, or null.
 * @param text - Source text to scan.
 * @returns Description of the opening, or null if no sz expression is present.
 */
function findSzStart(text: string): SzStart | null {
    /**
     *
     */
    type Best = { idx: number; start: SzStart } | null;
    let best: Best = null;
    const beat = (idx: number): boolean => best === null || idx > best.idx;

    const jsx = text.lastIndexOf('sz={{');
    if (jsx !== -1 && beat(jsx)) {
        best = {
            idx: jsx,
            start: { bodyStart: jsx + 4, explicit: true, terminator: null, form: 'sz' },
        };
    }

    const dq = text.lastIndexOf('sz="');
    if (dq !== -1 && beat(dq)) {
        let j = dq + 4;
        while (j < text.length && /\s/.test(text[j] ?? '')) {
            j++;
        }
        const start: SzStart =
            text[j] === '{'
                ? { bodyStart: j, explicit: true, terminator: null, form: 'sz' }
                : { bodyStart: dq + 4, explicit: false, terminator: '"', form: 'sz' };
        best = { idx: dq, start };
    }

    const sq = text.lastIndexOf("sz='");
    if (sq !== -1 && beat(sq)) {
        let j = sq + 4;
        while (j < text.length && /\s/.test(text[j] ?? '')) {
            j++;
        }
        const start: SzStart =
            text[j] === '{'
                ? { bodyStart: j, explicit: true, terminator: null, form: 'sz' }
                : { bodyStart: sq + 4, explicit: false, terminator: "'", form: 'sz' };
        best = { idx: sq, start };
    }

    const call = findCsszyxCallStart(text);
    if (call !== null && beat(call.idx)) {
        best = call;
    }

    return best === null ? null : best.start;
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

    // Implicit forms start "inside" the virtual object at depth 1.
    let depth = start.explicit ? 0 : 1;
    const segStart: number[] = [];
    // keyStack[d] = key owning the `{` that opened depth d ('' = unknown);
    // siblingsAt[d] = keys assigned at depth d since its `{` opened.
    const keyStack: string[] = [];
    const siblingsAt: Array<Set<string>> = [];
    if (start.explicit) {
        segStart[0] = 0;
    } else {
        segStart[1] = 0;
        keyStack[1] = '';
        siblingsAt[1] = new Set();
    }

    let lastColon = -1;
    let keyAtColon = '';

    for (let i = 0; i < afterOpen.length; i++) {
        const c = afterOpen[i];

        // Implicit: hitting the attribute's closing quote at depth 1 means
        // the cursor is past the sz expression entirely.
        if (!start.explicit && c === start.terminator && depth === 1) {
            return NONE;
        }

        if (c === '{') {
            const owner = lastColon >= (segStart[depth] ?? 0) ? keyAtColon : '';
            depth++;
            keyStack[depth] = owner;
            siblingsAt[depth] = new Set();
            segStart[depth] = i + 1;
            lastColon = -1;
            keyAtColon = '';
        } else if (c === '}') {
            if (depth === 0) {
                return NONE;
            }
            segStart.length = depth;
            keyStack.length = depth;
            siblingsAt.length = depth;
            depth--;
            lastColon = -1;
            keyAtColon = '';
        } else if (c === ',' && depth >= 1) {
            segStart[depth] = i + 1;
            lastColon = -1;
            keyAtColon = '';
        } else if (c === ':' && depth >= 1) {
            const seg = normalizeKeySegment(afterOpen.slice(segStart[depth] ?? 0, i));
            if (seg !== '') {
                lastColon = i;
                keyAtColon = seg;
                siblingsAt[depth]?.add(seg);
            }
        } else if ((c === '"' || c === "'") && depth >= 1) {
            const q = c;
            i++;
            while (i < afterOpen.length && afterOpen[i] !== q) {
                if (afterOpen[i] === '\\') {
                    i++;
                }
                i++;
            }
        } else if (c === '[' && depth >= 1) {
            let brackets = 1;
            i++;
            while (i < afterOpen.length && brackets > 0) {
                if (afterOpen[i] === '[') {
                    brackets++;
                } else if (afterOpen[i] === ']') {
                    brackets--;
                }
                i++;
            }
            i--;
        }
    }

    if (depth <= 0) {
        return NONE;
    }

    // Owners of depth 2..current, outer→inner (depth 1 — the root — has none).
    const parents = keyStack.slice(2, depth + 1);
    const siblings = [...(siblingsAt[depth] ?? [])];

    if (lastColon >= (segStart[depth] ?? 0)) {
        return {
            type: depth === 1 ? 'value' : 'variant-value',
            currentKey: keyAtColon || undefined,
            depth,
            form: start.form,
            parents,
            siblings,
        };
    }
    return {
        type: depth === 1 ? 'key' : 'variant-key',
        currentKey: undefined,
        depth,
        form: start.form,
        parents,
        siblings,
    };
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

        const { start } = hit;

        if (start.explicit) {
            // Walk braces starting from the `{`, skipping string interiors.
            let depth = 0;
            let objEnd = -1;
            for (let i = start.bodyStart; i < text.length; i++) {
                const c = text[i];
                if (c === '"' || c === "'") {
                    const q = c;
                    i++;
                    while (i < text.length && text[i] !== q) {
                        if (text[i] === '\\') {
                            i++;
                        }
                        i++;
                    }
                    continue;
                }
                if (c === '{') {
                    depth++;
                } else if (c === '}') {
                    depth--;
                    if (depth === 0) {
                        objEnd = i + 1;
                        break;
                    }
                }
            }
            if (objEnd !== -1) {
                results.push({
                    objText: text.slice(start.bodyStart, objEnd),
                    startOffset: start.bodyStart,
                    needsWrap: false,
                });
            }
            searchFrom = objEnd === -1 ? hit.idx + 4 : objEnd;
        } else {
            // Walk up to the matching terminator (the attribute's closing quote),
            // skipping nested string contents (which use the opposite quote).
            const terminator = start.terminator ?? '"';
            let end = -1;
            for (let i = start.bodyStart; i < text.length; i++) {
                const c = text[i];
                if (c === terminator) {
                    end = i;
                    break;
                }
                if (c === '"' || c === "'") {
                    const q = c;
                    i++;
                    while (i < text.length && text[i] !== q) {
                        if (text[i] === '\\') {
                            i++;
                        }
                        i++;
                    }
                }
            }
            if (end !== -1) {
                results.push({
                    objText: text.slice(start.bodyStart, end),
                    startOffset: start.bodyStart,
                    needsWrap: true,
                });
            }
            searchFrom = end === -1 ? hit.idx + 4 : end + 1;
        }
    }

    return results;
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
