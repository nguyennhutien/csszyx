// @vitest-environment jsdom
/**
 * The CDN artefact, exercised as a `<script>` tag rather than as source.
 *
 * `browser.test.ts` imports `src/browser.ts` through vitest, which proves the
 * logic but not the thing users receive. `dist/browser.iife.js` is a separate
 * artefact — esbuild bundles the browser compiler entry into it, substitutes
 * `process.env.NODE_ENV`, and minifies the result — and `unpkg`, `jsdelivr` and
 * the `./browser` subpath all point at that file. Nothing read it: a bundling
 * failure, a missed `define`, or an exports entry aimed at a path the build
 * stopped producing would all have shipped.
 *
 * So this runs the built file the way a browser does, against a document it did
 * not compile itself.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Locate a built bundle without depending on the working directory.
 *
 * `import.meta.url` is unusable here — the jsdom environment this suite needs
 * makes it a non-file URL — and the repo runs vitest from two roots, so a
 * single cwd-relative path resolves in one and not the other. Trying both and
 * failing loudly is the honest version: a bundle that was never built must
 * report that, not skip.
 *
 * @param file - The bundle's file name in `dist`.
 * @returns Absolute path to it.
 */
function resolveBundlePath(file = 'browser.iife.js'): string {
    const candidates = [`dist/${file}`, `packages/csszyx/dist/${file}`].map(relative =>
        path.resolve(process.cwd(), relative),
    );
    const found = candidates.find(candidate => existsSync(candidate));
    if (!found) {
        throw new Error(
            `Built CDN bundle not found. Looked in:\n  ${candidates.join('\n  ')}\n` +
                'Run `pnpm --filter csszyx build` first — this suite tests the artefact, ' +
                'not the source.',
        );
    }
    return found;
}

const bundlePath = resolveBundlePath();
/** The development CDN bundle: the same entry, built with the sentences. */
const devBundlePath = resolveBundlePath('browser.dev.iife.js');

/**
 * Run the built bundle against the current document, as a script tag would.
 *
 * The bundle defers to `DOMContentLoaded` while the document is still loading,
 * which is the state a real page is in when a `<script>` in `<head>` executes.
 * Dispatching it here reproduces that ordering rather than sidestepping it.
 */
function loadBundle(): void {
    // biome-ignore lint/security/noGlobalEval: running the shipped artefact as a script tag is the point
    eval(readFileSync(bundlePath, 'utf8'));
    document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
}

/** What a page printed and the classes its elements got. */
interface PageRun {
    /** Each listed element's `className`, in order. */
    classes: string[];
    /** The lines printed through `console.error`. */
    errors: string[];
    /** The lines printed through `console.warn`. */
    warnings: string[];
}

/**
 * Load a bundle into a page, in a child process with a deadline: the shipped
 * parser once spun forever on a stray character, and a spin blocks this
 * process's event loop, so only an outside clock can stop a regression.
 *
 * @param file - The bundle to load.
 * @param page - The page's body.
 * @param ids - The elements whose classes to report.
 * @returns The classes each element got and what the page printed.
 */
function runPage(file: string, page: string, ids: readonly string[]): PageRun {
    const script = `
const { JSDOM, VirtualConsole } = require('jsdom');
const errors = [];
const warnings = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')));
virtualConsole.on('warn', (...args) => warnings.push(args.map(String).join(' ')));
const dom = new JSDOM(${JSON.stringify(page)}, { runScripts: 'outside-only', virtualConsole });
// Named by its file, as a script tag's frames are named by its URL.
dom.window.eval(require('node:fs').readFileSync(${JSON.stringify(file)}, 'utf8') + ${JSON.stringify(`\n//# sourceURL=${file}`)});
// Loaded while the document is still parsing, as a <head> script is; report
// once the runtime's DOMContentLoaded pass has run.
dom.window.addEventListener('load', () => {
    const doc = dom.window.document;
    console.log(JSON.stringify({
        classes: ${JSON.stringify(ids)}.map(id => doc.getElementById(id).className),
        errors,
        warnings,
    }));
});`;
    const run = spawnSync(process.execPath, ['-e', script], {
        cwd: path.dirname(file),
        encoding: 'utf8',
        timeout: 10_000,
    });
    expect(run.signal, 'the bundle did not finish within the deadline').toBeNull();
    return JSON.parse(run.stdout.trim()) as PageRun;
}

/**
 * Load a bundle into a page of attributes that do not parse.
 *
 * @param file - The bundle to load.
 * @returns The classes each element got and what the page printed.
 */
function runBraceLessPage(file: string): PageRun {
    const page =
        '<div id="frac" sz="w: 1/2"></div>' +
        '<div id="semi" sz="p: 4; m: 2"></div>' +
        '<div id="hex" sz="bg: #fff"></div>' +
        '<div id="ok" sz="{p:4}"></div>';
    return runPage(file, page, ['frac', 'semi', 'hex', 'ok']);
}

/**
 * Load a bundle into a page with a misspelt `sz` key.
 *
 * @param file - The bundle to load.
 * @returns The class the element got and what the page printed.
 */
function runUnknownKeyPage(file: string): PageRun {
    return runPage(file, '<div id="typo" sz="{ pading: 4 }"></div>', ['typo']);
}

describe('csszyx/browser CDN bundle', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        document.body.className = '';
    });

    it('compiles the sz attributes already on the page', () => {
        document.body.innerHTML = `<div id="a" sz="{p:4,bg:'blue-500'}">x</div>`;
        loadBundle();

        expect(document.getElementById('a')?.className).toBe('p-4 bg-blue-500');
        // The stylesheet hides `[sz]` until this lands, so the flag is what makes
        // the page visible — a bundle that compiled but never set it renders blank.
        expect(document.body.classList.contains('sz-ready')).toBe(true);
    });

    it('compiles an element added after it loaded', () => {
        loadBundle();

        const added = document.createElement('div');
        added.setAttribute('sz', "{m:2,text:'red-500'}");
        document.body.appendChild(added);

        return new Promise<void>(resolve => {
            setTimeout(() => {
                expect(added.className).toBe('m-2 text-red-500');
                resolve();
            }, 0);
        });
    });

    it('carries no reference to process.env', () => {
        // esbuild substitutes it at build time. Left in, the bundle throws on the
        // first compile in any page that does not shim `process` — which is every
        // page reaching this file over a CDN.
        expect(readFileSync(bundlePath, 'utf8')).not.toContain('process.env');
    });

    it('reports a brace-less value that does not parse, and never hangs on it', () => {
        const result = runBraceLessPage(bundlePath);
        expect(result.classes).toEqual(['', '', '', 'p-4']);
        // The bundle is built for production, so each prints its code and
        // args: the attribute, the character and where it is.
        const line = (input: string, char: string): string =>
            `[csszyx] sz-attribute-syntax: ${JSON.stringify({ form: 'char', input, char, index: 4 })} https://csszyx.com/e/sz-attribute-syntax`;
        expect(result.errors).toEqual([
            line('w: 1/2', '/'),
            line('p: 4; m: 2', ';'),
            line('bg: #fff', '#'),
        ]);
        // Above the child's 10 s deadline, so that deadline is what fails a
        // hang; jsdom alone took 7.4 s to start on a loaded CI runner.
    }, 20_000);

    it('prints the sentence from the development bundle, which a page under development loads', () => {
        const result = runBraceLessPage(devBundlePath);
        expect(result.classes).toEqual(['', '', '', 'p-4']);
        expect(result.errors[0]).toBe(
            '[csszyx] sz-attribute-syntax: The `sz` attribute `w: 1/2` has an unexpected `/` at offset 4, so the element gets no classes from it.\n' +
                '  help: write it as an object literal with commas between keys, such as `sz="p: 4, w: \'1/2\'"`; quote a value that holds `/` or `#`.\n' +
                '  docs: https://csszyx.com/e/sz-attribute-syntax',
        );
        expect(result.errors).toHaveLength(3);
        expect(readFileSync(devBundlePath, 'utf8')).not.toContain('process.env');
        // The production bundle carries none of those words.
        expect(readFileSync(bundlePath, 'utf8')).not.toContain('write it as an object literal');
    }, 20_000);

    it('prints the development warnings from the development bundle, which has no server render to double them', () => {
        // A Vite or webpack app prints these from the server render and keeps
        // them out of the browser so they do not print twice; a script-tag
        // page has no server render, so the browser is the only place they
        // can print.
        const dev = runUnknownKeyPage(devBundlePath);
        expect(dev.classes).toEqual(['pading-4']);
        // Every frame on the stack is the bundle's own, so the line names the
        // object and no frame.
        expect(dev.warnings).toEqual([
            '[csszyx] unknown-key: sz object was {"pading":4}\n' +
                '  `pading` is not an sz property.\n' +
                "  help: write `p` if you meant it; for a custom utility, define it with Tailwind's `@utility`.\n" +
                '  note: the class is still emitted, and it styles nothing unless Tailwind serves that utility.\n' +
                '  docs: https://csszyx.com/e/unknown-key',
        ]);
        expect(dev.errors).toEqual([]);

        // The production bundle folds those warnings out, sentence and all.
        const production = runUnknownKeyPage(bundlePath);
        expect(production.classes).toEqual(['pading-4']);
        expect(production.warnings).toEqual([]);
        expect(production.errors).toEqual([]);
    }, 20_000);

    it('leaves no global behind', () => {
        loadBundle();

        // A script-tag bundle earns its place by having no API: anything exported
        // onto `window` becomes surface nobody agreed to support.
        expect((globalThis as Record<string, unknown>).csszyx).toBeUndefined();
    });
});
