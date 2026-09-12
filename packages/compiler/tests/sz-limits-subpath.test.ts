/**
 * `@csszyx/compiler/sz-limits` — the three limits the runtime needs, alone.
 *
 * The runtime's `core` and `merge` entries need only `MAX_SZ_DEPTH`,
 * `SzDepthError` and `isForbiddenSzKey`. They used to import them through
 * `@csszyx/compiler/browser`, which is the whole browser transform: its shared
 * chunk builds the compiler's property tables at module level
 * (`new Set(Object.entries(…).filter(…))`), a bundler cannot prove those calls
 * pure, and so every app using `szr` or `szcn` downloaded tables nothing read.
 * Measured with esbuild the way the runtime size contract bundles: `core` 1,145 B
 * gzip against 568 B, `merge` 7,232 B against 6,705 B.
 *
 * A subpath of its own is what lets a bundle take the limits without the
 * tables. The class identity case is the one that matters for correctness: the
 * subpath and the browser transform must hand out the same `SzDepthError`, or
 * an error thrown by one would not be the type the other's callers expect.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Load both built entries the way a bundler resolves the subpaths.
 *
 * Dynamic, so a missing subpath fails the cases that need it rather than the
 * whole file at import time.
 *
 * @returns The two module namespaces.
 */
async function loadEntries(): Promise<{
    browser: Record<string, unknown>;
    limits: Record<string, unknown>;
}> {
    // Specifiers held in variables so the test transform does not try to
    // resolve them ahead of time: a subpath that is not exported yet should
    // fail the cases that load it, not stop the file from being collected.
    const browserEntry = '@csszyx/compiler/browser';
    const limitsEntry = '@csszyx/compiler/sz-limits';
    const browser = (await import(/* @vite-ignore */ browserEntry)) as Record<string, unknown>;
    const limits = (await import(/* @vite-ignore */ limitsEntry)) as Record<string, unknown>;
    return { browser, limits };
}

type SubpathExport = {
    import: { types: string; default: string };
    require: { types: string; default: string };
};

describe('@csszyx/compiler/sz-limits subpath', () => {
    it('is published beside the browser entry, in both module formats', () => {
        const pkg = JSON.parse(
            readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
        ) as {
            exports: Record<string, SubpathExport>;
        };

        expect(pkg.exports['./sz-limits']).toEqual({
            import: { types: './dist/sz-limits.d.mts', default: './dist/sz-limits.mjs' },
            require: { types: './dist/sz-limits.d.cts', default: './dist/sz-limits.cjs' },
        });
    });

    it('exports exactly the limits, and nothing that drags the transform in', async () => {
        const { limits } = await loadEntries();

        expect(Object.keys(limits).sort()).toEqual([
            'MAX_SZ_DEPTH',
            'SzDepthError',
            'isForbiddenSzKey',
        ]);
    });

    it('hands out the same limits the browser transform re-exports', async () => {
        const { browser, limits } = await loadEntries();

        // One class, not two copies: a copy would make `instanceof` disagree
        // between an error the transform throws and a check written against
        // the subpath.
        expect(limits.SzDepthError).toBe(browser.SzDepthError);
        expect(limits.isForbiddenSzKey).toBe(browser.isForbiddenSzKey);
        expect(limits.MAX_SZ_DEPTH).toBe(browser.MAX_SZ_DEPTH);
    });

    it('keeps the module free of the compiler tables it exists to avoid', () => {
        const source = readFileSync(new URL('../src/sz-limits.ts', import.meta.url), 'utf8');

        expect(source).not.toMatch(/^import /m);
    });
});
