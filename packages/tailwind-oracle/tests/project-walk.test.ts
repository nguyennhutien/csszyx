/**
 * The shared project walk and the two skip sets its callers choose between.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    DEPENDENCY_OUTPUT_DIRS,
    GENERATED_REPORT_DIRS,
    type ProjectWalkOptions,
    STYLESHEET_WALK_SKIP_DIRS,
    skippedDirGlobs,
    walkProject,
} from '../src/project-walk.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * Write files under a fresh temporary root.
 *
 * @param files - Paths relative to the root, with their content.
 * @returns The root.
 */
function project(files: Record<string, string>): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-project-walk-')));
    roots.push(root);
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), content);
    }
    return root;
}

/**
 * The files a walk visits, relative to the root and sorted.
 *
 * @param root - Directory to walk.
 * @param options - Walk options.
 * @returns Relative posix paths.
 */
function walked(root: string, options: ProjectWalkOptions): string[] {
    const out: string[] = [];
    walkProject(root, options, file => out.push(relative(root, file.path).split(sep).join('/')));
    return out.sort();
}

describe('the skip sets', () => {
    it('keep dependency output apart from generated reports', () => {
        expect([...DEPENDENCY_OUTPUT_DIRS].sort()).toEqual(
            ['.astro', '.git', '.next', '.nuxt', '.turbo', 'build', 'dist', 'node_modules'].sort(),
        );
        expect([...GENERATED_REPORT_DIRS].sort()).toEqual([
            'coverage',
            'storybook-static',
            'target',
        ]);
        expect([...STYLESHEET_WALK_SKIP_DIRS].sort()).toEqual(
            [...DEPENDENCY_OUTPUT_DIRS, ...GENERATED_REPORT_DIRS].sort(),
        );
    });

    it('never puts a generated-report name in the dependency set', () => {
        // The sz prescan walks with the dependency set alone; a report name in
        // it would drop `src/features/target/Card.tsx` from the safelist.
        for (const name of GENERATED_REPORT_DIRS)
            expect(DEPENDENCY_OUTPUT_DIRS.has(name)).toBe(false);
    });

    it('turn into anchored or any-depth globs', () => {
        const dirs = new Set(['dist', 'build']);
        expect(skippedDirGlobs(dirs, { anchored: true })).toEqual(['dist/**', 'build/**']);
        expect(skippedDirGlobs(dirs, { anchored: false })).toEqual(['**/dist/**', '**/build/**']);
    });
});

describe('walkProject', () => {
    const files = {
        'src/a.tsx': '',
        'src/features/target/Card.tsx': '',
        'src/build/b.tsx': '',
        'coverage/index.html': '',
        'node_modules/pkg/index.js': '',
        '.cache/x.js': '',
        'legacy/old.tsx': '',
    };

    it('skips the named directories at any depth, and dot directories', () => {
        const root = project(files);
        expect(walked(root, { skipDirs: DEPENDENCY_OUTPUT_DIRS })).toEqual([
            'coverage/index.html',
            'legacy/old.tsx',
            'src/a.tsx',
            'src/features/target/Card.tsx',
        ]);
        expect(walked(root, { skipDirs: STYLESHEET_WALK_SKIP_DIRS })).toEqual([
            'legacy/old.tsx',
            'src/a.tsx',
        ]);
    });

    it('enters dot directories when asked, and prunes what the caller names', () => {
        const root = project(files);
        expect(
            walked(root, {
                skipDirs: DEPENDENCY_OUTPUT_DIRS,
                skipDotDirs: false,
                prune: dir => dir.endsWith('legacy'),
            }),
        ).toEqual([
            '.cache/x.js',
            'coverage/index.html',
            'src/a.tsx',
            'src/features/target/Card.tsx',
        ]);
    });

    it('reads nothing under a root that does not exist', () => {
        expect(walked(join(tmpdir(), 'csszyx-no-such-root'), { skipDirs: new Set() })).toEqual([]);
    });
});
