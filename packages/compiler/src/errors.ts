/**
 * `@csszyx/compiler/errors`: the error csszyx throws, and how to recognise one
 * (ADR 0031 §5).
 *
 * A csszyx error carries `code`, an id of the diagnostic registry with a page
 * at `https://csszyx.com/e/<code>`, and `args`, the values its message names.
 * `err.code` is what a caller matches on. {@link isCsszyxError} recognises one
 * by a brand under `Symbol.for('csszyx.error')` rather than by its class, so
 * an error from a second copy of the compiler, or from `@csszyx/core/native`
 * (which writes the same brand itself, since it cannot import this module),
 * is recognised too, where `instanceof` would say no.
 *
 * The class formats nothing: a site passes the final message, the registry's
 * words in development and the compact line in production, so a production
 * bundle carries no sentence (`szRender`, `@csszyx/compiler/report`).
 *
 * Browser-safe and dependency-free.
 *
 * @module errors
 */

import type { SzErrorCode } from './diagnostic-codes.generated.js';

/** The key a csszyx error is branded under, shared by every copy of csszyx. */
const BRAND = Symbol.for('csszyx.error');

/**
 * The values a csszyx error's message names, as the registry declares its
 * args; an optional one the error has nothing for is absent.
 */
export type CsszyxErrorArgs = Readonly<
    Record<string, string | number | readonly string[] | undefined>
>;

/** What every csszyx error carries, whatever class it is. */
export interface CsszyxErrorFields {
    /** The registry id: the page `https://csszyx.com/e/<code>` explains it. */
    readonly code: SzErrorCode;
    /** The values its message names, by the registry's arg names. */
    readonly args: CsszyxErrorArgs;
    /** The error this one wraps, when it wraps one. */
    readonly cause?: unknown;
}

/** What to construct a {@link CsszyxError} from. */
export interface CsszyxErrorOptions {
    /** The registry id. */
    readonly code: SzErrorCode;
    /** The values its message names. */
    readonly args: CsszyxErrorArgs;
    /** The final message: the site words it, the class does not. */
    readonly message: string;
    /** The error this one wraps. */
    readonly cause?: unknown;
}

/**
 * Brand an error and set its code and args.
 *
 * @param error - The error.
 * @param fields - Its code and args.
 * @param fields.code - The registry id.
 * @param fields.args - The values its message names.
 */
function brand(error: Error, fields: { code: SzErrorCode; args: CsszyxErrorArgs }): void {
    Object.assign(error, { [BRAND]: true, code: fields.code, args: fields.args });
}

/**
 * An error csszyx throws, with its registry code and args. Match it with
 * {@link isCsszyxError} and `err.code`, not `instanceof`: two copies of the
 * compiler in one app have two classes.
 */
export class CsszyxError extends Error implements CsszyxErrorFields {
    declare readonly code: SzErrorCode;
    declare readonly args: CsszyxErrorArgs;
    declare readonly cause?: unknown;

    /**
     * @param options - The code, the args, the final message, and the error it wraps.
     */
    constructor(options: CsszyxErrorOptions) {
        super(options.message);
        this.name = 'CsszyxError';
        brand(this, options);
        // As `new Error(message, { cause })` sets it: own, not enumerable, and
        // absent when nothing is wrapped.
        if (options.cause !== undefined) {
            Object.defineProperty(this, 'cause', {
                value: options.cause,
                writable: true,
                configurable: true,
            });
        }
    }
}

/**
 * Give a native error the code and args of a csszyx error without changing
 * its class, so a caller's `instanceof TypeError` or `instanceof SyntaxError`
 * still matches while {@link isCsszyxError} recognises it.
 *
 * @internal Shared by csszyx's own packages; not a stable API.
 * @param error - The error, with its final message.
 * @param fields - Its code and args.
 * @param fields.code - The registry id.
 * @param fields.args - The values its message names.
 * @returns The same error.
 */
export function brandCsszyxError<E extends Error>(
    error: E,
    fields: { readonly code: SzErrorCode; readonly args: CsszyxErrorArgs },
): E & CsszyxErrorFields {
    brand(error, fields);
    return error as E & CsszyxErrorFields;
}

/**
 * Whether a value is an error csszyx threw, by its brand: any class, from any
 * copy of csszyx.
 *
 * ```ts
 * try { szr(input); } catch (err) {
 *     if (isCsszyxError(err) && err.code === 'sz-object-depth') return '';
 *     throw err;
 * }
 * ```
 *
 * @param value - Anything caught.
 * @returns True when it carries the csszyx error brand.
 */
export function isCsszyxError(value: unknown): value is Error & CsszyxErrorFields {
    return (
        typeof value === 'object' &&
        value !== null &&
        (value as { [BRAND]?: unknown })[BRAND] === true
    );
}
