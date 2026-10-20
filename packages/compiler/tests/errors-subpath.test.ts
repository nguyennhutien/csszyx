/**
 * `@csszyx/compiler/errors` — the error csszyx throws and its guard, as a
 * built subpath.
 *
 * `@csszyx/runtime` and `csszyx` re-export `isCsszyxError` from here, and the
 * runtime ships CommonJS too, so the subpath is published in both formats.
 * `SzDepthError`, from `./sz-limits`, has to extend the class this subpath
 * hands out: a copy would make `instanceof CsszyxError` false for the error
 * the transform throws.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

type SubpathExport = {
    import: { types: string; default: string };
    require: { types: string; default: string };
};

/**
 * Load a built entry the way a bundler resolves the subpath.
 *
 * @param subpath - The subpath, without the package name.
 * @returns Its namespace.
 */
async function load(subpath: string): Promise<Record<string, unknown>> {
    // Held in a variable so the test transform does not resolve it ahead of time.
    const specifier = `@csszyx/compiler/${subpath}`;
    return (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
}

describe('@csszyx/compiler/errors subpath', () => {
    it('is published in both module formats', () => {
        const pkg = JSON.parse(
            readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
        ) as { exports: Record<string, SubpathExport> };
        expect(pkg.exports['./errors']).toEqual({
            import: { types: './dist/errors.d.mts', default: './dist/errors.mjs' },
            require: { types: './dist/errors.d.cts', default: './dist/errors.cjs' },
        });
    });

    it('exports the class, the guard and the brand helper, by name', async () => {
        const errors = await load('errors');
        expect(Object.keys(errors).sort()).toEqual([
            'CsszyxError',
            'brandCsszyxError',
            'isCsszyxError',
        ]);
    });

    it('is the class SzDepthError extends, in the ES build', async () => {
        const errors = await load('errors');
        const limits = await load('sz-limits');
        const SzDepthError = limits.SzDepthError as new () => Error;
        expect(new SzDepthError()).toBeInstanceOf(errors.CsszyxError as new () => Error);
    });

    it('is the class SzDepthError extends, in the CommonJS build', () => {
        const require = createRequire(import.meta.url);
        const errors = require('@csszyx/compiler/errors') as Record<string, unknown>;
        const limits = require('@csszyx/compiler/sz-limits') as Record<string, unknown>;
        const SzDepthError = limits.SzDepthError as new () => Error;
        const error = new SzDepthError();
        expect(error).toBeInstanceOf(errors.CsszyxError as new () => Error);
        expect((errors.isCsszyxError as (value: unknown) => boolean)(error)).toBe(true);
    });
});
