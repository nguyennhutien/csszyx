/**
 * A `.vue` or `.svelte` file's `sz` reaches the safelist a production build
 * writes, per engine.
 *
 * The source of a template holds only `sz`; the classes it lowers to are in
 * the adapter's output alone. The prescan writes the safelist before any
 * module is transformed, so a prescan that left templates unread gave a
 * `source(none)` stylesheet no rule for them, and the build stayed green.
 *
 * The output is markup, read as the HTML tokenizer reads it: text such as
 * `Don't` is text, where a JavaScript reading took its `'` for a string that
 * ran to the end of the file and lost every class after it.
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
    'src/App.vue':
        "<template><p>Don't panic</p><div sz=\"{ p: 9, hover: { bg: 'blue-700' } }\">a</div></template>\n",
    'src/Card.svelte': "<p>it's / here</p>\n<div sz={{ m: 9 }}>b</div>\n",
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
        expect(built.css).toMatch(/\.hover\\:bg-blue-700:hover/);
    }, 120_000);

    it('leaves a class a template writes unrenamed when a script owns it too', async () => {
        // `p-9` is owned through the script's `sz`; the template writes it
        // as a plain class, so renaming its rule would unstyle the template.
        const built = await buildViteApp({
            name: `prescan-template-sz-mangle-${parser}`,
            files: {
                ...FILES,
                'src/main.ts':
                    "import './styles.css';\nimport { Box } from './Box.tsx';\ndocument.body.textContent = JSON.stringify(Box());\n",
                'src/Box.tsx': 'export const Box = () => <div sz={{ p: 9, m: 3 }} />;\n',
            },
            plugin: { build: { parser }, production: { mangle: true } },
        });
        expect(built.map).not.toBeNull();
        const map = built.map as Record<string, string>;
        // The control: a class only the script writes is still renamed.
        expect(Object.keys(map)).toContain('m-3');
        expect(Object.keys(map)).not.toContain('p-9');
        expect(built.css).toMatch(/\.p-9\s*\{/);
    }, 120_000);
});
