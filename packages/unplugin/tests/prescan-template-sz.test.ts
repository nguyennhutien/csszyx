/**
 * A `.vue` or `.svelte` file's `sz` reaches the safelist a production build
 * writes, per engine.
 *
 * The source of a template holds only `sz`; the classes it lowers to are in
 * the adapter's output alone. The prescan writes the safelist before any
 * module is transformed, so a prescan that left templates unread gave a
 * `source(none)` stylesheet no rule for them, and the build stayed green.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildViteApp, cleanupViteAppBuilds } from './vite-app-build.js';

const FILES: Record<string, string> = {
    'index.html': `<!doctype html>
<html><head></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>
`,
    'src/main.ts': "import './styles.css';\ndocument.body.textContent = 'x';\n",
    'src/App.vue': '<template><div sz="{ p: 9, hover: { bg: \'blue-700\' } }">a</div></template>\n',
    'src/Card.svelte': '<div sz={{ m: 9 }}>b</div>\n',
    // The control: a script's sz reaches the safelist today.
    'src/Box.tsx': 'export const Box = () => <div sz={{ gap: 1 }} />;\n',
    'src/styles.css': '@import "tailwindcss" source(none);\n',
};

afterAll(() => cleanupViteAppBuilds());

describe.each(['rust', 'wasm'] as const)('a %s production build', parser => {
    it('writes the classes a template lowers its sz to into the safelist', async () => {
        const built = await buildViteApp({
            name: `prescan-template-sz-${parser}`,
            files: FILES,
            plugin: { build: { parser } },
        });
        const safelist = readFileSync(join(built.root, '.csszyx/csszyx-classes.txt'), 'utf8')
            .split(/\s+/)
            .filter(Boolean);
        expect(safelist).toEqual(
            expect.arrayContaining(['gap-1', 'p-9', 'hover:bg-blue-700', 'm-9']),
        );
        expect(built.css).toMatch(/\.p-9\s*\{/);
        expect(built.css).toMatch(/\.m-9\s*\{/);
    }, 120_000);
});
