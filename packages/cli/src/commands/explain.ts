/**
 * csszyx explain — print the Tailwind className(s) an sz object compiles to.
 *
 * A verification one-liner: paste an sz object literal and see exactly what
 * csszyx emits, without setting up a build or grepping the bundle.
 *
 *   csszyx explain "{ p: 4, bg: 'blue-500', hover: { bg: 'blue-700' } }"
 *   → p-4 bg-blue-500 hover:bg-blue-700
 *
 * The literal is placed on one element of a synthesized module and lowered by
 * the engine the build runs, so the answer is the build's answer: the class it
 * writes, the style variable it sets at runtime, the diagnostics it reports, or
 * the `_sz()` call it leaves when it cannot resolve the object. This command
 * used to read the literal with a TypeScript walker and lower it with the
 * runtime transform, a second definition of static that disagreed with the
 * build on shapes as plain as `{ p: +4 }` and `{ p: [4] }`.
 *
 * No eval is used: the engine reads the literal as source, never executes it.
 */

import { renderUnplacedDiagnostic, type SourceTransformResult } from '@csszyx/compiler';
import { transformSource } from '@csszyx/compiler/engine';
import { CsszyxError } from '@csszyx/compiler/errors';
import { findEmittedClassName } from '@csszyx/compiler/internal';

import { registryMessage } from '../utils/registry-words.js';
import { printError, printInfo, printWarn } from '../utils/terminal-ui.js';

/** Why `csszyx explain` refuses its input, by the registry's ids and args. */
export type ExplainParseFailure =
    | { readonly code: 'parse-error'; readonly args: { readonly form: 'expression' } }
    | {
          readonly code: 'explain-input-invalid';
          readonly args:
              | { readonly form: 'not-one-expression'; readonly input: string }
              | {
                    readonly form: 'runtime-only';
                    readonly input: string;
                    readonly diagnostics?: readonly string[];
                };
      };

/**
 * Thrown when the argument is not an sz object the build resolves to classes.
 * A csszyx error: `parse-error` for input that does not parse,
 * `explain-input-invalid` for one that is not one sz expression the build
 * lowers.
 */
export class ExplainParseError extends CsszyxError {
    /**
     * @param failure - Its registry id and args; the message is the
     *        registry's words for them.
     */
    constructor(failure: ExplainParseFailure) {
        // No place: the synthesized module's file and positions mean nothing
        // to the reader.
        super({ ...failure, message: registryMessage(failure) });
        this.name = 'ExplainParseError';
    }
}

/** One engine artifact, or the selection a build makes between them. */
export type ExplainEngine = (source: string, filename?: string) => SourceTransformResult;

/** What the build does with one sz object. */
export interface SzExplanation {
    /** The className the build writes; empty when the object yields no class. */
    className: string;
    /** Custom properties the build sets through `style`, whose values are read at runtime. */
    runtimeValues: string[];
    /** The engine's diagnostics for the object, without the synthesized location. */
    diagnostics: string[];
}

/** Name of the synthesized module; it appears in nothing the user reads. */
const FILENAME = 'sz.tsx';
const PREFIX = 'export const A = () => <div sz={';
const SUFFIX = '} />;\n';

/**
 * Read the className attribute the engine wrote on the synthesized element.
 * @param code - The engine's output for the synthesized module.
 * @returns The static className, `''` for none, or null when the build left
 *          the object to the runtime.
 */
function emittedClassName(code: string): string | null {
    return findEmittedClassName(code)?.className ?? null;
}

/**
 * Resolve an sz object literal to what the build emits for it.
 * @param input - The sz object literal source, e.g. "{ p: 4, bg: 'blue-500' }".
 * @param engine - The engine artifact to lower with; the build's own choice by default.
 * @returns The className, runtime style variables and diagnostics.
 * @throws {ExplainParseError} when the input does not parse, is more than one
 *         expression, or is left to the runtime `_sz()` helper.
 */
export function explainSz(input: string, engine: ExplainEngine = transformSource): SzExplanation {
    const result = engine(`${PREFIX}${input}${SUFFIX}`, FILENAME);
    if (result.issues?.some(issue => issue.code === 'parse-error')) {
        throw new ExplainParseError({ code: 'parse-error', args: { form: 'expression' } });
    }
    // Rendered without a place: the synthesized module's file and positions
    // mean nothing to the reader.
    const diagnostics = (result.issues ?? []).map(renderUnplacedDiagnostic);
    if (result.code.match(/ (?:className|sz)=[{"]/g)?.length !== 1) {
        throw new ExplainParseError({
            code: 'explain-input-invalid',
            args: { form: 'not-one-expression', input },
        });
    }
    const className = emittedClassName(result.code);
    if (className === null) {
        // The diagnostics are whole messages of their own, so they stay in
        // `args` for the command to print under this one, not in its words.
        throw new ExplainParseError({
            code: 'explain-input-invalid',
            args: {
                form: 'runtime-only',
                input,
                ...(diagnostics.length > 0 ? { diagnostics } : {}),
            },
        });
    }
    const runtimeValues = [...result.code.matchAll(/"(--_sz-[\w-]+)":/g)].map(match => match[1]);
    return { className, runtimeValues, diagnostics };
}

/**
 * `csszyx explain` command — prints the className for an sz object literal.
 * @param sz - The sz object literal source string.
 */
export function explain(sz: string): void {
    let explained: SzExplanation;
    try {
        explained = explainSz(sz);
    } catch (error) {
        process.exitCode = 1;
        if (!(error instanceof ExplainParseError)) {
            printError(`Could not explain sz: ${String(error)}`);
            return;
        }
        // The registry's words carry their own header, so no mark of ours.
        console.log(error.message);
        const { diagnostics = [] } = error.args as { diagnostics?: readonly string[] };
        for (const diagnostic of diagnostics) printWarn(diagnostic);
        return;
    }
    console.log(explained.className === '' ? '(no classes)' : explained.className);
    for (const name of explained.runtimeValues) {
        printInfo(`${name} is set through the style attribute at runtime; the class reads it.`);
    }
    for (const diagnostic of explained.diagnostics) printWarn(diagnostic);
}
