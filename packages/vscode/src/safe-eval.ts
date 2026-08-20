/**
 * Literal-only reader for the `sz` object text hover and diagnostics see.
 *
 * The input is never a program: it is one object literal lifted out of a
 * document, so the whole expression grammar is dead weight here. This reads
 * exactly the literal subset the providers can act on — primitives, nested
 * objects, arrays, uninterpolated templates — and returns null the moment it
 * meets anything that would have to be evaluated to know its value.
 *
 * Rejection is all-or-nothing on purpose: a partially resolved object would
 * make a provider report on keys whose neighbours it could not read.
 */

/** Value domain the providers can act on without evaluating anything. */
type SafeValue = string | number | boolean | null | SafeValue[] | { [key: string]: SafeValue };

const IDENTIFIER_START = /[\p{ID_Start}$_]/u;
const IDENTIFIER_PART = /[\p{ID_Continue}$\u200C\u200D]/u;
const DIGIT_OR_DOT = /[\d.]/;
const WHITESPACE = /\s/;

/**
 * Numeric literals as module code defines them.
 *
 * A leading zero followed by another digit is deliberately absent: `010` and
 * `09` are legacy octal and octal-like forms, and both are syntax errors in a
 * module. Accepting them would read `010` as ten where the bundler reads
 * eight.
 */
const NUMBER =
    /^(?:0x[\da-f](?:_?[\da-f])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*|(?:0|[1-9](?:_?\d)*)(?:\.(?:\d(?:_?\d)*)?)?(?:e[+-]?\d(?:_?\d)*)?|\.\d(?:_?\d)*(?:e[+-]?\d(?:_?\d)*)?)/i;

/** Thrown to unwind to {@link parseObjectLiteralSafe} from any depth. */
class NotStatic extends Error {}

/**
 * Cursor over the literal source.
 *
 * Every method either advances past a complete construct or throws, so no
 * caller has to check a return value for failure.
 */
class Reader {
    /** Source being read. */
    private readonly source: string;
    /** Offset of the next unread character. */
    private offset = 0;

    /**
     * @param source - Object literal text to read.
     */
    constructor(source: string) {
        this.source = source;
    }

    /**
     * Abandon the parse.
     * @throws Always.
     */
    bail(): never {
        throw new NotStatic();
    }

    /** Skip whitespace and comments. */
    skipTrivia(): void {
        while (this.offset < this.source.length) {
            const char = this.source[this.offset];
            if (WHITESPACE.test(char)) {
                this.offset += 1;
                continue;
            }
            if (char !== '/') return;
            const next = this.source[this.offset + 1];
            if (next === '/') {
                while (this.offset < this.source.length && this.source[this.offset] !== '\n') {
                    this.offset += 1;
                }
                continue;
            }
            if (next !== '*') return;
            const end = this.source.indexOf('*/', this.offset + 2);
            if (end === -1) this.bail();
            this.offset = end + 2;
        }
    }

    /**
     * @returns The next character, or undefined at end of input.
     */
    peek(): string | undefined {
        return this.source[this.offset];
    }

    /** Advance one character. */
    advance(): void {
        this.offset += 1;
    }

    /**
     * @returns True when the whole source has been read.
     */
    atEnd(): boolean {
        return this.offset === this.source.length;
    }

    /**
     * Consume one character when it is the expected one.
     * @param char - Character to consume.
     * @returns True when it was consumed.
     */
    eat(char: string): boolean {
        if (this.source[this.offset] !== char) return false;
        this.offset += 1;
        return true;
    }

    /**
     * Consume one required character.
     * @param char - Character that must be next.
     */
    expect(char: string): void {
        if (!this.eat(char)) this.bail();
    }

    /**
     * Read an identifier name.
     *
     * Callers check {@link IDENTIFIER_START} first, and every character that
     * may start an identifier may also continue one, so the loop always
     * consumes at least the character it was pointed at.
     *
     * @returns The name.
     */
    readIdentifier(): string {
        const start = this.offset;
        while (this.offset < this.source.length && IDENTIFIER_PART.test(this.source[this.offset])) {
            this.offset += 1;
        }
        return this.source.slice(start, this.offset);
    }

    /**
     * Read a quoted string.
     * @param quote - Opening quote character.
     * @returns The decoded text.
     */
    readString(quote: string): string {
        this.offset += 1;
        let out = '';
        for (;;) {
            const char = this.source[this.offset];
            if (char === undefined || char === '\n' || char === '\r') this.bail();
            if (char === quote) {
                this.offset += 1;
                return out;
            }
            if (char === '\\') {
                out += this.readEscape();
                continue;
            }
            out += char;
            this.offset += 1;
        }
    }

    /**
     * Read a template literal that has no interpolation.
     * @returns The decoded text.
     */
    readTemplate(): string {
        this.offset += 1;
        let out = '';
        for (;;) {
            const char = this.source[this.offset];
            if (char === undefined) this.bail();
            if (char === '`') {
                this.offset += 1;
                return out;
            }
            // An interpolation is a value the document has not computed yet.
            if (char === '$' && this.source[this.offset + 1] === '{') this.bail();
            if (char === '\\') {
                out += this.readEscape();
                continue;
            }
            out += char;
            this.offset += 1;
        }
    }

    /**
     * Read one backslash escape.
     * @returns The text the escape stands for.
     */
    readEscape(): string {
        this.offset += 1;
        const char = this.source[this.offset];
        if (char === undefined) this.bail();
        this.offset += 1;
        switch (char) {
            case 'n':
                return '\n';
            case 't':
                return '\t';
            case 'r':
                return '\r';
            case 'b':
                return '\b';
            case 'f':
                return '\f';
            case 'v':
                return '\v';
            case 'x':
                return this.readHexEscape(2);
            case 'u':
                return this.readUnicodeEscape();
            case '0':
                // `\0` is the null character only while no digit follows it;
                // `\01` is a legacy octal escape, which module code rejects.
                if (this.digitFollows()) this.bail();
                return '\0';
            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
            case '6':
            case '7':
            case '8':
            case '9':
                // Legacy octal escapes and `\8` / `\9` are module syntax errors.
                return this.bail();
            case '\r':
                this.eat('\n');
                return '';
            case '\n':
            case '\u2028':
            case '\u2029':
                // Line continuation: the newline contributes nothing.
                return '';
            default:
                return char;
        }
    }

    /**
     * @returns True when the next character is a decimal digit.
     */
    private digitFollows(): boolean {
        const next = this.source[this.offset];
        return next !== undefined && next >= '0' && next <= '9';
    }

    /**
     * Read a fixed-width hex escape body.
     * @param width - Number of hex digits to read.
     * @returns The character the digits encode.
     */
    private readHexEscape(width: number): string {
        const digits = this.source.slice(this.offset, this.offset + width);
        if (digits.length !== width || !isHex(digits)) this.bail();
        this.offset += width;
        return String.fromCodePoint(Number.parseInt(digits, 16));
    }

    /**
     * Read a `\u` escape in either the four-digit or the braced form.
     * @returns The character the escape encodes.
     */
    private readUnicodeEscape(): string {
        if (this.source[this.offset] !== '{') return this.readHexEscape(4);
        const end = this.source.indexOf('}', this.offset);
        if (end === -1) this.bail();
        const digits = this.source.slice(this.offset + 1, end);
        if (digits.length === 0 || digits.length > 6 || !isHex(digits)) this.bail();
        const codePoint = Number.parseInt(digits, 16);
        if (codePoint > 0x10ffff) this.bail();
        this.offset = end + 1;
        return String.fromCodePoint(codePoint);
    }

    /**
     * Read a numeric literal.
     * @returns Its value.
     */
    readNumber(): number {
        const matched = NUMBER.exec(this.source.slice(this.offset));
        if (!matched) this.bail();
        this.offset += matched[0].length;
        // `1n` is a bigint and `1abc` is not a literal at all; neither is a
        // number, and both end where a number would have ended.
        const next = this.source[this.offset];
        if (next !== undefined && (next === 'n' || IDENTIFIER_PART.test(next))) this.bail();
        return Number(matched[0].split('_').join(''));
    }
}

/**
 * @param text - Candidate hex digits.
 * @returns True when every character is a hex digit.
 */
function isHex(text: string): boolean {
    for (const char of text) {
        const lower = char.toLowerCase();
        const decimal = lower >= '0' && lower <= '9';
        const letter = lower >= 'a' && lower <= 'f';
        if (!decimal && !letter) return false;
    }
    return true;
}

/**
 * Read a negated number, seeing through any parentheses around it.
 *
 * Only a plain numeric literal may be negated. `-(-4)` folds to a number in
 * JavaScript but is two operators deep, and the providers have never read it.
 *
 * @param reader - Cursor positioned just after the minus sign.
 * @returns The negated value.
 */
function readNegative(reader: Reader): number {
    let depth = 0;
    reader.skipTrivia();
    while (reader.peek() === '(') {
        reader.advance();
        depth += 1;
        reader.skipTrivia();
    }
    const char = reader.peek();
    if (char === undefined || !DIGIT_OR_DOT.test(char)) reader.bail();
    const value = -reader.readNumber();
    while (depth > 0) {
        reader.skipTrivia();
        reader.expect(')');
        depth -= 1;
    }
    return value;
}

/**
 * Read one value.
 * @param reader - Cursor positioned at the value.
 * @returns The value.
 */
function readValue(reader: Reader): SafeValue {
    reader.skipTrivia();
    const char = reader.peek();
    if (char === undefined) reader.bail();
    if (char === '{') return readObject(reader);
    if (char === '[') return readArray(reader);
    if (char === "'" || char === '"') return reader.readString(char);
    if (char === '`') return reader.readTemplate();
    if (char === '(') {
        reader.advance();
        const inner = readValue(reader);
        reader.skipTrivia();
        reader.expect(')');
        return inner;
    }
    if (char === '-') {
        reader.advance();
        return readNegative(reader);
    }
    if (DIGIT_OR_DOT.test(char)) return reader.readNumber();
    if (!IDENTIFIER_START.test(char)) reader.bail();
    // Only the three literal keywords are values; every other name — `x`,
    // `undefined`, `NaN` — is something the document would have to resolve.
    const word = reader.readIdentifier();
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    return reader.bail();
}

/**
 * Read an array literal, recording holes as null.
 * @param reader - Cursor positioned at the opening bracket.
 * @returns The array.
 */
function readArray(reader: Reader): SafeValue[] {
    reader.expect('[');
    const values: SafeValue[] = [];
    for (;;) {
        reader.skipTrivia();
        if (reader.eat(']')) return values;
        if (reader.peek() === ',') {
            reader.advance();
            values.push(null);
            continue;
        }
        values.push(readValue(reader));
        reader.skipTrivia();
        if (reader.eat(',')) continue;
        reader.expect(']');
        return values;
    }
}

/**
 * Read one property key.
 * @param reader - Cursor positioned at the key.
 * @returns The key as the property name it becomes.
 */
function readKey(reader: Reader): string {
    const char = reader.peek();
    if (char === undefined) reader.bail();
    if (char === "'" || char === '"') return reader.readString(char);
    if (DIGIT_OR_DOT.test(char)) return String(reader.readNumber());
    if (!IDENTIFIER_START.test(char)) reader.bail();
    return reader.readIdentifier();
}

/**
 * Read an object literal.
 * @param reader - Cursor positioned at the opening brace.
 * @returns The object.
 */
function readObject(reader: Reader): Record<string, SafeValue> {
    reader.expect('{');
    const result: Record<string, SafeValue> = {};
    for (;;) {
        reader.skipTrivia();
        if (reader.eat('}')) return result;
        const key = readKey(reader);
        reader.skipTrivia();
        // A method, an accessor or a shorthand property never reaches a colon.
        reader.expect(':');
        const value = readValue(reader);
        // Assigning through `__proto__` would swap the prototype of the object
        // a provider is about to walk, so the name is read and dropped.
        if (key !== '__proto__') {
            result[key] = value;
        }
        reader.skipTrivia();
        if (reader.eat(',')) continue;
        reader.expect('}');
        return result;
    }
}

/**
 * Read a JavaScript object literal that resolves without evaluating anything.
 * @param source - Object literal source text.
 * @returns The object, or null when any part of it is not a literal.
 */
export function parseObjectLiteralSafe(source: string): Record<string, SafeValue> | null {
    const reader = new Reader(source);
    try {
        reader.skipTrivia();
        if (reader.peek() !== '{') return null;
        const result = readObject(reader);
        reader.skipTrivia();
        // Text after the literal means the window handed us more than one
        // expression, and the extra one has not been checked for anything.
        return reader.atEnd() ? result : null;
    } catch {
        return null;
    }
}
