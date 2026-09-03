/**
 * The selector hazard reaches the build log through the Vite output passes:
 * the CSS plugin rewrites each stylesheet in the transform phase and records
 * the `[class …]` selectors it saw, and `generateBundle` reports them against
 * the frozen map.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const tempDirs: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

type Hook = ((...args: unknown[]) => unknown) | undefined;

describe('selector hazard on the Vite build lane', () => {
    it('warns with a paste-ready manglePreserve when output CSS matches by name', async () => {
        const warnings: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
            warnings.push(args.map(String).join(' '));
        });
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-selector-hazard-'));
        tempDirs.push(root);
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });
        fs.writeFileSync(
            path.join(root, 'src/App.tsx'),
            'export const App = () => <div sz={{ m: 3, p: 2 }} />;',
            'utf8',
        );
        const plugins = vitePlugin({
            production: { mangle: true },
            build: { cache: false },
        }) as Array<Record<string, unknown>>;
        const hookOf = (pluginName: string, hookName: string): Hook => {
            const plugin = plugins.find(p => p?.name === pluginName);
            const hook = plugin?.[hookName];
            return (
                typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
            ) as Hook;
        };
        const ctx = { warn() {}, error() {}, emitFile() {} };
        for (const name of ['csszyx:pre', 'csszyx:css-mangle']) {
            await hookOf(name, 'configResolved')?.apply(ctx, [{ root, command: 'build' }]);
        }
        await hookOf('csszyx:css-mangle', 'transform')?.apply(ctx, [
            '.m-3{margin:0.75rem}.p-2{padding:0.5rem}.tag[class*="m-"]{--a:1}',
            path.join(root, 'src/theme.css'),
        ]);
        await hookOf('csszyx:post', 'generateBundle')?.apply(ctx, [{}, {}]);

        const hazard = warnings.find(w => w.includes('hybrid hazards'));
        expect(hazard).toContain('[class*="m-"] → m-3');
        expect(hazard).toContain("manglePreserve: ['m-*']");
    });
});
