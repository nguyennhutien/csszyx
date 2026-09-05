/**
 * CSP contract of the HTML a Vite build emits — over a REAL build.
 *
 * Field report: a consumer enforcing `script-src 'self'` found an executable
 * inline `window.__csszyx` installer in its built index.html. The consumer had
 * not enabled mangling, so the installer carried an empty map and did nothing
 * except trip the policy. A unit test of `injectMangleMapScript` cannot prove
 * what the build and the browser receive; this suite builds the app.
 *
 * The contract: every `<script>` csszyx puts into built HTML is either an
 * inert `type="application/json"` data block (the hydration census) or a
 * bundled `src=` module. Never executable inline code.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { buildViteApp, cleanupViteAppBuilds, executableInlineScripts } from './vite-app-build.js';

const FIXTURE_FILES: Record<string, string> = {
    'index.html': `<!doctype html>
<html><head></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>
`,
    'src/main.ts': `
import './styles.css';
import { szr } from '@csszyx/runtime';
import { App } from './App.tsx';
document.body.textContent = JSON.stringify(App());
document.body.dataset.cls = szr({ mx: 0 });
`,
    'src/App.tsx': `
export const App = () => <div sz={{ p: 4, m: 3 }}><span sz={{ mx: 4, color: 'red-500' }} /></div>;
`,
    'src/styles.css': `
@import "tailwindcss" source(none);
`,
};

/**
 * The DEMS-shaped app plus a pre-compiled UI kit under node_modules that
 * imports the runtime itself. The plugin never processes node_modules, so the
 * per-consumer import cannot reach the kit; the entry-level registration is
 * what must.
 */
const WRAPPER_FILES: Record<string, string> = {
    ...FIXTURE_FILES,
    'src/main.ts': `
import './styles.css';
import { kitClass } from 'ui-kit';
import { App } from './App.tsx';
document.body.textContent = JSON.stringify(App());
// Evaluated at module load: the map must already be registered here.
document.body.dataset.kit = kitClass();
`,
    'node_modules/ui-kit/package.json': JSON.stringify({
        name: 'ui-kit',
        version: '1.0.0',
        type: 'module',
        main: './index.js',
    }),
    'node_modules/ui-kit/index.js': `
import { szr } from '@csszyx/runtime';
export const kitClass = () => szr('mx-0');
`,
};

describe('built HTML never carries executable inline csszyx script', () => {
    afterAll(() => {
        cleanupViteAppBuilds();
    });

    it('default options (no mangling): no csszyx script tag at all', async () => {
        const built = await buildViteApp({ name: 'csp-default', files: FIXTURE_FILES });
        expect(executableInlineScripts(built.html)).toEqual([]);
        // The checksum attribute stays — it is what the bundle is compared
        // against. The census does not: it maps original names to tokens, and a
        // build that renames nothing has nothing to map, so the page carried an
        // inline `<script>` element holding `{}` for every reader that
        // inventories one.
        expect(built.html).toContain('data-sz-checksum="');
        expect(built.html).not.toContain('__CSSZYX_MANGLE_MAP__');
        expect(built.map).toBeNull();
    }, 60_000);

    it('mangling on, delivery unset: the map reaches the bundle, not an inline script', async () => {
        const built = await buildViteApp({
            name: 'csp-mangle',
            files: FIXTURE_FILES,
            plugin: { production: { mangle: true } },
        });
        expect(executableInlineScripts(built.html)).toEqual([]);
        expect(built.map, 'census must still carry the class map').not.toEqual({});
        const token = built.map?.['mx-0'];
        expect(token).toBeTruthy();
        // The runtime map travels inside the JS bundle, final and substituted.
        expect(built.js).toContain(`"mx-0": "${token}"`);
        expect(built.js).not.toContain('___CSSZYX_');
    }, 60_000);

    it('registers the map before an unprocessed wrapper package evaluates', async () => {
        const built = await buildViteApp({
            name: 'csp-wrapper',
            files: WRAPPER_FILES,
            plugin: { production: { mangle: true } },
        });
        expect(executableInlineScripts(built.html)).toEqual([]);
        // The registration module is the first thing the entry evaluates:
        // its install call precedes the wrapper's code in the chunk.
        const install = built.js.indexOf('installMangleRuntime(');
        const wrapper = built.js.indexOf('kitClass');
        expect(install, 'registration must be bundled').toBeGreaterThanOrEqual(0);
        expect(wrapper, 'wrapper package must be bundled').toBeGreaterThanOrEqual(0);
        expect(install).toBeLessThan(wrapper);
        expect(built.js).not.toContain('___CSSZYX_');
    }, 60_000);
});
