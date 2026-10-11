/**
 * The shared project walk and the two skip sets its callers choose between.
 */
import fs, {
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

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
    vi.restoreAllMocks();
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

/**
 * Stand in for `fs.realpathSync` as it answers on a case-insensitive
 * filesystem (macOS, Windows): the JavaScript realpath keeps the spelling it
 * was given or read from a link, while `realpathSync.native` asks the
 * filesystem and gets the folder's own spelling back.
 *
 * @param spelled - The answer to give, per path asked about; any other path
 *        gets the native answer.
 */
function caseKeepingRealpath(spelled: Record<string, string>): void {
    const native = fs.realpathSync.native;
    const keepCase = Object.assign(
        (target: fs.PathLike) => spelled[String(target)] ?? native(target),
        { native },
    );
    vi.spyOn(fs, 'realpathSync').mockImplementation(keepCase as typeof fs.realpathSync);
}

describe('walkProject on a case-insensitive filesystem', () => {
    // A link spelled `../SRC` for `src` names a folder the walk is already
    // inside; compared as spelled, it was entered once more.
    it('stops at a link to a folder it is inside, spelled in another case', () => {
        const root = project({ 'src/x.tsx': '' });
        symlinkSync('../src', join(root, 'src/up'));
        caseKeepingRealpath({ [join(root, 'src/up')]: join(root, 'SRC') });
        expect(walked(root, { skipDirs: new Set() })).toEqual(['src/x.tsx']);
    });

    it('stops at a link back to a root given in another case', () => {
        const top = project({ 'app/x.tsx': '' });
        // Linux cannot spell `app` as `APP`; a link stands in for it. On a
        // case-insensitive filesystem `APP` already is `app`.
        if (!fs.existsSync(join(top, 'APP'))) symlinkSync('app', join(top, 'APP'));
        symlinkSync('../app', join(top, 'app/up'));
        caseKeepingRealpath({ [join(top, 'app')]: join(top, 'APP') });
        expect(walked(join(top, 'app'), { skipDirs: new Set() })).toEqual(['x.tsx']);
    });
});
