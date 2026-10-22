/**
 * The esbuild options both CDN bundles are written from (`cdn-build.mjs`).
 * `browser-bundle.test.ts` runs the bundles they write; this pins what each
 * mode defines, which is the only difference between the two files.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CDN_BUNDLES, cdnBuildOptions, INSTALLED_RESOLUTION } from '../cdn-build.mjs';

describe('the CDN bundle build options', () => {
    it('writes one production and one development bundle', () => {
        expect(CDN_BUNDLES).toEqual([
            { file: 'browser.iife.js', mode: 'production' },
            { file: 'browser.dev.iife.js', mode: 'development' },
        ]);
    });

    it('builds the browser entry as an installed package resolves it', () => {
        const options = cdnBuildOptions('production');
        expect(options.entryPoints).toEqual([
            path.resolve(import.meta.dirname, '../src/browser.ts'),
        ]);
        expect(options).toMatchObject({ ...INSTALLED_RESOLUTION, format: 'iife', bundle: true });
        // The repository's tsconfig `paths` stay out, so `@csszyx/compiler`
        // resolves to its `dist`.
        expect(INSTALLED_RESOLUTION).toEqual({ tsconfigRaw: '{}' });
    });

    it('lets only the development bundle print the sz warnings in the browser', () => {
        const flag = 'globalThis.__CSSZYX_SZ_WARNINGS_IN_BROWSER__';
        const development = cdnBuildOptions('development').define;
        const production = cdnBuildOptions('production').define;
        expect(development).toMatchObject({
            'process.env.NODE_ENV': '"development"',
            [flag]: 'true',
        });
        expect(production).toMatchObject({ 'process.env.NODE_ENV': '"production"' });
        expect(production).not.toHaveProperty([flag]);
        // A script-tag page has no `process`, so neither bundle reads it.
        for (const define of [development, production]) {
            expect(define).toMatchObject({
                'process.env.CSSZYX_NO_PROJECT_SCAN_HINT': '"1"',
                'process.env.CSSZYX_QUIET_SZ_WARNINGS': 'undefined',
            });
        }
    });
});
