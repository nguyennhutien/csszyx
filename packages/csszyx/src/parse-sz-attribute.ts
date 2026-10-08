/**
 * The `sz` attribute parser of the CDN runtime, apart from `browser.ts` so it
 * can be tested without that module's load-time DOM walk.
 *
 * @module
 */

/**
 * Safe JS object literal parser for sz attributes. Handles single-quoted
 * strings, unquoted keys, numbers, booleans, nested objects, and arbitrary
 * variant keys like `[&>span]`. Does NOT use eval/new Function — the runtime
 * has to be CSP-safe so it can ship through unpkg/jsdelivr to pages with
 * strict-CSP headers.
 *
 * Auto-wraps input in `{}` if missing, so both `"p: 4"` and `"{p: 4}"` parse.
 *
 * Every pass of the object and array loops consumes at least one character or
 * throws, so a parse takes time linear in the input and always ends. A
 * character the grammar does not expect (`{ w: 1/2 }`, `{ p: 4; m: 2 }`) is a
 * `SyntaxError` naming it, which the runtime reports; without the check those
 * passes consumed nothing and the loop never ended, freezing the page.
 *
 * @param rawInput Raw `sz` attribute value as written in HTML.
 * @returns Parsed object representation suitable for the sz transform.
 */
export function parseSzAttribute(rawInput: string): Record<string, unknown> {
    const trimmed = rawInput.trim();
    const wrapped = !trimmed.startsWith('{');
    const input = wrapped ? `{${trimmed}}` : trimmed;
    // Maps a position in `input` back to `rawInput`: undo the added `{` and
    // the leading whitespace `trim` removed, so the report points at the
    // character the author wrote.
    const offset = rawInput.length - rawInput.trimStart().length - (wrapped ? 1 : 0);
    let pos = 0;

    // Only called inside a loop that runs while `pos` is in range.
    const unexpected = (): never => {
        throw new SyntaxError(
            `[csszyx] Unexpected ${JSON.stringify(input[pos])} at ${pos + offset} in sz attribute "${rawInput}"`,
        );
    };

    const skipWhitespace = (): void => {
        while (pos < input.length && /\s/.test(input[pos])) {
            pos++;
        }
    };

    const parseString = (quote: string): string => {
        pos++; // skip opening quote
        let result = '';
        while (pos < input.length && input[pos] !== quote) {
            if (input[pos] === '\\') {
                pos++;
                if (pos < input.length) {
                    result += input[pos];
                }
            } else {
                result += input[pos];
            }
            pos++;
        }
        pos++; // skip closing quote
        return result;
    };

    const parseKey = (): string => {
        skipWhitespace();
        if (input[pos] === "'" || input[pos] === '"') {
            return parseString(input[pos]);
        }
        let key = '';
        if (input[pos] === '[') {
            // Arbitrary variant key like [&>span] — track bracket depth.
            let depth = 0;
            while (pos < input.length) {
                if (input[pos] === '[') {
                    depth++;
                }
                if (input[pos] === ']') {
                    depth--;
                }
                key += input[pos];
                pos++;
                if (depth === 0) {
                    break;
                }
            }
            return key;
        }
        while (pos < input.length && /[\w$@\-.]/.test(input[pos])) {
            key += input[pos];
            pos++;
        }
        return key;
    };

    const parseValue = (): unknown => {
        skipWhitespace();
        const ch = input[pos];

        if (ch === "'" || ch === '"') {
            return parseString(ch);
        }
        if (ch === '{') {
            return parseObject();
        }
        if (ch === '[') {
            return parseArray();
        }

        let token = '';
        while (pos < input.length && /[\w.\-+]/.test(input[pos])) {
            token += input[pos];
            pos++;
        }

        if (token === 'true') {
            return true;
        }
        if (token === 'false') {
            return false;
        }
        if (token === 'null') {
            return null;
        }

        const num = Number(token);
        if (!Number.isNaN(num) && token !== '') {
            return num;
        }

        return token;
    };

    const parseArray = (): unknown[] => {
        pos++; // skip [
        const arr: unknown[] = [];
        skipWhitespace();
        while (pos < input.length && input[pos] !== ']') {
            const from = pos;
            arr.push(parseValue());
            skipWhitespace();
            if (input[pos] === ',') {
                pos++;
            }
            skipWhitespace();
            if (pos === from) {
                unexpected();
            }
        }
        pos++; // skip ]
        return arr;
    };

    const parseObject = (): Record<string, unknown> => {
        pos++; // skip {
        const obj: Record<string, unknown> = {};

        skipWhitespace();
        while (pos < input.length && input[pos] !== '}') {
            const from = pos;
            const key = parseKey();
            skipWhitespace();
            if (input[pos] === ':') {
                pos++;
            } // skip :
            const value = parseValue();
            // Defined, not assigned: assigning `__proto__` would set the
            // object's prototype instead of giving it that key.
            Object.defineProperty(obj, key, {
                value,
                enumerable: true,
                writable: true,
                configurable: true,
            });
            skipWhitespace();
            if (input[pos] === ',') {
                pos++;
            }
            skipWhitespace();
            if (pos === from) {
                unexpected();
            }
        }
        pos++; // skip }

        return obj;
    };

    skipWhitespace();
    return parseObject();
}
