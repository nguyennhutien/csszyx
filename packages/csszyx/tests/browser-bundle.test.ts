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
 * Locate the built bundle without depending on the working directory.
 *
 * `import.meta.url` is unusable here — the jsdom environment this suite needs
 * makes it a non-file URL — and the repo runs vitest from two roots, so a
 * single cwd-relative path resolves in one and not the other. Trying both and
 * failing loudly is the honest version: a bundle that was never built must
 * report that, not skip.
 *
 * @returns Absolute path to `dist/browser.iife.js`.
 */
function resolveBundlePath(): string {
    const candidates = ['dist/browser.iife.js', 'packages/csszyx/dist/browser.iife.js'].map(
        relative => path.resolve(process.cwd(), relative),
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
        // In a child process with a deadline: the shipped parser once spun
        // forever on a stray character, and a spin blocks this process's
        // event loop, so only an outside clock can stop a regression.
        const page =
            '<div id="frac" sz="w: 1/2"></div>' +
            '<div id="semi" sz="p: 4; m: 2"></div>' +
            '<div id="hex" sz="bg: #fff"></div>' +
            '<div id="ok" sz="{p:4}"></div>';
        const script = `
const { JSDOM, VirtualConsole } = require('jsdom');
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')));
const dom = new JSDOM(${JSON.stringify(page)}, { runScripts: 'outside-only', virtualConsole });
dom.window.eval(require('node:fs').readFileSync(${JSON.stringify(bundlePath)}, 'utf8'));
// Loaded while the document is still parsing, as a <head> script is; report
// once the runtime's DOMContentLoaded pass has run.
dom.window.addEventListener('load', () => {
    const doc = dom.window.document;
    console.log(JSON.stringify({
        classes: ['frac', 'semi', 'hex', 'ok'].map(id => doc.getElementById(id).className),
        errors,
    }));
});`;
        const run = spawnSync(process.execPath, ['-e', script], {
            cwd: path.dirname(bundlePath),
            encoding: 'utf8',
            timeout: 10_000,
        });

        expect(run.signal, 'the bundle did not finish within the deadline').toBeNull();
        const result = JSON.parse(run.stdout.trim()) as { classes: string[]; errors: string[] };
        expect(result.classes).toEqual(['', '', '', 'p-4']);
        expect(result.errors).toHaveLength(3);
        for (const error of result.errors) {
            expect(error).toContain('[csszyx] Parsing error:');
        }
        expect(result.errors[0]).toContain('Unexpected "/" at 4');
    });

    it('leaves no global behind', () => {
        loadBundle();

        // A script-tag bundle earns its place by having no API: anything exported
        // onto `window` becomes surface nobody agreed to support.
        expect((globalThis as Record<string, unknown>).csszyx).toBeUndefined();
    });
});
