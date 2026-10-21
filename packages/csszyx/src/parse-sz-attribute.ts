/**
 * The `sz` attribute parser of the CDN runtime, apart from `browser.ts` so it
 * can be tested without that module's load-time DOM walk.
 *
 * @module
 */

import { brandCsszyxError } from '@csszyx/compiler/errors';
import { SZ_ATTRIBUTE_SYNTAX, szRender } from '@csszyx/compiler/report';

/** What an `sz-attribute-syntax` error names, as the registry types it. */
export type SzAttributeSyntaxArgs = NonNullable<(typeof SZ_ATTRIBUTE_SYNTAX)['argsType']>;

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
    const leading = rawInput.length - rawInput.trimStart().length;
    const offset = leading - (wrapped ? 1 : 0);

    // Where the author's text ends in `input`: before the `}` added around
    // brace-less input, which is never the character a report names.
    const end = wrapped ? input.length - 1 : input.length;
    let pos = 0;

    // The error stays a `SyntaxError` and carries the code and args of the
    // runtime's line (`sz-attribute-syntax`). A key that never reaches its
    // `:` runs `pos` off the end, or onto the added `}`, where there is no
    // character of the author's to name, so the line names where the
    // attribute ends instead.
    const unexpected = (): never => {
        const args: SzAttributeSyntaxArgs =
            pos < end
                ? { form: 'char', input: rawInput, char: input[pos] as string, index: pos + offset }
                : { form: 'end', input: rawInput, index: leading + trimmed.length };
        throw brandCsszyxError(
            new SyntaxError(
                process.env.NODE_ENV !== 'production'
                    ? szRender({ diagnostic: SZ_ATTRIBUTE_SYNTAX, args })
                    : `[csszyx] sz-attribute-syntax: ${JSON.stringify(args)} https://csszyx.com/e/sz-attribute-syntax`,
            ),
            { code: 'sz-attribute-syntax', args },
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
            // A key always takes a value. Without the colon the text is a
            // class list (`flex gap-2`), which the caller falls back to,
            // rather than one key with a bare value (`flex-gap-2`).
            if (input[pos] !== ':') {
                unexpected();
            }
            pos++;
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
