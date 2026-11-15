/**
 * The bundle half of ADR 0034: a build that mangles renames only the class
 * strings the compiler marked, as Closure renames only `goog.getCssName`.
 *
 * The engine writes each class string it emits as `/*#__PURE__*\/__szCss("…")`.
 * Before any minifier runs — Vite's `renderChunk`, webpack's `OPTIMIZE` stage —
 * this pass replaces each such call with its argument renamed through the map,
 * and leaves every other byte of the chunk as written. A call it cannot read
 * stays a call: `__szCss` from `@csszyx/runtime` names its classes through the
 * mangle registry at runtime, so a miss costs bytes, never a class.
 *
 * A call is found by the annotation the engine writes, `/*#__PURE__*\/`, which
 * bundlers keep as written (rolldown prints its own as `/* @__PURE__ *\/`), and
 * a callee naming `__szCss`: the import itself, the import renamed apart from a
 * local of the same name (`__szCss$1`), or a namespace member
 * (`(0, ns.__szCss)`, `ns.__szCss`). A call the author wrote carries no such
 * annotation, so it is left alone.
 *
 * Cost: one forward scan of the chunk, `n` its length. Each annotation is
 * tried once with sticky expressions anchored at it and never revisited, so
 * the worst case — a chunk that is all annotations — stays `O(n)`.
 */
import { HTML_CLASS_SPACE } from '@csszyx/compiler';

/**
 * An own-key test: a name like `constructor` must not read the prototype.
 * `Object.hasOwn` is past the library level this package compiles against.
 */
const ownKey = Object.prototype.hasOwnProperty;

/** The annotation the engine writes before each marked class string. */
const ANNOTATION = '/*#__PURE__*/';

/**
 * The parts of a marked call's callee, each anchored where the last ended.
 * The callee is the import, the import renamed with a `$<n>` suffix, or a
 * namespace member, bare or in the `(0, ns.x)` form bundlers call through to
 * drop the receiver. A member may be written out (`ns.__szCss`) or shortened
 * by webpack production, with the original after it as a comment
 * (`ns/* .__szCss *\/ .$t`): webpack does that for a module it does not
 * concatenate into its importer, such as one a shared chunk holds.
 */
const DROP_RECEIVER = /\(0,\s*/y;
const MEMBER = /[\w$]+\.__szCss/y;
const SHORTENED_MEMBER = /[\w$]+\s*\/\*\s*\.?__szCss\s*\*\/\s*\.[\w$]+/y;
const DIRECT = /(?:[\w$]+\.)?__szCss(?:\$\d+)?/y;
const CLOSE_RECEIVER = /\s*\)/y;
const OPEN_ARGUMENTS = /\s*\(\s*/y;

/**
 * Where `pattern` ends when it matches at `at`.
 *
 * @param pattern - A sticky expression.
 * @param code - The text.
 * @param at - Index to match at.
 * @returns The index after the match, or null.
 */
function matchAt(pattern: RegExp, code: string, at: number): number | null {
    pattern.lastIndex = at;
    return pattern.test(code) ? pattern.lastIndex : null;
}

/**
 * Read a marked call's callee after its annotation, through the opening
 * parenthesis of its arguments.
 *
 * @param code - The text.
 * @param at - Index after the annotation.
 * @returns The index of the first argument, or null for a callee the pass
 *          does not read.
 */
function readCallee(code: string, at: number): number | null {
    let start = at;
    while (/\s/.test(code.charAt(start))) start++;
    const inner = matchAt(DROP_RECEIVER, code, start);
    if (inner !== null) {
        const member = matchAt(MEMBER, code, inner) ?? matchAt(SHORTENED_MEMBER, code, inner);
        const closed = member === null ? null : matchAt(CLOSE_RECEIVER, code, member);
        return closed === null ? null : matchAt(OPEN_ARGUMENTS, code, closed);
    }
    const callee = matchAt(SHORTENED_MEMBER, code, start) ?? matchAt(DIRECT, code, start);
    return callee === null ? null : matchAt(OPEN_ARGUMENTS, code, callee);
}

/**
 * The helper's name as a word, in the callee text after an annotation the
 * pass could not read: such a call is reported as missed, not passed over.
 */
const NAMES_HELPER = /(?<![\w$])__szCss\b/;

/** How far after an annotation a callee is looked for when it is not read. */
const CALLEE_HEAD = 200;

/** The close of a one-argument call, anchored after the argument. */
const CALL_CLOSE = /\s*\)/y;

/** What one pass over a chunk did. */
export interface ClassMarkInline {
    /** The chunk with every readable marked call replaced by its string. */
    readonly code: string;
    /** How many calls were replaced. */
    readonly inlined: number;
    /** Marked calls left as calls because their argument is not one string literal. */
    readonly missed: number;
}

/** A `\u{…}` code point's braces and digits, anchored after the `u`. */
const CODE_POINT = /\{([\da-f]+)\}/iy;

/** Single-character escapes, as JavaScript reads them in a string literal. */
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v',
    '0': '\0',
};

/**
 * Read the escape after a backslash in a string literal.
 *
 * @param code - The chunk.
 * @param at - Index of the character after the backslash.
 * @returns The character it stands for and the index after it, or null for
 *          one this pass does not read (a line continuation, a legacy octal).
 */
function readEscape(code: string, at: number): { value: string; end: number } | null {
    const char = code[at];
    if (char === undefined || LINE_TERMINATORS.has(char)) return null;
    if (char === 'x') return readHexEscape(code, at + 1, 2);
    if (char === 'u') {
        return code[at + 1] === '{'
            ? readCodePointEscape(code, at + 1)
            : readHexEscape(code, at + 1, 4);
    }
    if (char === '0' && /\d/.test(code.charAt(at + 1))) return null;
    if (/[1-9]/.test(char)) return null;
    return { value: SIMPLE_ESCAPES[char] ?? char, end: at + 1 };
}

/** Characters that end a line, so a backslash before one continues it. */
const LINE_TERMINATORS: ReadonlySet<string> = new Set(['\n', '\r', '\u2028', '\u2029']);

/**
 * Read a fixed number of hex digits as one UTF-16 code unit (`\xHH`, `\uHHHH`).
 *
 * @param code - The chunk.
 * @param at - Index of the first digit.
 * @param digits - How many digits the escape takes.
 * @returns The character and the index after the digits, or null.
 */
function readHexEscape(
    code: string,
    at: number,
    digits: number,
): { value: string; end: number } | null {
    const hex = code.slice(at, at + digits);
    return hex.length === digits && /^[\da-f]+$/i.test(hex)
        ? { value: String.fromCodePoint(Number.parseInt(hex, 16)), end: at + digits }
        : null;
}

/**
 * Read a `\u{…}` code point escape. Anchored, so a `\u{` with no `}` costs
 * its digits, not the rest of the text.
 *
 * @param code - The chunk.
 * @param at - Index of the `{`.
 * @returns The character and the index after the `}`, or null.
 */
function readCodePointEscape(code: string, at: number): { value: string; end: number } | null {
    CODE_POINT.lastIndex = at;
    const hex = CODE_POINT.exec(code)?.[1];
    const point = hex === undefined ? Number.NaN : Number.parseInt(hex, 16);
    return point <= 0x10_ff_ff
        ? { value: String.fromCodePoint(point), end: CODE_POINT.lastIndex }
        : null;
}

/**
 * Read the quoted string literal starting at `start`.
 *
 * @param code - The chunk.
 * @param start - Index of the opening quote.
 * @returns Its value and the index after the closing quote, or null when
 *          there is no complete literal this pass reads.
 */
function readStringLiteral(code: string, start: number): { value: string; end: number } | null {
    const quote = code[start];
    if (quote !== '"' && quote !== "'") return null;
    let value = '';
    let at = start + 1;
    while (at < code.length) {
        const char = code[at];
        if (char === quote) return { value, end: at + 1 };
        if (char === '\n' || char === '\r') return null;
        if (char === '\\') {
            const escaped = readEscape(code, at + 1);
            if (escaped === null) return null;
            value += escaped.value;
            at = escaped.end;
            continue;
        }
        value += char;
        at++;
    }
    return null;
}

/**
 * Rename a class list as the runtime `__szCss` does: split where a browser
 * splits a class attribute, map each name the map holds, join with a space.
 *
 * @param classes - The marked class string.
 * @param mangleMap - Original class name to token.
 * @returns The renamed string.
 */
function renameClassList(classes: string, mangleMap: Readonly<Record<string, string>>): string {
    return classes
        .split(HTML_CLASS_SPACE)
        .map(name => (ownKey.call(mangleMap, name) ? mangleMap[name] : name))
        .join(' ');
}

/**
 * Whether the callee after an annotation names the helper, in a shape the
 * pass does not read: the text up to the end of its statement or line, at
 * most {@link CALLEE_HEAD} characters.
 *
 * @param code - Source or chunk text.
 * @param start - Index after the annotation.
 * @returns True when that text names `__szCss`.
 */
function namesHelper(code: string, start: number): boolean {
    const head = code.slice(start, start + CALLEE_HEAD);
    // The callee ends before its arguments' first string, and the annotation
    // of a call inside them is that call's own.
    const next = head.indexOf(ANNOTATION);
    const text = next === -1 ? head : head.slice(0, next);
    const cut = text.search(/[;\n"'`]/);
    const callee = cut === -1 ? text : text.slice(0, cut);
    return NAMES_HELPER.test(callee);
}

/**
 * A call to the helper with no annotation before it: the import, or the
 * import renamed with a `$<n>` suffix, called by its name. A transformer
 * between the compiler and the bundle dropped the annotation (SWC drops one
 * that opens a JSX expression container), so the call cannot be told from
 * one the author wrote; it is left to run, and counted as missed. Not a
 * declaration (`function __szCss(`), not a member of another object, and not
 * the start of a string's text.
 */
const HELPER_CALL = /(__szCss(?:\$\d+)?)\s*\(/g;

/**
 * A `const`, `let` or `var` binding of the helper's name, or of a `$<n>` form
 * of it. The engine calls the helper through a name the module does not spell
 * and the import binds it, so a name the chunk declares this way is the
 * author's, renamed or not by the bundler. The runtime's own declaration is a
 * `function`, and calls to it stay counted.
 */
const HELPER_DECLARATION = /(?:^|[^\w$.])(?:const|let|var)\s+(__szCss(?:\$\d+)?)\s*=/g;

/**
 * The helper-like names the chunk declares as variables.
 *
 * @param code - Chunk text.
 * @returns Each declared name.
 */
function declaredHelperNames(code: string): ReadonlySet<string> {
    return new Set(Array.from(code.matchAll(HELPER_DECLARATION), match => match[1]));
}

/** How far back the context of a helper call is read: the annotation, `function`. */
const CALL_CONTEXT = 32;

/**
 * How many unannotated helper calls `code` holds. The name is matched first
 * and only the few characters before it are read, so a long run of spaces
 * costs its length once.
 *
 * @param code - Chunk text after the readable marks were replaced.
 * @returns The count.
 */
function unannotatedCalls(code: string): number {
    const declared = declaredHelperNames(code);
    let count = 0;
    for (const match of code.matchAll(HELPER_CALL)) {
        const at = match.index;
        if (declared.has(match[1])) continue;
        const before = code.charAt(at - 1);
        if (/[\w$."'`]/.test(before)) continue;
        const context = code.slice(Math.max(0, at - CALL_CONTEXT), at).trimEnd();
        if (context.endsWith(ANNOTATION) || /(?:^|[^\w$])function$/.test(context)) continue;
        count++;
    }
    return count;
}

/** What a mark can follow: the start of an expression, as every place the engine writes one. */
const EXPRESSION_START = new Set(['(', ',', '?', ':', '{', '[', '=', '&', '|', '>']);

/**
 * Whether the annotation at `at` sits where an expression starts. A mark is
 * a call the engine writes as an argument, a property value, a branch or a
 * placeholder; the same text after a word or inside a string's words is that
 * string's text, and is never rewritten.
 *
 * @param code - Source or chunk text.
 * @param at - Index of the annotation.
 * @returns True at the start of the text or after an expression start.
 */
function atExpressionStart(code: string, at: number): boolean {
    let before = at - 1;
    while (before >= 0 && /\s/.test(code.charAt(before))) before--;
    return before < 0 || EXPRESSION_START.has(code.charAt(before));
}

/**
 * Replace each readable marked call in `code` with what `replace` makes of its
 * class string, counting the calls it could not read.
 *
 * @param code - Source or chunk text.
 * @param replace - The text for one call, given its decoded class string.
 * @returns The rewritten text and the counts.
 */
function replaceClassMarks(code: string, replace: (classes: string) => string): ClassMarkInline {
    let out = '';
    let copiedTo = 0;
    let inlined = 0;
    let missed = 0;
    let at = code.indexOf(ANNOTATION);
    while (at !== -1) {
        const argument = atExpressionStart(code, at)
            ? readCallee(code, at + ANNOTATION.length)
            : null;
        if (argument !== null) {
            const literal = readStringLiteral(code, argument);
            CALL_CLOSE.lastIndex = literal?.end ?? 0;
            if (literal !== null && CALL_CLOSE.test(code)) {
                out += code.slice(copiedTo, at) + replace(literal.value);
                copiedTo = CALL_CLOSE.lastIndex;
                inlined++;
                at = code.indexOf(ANNOTATION, copiedTo);
                continue;
            }
            missed++;
        } else if (namesHelper(code, at + ANNOTATION.length)) {
            // Not inlined, wherever it sits: a mark the pass will not read is
            // left to the runtime, and said.
            missed++;
        }
        at = code.indexOf(ANNOTATION, at + ANNOTATION.length);
    }
    return inlined === 0
        ? { code, inlined, missed }
        : { code: out + code.slice(copiedTo), inlined, missed };
}

/**
 * Replace each marked `__szCss("…")` call in a chunk with its string, renamed
 * through the map. An empty map still inlines every call, so a build that
 * mangles ships no call it does not need.
 *
 * @param code - A chunk as the bundler rendered it, before any minifier.
 * @param mangleMap - Original class name to token.
 * @returns The rewritten chunk and what was replaced or left.
 */
export function inlineClassMarks(
    code: string,
    mangleMap: Readonly<Record<string, string>>,
): ClassMarkInline {
    const result = replaceClassMarks(code, classes =>
        JSON.stringify(renameClassList(classes, mangleMap)),
    );
    const unannotated = unannotatedCalls(result.code);
    return unannotated === 0 ? result : { ...result, missed: result.missed + unannotated };
}

/**
 * Where a run of text breaks: a space as JavaScript, Unicode or a browser
 * reads one (`\s` holds them all, and a BOM besides), or a quote.
 */
const RUN_BREAK = /[\s"'`]+/;

/** Where a run breaks for a browser alone, which keeps a no-break space inside a class. */
const BROWSER_RUN_BREAK = /[\t\n\f\r "'`]+/;

/** JavaScript punctuation a name sits between outside a string: `{ flex: on }`. */
const PUNCTUATION_BREAK = /[{}();,=]+/;

/**
 * Add one run, the run with its escapes undone, and each piece of either
 * between JavaScript punctuation, a trailing `:` dropped.
 *
 * @param names - The set read into.
 * @param run - A run of text between spaces and quotes.
 */
function addRun(names: Set<string>, run: string): void {
    for (const value of run.includes('\\') ? [run, run.replace(/\\(.)/g, '$1')] : [run]) {
        names.add(value);
        for (const piece of value.split(PUNCTUATION_BREAK)) {
            if (piece !== '') names.add(piece.endsWith(':') ? piece.slice(0, -1) : piece);
        }
    }
}

/**
 * Every name a module's text could hand a class list outside the strings the
 * compiler marked: each run between spaces and quotes, which holds every
 * class written in a string or template, and the pieces of each run between
 * JavaScript punctuation, which holds an object key or a shorthand property
 * a `clsx`-like helper turns into a class. A run is also read with its
 * escapes undone, as the string's value holds it, and once more between
 * browser spaces only, as the DOM splits a class attribute.
 *
 * Over-reading is the safe side: a name read here is only left unrenamed.
 * Missing one would rename a class some unmarked code still writes as it was.
 *
 * Cost: linear in the text; the set holds each distinct run once.
 *
 * @param code - A module's text after the compiler transformed it, or as
 *               written when it has nothing to transform.
 * @returns The names read.
 */
export function collectUnmarkedNames(code: string): Set<string> {
    const names = new Set<string>();
    const unmarked = replaceClassMarks(code, () => '""').code;
    for (const run of unmarked.split(RUN_BREAK)) {
        if (run !== '') addRun(names, run);
    }
    for (const run of unmarked.split(BROWSER_RUN_BREAK)) {
        if (run !== '') addRun(names, run);
    }
    // A class can hold a quote (`before:content-['""']`), which the runs break
    // on: read each string and template text as its value, too.
    for (const text of stringValues(unmarked)) {
        addWords(names, text, /\s+/);
        addWords(names, text, HTML_CLASS_SPACE);
    }
    return names;
}

/**
 * Add each non-empty piece of `text` between `separator`s.
 *
 * @param names - The set read into.
 * @param text - A string's value.
 * @param separator - Where the text splits.
 */
function addWords(names: Set<string>, text: string, separator: RegExp): void {
    for (const name of text.split(separator)) {
        if (name !== '') names.add(name);
    }
}

/**
 * The value of each string literal and each template's text in `code`, read
 * twice: once as JavaScript lexes it, past comments and regular expressions
 * and through each placeholder's own code, and once from quote to quote. A
 * `/` the first reading misjudges loses only the strings up to its line's
 * end, which the second still reads; and a quote in a comment the second
 * pairs wrongly, the first reads past. Reading a value twice adds no name.
 *
 * Cost: linear in the text; placeholders nest on a stack, not the call stack.
 *
 * @param code - Module text.
 * @returns The values, in order, the first reading's before the second's.
 */
function stringValues(code: string): string[] {
    const values: string[] = [];
    lexStrings(code, values);
    quoteToQuote(code, values);
    return values;
}

/**
 * Read each string and template text as JavaScript lexes the code.
 *
 * @param code - Module text.
 * @param values - Where each value goes.
 */
function lexStrings(code: string, values: string[]): void {
    // The brace depth of each open placeholder, innermost last.
    const placeholders: number[] = [];
    let at = 0;
    while (at < code.length) at = lexToken(code, at, values, placeholders);
}

/**
 * Read the token at `at` for {@link lexStrings}.
 *
 * @param code - Module text.
 * @param at - Where the token starts.
 * @param values - Where each value goes.
 * @param placeholders - The brace depth of each open placeholder.
 * @returns Where reading goes on.
 */
function lexToken(code: string, at: number, values: string[], placeholders: number[]): number {
    const char = code[at];
    if (char === '"' || char === "'") {
        const literal = readStringLiteral(code, at);
        if (literal === null) return at + 1;
        values.push(literal.value);
        return literal.end;
    }
    if (char === '`') return readPiece(code, at + 1, values, placeholders);
    if (char === '/') {
        const past = skipCommentOrRegex(code, at);
        return past === at ? at + 1 : past;
    }
    if (placeholders.length > 0 && (char === '{' || char === '}')) {
        return placeholderBrace(code, at, values, placeholders);
    }
    return at + 1;
}

/**
 * A brace inside an open placeholder: one that closes it resumes the
 * template's text, any other moves the depth.
 *
 * @param code - Module text.
 * @param at - Index of the brace.
 * @param values - Where each value goes.
 * @param placeholders - The brace depth of each open placeholder.
 * @returns Where reading goes on.
 */
function placeholderBrace(
    code: string,
    at: number,
    values: string[],
    placeholders: number[],
): number {
    const depth = placeholders.pop() as number;
    if (code[at] === '}' && depth === 0) return readPiece(code, at + 1, values, placeholders);
    placeholders.push(code[at] === '{' ? depth + 1 : depth - 1);
    return at + 1;
}

/**
 * Read a template's text from `from`, opening a placeholder where it stops at one.
 *
 * @param code - Module text.
 * @param from - Where the text starts.
 * @param values - Where each value goes.
 * @param placeholders - The brace depth of each open placeholder.
 * @returns Where reading goes on.
 */
function readPiece(code: string, from: number, values: string[], placeholders: number[]): number {
    const piece = readTemplatePiece(code, from, values);
    if (piece.open) placeholders.push(0);
    return piece.end;
}

/**
 * Read each quoted string and template text from quote to quote, nothing
 * told apart: the reading that never misjudges a `/`.
 *
 * @param code - Module text.
 * @param values - Where each value goes.
 */
function quoteToQuote(code: string, values: string[]): void {
    let at = 0;
    while (at < code.length) {
        const char = code[at];
        if (char === '"' || char === "'") {
            const literal = readStringLiteral(code, at);
            if (literal !== null) {
                values.push(literal.value);
                at = literal.end;
                continue;
            }
        } else if (char === '`') {
            at = readTemplateText(code, at + 1, values);
            continue;
        }
        at++;
    }
}

/** A character after which a `/` begins a regular expression, not a division. */
const REGEX_AFTER = new Set([
    '(',
    ',',
    '=',
    ':',
    '[',
    '!',
    '&',
    '|',
    '?',
    '{',
    '}',
    ';',
    '+',
    '-',
    '*',
    '%',
    '~',
    '^',
]);

/** A keyword after which a `/` begins a regular expression. */
const REGEX_AFTER_WORD =
    /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;

/**
 * The index past the comment or regular expression a `/` begins, or `at`
 * itself when it is a division. A regular expression ends on its line; one
 * that does not is read as reaching the line's end, so no `/` is scanned twice.
 *
 * @param code - Module text.
 * @param at - Index of the `/`.
 * @returns Where reading goes on.
 */
function skipCommentOrRegex(code: string, at: number): number {
    const next = code[at + 1];
    if (next === '/') return lineEnd(code, at);
    if (next === '*') {
        const close = code.indexOf('*/', at + 2);
        return close < 0 ? code.length : close + 2;
    }
    if (!regexStarts(code, at)) return at;
    let inClass = false;
    for (let cursor = at + 1; cursor < code.length; cursor++) {
        const char = code[cursor];
        if (char === '\n' || char === '\r') return cursor;
        if (char === '\\') cursor++;
        else if (char === '[') inClass = true;
        else if (char === ']') inClass = false;
        else if (char === '/' && !inClass) return cursor + 1;
    }
    return code.length;
}

/**
 * The index of the line break after `at`, or the text's end.
 *
 * @param code - Module text.
 * @param at - Where to look from.
 * @returns That index.
 */
function lineEnd(code: string, at: number): number {
    let cursor = at;
    while (cursor < code.length && code[cursor] !== '\n' && code[cursor] !== '\r') cursor++;
    return cursor;
}

/**
 * Whether the `/` at `at` begins a regular expression, read from the
 * character before it.
 *
 * @param code - Module text.
 * @param at - Index of the `/`.
 * @returns True after an operator, an opening bracket or a keyword.
 */
function regexStarts(code: string, at: number): boolean {
    let before = at - 1;
    while (before >= 0 && /\s/.test(code.charAt(before))) before--;
    if (before < 0) return true;
    const char = code.charAt(before);
    if (REGEX_AFTER.has(char)) return true;
    return (
        /[\w$]/.test(char) && REGEX_AFTER_WORD.test(code.slice(Math.max(0, before - 9), before + 1))
    );
}

/**
 * Read one piece of a template's text, up to its closing backtick or the
 * next `${`.
 *
 * @param code - Module text.
 * @param start - Index after the backtick or the placeholder's `}`.
 * @param values - Where the piece goes.
 * @returns The index after what ended it, and whether a placeholder opened.
 */
function readTemplatePiece(
    code: string,
    start: number,
    values: string[],
): { end: number; open: boolean } {
    let text = '';
    let at = start;
    while (at < code.length) {
        const char = code[at];
        if (char === '`' || (char === '$' && code[at + 1] === '{')) {
            values.push(text);
            return char === '`' ? { end: at + 1, open: false } : { end: at + 2, open: true };
        }
        if (char === '\\') {
            const escaped = readEscape(code, at + 1);
            text += escaped?.value ?? '';
            at = escaped?.end ?? at + 2;
            continue;
        }
        text += char;
        at++;
    }
    values.push(text);
    return { end: at, open: false };
}

/**
 * The index after a template placeholder's closing brace, counting braces
 * only: the quote-to-quote reading's guess.
 *
 * @param code - Module text.
 * @param start - Index after the `${`.
 * @returns The index after its `}`, or past the end of the text.
 */
function skipPlaceholder(code: string, start: number): number {
    let depth = 0;
    let at = start;
    while (at < code.length && !(code[at] === '}' && depth === 0)) {
        if (code[at] === '{') depth++;
        else if (code[at] === '}') depth--;
        at++;
    }
    return at + 1;
}

/**
 * Read a template's text pieces, skipping each `${…}` placeholder.
 *
 * @param code - Module text.
 * @param start - Index after the opening backtick.
 * @param values - Where each piece of text goes.
 * @returns The index after the closing backtick, or the end of the text.
 */
function readTemplateText(code: string, start: number, values: string[]): number {
    let at = start;
    for (;;) {
        const piece = readTemplatePiece(code, at, values);
        if (!piece.open) return piece.end;
        at = skipPlaceholder(code, piece.end);
    }
}
