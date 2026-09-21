/**
 * The Turbopack loader's theme registration leaves ignored stylesheets out.
 *
 * The loader finds `@theme` tokens by walking the project. A directory the Next
 * command was told to ignore may hold another app's theme, whose tokens are not
 * ones this app's CSS is compiled with.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { _resetThemeGroupsFileCache, ensureThemeGroupsFile } from '../src/theme-groups-file.js';

const roots: string[] = [];

afterEach(() => {
    _resetThemeGroupsFileCache();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * An app with its own theme beside a directory holding another app's.
 *
 * @returns The project root.
 */
function appBesideAnother(): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-theme-groups-ignore-'));
    roots.push(root);
    mkdirSync(join(root, 'app'), { recursive: true });
    mkdirSync(join(root, 'legacy'), { recursive: true });
    writeFileSync(join(root, 'app/globals.css'), '@theme { --color-brand: #123456; }\n');
    writeFileSync(join(root, 'legacy/old.css'), '@theme { --color-retired: #654321; }\n');
    return root;
}

describe('ensureThemeGroupsFile with ignore patterns', () => {
    it('registers and watches only the stylesheets no pattern covers', () => {
        const root = appBesideAnother();

        const groups = ensureThemeGroupsFile(root, join(root, '.csszyx'), ['legacy/**']);
        const written = readFileSync(groups.file ?? '', 'utf8');

        expect(written).toContain('brand');
        expect(written).not.toContain('retired');
        expect(groups.watch).toEqual([join(root, 'app/globals.css')]);
    });

    it('does not answer from a cache that was filled under other patterns', () => {
        const root = appBesideAnother();
        const outputDir = join(root, '.csszyx');
        ensureThemeGroupsFile(root, outputDir);

        const groups = ensureThemeGroupsFile(root, outputDir, ['legacy/**']);

        expect(readFileSync(groups.file ?? '', 'utf8')).not.toContain('retired');
    });
});
