/** Characters that can precede a JavaScript regular-expression literal. */
const REGEX_PREFIXES = new Set('([{:,;=!?&|+-*%^~<>/');
const REGEX_PREFIX_KEYWORDS = new Set([
    'await',
    'case',
    'delete',
    'do',
    'else',
    'in',
    'instanceof',
    'of',
    'return',
    'throw',
    'typeof',
    'void',
    'yield',
]);
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v',
    '0': '\0',
};

/** One decoded escape and the last consumed source offset. */
interface DecodedEscape {
    value: string;
    cursor: number;
}

/**
 * Decode a braced Unicode code-point escape.
 *
 * @param value Complete raw literal content.
 * @param cursor Escaped `u` offset after the backslash.
 * @returns Decoded escape, or null when this is not a valid braced form.
 */
function decodeBracedUnicodeEscape(value: string, cursor: number): DecodedEscape | null {
    if (value[cursor] !== 'u' || value[cursor + 1] !== '{') return null;
    const close = value.indexOf('}', cursor + 2);
    const hex = close === -1 ? '' : value.slice(cursor + 2, close);
    const codePoint = hex && /^[\dA-F]+$/i.test(hex) ? Number.parseInt(hex, 16) : -1;
    if (codePoint < 0 || codePoint > 0x10ffff) return null;
    return { value: String.fromCodePoint(codePoint), cursor: close };
}

/**
 * Decode a fixed-width hexadecimal escape.
 *
 * @param value Complete raw literal content.
 * @param cursor Escaped character offset after the backslash.
 * @returns Decoded escape, or null for a different or malformed escape.
 */
function decodeFixedWidthEscape(value: string, cursor: number): DecodedEscape | null {
    const escaped = value[cursor];
    let width = 0;
    if (escaped === 'x') width = 2;
    if (escaped === 'u') width = 4;
    const hex = value.slice(cursor + 1, cursor + width + 1);
    if (width === 0 || !isFixedHex(hex, width)) return null;
    return {
        value: String.fromCodePoint(Number.parseInt(hex, 16)),
        cursor: cursor + width,
    };
}

/**
 * Whether a string contains exactly the requested number of hex digits.
 *
 * @param value Candidate hexadecimal text.
 * @param width Required digit count.
 * @returns Whether the candidate is a fixed-width hexadecimal value.
 */
function isFixedHex(value: string, width: number): boolean {
    if (value.length !== width) return false;
    for (const character of value) {
        if (!'0123456789abcdefABCDEF'.includes(character)) return false;
    }
    return true;
}

/**
 * Decode one escape sequence and report its consumed end.
 *
 * @param value Complete raw literal content.
 * @param cursor Escaped character offset after the backslash.
 * @returns Decoded value and final consumed offset.
 */
function decodeEscape(value: string, cursor: number): DecodedEscape {
    const escaped = value[cursor];
    if (SIMPLE_ESCAPES[escaped] !== undefined) {
        return { value: SIMPLE_ESCAPES[escaped], cursor };
    }
    if (escaped === '\r' && value[cursor + 1] === '\n') {
        return { value: '', cursor: cursor + 1 };
    }
    const bracedUnicode = decodeBracedUnicodeEscape(value, cursor);
    if (bracedUnicode) return bracedUnicode;
    const fixedWidth = decodeFixedWidthEscape(value, cursor);
    if (fixedWidth) return fixedWidth;
    const decoded = escaped === '\n' || escaped === '\r' ? '' : escaped;
    return { value: decoded, cursor };
}

/**
 * Decode the escape forms that can change class-token boundaries or spelling.
 *
 * @param value Raw JavaScript string-literal content.
 * @returns Decoded static string content.
 */
function decodeJavaScriptString(value: string): string {
    let output = '';
    let cursor = 0;
    while (cursor < value.length) {
        if (value[cursor] !== '\\' || cursor + 1 >= value.length) {
            output += value[cursor++];
            continue;
        }
        const decoded = decodeEscape(value, cursor + 1);
        output += decoded.value;
        cursor = decoded.cursor + 1;
    }
    return output;
}

/**
 * Decode HTML whitespace entities that can separate class candidates.
 *
 * @param value Raw quoted JSX/HTML attribute content.
 * @returns Content with class-separating entities decoded.
 */
function decodeAttributeWhitespace(value: string): string {
    return value.replace(
        /&#(?:(\d+)|x([\da-f]+));|&(?:Tab|NewLine);/gi,
        (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
            if (!decimal && !hexadecimal) return ' ';
            const codePoint = Number.parseInt(decimal ?? hexadecimal ?? '', decimal ? 10 : 16);
            return [9, 10, 12, 13, 32].includes(codePoint) ? ' ' : entity;
        },
    );
}

/**
 * Add whitespace-delimited class candidates to a set.
 *
 * @param target Class candidate sink.
 * @param value Authored class string.
 */
function collectClassTokens(target: Set<string>, value: string): void {
    for (const className of value.split(/\s+/)) {
        if (className) target.add(className);
    }
}

/**
 * Find the offset after a quoted JavaScript literal.
 * @param source Complete source text.
 * @param start Opening quote offset.
 * @param quote Quote delimiter.
 * @returns Offset after the closing quote, or source length.
 */
function quotedEnd(source: string, start: number, quote: string): number {
    let cursor = start + 1;
    while (cursor < source.length) {
        if (source[cursor] === '\\') cursor += 2;
        else if (source[cursor++] === quote) break;
    }
    return cursor;
}

/**
 * Find the offset after a line or block comment.
 * @param source Complete source text.
 * @param start Opening slash offset.
 * @returns Offset after the comment, or source length.
 */
function commentEnd(source: string, start: number): number {
    if (source[start + 1] === '/') {
        const end = source.indexOf('\n', start + 2);
        return end === -1 ? source.length : end + 1;
    }
    const end = source.indexOf('*/', start + 2);
    return end === -1 ? source.length : end + 2;
}

/**
 * Whether a slash at one offset starts a regular-expression literal.
 * @param source Complete source text.
 * @param start Candidate slash offset.
 * @returns Whether the slash begins a regular expression.
 */
function isRegexStart(source: string, start: number): boolean {
    let cursor = start - 1;
    while (cursor >= 0 && /\s/.test(source[cursor])) cursor--;
    if (source[cursor] === '<' && /[A-Z]/i.test(source[start + 1] ?? '')) return false;
    if (cursor < 0 || REGEX_PREFIXES.has(source[cursor])) return true;
    if (!/[\w$]/.test(source[cursor])) return false;
    const end = cursor + 1;
    while (cursor >= 0 && /[\w$]/.test(source[cursor])) cursor--;
    return REGEX_PREFIX_KEYWORDS.has(source.slice(cursor + 1, end));
}

/**
 * Find the offset after a regular-expression literal.
 * @param source Complete source text.
 * @param start Opening slash offset.
 * @returns Offset after the literal and flags, or source length.
 */
function regexEnd(source: string, start: number): number {
    let cursor = start + 1;
    let inCharacterClass = false;
    while (cursor < source.length) {
        const character = source[cursor];
        if (character === '\\') cursor += 2;
        else if (character === '[') {
            inCharacterClass = true;
            cursor++;
        } else if (character === ']') {
            inCharacterClass = false;
            cursor++;
        } else if (character === '/' && !inCharacterClass) {
            cursor++;
            while (/[A-Z]/i.test(source[cursor] ?? '')) cursor++;
            break;
        } else cursor++;
    }
    return cursor;
}

/**
 * Find the offset after a template literal, including nested interpolations.
 * @param source Complete source text.
 * @param start Opening backtick offset.
 * @returns Offset after the closing backtick, or source length.
 */
function templateEnd(source: string, start: number): number {
    let cursor = start + 1;
    while (cursor < source.length) {
        if (source[cursor] === '\\') cursor += 2;
        else if (source[cursor] === '`') return cursor + 1;
        else if (source[cursor] === '$' && source[cursor + 1] === '{') {
            cursor = findBalancedCodeEnd(source, cursor + 2);
        } else cursor++;
    }
    return source.length;
}

/**
 * Return the end of a lexical region, or the same offset for ordinary code.
 * @param source Complete source text.
 * @param start Candidate lexical-region offset.
 * @returns Region end, or start when ordinary code begins there.
 */
function lexicalRegionEnd(source: string, start: number): number {
    const character = source[start];
    if (character === '"' || character === "'") return quotedEnd(source, start, character);
    if (character === '`') return templateEnd(source, start);
    if (character === '/' && (source[start + 1] === '/' || source[start + 1] === '*')) {
        return commentEnd(source, start);
    }
    if (character === '/' && isRegexStart(source, start)) return regexEnd(source, start);
    return start;
}

/**
 * Find the exclusive end of a balanced JavaScript brace expression.
 *
 * @param source Complete source text.
 * @param bodyStart Offset immediately after the opening brace.
 * @returns Offset of the matching closing brace, or source length.
 */
export function findBalancedCodeEnd(source: string, bodyStart: number): number {
    let depth = 1;
    let cursor = bodyStart;
    while (cursor < source.length) {
        const regionEnd = lexicalRegionEnd(source, cursor);
        if (regionEnd !== cursor) {
            cursor = regionEnd;
            continue;
        }
        if (source[cursor] === '{') depth++;
        else if (source[cursor] === '}' && --depth === 0) return cursor;
        cursor++;
    }
    return source.length;
}

/**
 * Collect static quasis and interpolation literals from one template.
 * @param target Class candidate sink.
 * @param source Expression source text.
 * @param start Opening backtick offset.
 * @returns Offset after the closing backtick, or source length.
 */
function collectTemplateTokens(target: Set<string>, source: string, start: number): number {
    let cursor = start + 1;
    let quasiStart = cursor;
    while (cursor < source.length) {
        if (source[cursor] === '\\') {
            cursor += 2;
            continue;
        }
        if (source[cursor] === '`') {
            collectClassTokens(target, decodeJavaScriptString(source.slice(quasiStart, cursor)));
            return cursor + 1;
        }
        if (source[cursor] === '$' && source[cursor + 1] === '{') {
            collectClassTokens(target, decodeJavaScriptString(source.slice(quasiStart, cursor)));
            const expressionEnd = findBalancedCodeEnd(source, cursor + 2);
            collectExpressionTokens(target, source.slice(cursor + 2, expressionEnd));
            cursor = expressionEnd + 1;
            quasiStart = cursor;
            continue;
        }
        cursor++;
    }
    collectClassTokens(target, decodeJavaScriptString(source.slice(quasiStart)));
    return source.length;
}

/**
 * Collect quoted and template strings from a class expression.
 * @param target Class candidate sink.
 * @param expression Class-bearing JavaScript expression.
 */
function collectExpressionTokens(target: Set<string>, expression: string): void {
    let cursor = 0;
    let pendingLiteral = '';
    let previousLiteralEnd = -1;
    const flushPending = (): void => {
        if (pendingLiteral) collectClassTokens(target, pendingLiteral);
        pendingLiteral = '';
    };
    while (cursor < expression.length) {
        const character = expression[cursor];
        if (
            character === '/' &&
            (expression[cursor + 1] === '/' || expression[cursor + 1] === '*')
        ) {
            cursor = commentEnd(expression, cursor);
            continue;
        }
        if (character === '/' && isRegexStart(expression, cursor)) {
            cursor = regexEnd(expression, cursor);
            continue;
        }
        if (character === '`') {
            flushPending();
            cursor = collectTemplateTokens(target, expression, cursor);
            previousLiteralEnd = -1;
            continue;
        }
        if (character !== '"' && character !== "'") {
            cursor++;
            continue;
        }
        const end = quotedEnd(expression, cursor, character);
        const decoded = decodeJavaScriptString(expression.slice(cursor + 1, end - 1));
        const joinsPrevious =
            previousLiteralEnd >= 0 && expression.slice(previousLiteralEnd, cursor).trim() === '+';
        if (!joinsPrevious) flushPending();
        pendingLiteral += decoded;
        previousLiteralEnd = end;
        cursor = end;
    }
    flushPending();
}

/**
 * Skip whitespace and comments between a class sink and its value.
 * @param source Complete source text.
 * @param start Offset after the sink name or operator.
 * @returns First non-trivia offset.
 */
function triviaEnd(source: string, start: number): number {
    let cursor = start;
    while (cursor < source.length) {
        if (/\s/.test(source[cursor])) cursor++;
        else if (
            source[cursor] === '/' &&
            (source[cursor + 1] === '/' || source[cursor + 1] === '*')
        ) {
            cursor = commentEnd(source, cursor);
        } else break;
    }
    return cursor;
}

/**
 * Find the boundary of an object-property class expression.
 * @param source Complete source text.
 * @param start Property value start.
 * @returns Exclusive property-expression end.
 */
function propertyExpressionEnd(source: string, start: number): number {
    let cursor = start;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    while (cursor < source.length) {
        const regionEnd = lexicalRegionEnd(source, cursor);
        if (regionEnd !== cursor) {
            cursor = regionEnd;
            continue;
        }
        const character = source[cursor];
        if (character === '(') parenDepth++;
        else if (character === ')') parenDepth--;
        else if (character === '[') bracketDepth++;
        else if (character === ']') bracketDepth--;
        else if (character === '{') braceDepth++;
        else if (character === '}' && braceDepth > 0) braceDepth--;
        else if (
            (character === ',' || character === ';' || character === '}') &&
            parenDepth === 0 &&
            bracketDepth === 0 &&
            braceDepth === 0
        )
            return cursor;
        cursor++;
    }
    return source.length;
}

/**
 * Whether an identifier is a class-bearing source key rather than a property access.
 * @param source Complete source text.
 * @param start Identifier start.
 * @param end Identifier end.
 * @returns Whether the identifier is a supported class sink.
 */
function isClassSink(source: string, start: number, end: number): boolean {
    const name = source.slice(start, end);
    if (name !== 'class' && name !== 'className') return false;
    let previous = start - 1;
    while (previous >= 0 && /\s/.test(source[previous])) previous--;
    return source[previous] !== '.' && source[previous] !== '-';
}

/**
 * Collect a framework `class:*` directive when one starts at an object-like colon value.
 * @param target Class candidate sink.
 * @param source Complete source text.
 * @param sinkStart Class identifier start.
 * @param valueStart Offset immediately after the colon and trivia.
 * @returns Consumed end for a directive, or null for an ordinary object property.
 */
function collectClassDirective(
    target: Set<string>,
    source: string,
    sinkStart: number,
    valueStart: number,
): number | null {
    if (!/[\w$-]/.test(source[valueStart] ?? '')) return null;
    let directiveEnd = valueStart;
    while (/[\w$-]/.test(source[directiveEnd] ?? '')) directiveEnd++;
    const equals = triviaEnd(source, directiveEnd);
    if (source[equals] !== '=') {
        const insideMarkupTag =
            source.lastIndexOf('<', sinkStart) > source.lastIndexOf('>', sinkStart);
        const next = source[equals] ?? '';
        const continuesMarkupTag =
            next === '/' || next === '>' || next === '{' || /[A-Z_:]/i.test(next);
        if (!insideMarkupTag || !continuesMarkupTag) return null;
        // Svelte permits shorthand `class:name` when the condition variable
        // has the same name as the class.
        collectClassTokens(target, source.slice(valueStart, directiveEnd));
        return directiveEnd;
    }

    const directive = source.slice(valueStart, directiveEnd);
    const directiveValueStart = triviaEnd(source, equals + 1);
    const directiveQuote = source[directiveValueStart];
    // Svelte's class:name directive authors `name` directly. Astro's
    // class:list directive instead carries the authored names in its value, so
    // `list` itself is not a runtime class.
    if (directive !== 'list') collectClassTokens(target, directive);
    if (directiveQuote === '{') {
        const end = findBalancedCodeEnd(source, directiveValueStart + 1);
        if (directive === 'list') {
            collectExpressionTokens(target, source.slice(directiveValueStart + 1, end));
        }
        return end + 1;
    }
    if (directive === 'list' && (directiveQuote === '"' || directiveQuote === "'")) {
        const end = quotedEnd(source, directiveValueStart, directiveQuote);
        collectExpressionTokens(target, source.slice(directiveValueStart, end));
        return end;
    }
    return directiveValueStart;
}

/**
 * Collect one recognized class/className sink and return its consumed end.
 * @param target Class candidate sink.
 * @param source Complete source text.
 * @param start Class identifier start.
 * @param nameEnd Class identifier end.
 * @returns Offset after the consumed sink value.
 */
function collectClassSink(
    target: Set<string>,
    source: string,
    start: number,
    nameEnd: number,
): number {
    const operatorStart = triviaEnd(source, nameEnd);
    const operator = source[operatorStart];
    if (operator !== '=' && operator !== ':') return nameEnd;
    const valueStart = triviaEnd(source, operatorStart + 1);
    const quote = source[valueStart];
    const vueBinding = operator === '=' && source.slice(Math.max(0, start - 1), start) === ':';
    if (operator === ':' && valueStart === operatorStart + 1) {
        const directiveEnd = collectClassDirective(target, source, start, valueStart);
        if (directiveEnd !== null) return directiveEnd;
    }
    if (quote === '"' || quote === "'") {
        const end = quotedEnd(source, valueStart, quote);
        const value = source.slice(valueStart + 1, end - 1);
        if (vueBinding) collectExpressionTokens(target, decodeAttributeWhitespace(value));
        else collectClassTokens(target, decodeAttributeWhitespace(value));
        return end;
    }
    if (operator === '=' && quote === '{') {
        const end = findBalancedCodeEnd(source, valueStart + 1);
        collectExpressionTokens(target, source.slice(valueStart + 1, end));
        return end + 1;
    }
    if (operator === ':') {
        const end = propertyExpressionEnd(source, valueStart);
        collectExpressionTokens(target, source.slice(valueStart, end));
        return end;
    }
    return valueStart;
}

/**
 * Collect statically authored class candidates from source-level class sinks.
 *
 * @param source Module text before csszyx transforms it.
 * @returns Candidates that must retain authored spelling.
 */
export function collectAuthoredClassNames(source: string): Set<string> {
    const classes = new Set<string>();
    let cursor = 0;
    while (cursor < source.length) {
        if (source[cursor] === '"' || source[cursor] === "'") {
            const keyEnd = quotedEnd(source, cursor, source[cursor]);
            const key = decodeJavaScriptString(source.slice(cursor + 1, keyEnd - 1));
            cursor =
                key === 'class' || key === 'className'
                    ? collectClassSink(classes, source, cursor, keyEnd)
                    : keyEnd;
            continue;
        }
        const regionEnd = lexicalRegionEnd(source, cursor);
        if (regionEnd !== cursor) {
            cursor = regionEnd;
            continue;
        }
        if (!/[A-Z_$]/i.test(source[cursor])) {
            cursor++;
            continue;
        }
        let nameEnd = cursor + 1;
        while (/[\w$]/.test(source[nameEnd] ?? '')) nameEnd++;
        cursor = isClassSink(source, cursor, nameEnd)
            ? collectClassSink(classes, source, cursor, nameEnd)
            : nameEnd;
    }
    return classes;
}
