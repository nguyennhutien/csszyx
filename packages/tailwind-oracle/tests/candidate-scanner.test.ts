/**
 * Where Tailwind's Scanner looks, built the way its integrations build it.
 *
 * `@tailwindcss/postcss` 4.3.3 hands its Scanner nothing for `source(none)`,
 * the whole base for an import with no `source(...)`, the named path
 * otherwise, then every `@source` rule. The census the merge table is built
 * from has to read the same files, or a class Tailwind generated CSS for
 * would have no entry.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    filesNamedBySources,
    loadCandidateScanner,
    scanSourcesOf,
} from '../src/candidate-scanner.js';

const created: string[] = [];
afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('scanSourcesOf', () => {
    const rule = { base: '/app/styles', pattern: '../lib', negated: false };

    it('scans only the @source rules under source(none)', () => {
        expect(scanSourcesOf({ root: 'none', sources: [rule] }, '/app')).toEqual([rule]);
    });

    it('scans the whole project when the import names no source', () => {
        expect(scanSourcesOf({ root: null, sources: [] }, '/app')).toEqual([
            { base: '/app', pattern: '**/*', negated: false },
        ]);
    });

    it('scans the named path, then the rules', () => {
        const negated = { base: '/app/styles', pattern: './legacy', negated: true };
        expect(
            scanSourcesOf(
                { root: { base: '/app/styles', pattern: '../src' }, sources: [negated] },
                '/app',
            ),
        ).toEqual([{ base: '/app/styles', pattern: '../src', negated: false }, negated]);
    });

    it('preserves an explicitly empty source path without mutating the compiled input', () => {
        const root = Object.freeze({ base: '', pattern: '' });
        const compiled = Object.freeze({ root, sources: Object.freeze([rule]) });
        expect(scanSourcesOf(compiled, '/fallback')).toEqual([
            { base: '', pattern: '', negated: false },
            rule,
        ]);
        expect(compiled.root).toEqual({ base: '', pattern: '' });
    });
});

describe('loadCandidateScanner', () => {
    it('answers null for a project with no Tailwind integration to load it from', () => {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-no-scanner-'));
        created.push(dir);
        expect(loadCandidateScanner(dir)).toBeNull();
    });

    it('answers null for an oxide that predates the Scanner', () => {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-old-oxide-'));
        created.push(dir);
        writeFileSync(join(dir, 'package.json'), '{ "name": "app" }\n');
        const oxide = join(dir, 'node_modules/@tailwindcss/oxide');
        mkdirSync(oxide, { recursive: true });
        writeFileSync(
            join(oxide, 'package.json'),
            '{ "name": "@tailwindcss/oxide", "main": "index.js" }\n',
        );
        writeFileSync(join(oxide, 'index.js'), 'module.exports = {};\n');

        expect(loadCandidateScanner(dir)).toBeNull();
    });
});

/**
 * The files a project's explicit `@source` rules name, as its own Scanner
 * lists them. The sz walk skips what `.gitignore` covers (ADR 0033), and
 * takes these back, so a rule that reaches Tailwind reaches the safelist too.
 */
describe('filesNamedBySources', () => {
    const REPO = join(import.meta.dirname, '../../..');

    /**
     * A project with a `.gitignore` and the files it names.
     *
     * @param files - Relative path to text.
     * @returns The project root.
     */
    function project(files: Record<string, string>): string {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-named-'));
        created.push(root);
        for (const [file, text] of Object.entries(files)) {
            mkdirSync(join(root, file, '..'), { recursive: true });
            writeFileSync(join(root, file), text);
        }
        return root;
    }

    const IGNORED = {
        '.gitignore': 'gen/\nsingle/\nvenv/\n',
        'src/a.tsx': 'x',
        'gen/a.tsx': 'x',
        'gen/deep/b.tsx': 'x',
        'single/one.tsx': 'x',
        'single/two.tsx': 'x',
        'venv/.gitignore': '*\n',
        'venv/v.tsx': 'x',
    };

    /**
     * Paths relative to a root, for comparison.
     *
     * @param root - The project root.
     * @param files - Absolute paths.
     * @returns Them, relative and with forward slashes.
     */
    const relative = (root: string, files: readonly string[] | null): string[] | null =>
        files?.map(file => file.slice(root.length + 1).replaceAll('\\', '/')) ?? null;

    it('names nothing for automatic detection alone, which the walk already covers', () => {
        const root = project(IGNORED);
        expect(
            filesNamedBySources(REPO, root, [[{ base: root, pattern: '**/*', negated: false }]]),
        ).toEqual([]);
    });

    it('names a gitignored folder an @source points at, and only what it holds', () => {
        const root = project(IGNORED);
        const roots = [
            [
                { base: root, pattern: '**/*', negated: false },
                { base: join(root, 'src'), pattern: '../gen', negated: false },
            ],
        ];
        expect(relative(root, filesNamedBySources(REPO, root, roots))).toEqual([
            'gen/a.tsx',
            'gen/deep/b.tsx',
        ]);
    });

    it.each([
        ['a glob', 'gen/*.tsx'],
        ['one file', 'gen/a.tsx'],
    ])(
        'names the whole gitignored folder %s into it opens beside automatic detection',
        (_name, pattern) => {
            // Tailwind 4.3.3 reads every file of `gen/` for either rule, so
            // the safelist has to read them too.
            const root = project(IGNORED);
            const roots = [
                [
                    { base: root, pattern: '**/*', negated: false },
                    { base: root, pattern, negated: false },
                ],
            ];
            expect(relative(root, filesNamedBySources(REPO, root, roots))).toEqual([
                'gen/a.tsx',
                'gen/deep/b.tsx',
            ]);
        },
    );

    it('answers in the spelling of a root reached through a link', () => {
        const root = project(IGNORED);
        const link = `${root}-link`;
        symlinkSync(root, link);
        created.push(link);
        // A folder outside the root keeps the path the Scanner reports.
        const other = project({ 'lib/c.tsx': 'x' });
        const roots = [
            [
                { base: link, pattern: 'gen', negated: false },
                { base: other, pattern: 'lib', negated: false },
            ],
        ];
        const named = filesNamedBySources(REPO, link, roots) ?? [];
        expect(named).toContain(realpathSync(join(other, 'lib/c.tsx')));
        expect(
            relative(
                link,
                named.filter(file => file.startsWith(link)),
            ),
        ).toEqual(['gen/a.tsx', 'gen/deep/b.tsx']);
    });

    it('lists nothing under a root that does not exist', () => {
        const root = join(project({}), 'gone');
        const roots = [[{ base: root, pattern: 'gen', negated: false }]];
        expect(filesNamedBySources(REPO, root, roots)).toEqual([]);
    });

    it('asks nothing of a rule into `node_modules`, which no prescan reads', () => {
        const root = project({ ...IGNORED, 'node_modules/p/i.tsx': 'x' });
        const roots = [
            [
                { base: root, pattern: '**/*', negated: false },
                { base: root, pattern: 'node_modules/p', negated: false },
            ],
        ];
        expect(filesNamedBySources(join(root, 'none'), root, roots)).toEqual([]);
    });

    it('names one file, not its gitignored folder', () => {
        const root = project(IGNORED);
        const roots = [[{ base: root, pattern: 'single/one.tsx', negated: false }]];
        expect(relative(root, filesNamedBySources(REPO, root, roots))).toEqual(['single/one.tsx']);
    });

    it('keeps a folder whose own .gitignore ignores everything in it', () => {
        const root = project(IGNORED);
        const roots = [[{ base: root, pattern: 'venv', negated: false }]];
        expect(relative(root, filesNamedBySources(REPO, root, roots))).toContain('venv/v.tsx');
    });

    it("applies one stylesheet's `@source not` to that stylesheet only", () => {
        const root = project(IGNORED);
        const gen = { base: root, pattern: 'gen', negated: false };
        const roots = [
            [gen, { base: root, pattern: 'gen/deep', negated: true }],
            [{ base: root, pattern: 'gen/deep', negated: false }],
        ];
        expect(relative(root, filesNamedBySources(REPO, root, roots))).toEqual([
            'gen/a.tsx',
            'gen/deep/b.tsx',
        ]);
    });

    it('answers the same sorted list whatever order the stylesheets come in', () => {
        const root = project(IGNORED);
        const a = [{ base: root, pattern: 'single', negated: false }];
        const b = [{ base: root, pattern: 'gen', negated: false }];
        const forward = filesNamedBySources(REPO, root, [a, b]);
        expect(filesNamedBySources(REPO, root, [b, a])).toEqual(forward);
        expect(forward).toEqual([...(forward ?? [])].sort());
    });

    it('answers null for a Scanner that lists no files', () => {
        const dir = project({});
        writeFileSync(join(dir, 'package.json'), '{ "name": "app" }\n');
        const oxide = join(dir, 'node_modules/@tailwindcss/oxide');
        mkdirSync(oxide, { recursive: true });
        writeFileSync(
            join(oxide, 'package.json'),
            '{ "name": "@tailwindcss/oxide", "main": "index.js" }\n',
        );
        writeFileSync(
            join(oxide, 'index.js'),
            'module.exports = { Scanner: class { scan() { return []; } } };\n',
        );
        expect(
            filesNamedBySources(dir, dir, [[{ base: dir, pattern: 'gen', negated: false }]]),
        ).toBeNull();
    });

    it('answers null when the project has no Scanner to ask', () => {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-no-scanner-'));
        created.push(dir);
        expect(
            filesNamedBySources(dir, dir, [[{ base: dir, pattern: 'gen', negated: false }]]),
        ).toBeNull();
    });
});
