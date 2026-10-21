/**
 * The errors csszyx throws carry a registry code (ADR 0031 §5, PR C).
 *
 * `err.code` is the contract a caller matches on, `isCsszyxError` recognises
 * one by its brand (`Symbol.for('csszyx.error')`) so two copies of the
 * compiler still agree, and `instanceof` the class a caller already catches
 * keeps working: `SzDepthError` extends `CsszyxError`, and a `TypeError` or
 * `SyntaxError` keeps its native class and gets the brand attached. The
 * message is the registry's full form in development and the compact line in
 * production; the class itself formats nothing.
 */
import { CsszyxNativeUnavailableError } from '@csszyx/core/native';
import { afterEach, describe, expect, it } from 'vitest';

import { brandCsszyxError, CsszyxError, isCsszyxError } from '../src/errors.js';
import { SZ_OBJECT_DEPTH, szRender } from '../src/report.js';
import { MAX_SZ_DEPTH, SzDepthError } from '../src/sz-limits.js';
import { transform } from '../src/transform-core.js';
import { productionMessage, runtimeMessage } from './engine-message.js';

afterEach(() => {
    process.env.NODE_ENV = 'test';
});

/**
 * What a call threw.
 *
 * @param run - The call.
 * @returns The thrown value.
 */
function thrown(run: () => unknown): unknown {
    try {
        run();
    } catch (error) {
        return error;
    }
    throw new Error('expected the call to throw');
}

describe('CsszyxError', () => {
    it('carries the code, the args and the message it was given', () => {
        const error = new CsszyxError({
            code: 'lowering-not-loaded',
            args: {},
            message: '[csszyx] lowering-not-loaded: x',
        });
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('CsszyxError');
        expect(error.code).toBe('lowering-not-loaded');
        expect(error.args).toEqual({});
        expect(error.message).toBe('[csszyx] lowering-not-loaded: x');
        expect('cause' in error).toBe(false);
        expect(isCsszyxError(error)).toBe(true);
    });

    it('keeps the error it wraps as its cause', () => {
        const cause = new Error('inner');
        const error = new CsszyxError({
            code: 'dynamic-manifest-unreachable',
            args: { status: 404 },
            message: 'm',
            cause,
        });
        expect(error.cause).toBe(cause);
        expect(error.args).toEqual({ status: 404 });
    });

    it('is recognised by its brand, not its class, so a second copy agrees', () => {
        const foreign = Object.assign(new Error('x'), {
            code: 'lowering-not-loaded',
            args: {},
            [Symbol.for('csszyx.error')]: true,
        });
        expect(isCsszyxError(foreign)).toBe(true);
        expect(foreign).not.toBeInstanceOf(CsszyxError);
    });

    it.each([
        ['an Error', new Error('x')],
        ['an Error with a code', Object.assign(new Error('x'), { code: 'ENOENT' })],
        ['null', null],
        ['a string', '[csszyx] lowering-not-loaded: x'],
        ['an object with the brand set false', { [Symbol.for('csszyx.error')]: false }],
    ])('refuses %s', (_name, value) => {
        expect(isCsszyxError(value)).toBe(false);
    });
});

describe('a native error with the brand', () => {
    it('keeps its class and gets the code and args', () => {
        const error = brandCsszyxError(new TypeError('m'), {
            code: 'split-box-sz-string',
            args: { value: 'p-4' },
        });
        expect(error).toBeInstanceOf(TypeError);
        expect(error.name).toBe('TypeError');
        expect(error.code).toBe('split-box-sz-string');
        expect(error.args).toEqual({ value: 'p-4' });
        expect(isCsszyxError(error)).toBe(true);
    });
});

describe('the native loader error', () => {
    // `@csszyx/core/native` cannot import the compiler, so it writes the
    // brand's key itself; this is the check that the two keys are one.
    it('carries the same brand as CsszyxError', () => {
        const error = new CsszyxNativeUnavailableError({
            form: 'no-platform-package',
            platform: 'freebsd-x64',
        });
        expect(isCsszyxError(error)).toBe(true);
        expect(error.code).toBe('native-engine-unavailable');
        expect(error.args).toEqual({ form: 'no-platform-package', platform: 'freebsd-x64' });
    });
});

/** `sz-object-depth` as a value deeper than the limit reports it. */
const DEPTH_ARGS = { form: 'value', maxDepth: MAX_SZ_DEPTH } as const;
const DEPTH_LINE = runtimeMessage(
    'sz-object-depth',
    `This \`sz\` value nests deeper than ${MAX_SZ_DEPTH} levels, so csszyx rejects it.`,
    'help: check what reaches the `sz` prop; nesting this deep usually means untrusted or looping data.',
);

describe('szRender', () => {
    it('returns what szReport prints, without printing it', () => {
        expect(szRender({ diagnostic: SZ_OBJECT_DEPTH, args: DEPTH_ARGS })).toBe(DEPTH_LINE);
    });
});

/**
 * A value nested past the depth limit.
 *
 * @param n - How deep.
 * @returns The value.
 */
function nested(n: number): Record<string, unknown> {
    let value: Record<string, unknown> = { p: 4 };
    for (let i = 0; i < n; i++) value = { hover: value };
    return value;
}

describe('SzDepthError', () => {
    it('is a CsszyxError with the sz-object-depth code', () => {
        const error = thrown(() => transform(nested(5000) as never));
        expect(error).toBeInstanceOf(SzDepthError);
        expect(error).toBeInstanceOf(CsszyxError);
        expect(isCsszyxError(error)).toBe(true);
        const depth = error as SzDepthError;
        expect(depth.name).toBe('SzDepthError');
        expect(depth.code).toBe('sz-object-depth');
        expect(depth.args).toEqual(DEPTH_ARGS);
        expect(depth.message).toBe(DEPTH_LINE);
    });

    it('names the limit it was given', () => {
        expect(new SzDepthError(4).args).toEqual({ form: 'value', maxDepth: 4 });
    });

    it('is the compact line in production', () => {
        process.env.NODE_ENV = 'production';
        expect(new SzDepthError().message).toBe(productionMessage('sz-object-depth', DEPTH_ARGS));
    });
});

describe('transform called the positional way', () => {
    const call = transform as unknown as (...args: unknown[]) => unknown;
    const LINE = runtimeMessage(
        'options-object-required',
        '`transform` takes its options in one object, so a second argument that is not an object, or a third argument, is refused.',
        "help: pass the prefix and the mangle map as keys: `transform(sz, { prefix: 'hover:', mangleMap })`.",
    );

    it.each([
        ['a string prefix', () => call({ p: 4 }, 'hover:')],
        ['a third argument', () => call({ p: 4 }, {}, { 'p-4': 'x' })],
        ['null', () => call({ p: 4 }, null)],
    ])('throws options-object-required for %s', (_name, run) => {
        const error = thrown(run);
        expect(error).toBeInstanceOf(CsszyxError);
        expect(isCsszyxError(error)).toBe(true);
        const coded = error as CsszyxError;
        expect(coded.code).toBe('options-object-required');
        expect(coded.args).toEqual({ form: 'transform' });
        expect(coded.message).toBe(LINE);
    });

    it('is the compact line in production', () => {
        process.env.NODE_ENV = 'production';
        const error = thrown(() => call({ p: 4 }, 'hover:')) as CsszyxError;
        expect(error.message).toBe(
            productionMessage('options-object-required', { form: 'transform' }),
        );
    });
});
