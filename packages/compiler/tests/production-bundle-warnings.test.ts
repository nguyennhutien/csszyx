/**
 * What a production app bundle keeps of the browser entry's warnings.
 *
 * Every `sz` warning the compiler prints is a usage nudge for something it
 * already handled (ADR 0011, "warning nào được sống ở production"), so none of
 * them belongs in a production bundle. A guard only drops its warning there
 * when the bundler can fold it: `process.env.NODE_ENV` written at the call
 * site is replaced and the branch removed, a guard hidden inside a helper call
 * is not, and the message text ships to every user.
 *
 * The bundle is built the way an app builds it — tree-shaken, minified,
 * `NODE_ENV` defined as production — so this measures what users download, not
 * what the package contains.
 */
import path from 'node:path';

import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

const ENTRY = path.resolve(import.meta.dirname, '../src/transform-core.ts');

/**
 * Bundle the browser entry as an app would.
 * @param nodeEnv - The `process.env.NODE_ENV` the app is built with.
 * @returns The minified bundle.
 */
function appBundle(nodeEnv: 'production' | 'development'): string {
    const result = buildSync({
        entryPoints: [ENTRY],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        minify: true,
        treeShaking: true,
        define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) },
        logLevel: 'silent',
    });
    return result.outputFiles[0]?.text ?? '';
}

/**
 * The opening words of each console message left in a bundle.
 * @param code - A bundle.
 * @returns One entry per `console.warn` / `console.error` call.
 */
function consoleMessages(code: string): string[] {
    return [...code.matchAll(/console\.(?:warn|error)\(\s*[`'"]([^`'"$]{0,60})/g)].map(
        ([, head]) => head ?? '',
    );
}

/** Warnings that report csszyx's own output as wrong; none ship from this entry today. */
const PRODUCTION_WARNINGS: readonly string[] = [];

describe('the browser entry in a production app bundle', () => {
    it('keeps no usage warning', () => {
        expect(consoleMessages(appBundle('production'))).toEqual(PRODUCTION_WARNINGS);
    });

    it('keeps them in a development bundle, so the check above has something to remove', () => {
        expect(consoleMessages(appBundle('development')).length).toBeGreaterThan(10);
    });
});
