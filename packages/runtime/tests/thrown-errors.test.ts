/**
 * Every error the runtime throws carries its registry code (ADR 0031 §5, PR C).
 *
 * A caller matches on `err.code` and recognises the error with
 * `isCsszyxError`, re-exported here so an app that installs only
 * `@csszyx/runtime` can reach it. The class it caught before still matches:
 * `SzDepthError` stays an `SzDepthError`, and a `TypeError` stays a
 * `TypeError`. The message is the registry's full form in development and the
 * compact line in production; a throw the registry marks development-only
 * does not happen in production at all.
 */
import { SzDepthError } from '@csszyx/compiler/sz-limits';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { productionMessage, runtimeMessage } from '../../compiler/tests/engine-message.js';
import { _sz as coreSz } from '../src/core.js';
import { computeMangleChecksumAsync, isCsszyxError } from '../src/index.js';
import { _sz as liteSz, _szMerge as liteSzMerge } from '../src/lite.js';
import { registerSzClassPrefix, setSzClassPrefix, setSzLowering } from '../src/lowering-slot.js';
import { _szMerge } from '../src/merge.js';
import { splitBoxSz } from '../src/split-box.js';
import { szv } from '../src/variants.js';
import { WEB_CRYPTO_LINE } from './helpers/hydration-lines.js';

interface PrefixGlobals {
    __csszyx_class_prefix?: string;
    __csszyx_class_prefix_registration?: { readonly value: string | null };
}

const globals = globalThis as typeof globalThis & PrefixGlobals;

afterEach(() => {
    process.env.NODE_ENV = 'test';
    setSzLowering(null);
    setSzClassPrefix(null);
    delete globals.__csszyx_class_prefix;
    delete globals.__csszyx_class_prefix_registration;
    vi.unstubAllGlobals();
});

/**
 * What a call threw, synchronously.
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

/**
 * The code, args and message of a thrown csszyx error, after checking it is one.
 *
 * @param error - What was thrown.
 * @returns Its fields.
 */
function fieldsOf(error: unknown): { code: string; args: object; message: string } {
    expect(isCsszyxError(error)).toBe(true);
    const { code, args, message } = error as { code: string; args: object; message: string };
    return { code, args, message };
}

/**
 * A value nested past the depth limit, as an array and as an sz object.
 * @param n
 */
/**
 * An array nested past the depth limit.
 * @param n - How deep.
 * @returns The array.
 */
function nestedArray(n: number): unknown {
    let value: unknown = ['p-4'];
    for (let i = 0; i < n; i++) value = [value];
    return value;
}

/**
 * An sz object nested past the depth limit.
 * @param n - How deep.
 * @returns The object.
 */
function nestedObject(n: number): Record<string, unknown> {
    let value: Record<string, unknown> = { p: 4 };
    for (let i = 0; i < n; i++) value = { hover: value };
    return value;
}

const DEPTH_ARGS = { form: 'value', maxDepth: 32 };
const DEPTH_LINE = runtimeMessage(
    'sz-object-depth',
    'This `sz` value nests deeper than 32 levels, so csszyx rejects it.',
    'help: check what reaches the `sz` prop; nesting this deep usually means untrusted or looping data.',
);

describe.each([
    ['development', false],
    ['production', true],
])('in %s', (_mode, production) => {
    /**
     * The message one code reads in this mode.
     *
     * @param code - The code.
     * @param args - Its args.
     * @param line - The development line.
     * @returns The message.
     */
    const expected = (code: string, args: object, line: string) =>
        production ? productionMessage(code, args) : line;
    const mode = () => {
        process.env.NODE_ENV = production ? 'production' : 'development';
    };

    it('an object with no lowering module throws lowering-not-loaded', () => {
        mode();
        const error = thrown(() => coreSz({ p: 4 }));
        expect(error).toBeInstanceOf(Error);
        expect(fieldsOf(error)).toEqual({
            code: 'lowering-not-loaded',
            args: {},
            message: expected(
                'lowering-not-loaded',
                {},
                runtimeMessage(
                    'lowering-not-loaded',
                    'A string helper received an sz object, but the module that turns sz objects into class names is not loaded, so it cannot produce class names for it.',
                    "help: add `import '@csszyx/runtime/lowering';` once at startup when the code runs outside the csszyx bundler plugin, such as in unit tests or scripts; the plugin loads it for files that can pass objects at runtime.",
                ),
            ),
        });
    });

    it.each([
        ['two prefixes', 'tw', 'ui', { form: 'prefixes', first: 'tw', second: 'ui' }],
        ['a prefix, then none', 'tw', null, { form: 'unprefixed', first: 'tw' }],
        ['none, then a prefix', null, 'tw', { form: 'unprefixed', first: 'tw' }],
    ] as const)('%s throw runtime-prefix-conflict', (_name, first, second, args) => {
        mode();
        registerSzClassPrefix(first);
        const error = thrown(() => registerSzClassPrefix(second));
        const text =
            args.form === 'prefixes'
                ? 'Two builds sharing one JavaScript runtime registered the Tailwind prefixes `tw` and `ui`, so csszyx cannot tell which prefix their classes take.'
                : 'Two builds sharing one JavaScript runtime registered different Tailwind prefixes, `tw` and none, so csszyx cannot tell which prefix their classes take.';
        expect(fieldsOf(error)).toEqual({
            code: 'runtime-prefix-conflict',
            args,
            message: expected(
                'runtime-prefix-conflict',
                args,
                runtimeMessage(
                    'runtime-prefix-conflict',
                    text,
                    'help: keep independently configured applications on separate `@csszyx/runtime` instances, or align their Tailwind prefix.',
                ),
            ),
        });
    });

    it.each([
        ['_sz, from core', () => coreSz(nestedArray(5000) as never)],
        ['_szMerge', () => _szMerge(nestedArray(5000) as never)],
        [
            'szv',
            () => {
                const deep = nestedObject(5000);
                szv({ base: deep, variants: { v: { on: deep } } } as never)({ v: 'on' } as never);
            },
        ],
        ['splitBoxSz', () => splitBoxSz(nestedArray(5000) as never)],
    ])('%s throws an SzDepthError with the sz-object-depth code', (_name, run) => {
        mode();
        const error = thrown(run);
        expect(error).toBeInstanceOf(SzDepthError);
        expect(fieldsOf(error)).toEqual({
            code: 'sz-object-depth',
            args: DEPTH_ARGS,
            message: expected('sz-object-depth', DEPTH_ARGS, DEPTH_LINE),
        });
    });

    it('a page without Web Crypto throws web-crypto-unavailable', async () => {
        mode();
        vi.stubGlobal('crypto', { subtle: undefined });
        const error = await computeMangleChecksumAsync({ 'p-4': 'a' }).catch(e => e);
        expect(error).toBeInstanceOf(Error);
        expect(fieldsOf(error)).toEqual({
            code: 'web-crypto-unavailable',
            args: {},
            message: expected('web-crypto-unavailable', {}, WEB_CRYPTO_LINE),
        });
    });
});

describe('a class string passed to splitBoxSz', () => {
    it('throws a TypeError with the split-box-sz-string code in development', () => {
        process.env.NODE_ENV = 'development';
        const error = thrown(() => splitBoxSz('p-4 m-2'));
        expect(error).toBeInstanceOf(TypeError);
        expect(fieldsOf(error)).toEqual({
            code: 'split-box-sz-string',
            args: { value: 'p-4 m-2' },
            message: runtimeMessage(
                'split-box-sz-string',
                '`splitBoxSz` partitions sz objects, not class strings, so it cannot split `p-4 m-2`.',
                'help: use `splitBox()` for a class string.',
                'note: a production build drops the string instead of throwing.',
            ),
        });
    });

    it('is dropped in production, as its note says', () => {
        process.env.NODE_ENV = 'production';
        expect(() => splitBoxSz('p-4 m-2')).not.toThrow();
    });
});

describe('an object passed to a lite helper', () => {
    const line = (fnName: string) =>
        runtimeMessage(
            'lite-sz-object',
            `\`${fnName}()\` takes class strings and received the plain object \`{"p":4}\`, because the compiler could not resolve this \`sz\` prop at build time.`,
            "help: write `sz={[cond ? varA : varB, { key: 'val' }]}`; a spread of a conditional, such as `sz={{ ...(cond ? varA : varB), key: 'val' }}`, is the usual cause.",
            'note: a production build skips this check: `_sz` returns the object, or `[object Object]` beside other classes, and `_szMerge` throws a `TypeError`.',
        );

    it.each([
        ['_sz', () => liteSz({ p: 4 } as never)],
        ['_sz', () => liteSz('a', { p: 4 } as never)],
        ['_szMerge', () => liteSzMerge({ p: 4 } as never)],
    ])('%s throws lite-sz-object in development', (fnName, run) => {
        process.env.NODE_ENV = 'development';
        const error = thrown(run);
        expect(error).toBeInstanceOf(Error);
        expect(fieldsOf(error)).toEqual({
            code: 'lite-sz-object',
            args: { fnName, received: '{"p":4}' },
            message: line(fnName),
        });
    });
});
