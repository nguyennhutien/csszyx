/**
 * A comma-separated list of globs, as the `--ignore` flags take one.
 *
 * @module
 */
import { withPosixSeparators } from './utils/posix-path.js';

/** The closer each glob group opens with: a brace set, a bracket class, an extglob. */
const GROUP_CLOSERS: Readonly<Record<string, string>> = { '{': '}', '[': ']', '(': ')' };

/**
 * The positions of the group characters that pair up.
 *
 * @param value - The option text.
 * @returns Index of every opener that a later closer of its own kind closes,
 * and of that closer.
 */
function pairedGroups(value: string): Set<number> {
    const paired = new Set<number>();
    const open: Array<{ index: number; closer: string }> = [];
    for (let index = 0; index < value.length; index++) {
        const char = value.charAt(index);
        const closer = GROUP_CLOSERS[char];
        const innermost = open.at(-1);
        if (closer !== undefined) {
            open.push({ index, closer });
        } else if (innermost?.closer === char) {
            open.pop();
            paired.add(innermost.index).add(index);
        }
    }
    return paired;
}

/**
 * Split one option value on the commas that separate globs.
 *
 * A comma inside a group is glob syntax and stays: a brace set `legacy/{a,b}/**`,
 * a bracket class `[a,b]`, an extglob `+(a,b)`. An opener with no partner is an
 * ordinary character, so it cannot hide the commas that follow it. Two passes
 * over the text, `O(n)` in its length.
 *
 * @param value - The option text.
 * @returns The globs, trimmed, without empty entries.
 */
function splitOne(value: string): string[] {
    const paired = pairedGroups(value);
    const entries: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < value.length; index++) {
        const char = value.charAt(index);
        if (paired.has(index)) {
            depth += char in GROUP_CLOSERS ? 1 : -1;
        } else if (char === ',' && depth === 0) {
            entries.push(value.slice(start, index));
            start = index + 1;
        }
    }
    entries.push(value.slice(start));
    return entries.map(entry => entry.trim()).filter(entry => entry !== '');
}

/**
 * A comma-separated glob option as a list.
 *
 * @param value - The option as the argument parser hands it over: the text,
 * or one text per occurrence when the flag was repeated.
 * @returns The globs with forward slashes, or undefined when the option was
 * not given. fast-glob and the ignore matcher both read a backslash as an
 * escape, so `legacy\**` typed in a Windows shell would match nothing.
 */
export function splitGlobList(value: string | readonly string[] | undefined): string[] | undefined {
    if (value === undefined || value === '') return undefined;
    return (typeof value === 'string' ? [value] : value).flatMap(entry =>
        splitOne(withPosixSeparators(String(entry))),
    );
}
