/**
 * Pins the CSS-variable mangle map and hoisting metrics a build emits when
 * many modules each contribute entries.
 *
 * Characterisation for the per-file aggregation: every module that authors a
 * dynamic sz value adds entries to the var map and counters to the metrics,
 * and the manifest carries the aggregate. The map is deterministic (allocation
 * runs in sorted file order), so the snapshot is the contract that a change to
 * HOW the aggregate is built must reproduce byte for byte.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildViteApp, cleanupViteAppBuilds } from './vite-app-build.js';

const MODULES = 24;

afterAll(cleanupViteAppBuilds);

/** @returns Fixture files: one entry importing `MODULES` dynamic-sz components. */
function fixtureFiles(): Record<string, string> {
    const files: Record<string, string> = {
        'index.html':
            '<html><head></head><body><div id="root"></div><script type="module" src="/src/App.tsx"></script></body></html>',
        'src/styles.css':
            '@import "tailwindcss" source(none);\n:root{--brand-primary:red}.card{color:var(--brand-primary)}',
    };
    const imports: string[] = [];
    const uses: string[] = [];
    for (let index = 0; index < MODULES; index++) {
        files[`src/C${index}.tsx`] = [
            `export function C${index}({ w, color }: { w: number; color: string }) {`,
            `    return <div sz={{ w, p: 4, bg: color, hover: { opacity: 0.5 } }}>c${index}</div>;`,
            '}',
        ].join('\n');
        imports.push(`import { C${index} } from './C${index}';`);
        uses.push(`<C${index} w={${index}} color="red" />`);
    }
    files['src/App.tsx'] = [
        "import './styles.css';",
        ...imports,
        `export const App = () => <div className="card" sz={{ bg: "--brand-primary" }}>${uses.join('')}</div>;`,
        'document.getElementById("root")!.textContent = JSON.stringify(App());',
    ].join('\n');
    return files;
}

describe('var mangle map aggregation across modules', () => {
    it('emits one deterministic map and metric total for every contributing module', async () => {
        const built = await buildViteApp({
            name: 'var-map-agg',
            files: fixtureFiles(),
            plugin: {
                build: { emitManifest: true },
                production: {
                    mangle: true,
                    mangleVars: true,
                    mangleGlobalVars: { enabled: true, tokens: ['--brand-primary'] },
                },
            },
        });

        const manifest = JSON.parse(
            readFileSync(join(built.root, 'dist/csszyx-manifest.json'), 'utf8'),
        ) as {
            varMangleMap?: Record<string, string | string[]>;
            cssVarMetrics?: Record<string, number>;
        };
        const map = manifest.varMangleMap ?? {};
        expect(Object.keys(map).sort()).toEqual(['--_sz-bg', '--_sz-w', '--brand-primary']);
        expect(map['--brand-primary']).toBe('---gz');
        expect(map).toMatchInlineSnapshot(`
          {
            "--_sz-bg": "--sy",
            "--_sz-w": "--sz",
            "--brand-primary": "---gz",
          }
        `);
        expect(manifest.cssVarMetrics).toMatchInlineSnapshot(`
          {
            "componentClassUses": 0,
            "componentStyleDeclarations": 0,
            "estimatedHoistedDeclarationsSaved": 0,
            "scopedClassUses": 48,
            "scopedStyleDeclarations": 48,
          }
        `);
    }, 60_000);
});
