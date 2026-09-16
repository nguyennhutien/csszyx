/**
 * Stylesheets reached from JavaScript: the shape of a monorepo whose app
 * imports its design system's CSS from `main.tsx` and keeps no stylesheet of
 * its own, which a walk over `.css` files never finds.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { stylesheetsImportedBy } from '../src/js-stylesheet-imports.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * Write a project from relative path to content.
 *
 * @param files - Relative path to file content.
 * @returns Absolute project root.
 */
function project(files: Record<string, string>): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-js-css-')));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app' }));
    for (const [relative, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, relative)), { recursive: true });
        writeFileSync(join(root, relative), content);
    }
    return root;
}

describe('stylesheetsImportedBy', () => {
    it('resolves every stylesheet a module imports, and leaves out what the build does not compile', () => {
        const main = [
            "import './a.css';",
            "import url from './b.css?url';",
            "import raw from './c.css?raw';",
            "const lazy = () => import('./d.css');",
            "import '@ui/theme.css';",
            "import '@fixture/ui/globals.css';",
            "import './missing.css';",
            "import '@ui/missing.css';",
        ].join('\n');
        const root = project({
            'src/main.tsx': main,
            'src/a.css': '',
            'src/b.css': '',
            'src/c.css': '',
            'src/d.css': '',
            'src/ui/theme.css': '',
            'node_modules/@fixture/ui/package.json': JSON.stringify({
                name: '@fixture/ui',
                exports: { './globals.css': './globals.css' },
            }),
            'node_modules/@fixture/ui/globals.css': '',
        });

        const found = stylesheetsImportedBy(
            [{ filePath: join(root, 'src/main.tsx'), content: main }],
            [{ find: '@ui/', replacement: `${root}/src/ui/`, exact: false }],
        );

        expect(found).toEqual([
            join(root, 'node_modules/@fixture/ui/globals.css'),
            join(root, 'src/a.css'),
            join(root, 'src/b.css'),
            join(root, 'src/d.css'),
            join(root, 'src/ui/theme.css'),
        ]);
    });

    it('lists a stylesheet two modules import once', () => {
        const root = project({ 'src/shared.css': '' });
        const content = "import './shared.css';";

        const found = stylesheetsImportedBy(
            [
                { filePath: join(root, 'src/a.tsx'), content },
                { filePath: join(root, 'src/b.tsx'), content },
            ],
            [],
        );

        expect(found).toEqual([join(root, 'src/shared.css')]);
    });

    it('resolves a stylesheet whose JavaScript specifier escapes the dot', () => {
        const root = project({ 'src/theme.css': '' });
        const content = String.raw`import './theme\u002ecss';`;

        expect(
            stylesheetsImportedBy([{ filePath: join(root, 'src/main.tsx'), content }], []),
        ).toEqual([join(root, 'src/theme.css')]);
    });

    it('answers nothing, without reading, when no module names a stylesheet', () => {
        expect(
            stylesheetsImportedBy(
                [{ filePath: '/p/src/a.tsx', content: 'export const a = 1;' }],
                [],
            ),
        ).toEqual([]);
    });
});
