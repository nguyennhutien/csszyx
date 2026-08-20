/**
 * csszyx explain — print the Tailwind className(s) an sz object compiles to.
 *
 * A verification one-liner: paste an sz object literal and see exactly what
 * csszyx emits, without setting up a build or grepping the bundle.
 *
 *   csszyx explain "{ p: 4, bg: 'blue-500', hover: { bg: 'blue-700' } }"
 *   → p-4 bg-blue-500 hover:bg-blue-700
 *
 * The literal is read by `explainStaticObjectLiteral`, the same function the
 * Vue and Svelte adapters use, so what counts as "static" here is what counts
 * as static everywhere else. This command previously carried its own walker
 * over a second parser, which meant two definitions of dynamic that could
 * disagree — and a 4 MB parser in the CLI for one expression.
 *
 * No eval is used: the literal is read from a syntax tree, never executed.
 */

import { explainStaticObjectLiteral, transform } from '@csszyx/compiler';

import { printError } from '../utils/terminal-ui.js';

/** Thrown when the argument is not a statically-resolvable sz object literal. */
export class ExplainParseError extends Error {}

/**
 * Resolve an sz object literal string to the Tailwind className it compiles to.
 * @param input - The sz object literal source, e.g. "{ p: 4, bg: 'blue-500' }".
 * @returns The compiled className string.
 */
export function explainSz(input: string): string {
    const parsed = explainStaticObjectLiteral(input);
    if (!('value' in parsed)) throw new ExplainParseError(parsed.reason);
    const result = transform(parsed.value);
    return typeof result === 'string' ? result : result.className;
}

/**
 * `csszyx explain` command — prints the className for an sz object literal.
 * @param sz - The sz object literal source string.
 */
export function explain(sz: string): void {
    let className: string;
    try {
        className = explainSz(sz);
    } catch (error) {
        const reason = error instanceof ExplainParseError ? error.message : String(error);
        printError(`Could not explain sz: ${reason}`);
        process.exitCode = 1;
        return;
    }
    console.log(className === '' ? '(no classes)' : className);
}
