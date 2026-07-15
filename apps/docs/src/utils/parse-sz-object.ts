/** One parsed key/value pair from an sz object display string. */
export interface SzObjectEntry {
    /** Property name. */
    key: string;
    /** Unmodified value source. */
    val: string;
}

interface ParsedValue {
    value: string;
    nextIndex: number;
}

/**
 * Skip separators between displayed object entries.
 * @param source - Object contents without outer braces.
 * @param start - Current source offset.
 * @returns Offset of the next non-separator character.
 */
function skipSeparators(source: string, start: number): number {
    let index = start;
    while (index < source.length && (source[index] === ' ' || source[index] === ',')) index++;
    return index;
}

/**
 * Skip whitespace before a displayed value without consuming entry commas.
 * @param source - Object contents.
 * @param start - Current source offset.
 * @returns Offset of the next non-space character.
 */
function skipSpaces(source: string, start: number): number {
    let index = start;
    while (index < source.length && source[index] === ' ') index++;
    return index;
}

/**
 * Read a balanced nested object value.
 * @param source - Object contents.
 * @param start - Opening brace offset.
 * @returns Nested object source and following offset.
 */
function readNestedObject(source: string, start: number): ParsedValue {
    let depth = 0;
    let index = start;
    while (index < source.length) {
        if (source[index] === '{') depth++;
        if (source[index] === '}') depth--;
        index++;
        if (depth === 0) break;
    }
    return { value: source.slice(start, index), nextIndex: index };
}

/**
 * Read one quoted value while retaining its delimiters.
 * @param source - Object contents.
 * @param start - Opening quote offset.
 * @returns Quoted source and following offset.
 */
function readQuotedValue(source: string, start: number): ParsedValue {
    const quote = source[start];
    let index = start + 1;
    while (index < source.length && source[index] !== quote) index++;
    index++;
    return { value: source.slice(start, index), nextIndex: index };
}

/**
 * Read an unquoted scalar up to the next entry separator.
 * @param source - Object contents.
 * @param start - Scalar start offset.
 * @returns Trimmed scalar source and following offset.
 */
function readScalarValue(source: string, start: number): ParsedValue {
    let index = start;
    while (index < source.length && source[index] !== ',') index++;
    return { value: source.slice(start, index).trim(), nextIndex: index };
}

/**
 * Read the next displayed sz value by its opening token.
 * @param source - Object contents.
 * @param start - Value start offset.
 * @returns Value source and following offset.
 */
function readValue(source: string, start: number): ParsedValue {
    if (source[start] === '{') return readNestedObject(source, start);
    if (source[start] === "'" || source[start] === '"') return readQuotedValue(source, start);
    return readScalarValue(source, start);
}

/**
 * Parse displayed `key: value` pairs while preserving nested object source.
 * @param source - Object contents without outer braces.
 * @returns Parsed entries in source order.
 */
export function parseSzObjectEntries(source: string): SzObjectEntry[] {
    const entries: SzObjectEntry[] = [];
    let index = 0;
    while (index < source.length) {
        index = skipSeparators(source, index);
        if (index >= source.length) break;

        const colon = source.indexOf(': ', index);
        if (colon === -1) break;
        const key = source.slice(index, colon).trim();
        const valueStart = skipSpaces(source, colon + 2);
        const parsed = readValue(source, valueStart);
        if (key) entries.push({ key, val: parsed.value });
        index = parsed.nextIndex;
    }
    return entries;
}
