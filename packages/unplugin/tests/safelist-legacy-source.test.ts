import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import postcss from 'postcss';
import { afterEach, describe, expect, it } from 'vitest';
import csszyxPostcss from '../src/postcss.js';
import { findLegacySourceDirective, SAFELIST_FILE } from '../src/safelist-source.js';
import { vitePlugin } from '../src/unplugin.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function projectRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-legacy-source-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'src'));
    return root;
}

const LEGACY_CSS = '@import "tailwindcss" source(none);\n@source "../csszyx-classes.html";\n';

describe('findLegacySourceDirective', () => {
    it('finds an @source that names the old safelist when that file is gone', () => {
        const root = projectRoot();
        const found = findLegacySourceDirective(LEGACY_CSS, path.join(root, 'src/app.css'));
        expect(found).toEqual({
            directive: '@source "../csszyx-classes.html"',
            target: '../csszyx-classes.html',
        });
    });

    it.each([
        ['the old Next loader name', '@source "../.csszyx/next-loader-classes.html";\n'],
        ['single quotes', "@source '../csszyx-classes.html';\n"],
    ])('recognises %s', (_label, directive) => {
        const root = projectRoot();
        expect(
            findLegacySourceDirective(
                `@import "tailwindcss";\n${directive}`,
                path.join(root, 'src/app.css'),
            ),
        ).not.toBeNull();
    });

    it('lets an old name stand while the author keeps a file there', () => {
        const root = projectRoot();
        fs.writeFileSync(path.join(root, 'csszyx-classes.html'), '<div class="p-4"></div>\n');
        expect(findLegacySourceDirective(LEGACY_CSS, path.join(root, 'src/app.css'))).toBeNull();
    });

    it.each([
        ['another file', '@source "../safelist.html";\n'],
        ['a directory', '@source "../src";\n'],
        ['a negated source', '@source not "../csszyx-classes.html";\n'],
        ['a commented-out directive', '/* @source "../csszyx-classes.html"; */\n'],
        ['the current safelist', `@source "../${SAFELIST_FILE}";\n`],
    ])('ignores %s', (_label, directive) => {
        const root = projectRoot();
        expect(
            findLegacySourceDirective(
                `@import "tailwindcss";\n${directive}`,
                path.join(root, 'src/app.css'),
            ),
        ).toBeNull();
    });
});

describe('a stylesheet still pointing at the old safelist', () => {
    async function viteTransform(root: string, css: string): Promise<unknown> {
        const plugins = vitePlugin({});
        const invoke = async (hookName: string, ...args: unknown[]): Promise<unknown> => {
            const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
            const hook = (plugin as Record<string, unknown>)[hookName];
            const fn = (
                typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
            ) as (...a: unknown[]) => unknown;
            return await fn.apply({ warn() {}, error() {} }, args);
        };
        await invoke('configResolved', { root, command: 'build' });
        return invoke('transform', css, path.join(root, 'src/styles.css'));
    }

    it('fails the Vite build and says what to do instead', async () => {
        const root = projectRoot();
        await expect(viteTransform(root, LEGACY_CSS)).rejects.toThrow(
            /@source "\.\.\/csszyx-classes\.html".*no longer writes.*\.csszyx\/csszyx-classes\.txt.*'@csszyx\/unplugin\/postcss'/s,
        );
    });

    it('still transforms a stylesheet whose @source names something else', async () => {
        const root = projectRoot();
        await expect(
            viteTransform(root, '@import "tailwindcss" source(none);\n@source "../src";\n'),
        ).resolves.not.toThrow();
    });

    it('fails the PostCSS run the same way', async () => {
        const root = projectRoot();
        const run = postcss([csszyxPostcss({ root })]).process(LEGACY_CSS, {
            from: path.join(root, 'src/styles.css'),
        });
        await expect(run).rejects.toThrow(/no longer writes.*\.csszyx\/csszyx-classes\.txt/s);
    });
});
