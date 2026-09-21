/**
 * What `@csszyx/unplugin` exports from its main entry.
 *
 * The entry re-exported whole implementation files, so every helper in them
 * was a name someone could import and semver would have to keep. The list
 * below is the package's promise; a name that belongs to one lane lives in
 * that lane's own entry (`./css-mangler`, `./next`, `./postcss`, …).
 */
import { describe, expect, it } from 'vitest';

import * as entry from '../src/index.js';

const PUBLIC = [
    'default',
    'esbuildPlugin',
    'hasTokens',
    'parseThemeBlocks',
    'rollupPlugin',
    'unplugin',
    'vitePlugin',
    'webpackPlugin',
];

describe('the package entry', () => {
    it('exports the names it promises, and nothing else', () => {
        expect(Object.keys(entry).sort()).toEqual(PUBLIC);
    });

    it('still gives the bundler plugins and the theme readers the CLI uses', () => {
        expect({
            unplugin: typeof entry.unplugin,
            vite: typeof entry.vitePlugin,
            webpack: typeof entry.webpackPlugin,
            rollup: typeof entry.rollupPlugin,
            esbuild: typeof entry.esbuildPlugin,
            theme: typeof entry.parseThemeBlocks,
            tokens: typeof entry.hasTokens,
        }).toEqual({
            unplugin: 'object',
            vite: 'function',
            webpack: 'function',
            rollup: 'function',
            esbuild: 'function',
            theme: 'function',
            tokens: 'function',
        });
    });
});
