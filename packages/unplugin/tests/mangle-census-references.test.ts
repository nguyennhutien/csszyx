/**
 * A class an element spells with a character reference is a class the element
 * carries, through a real vite build with mangling on, per engine.
 *
 * `className="p&#45;4"` puts `p-4` on the element. The census of authored
 * classes reads what the attribute decodes to, so `p-4`, which an `sz`
 * elsewhere also writes, stays out of the mangle map and its rule keeps the
 * name the element carries. A census that read the spelling left `p-4` in the
 * map, renamed its rule, and the element lost its padding.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { buildViteApp, cleanupViteAppBuilds } from './vite-app-build.js';

const FILES: Record<string, string> = {
    'index.html': `<!doctype html>
<html><head></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>
`,
    'src/main.ts': `
import './styles.css';
import { Card } from './Card.tsx';
import { Note } from './Note.tsx';
document.body.textContent = JSON.stringify([Card(), Note()]);
`,
    'src/Card.tsx': 'export const Card = () => <div sz={{ p: 4, m: 3 }} />;\n',
    'src/Note.tsx': 'export const Note = () => <p className="p&#45;4">note</p>;\n',
    'src/styles.css': '@import "tailwindcss" source(none);\n',
};

afterAll(() => cleanupViteAppBuilds());

describe.each(['rust', 'wasm'] as const)('a %s build with mangling on', parser => {
    it('keeps a class an element spells with a reference out of the map', async () => {
        const built = await buildViteApp({
            name: `mangle-census-references-${parser}`,
            files: FILES,
            plugin: { build: { parser }, production: { mangle: true } },
        });
        expect(built.map).not.toBeNull();
        const map = built.map as Record<string, string>;
        // The control: a class only `sz` writes is still renamed.
        expect(Object.keys(map)).toContain('m-3');
        expect(Object.keys(map)).not.toContain('p-4');
        expect(built.css).toMatch(/\.p-4\s*\{/);
    }, 120_000);
});
