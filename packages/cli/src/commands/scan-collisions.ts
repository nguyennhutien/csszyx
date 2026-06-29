/**
 * `csszyx scan-collisions` — find class names in a project's own CSS/SCSS that
 * could collide with a mangled token, and print a paste-ready
 * `production.mangleExclude` list.
 *
 * Mangling renames csszyx-owned classes to short base62 tokens (`z`, `y`, `x`,
 * `b7`, …). Those tokens never contain `-` or `_`, so only SHORT, purely
 * alphanumeric class names in non-csszyx CSS can ever clash with one. A dev who
 * knows the project can fill `mangleExclude` by hand; a dev inheriting it runs
 * this to surface the risky names without reading every stylesheet.
 *
 * @module
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import fg from 'fast-glob';

import { printHeader, printInfo, printSuccess, printWarn, spinner } from '../utils/terminal-ui.js';

/** Options for the `scan-collisions` command. */
export interface ScanCollisionsOptions {
    /** Project root to scan. Defaults to `process.cwd()`. */
    cwd?: string;
    /** Glob of stylesheet files to scan. Defaults to CSS/SCSS/Sass/Less. */
    pattern?: string;
    /** Extra ignore globs appended to the defaults. */
    ignore?: string[];
}

const DEFAULT_IGNORE = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/.astro/**',
];

// A class selector: `.name`. Captures the name; a following `-`/`_`/word char keeps
// the whole name so `.main-body` is read in full (and then rejected as too long /
// non-token-shaped below), not truncated to `.main`.
const CLASS_SELECTOR_RE = /\.(-?[a-z_][\w-]*)/gi;

/**
 * Remove the parts of a stylesheet where a `.foo` is NOT a class selector —
 * comments, `url(...)` contents, and string literals — so things like a comment
 * note (`.z`), an `@import 'theme.css'`, or `url(hero.png)` are not mistaken for
 * collision-prone class names.
 *
 * @param css - raw stylesheet text.
 * @returns text with non-selector regions blanked out.
 */
function stripNonSelectorText(css: string): string {
    return (
        css
            // /* block */ and // line comments (SCSS/Less).
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/\/\/[^\n]*/g, ' ')
            // url(...) — may be unquoted, e.g. url(hero.png).
            .replace(/url\([^)]*\)/gi, ' ')
            // 'single' and "double" quoted strings (@import paths, content, etc.).
            .replace(/'[^']*'/g, ' ')
            .replace(/"[^"]*"/g, ' ')
    );
}

/**
 * True when `name` has the shape of a mangle token — short and purely
 * alphanumeric (base62, starting with a letter). Tokens never contain `-`/`_`,
 * so any class carrying those can never collide and is excluded here. The length
 * cap of 3 covers the realistic token tiers (single letter through letter+two);
 * longer external class names are vanishingly unlikely to be reached.
 *
 * @param name - the class name to test.
 * @returns whether the name could collide with a mangled token.
 */
function looksLikeToken(name: string): boolean {
    return /^[a-z][a-z0-9]{0,2}$/i.test(name);
}

/**
 * Scan the project's stylesheets for class names that could collide with a
 * mangled token and print a paste-ready `mangleExclude` list. Sets
 * `process.exitCode` to 1 when any risk is found so it can gate CI.
 *
 * @param options - scan options.
 */
export async function scanCollisions(options: ScanCollisionsOptions = {}): Promise<void> {
    const cwd = options.cwd ?? process.cwd();
    const patterns = options.pattern ? [options.pattern] : ['**/*.{css,scss,sass,less}'];
    const ignore = [...DEFAULT_IGNORE, ...(options.ignore ?? [])];

    printHeader('csszyx scan-collisions — mangle token risks');

    const s = spinner.start('Scanning stylesheets...');
    let files: string[];
    try {
        files = await fg(patterns, { cwd, ignore, absolute: true });
    } catch (err) {
        s.fail('Stylesheet scan failed');
        printWarn(`Could not scan files: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
    }
    s.succeed(`Scanned ${files.length} stylesheet(s)`);

    // name → set of files it appears in.
    const risky = new Map<string, Set<string>>();
    for (const file of files) {
        let css: string;
        try {
            css = await readFile(file, 'utf8');
        } catch {
            continue;
        }
        const rel = path.relative(cwd, file);
        for (const match of stripNonSelectorText(css).matchAll(CLASS_SELECTOR_RE)) {
            const name = match[1];
            if (looksLikeToken(name)) {
                (risky.get(name) ?? risky.set(name, new Set()).get(name))?.add(rel);
            }
        }
    }

    if (risky.size === 0) {
        printSuccess('No collision-prone class names found — mangling is safe to enable.');
        return;
    }

    const names = [...risky.keys()].sort();
    printWarn(`${names.length} class name(s) could collide with a mangled token:`);
    for (const name of names) {
        const where = [...(risky.get(name) ?? [])].slice(0, 3).join(', ');
        printInfo(`  .${name}  (in ${where})`);
    }
    printInfo('\nAdd these to your csszyx config to keep mangling safe:');
    printInfo(`  production: { mangle: true, mangleExclude: ${JSON.stringify(names)} }`);
    process.exitCode = 1;
}
