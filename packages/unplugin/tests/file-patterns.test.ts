import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    expandFilePatterns,
    matchesAnyPattern,
    matchesPattern,
    normalizeFileId,
} from '../src/file-patterns.js';

describe('file pattern helpers', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-patterns-'));
        fs.mkdirSync(path.join(root, 'src/generated'), { recursive: true });
        fs.mkdirSync(path.join(root, 'src/styles'), { recursive: true });
        fs.mkdirSync(path.join(root, 'node_modules/pkg'), { recursive: true });
        fs.writeFileSync(path.join(root, 'src/App.tsx'), 'export const App = 1;');
        fs.writeFileSync(path.join(root, 'src/generated/icons.tsx'), 'export const Icons = 1;');
        fs.writeFileSync(path.join(root, 'src/styles/theme.css'), '@theme {}');
        fs.writeFileSync(path.join(root, 'src/styles/extra.css'), '@theme {}');
        fs.writeFileSync(path.join(root, 'node_modules/pkg/theme.css'), '@theme {}');
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('normalizes bundler query suffixes and Windows separators', () => {
        expect(normalizeFileId('src\\App.tsx?import')).toBe('src/App.tsx');
    });

    it('matches RegExp filters against relative paths', () => {
        expect(matchesPattern(path.join(root, 'src/generated/icons.tsx'), /generated/, root)).toBe(
            true,
        );
    });

    it('matches simple glob filters against relative paths', () => {
        expect(
            matchesPattern(path.join(root, 'src/generated/icons.tsx'), 'src/generated/**', root),
        ).toBe(true);
        expect(matchesPattern(path.join(root, 'src/App.tsx'), 'src/generated/**', root)).toBe(
            false,
        );
    });

    it('matches arrays of include/exclude patterns', () => {
        expect(
            matchesAnyPattern(
                path.join(root, 'src/generated/icons.tsx'),
                ['src/components/**', /generated/],
                root,
            ),
        ).toBe(true);
    });

    it('expands literal and glob CSS scan patterns', () => {
        const files = expandFilePatterns(root, ['src/styles/theme.css', 'src/styles/*.css']).map(
            f => path.relative(root, f).replace(/\\/g, '/'),
        );

        expect(files).toEqual(['src/styles/extra.css', 'src/styles/theme.css']);
    });

    it('does not walk ignored build/dependency directories for glob expansion', () => {
        const files = expandFilePatterns(root, '**/*.css').map(f =>
            path.relative(root, f).replace(/\\/g, '/'),
        );

        expect(files).toContain('src/styles/theme.css');
        expect(files).not.toContain('node_modules/pkg/theme.css');
    });
});
