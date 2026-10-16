/**
 * Decode the character references of a Vue template attribute value.
 *
 * Vue decodes `&quot;`, `&#39;` and the like in an attribute value before it
 * reads the value as an expression, so `:sz="{ content: '&quot;' }"` holds a
 * `"`. The value is decoded the same way before the engine reads it, and each
 * decoded unit remembers where it was written, so a diagnostic still points
 * at the template.
 *
 * @module character-references
 */

/** The named references decoded; any other name is left as written. */
const NAMED: ReadonlyMap<string, string> = new Map([
    ['amp', '&'],
    ['apos', "'"],
    ['gt', '>'],
    ['lt', '<'],
    ['nbsp', String.fromCodePoint(0xa0)],
    ['quot', '"'],
]);

/** A decimal, hexadecimal or named character reference. */
const REFERENCE = /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi;

/** A decoded attribute value. */
export interface DecodedValue {
    /** The value with its character references decoded. */
    source: string;
    /** The file offset of each UTF-16 unit of `source`; absent when nothing was decoded. */
    offsets?: number[];
}

/**
 * The text one reference stands for.
 *
 * @param match - One {@link REFERENCE} match.
 * @returns The decoded text, or undefined for a name or code point Vue would
 *          not decode either.
 */
function referenceText(match: RegExpMatchArray): string | undefined {
    const [, decimal, hexadecimal, name] = match;
    if (name !== undefined) return NAMED.get(name);
    const codePoint = decimal === undefined ? Number.parseInt(hexadecimal, 16) : Number(decimal);
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : undefined;
}

/**
 * Decode the character references in one attribute value.
 *
 * @param text - The value as written.
 * @param start - The file offset where the value starts.
 * @returns The decoded value, with offsets when any reference was decoded.
 */
export function decodeCharacterReferences(text: string, start: number): DecodedValue {
    if (!text.includes('&')) return { source: text };
    let source = '';
    const offsets: number[] = [];
    let last = 0;
    const append = (part: string, offset: number, step: number): void => {
        for (let index = 0; index < part.length; index += 1) offsets.push(offset + index * step);
        source += part;
    };
    for (const match of text.matchAll(REFERENCE)) {
        const decoded = referenceText(match);
        if (decoded === undefined) continue;
        append(text.slice(last, match.index), start + last, 1);
        append(decoded, start + match.index, 0);
        last = match.index + match[0].length;
    }
    append(text.slice(last), start + last, 1);
    return { source, offsets };
}
