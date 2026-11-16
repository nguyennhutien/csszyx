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

import { sortStrings } from '@csszyx/compiler';
import { readTextFiles } from '@csszyx/tailwind-oracle';
import { cssOpaqueEnd } from '@csszyx/tailwind-oracle/css-comments';
import fg from 'fast-glob';
import { relativePosix, withPosixSeparators } from '../utils/posix-path.js';
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

/**
 * Directories a tool writes into, never a project's own stylesheets.
 *
 * Reported from the field: run in a package that had once collected coverage,
 * the command found 32 names and 30 of them were istanbul's HTML report —
 * `.L0` through `.L9`, `.kwd`, `.pun`, `.typ`, the syntax highlighter it ships.
 * The two real findings sat in the middle of that list and the paste-ready
 * `mangleExclude` reserved 34 token names on behalf of a gitignored artefact.
 * Generated CSS cannot collide with a mangled token, because nothing renders
 * it into the app.
 */
const DEFAULT_IGNORE = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/out/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/.astro/**',
    '**/.output/**',
    '**/.svelte-kit/**',
    '**/.vercel/**',
    '**/.turbo/**',
    '**/storybook-static/**',
    '**/playwright-report/**',
];

// A class selector: `.name`. Captures the name; a following `-`/`_`/word char keeps
// the whole name so `.main-body` is read in full (and then rejected as too long /
// non-token-shaped below), not truncated to `.main`.
const CLASS_SELECTOR_RE = /\.(-?[a-z_][\w-]*)/gi;

/**
 * Remove the parts of a stylesheet where a `.foo` is NOT a class selector —
 * comments (`/* *\/`, and `//` in SCSS and Less), `url(...)` contents, and
 * string literals — so things like a comment note (`.z`), an
 * `@import 'theme.css'`, or `url(hero.png)` are not mistaken for
 * collision-prone class names. Comments and strings are read by the shared
 * CSS reader, so a `/*` inside a string opens no comment.
 *
 * Cost: one pass over the text; a `url(` that never closes stops the search
 * for later ones, so the pass stays linear.
 *
 * @param css - raw stylesheet text.
 * @returns text with each non-selector region collapsed to one space.
 */
function stripNonSelectorText(css: string): string {
    let out = '';
    let copied = 0;
    let index = 0;
    const url = { closes: true };
    while (index < css.length) {
        const end = nonSelectorEnd(css, index, url);
        if (end === -1) {
            index++;
            continue;
        }
        // An escape is selector text (`.a\:b`); it is only stepped over.
        if (css[index] !== '\\') {
            out += `${css.slice(copied, index)} `;
            copied = end;
        }
        index = end;
    }
    return out + css.slice(copied);
}

/**
 * Where the non-selector text at `index` ends: a comment, a string or an
 * escape (the shared CSS reader), a `//` comment to its line's end, or a
 * `url(...)` to its `)`.
 *
 * @param css - raw stylesheet text.
 * @param index - Index to read from.
 * @param url - Whether a `url(` can still close; cleared once one does not.
 * @param url.closes - False after a `url(` with no `)` after it.
 * @returns The index just past that text, or -1 when none starts here.
 */
function nonSelectorEnd(css: string, index: number, url: { closes: boolean }): number {
    const opaque = cssOpaqueEnd(css, index);
    if (opaque !== -1) return opaque;
    if (css.startsWith('//', index)) {
        const lineEnd = css.indexOf('\n', index);
        return lineEnd === -1 ? css.length : lineEnd;
    }
    if (!url.closes || css.slice(index, index + 4).toLowerCase() !== 'url(') return -1;
    const close = css.indexOf(')', index + 4);
    url.closes = close !== -1;
    return url.closes ? close + 1 : -1;
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
    const patterns = options.pattern
        ? [withPosixSeparators(options.pattern)]
        : ['**/*.{css,scss,sass,less}'];
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
    for (const { path: file, text } of await readTextFiles(files)) {
        const rel = relativePosix(cwd, file);
        for (const match of stripNonSelectorText(text).matchAll(CLASS_SELECTOR_RE)) {
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

    const names = sortStrings(risky.keys());
    printWarn(`${names.length} class name(s) could collide with a mangled token:`);
    for (const name of names) {
        const where = [...(risky.get(name) as Set<string>)].slice(0, 3).join(', ');
        printInfo(`  .${name}  (selector declared in ${where})`);
    }
    // The scan reads stylesheets only. A class is usually emitted from a
    // component, which may live in another package, so renaming only the
    // listed files leaves the component emitting a name no rule matches.
    printInfo('\nThese files declare the selectors; the class may be emitted elsewhere,');
    printInfo('  such as a shared component, so find where the class is emitted before renaming.');
    printInfo('\nPreferred: rename the class where it is declared and where it is emitted,');
    printInfo('  to something specific (e.g. `.x` → `.resize-handle-x`) — short names');
    printInfo('  also clash on specificity with other libraries.');
    printInfo('\nFor names in a third-party stylesheet you cannot edit, reserve them:');
    printInfo(`  production: { mangle: true, mangleExclude: ${JSON.stringify(names)} }`);
    process.exitCode = 1;
}
