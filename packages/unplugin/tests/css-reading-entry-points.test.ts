/**
 * One analyzer reads the project's CSS, and this test names every file allowed
 * to reach for it.
 *
 * csszyx answers three questions from the same stylesheets: which classes the
 * project's Tailwind serves, what each one sets, and which `@theme` tokens
 * exist. Two separate paths grew for that — a regex scan
 * (`theme-scanner.ts`) and the compiled design system
 * (`@csszyx/tailwind-oracle`) — and neither knows about the other, so a
 * feature wired to the regex silently misses `@theme` inside `node_modules`,
 * `@plugin` and `@config`. The flow is written down in
 * `.agent/flows/css-design-system-pipeline.md`; this test is what keeps a new
 * caller from quietly opening a third path.
 *
 * It fails when a file not on the list below imports one of the entry points.
 * That failure is not a verdict — it asks for a decision: either route the new
 * code through the analyzer, or add the file here in the SAME commit with a
 * line saying why it reads CSS on its own.
 *
 * @module
 */
import * as fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/** Repository root, three levels up from this file. */
const REPO = path.resolve(import.meta.dirname, '../../..');

/**
 * The entry points that read a project's CSS, and who may import each.
 *
 * Paths are repository-relative. The list is deliberately per-symbol rather
 * than per-package: `unplugin` legitimately reads the scan result, and the
 * point is which files hold the reading itself.
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
    // The regex scan. Fallback tier: it runs when no design system compiles.
    parseThemeBlocks: [
        'packages/unplugin/src/theme-scanner.ts',
        'packages/unplugin/src/theme-discovery.ts',
        'packages/unplugin/src/unplugin.ts',
        'packages/cli/src/scanner/theme-declarations.ts',
        'packages/mcp-server/src/tools/theme.ts',
    ],
    parseUtilityBlocks: [
        'packages/unplugin/src/theme-scanner.ts',
        'packages/unplugin/src/unplugin.ts',
    ],
    // The project-wide walk that feeds both tiers.
    discoverProjectTheme: [
        'packages/unplugin/src/theme-discovery.ts',
        'packages/unplugin/src/theme-groups-file.ts',
        'packages/unplugin/src/unplugin.ts',
    ],
    // The compiled design system: the source of truth.
    createEmittedClassOracle: [
        'packages/tailwind-oracle/src/emitted-class-oracle.ts',
        'packages/tailwind-oracle/src/index.ts',
        // The one path through the bundler plugin. `unserved-classes.ts` used
        // to compile its own, which is how two answers to the same question
        // came to exist.
        'packages/unplugin/src/project-style-model.ts',
        'packages/cli/src/commands/check.ts',
    ],
    // Entry-point discovery. A glob is the last resort; a bundler hands its own
    // list over, so a new caller globbing the tree is worth a second look.
    findTailwindCssEntries: [
        'packages/tailwind-oracle/src/emitted-class-oracle.ts',
        'packages/tailwind-oracle/src/index.ts',
        'packages/cli/src/commands/check.ts',
    ],
    tailwindEntriesAmong: [
        'packages/tailwind-oracle/src/emitted-class-oracle.ts',
        'packages/tailwind-oracle/src/index.ts',
        'packages/unplugin/src/project-style-model.ts',
    ],
    // Tailwind's own loader. Exactly one file may call it.
    __unstable__loadDesignSystem: ['packages/tailwind-oracle/src/emitted-class-oracle.ts'],
};

/** Package source directories this test scans. */
const SCANNED_PACKAGES = [
    'cli',
    'compiler',
    'core',
    'csszyx',
    'dynamic',
    'mcp-server',
    'runtime',
    'tailwind-oracle',
    'ts-plugin',
    'unplugin',
    'vars',
    'vscode',
] as const;

/**
 * Every TypeScript source file under the scanned packages.
 *
 * @returns Repository-relative paths, sorted.
 */
function sourceFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === 'generated') continue;
                walk(full);
                continue;
            }
            if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
                found.push(path.relative(REPO, full));
            }
        }
    };
    for (const pkg of SCANNED_PACKAGES) walk(path.join(REPO, 'packages', pkg, 'src'));
    return found.sort();
}

/**
 * Files that name a symbol anywhere in their source.
 *
 * A plain substring search on a word boundary rather than an import parse: the
 * question is "does this file reach for CSS reading", and a re-export, a
 * dynamic `await import`, or a mention inside a template string all answer yes.
 * Matching wider than needed is the safe direction — it asks for a decision
 * where a parse would stay silent.
 *
 * The scan walks the source rather than building a pattern from the symbol:
 * every name here is an identifier, so a word boundary is "the neighbours are
 * not identifier characters", and answering that with an index walk keeps the
 * pattern literal (`security/detect-non-literal-regexp`).
 *
 * @param symbol The entry-point name.
 * @param files Source files to search.
 * @returns Repository-relative paths, sorted.
 */
function filesMentioning(symbol: string, files: readonly string[]): string[] {
    const isWordChar = (character: string | undefined): boolean =>
        character !== undefined && /[\w$]/.test(character);
    const mentions = (source: string): boolean => {
        let from = source.indexOf(symbol);
        while (from !== -1) {
            const before = source[from - 1];
            const after = source[from + symbol.length];
            if (!isWordChar(before) && !isWordChar(after)) return true;
            from = source.indexOf(symbol, from + 1);
        }
        return false;
    };
    return files.filter(file => mentions(fs.readFileSync(path.join(REPO, file), 'utf8'))).sort();
}

describe("the project's CSS is read through one analyzer", () => {
    const files = sourceFiles();

    it('scans a source tree that is actually there', () => {
        // Guards the scan itself: a wrong root or a renamed layout would make
        // every case below pass by finding nothing.
        expect(files.length).toBeGreaterThan(100);
        expect(files).toContain('packages/unplugin/src/theme-scanner.ts');
    });

    it.each(Object.entries(ALLOWED))('%s is read only where it is allowed', (symbol, allowed) => {
        expect(filesMentioning(symbol, files)).toEqual([...allowed].sort());
    });

    it('leaves the design-system loader with a single caller', () => {
        // Stated twice on purpose: the table above can be edited to add a
        // caller, and for this one symbol that edit is the thing to notice.
        expect(filesMentioning('__unstable__loadDesignSystem', files)).toHaveLength(1);
    });
});
