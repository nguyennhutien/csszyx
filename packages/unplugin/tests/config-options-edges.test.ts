/**
 * Option-driven branches in the plugin factory: the `include` allowlist filter
 * (matched and unmatched), and the one-time `compileSources` warning for entries
 * that do not resolve to a real directory.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

type PrePlugin = {
    configResolved?: (c: { root: string; command: string }) => void;
    transformInclude(id: string): boolean;
    transform(this: { warn(m: string): void }, code: string, id: string): unknown;
};

describe('include filter', () => {
    it('only admits source files that match the include patterns', () => {
        const [pre] = vitePlugin({ include: [/src\/App\.tsx$/] }) as unknown as [PrePlugin];
        expect(pre.transformInclude('/project/src/App.tsx')).toBe(true);
        // A real source file that does not match the include list is rejected.
        expect(pre.transformInclude('/project/src/Other.tsx')).toBe(false);
    });
});

describe('production option validation', () => {
    it('rejects an unknown mangle-map delivery lane instead of widening it', () => {
        expect(() => vitePlugin({ production: { mangleMapDelivery: 'htlm' as never } })).toThrow(
            /mangleMapDelivery must be 'both', 'html' or 'bundle'/,
        );
    });
});

describe('compileSources resolution warning', () => {
    it('warns once about entries that do not resolve to a directory', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-compilesrc-'));
        tempDirs.push(root);
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const [pre] = vitePlugin({
            compileSources: ['does-not-exist', 'also-missing'],
        }) as unknown as [PrePlugin];
        pre.configResolved?.({ root, command: 'build' });

        // Any transform triggers the lazy compileSources resolution + warning.
        pre.transform.call(
            { warn() {} },
            'export const App = () => <div sz={{ p: 4 }} />;',
            path.join(root, 'src/App.tsx'),
        );

        const message = warn.mock.calls.map(c => String(c[0])).join('\n');
        expect(message).toContain('compileSources');
        expect(message).toContain('did not resolve to a');
        expect(message).toContain('does-not-exist');
    });
});
