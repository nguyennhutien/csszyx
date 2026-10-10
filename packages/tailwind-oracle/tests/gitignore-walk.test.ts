/**
 * The project walk reads `.gitignore` the way Tailwind's own Scanner does.
 *
 * The stylesheet and markup walks follow `.gitignore` so a coverage report, a
 * stale `out/` copy or any other ignored artefact stops feeding theme tokens
 * and merge hooks. Tailwind already skips those files for class candidates;
 * reading them differently would make csszyx keep or drop a class over a file
 * Tailwind never looked at. So each fixture below is walked twice — by the
 * Scanner of the Tailwind this repository installs, and by `walkProject` — and
 * the two must find the same files.
 */
import { execFileSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadCandidateScanner } from '../src/candidate-scanner.js';
import { createGitignoreQuery, type GitignoreMode, walkProject } from '../src/project-walk.js';

const REPO = resolve(import.meta.dirname, '../../..');
const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * Write files under a fresh temporary directory.
 *
 * @param files - Paths relative to it, with their content.
 * @returns The directory.
 */
function tree(files: Record<string, string>): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-gitignore-walk-')));
    roots.push(root);
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), content);
    }
    return root;
}

/**
 * Turn a directory into a git repository.
 *
 * @param dir - The directory.
 */
function gitInit(dir: string): void {
    execFileSync('git', ['init', '-q'], { cwd: dir });
}

/**
 * A source whose only class candidate names the file.
 *
 * @param token - The candidate.
 * @returns Its text.
 */
const source = (token: string): string => `export const a = "cls-${token}";\n`;

/**
 * Whether the temporary folder tells `Gen` from `gen`. macOS's default APFS
 * volume does not, so there `Gen/g.tsx` and `gen/g.tsx` are one file and the
 * case marker below cannot be written; Linux CI keeps it.
 */
const CASE_SENSITIVE_FS = ((): boolean => {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-case-'));
    try {
        writeFileSync(join(dir, 'a'), '');
        return !existsSync(join(dir, 'A'));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
})();

/** The app every fixture holds: one marker per rule the walk has to read. */
const APP: Record<string, string> = {
    '.gitignore': 'gen/\n*.generated.tsx\nsub/keepdir/*\n!sub/keepdir/keep.tsx\n',
    'sub/.gitignore': 'local/\n',
    'src/a.tsx': source('src'),
    'src/x.generated.tsx': source('generatedsuffix'),
    'gen/g.tsx': source('gen'),
    'Gen2/gen/deep.tsx': source('gendeep'),
    ...(CASE_SENSITIVE_FS ? { 'Gen/g.tsx': source('gencase') } : {}),
    'sub/local/l.tsx': source('sublocal'),
    'sub/a.tsx': source('sub'),
    'sub/keepdir/keep.tsx': source('keep'),
    'sub/keepdir/drop.tsx': source('drop'),
    'src/fromparent.tsx': source('fromparent'),
};

/** How many sources `APP` holds, and how many files in all. */
const APP_SOURCES = Object.keys(APP).filter(file => file.endsWith('.tsx')).length;
const APP_FILES = Object.keys(APP).length;

/**
 * The candidates Tailwind's Scanner reads under a base.
 *
 * @param base - Directory scanned with `**\/*`.
 * @returns The `cls-` candidates, sorted.
 */
function tailwindSees(base: string): string[] {
    const scan = loadCandidateScanner(REPO);
    if (scan === null) throw new Error('the repository installs no Tailwind Scanner');
    return scan([{ base, pattern: '**/*', negated: false }])
        .filter(candidate => candidate.startsWith('cls-'))
        .sort();
}

/**
 * The candidates in the files a walk keeps.
 *
 * @param base - Directory walked.
 * @param mode - How the walk treats `.gitignore`.
 * @returns The `cls-` candidates, sorted.
 */
function walkSees(base: string, mode: GitignoreMode = 'skip'): string[] {
    const found: string[] = [];
    walkProject(base, { skipDirs: new Set(), gitignore: mode }, file => {
        if (file.gitignored) return;
        const match = /cls-[a-z]+/.exec(readFileSync(file.path, 'utf8'));
        if (match) found.push(match[0]);
    });
    return found.sort();
}

describe('the .gitignore reader against Tailwind’s Scanner', () => {
    it.each([
        ['with no git repository', false],
        ['inside a git repository', true],
    ])('reads nested files, negation and case %s', (_name, git) => {
        const root = tree(APP);
        if (git) gitInit(root);
        expect(walkSees(root)).toEqual(tailwindSees(root));
        expect(walkSees(root)).toEqual(
            [
                'cls-fromparent',
                CASE_SENSITIVE_FS ? 'cls-gencase' : null,
                'cls-keep',
                'cls-src',
                'cls-sub',
            ].filter(token => token !== null),
        );
    });

    it.each([
        ['a git repository', true],
        ['a plain folder', false],
    ])('reads a parent folder’s .gitignore when the parent is %s', (_name, git) => {
        const parent = tree({ '.gitignore': 'app/src/fromparent.tsx\n' });
        if (git) gitInit(parent);
        const root = join(parent, 'app');
        for (const [file, content] of Object.entries(APP)) {
            mkdirSync(dirname(join(root, file)), { recursive: true });
            writeFileSync(join(root, file), content);
        }
        expect(walkSees(root)).toEqual(tailwindSees(root));
        expect(walkSees(root)).not.toContain('cls-fromparent');
    });

    it('stops at the nearest repository: a parent above it does not apply', () => {
        const parent = tree({ '.gitignore': 'app/src/fromparent.tsx\n' });
        gitInit(parent);
        const root = join(parent, 'app');
        for (const [file, content] of Object.entries(APP)) {
            mkdirSync(dirname(join(root, file)), { recursive: true });
            writeFileSync(join(root, file), content);
        }
        gitInit(root);
        expect(walkSees(root)).toEqual(tailwindSees(root));
        expect(walkSees(root)).toContain('cls-fromparent');
    });

    it('skips a tracked file a pattern matches, as Tailwind does', () => {
        const root = tree(APP);
        gitInit(root);
        execFileSync('git', ['add', '-f', 'gen/g.tsx'], { cwd: root });
        expect(walkSees(root)).toEqual(tailwindSees(root));
        expect(walkSees(root)).not.toContain('cls-gen');
    });
});

describe('the gitignore modes', () => {
    it('marks what it would skip when asked to read everything', () => {
        const root = tree(APP);
        const marked: string[] = [];
        const all: string[] = [];
        walkProject(root, { skipDirs: new Set(), gitignore: 'mark' }, file => {
            const token = /cls-[a-z]+/.exec(readFileSync(file.path, 'utf8'))?.[0];
            if (token === undefined) return;
            all.push(token);
            if (file.gitignored) marked.push(token);
        });
        expect(all.sort()).toHaveLength(APP_SOURCES);
        expect(marked.sort()).toEqual([
            'cls-drop',
            'cls-gen',
            'cls-gendeep',
            'cls-generatedsuffix',
            'cls-sublocal',
        ]);
    });

    it('reads no .gitignore when off, and lists the ones it read otherwise', () => {
        const root = tree(APP);
        expect(walkSees(root, 'off')).toHaveLength(APP_SOURCES);
        const read = walkProject(root, { skipDirs: new Set(), gitignore: 'skip' }, () => {});
        expect(read.gitignoreFiles.map(file => file.slice(root.length + 1)).sort()).toEqual([
            '.gitignore',
            'sub/.gitignore',
        ]);
    });
});

describe('createGitignoreQuery', () => {
    it('answers for one path what the walk decides for it', () => {
        const parent = tree({ '.gitignore': 'app/src/fromparent.tsx\n' });
        const root = join(parent, 'app');
        for (const [file, content] of Object.entries(APP)) {
            mkdirSync(dirname(join(root, file)), { recursive: true });
            writeFileSync(join(root, file), content);
        }
        const decided = new Map<string, boolean>();
        walkProject(root, { skipDirs: new Set(), gitignore: 'mark' }, file => {
            decided.set(file.path, file.gitignored);
        });
        const query = createGitignoreQuery(root);
        expect(decided.size).toBe(APP_FILES);
        for (const [file, gitignored] of decided)
            expect([file, query(file)]).toEqual([file, gitignored]);
    });

    it('answers false for the root and for paths outside it', () => {
        const root = tree(APP);
        const query = createGitignoreQuery(root);
        expect(query(root)).toBe(false);
        expect(query(join(root, '..', 'gen', 'g.tsx'))).toBe(false);
        expect(query(join(root, 'gen', 'g.tsx'))).toBe(true);
    });
});

/**
 * Write files under a folder that already exists.
 *
 * @param dir - The folder.
 * @param files - Paths relative to it, with their content.
 * @returns The folder.
 */
function writeUnder(dir: string, files: Record<string, string>): string {
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        writeFileSync(join(dir, file), content);
    }
    return dir;
}

/**
 * Every file a `mark` walk visits, against what a fresh query says of it.
 *
 * @param root - Directory walked.
 * @returns Pairs of the walk's verdict and the query's, keyed by path.
 */
function walkAgainstQuery(root: string): Array<[string, boolean, boolean]> {
    const query = createGitignoreQuery(root);
    const pairs: Array<[string, boolean, boolean]> = [];
    walkProject(root, { skipDirs: new Set(), gitignore: 'mark' }, file => {
        pairs.push([file.path.slice(root.length + 1), file.gitignored, query(file.path)]);
    });
    return pairs.sort(([a], [b]) => a.localeCompare(b));
}

describe('a nested .gitignore re-including a folder an outer one ignores', () => {
    /** `x/.gitignore` takes `x/gen/` back; `y/.gitignore` cannot take `y/out/deep/` back. */
    const NESTED: Record<string, string> = {
        '.gitignore': 'gen/\nout/\n',
        'x/.gitignore': '!gen/\n',
        'x/gen/a.tsx': source('xgen'),
        'x/gen/deep/b.tsx': source('xgendeep'),
        'gen/top.tsx': source('topgen'),
        'y/.gitignore': 'out/*\n!out/deep/\n',
        'y/out/c.tsx': source('yout'),
        'y/out/deep/d.tsx': source('youtdeep'),
    };

    it.each([
        ['with no git repository', false],
        ['inside a git repository', true],
    ])('keeps what git and Tailwind keep %s', (_name, git) => {
        const root = tree(NESTED);
        if (git) gitInit(root);
        expect(walkSees(root)).toEqual(tailwindSees(root));
        expect(walkSees(root)).toEqual(['cls-xgen', 'cls-xgendeep']);
        expect(walkSees(root, 'mark')).toEqual(['cls-xgen', 'cls-xgendeep']);
    });

    it('is what git itself ignores', () => {
        const root = tree(NESTED);
        gitInit(root);
        const ignoredByGit = execFileSync(
            'git',
            ['ls-files', '--others', '--ignored', '--exclude-standard'],
            { cwd: root, encoding: 'utf8' },
        )
            .split('\n')
            .filter(line => line.endsWith('.tsx'))
            .sort();
        const marked = walkAgainstQuery(root)
            .filter(([, gitignored]) => gitignored)
            .map(([file]) => file)
            .sort();
        expect(marked).toEqual(ignoredByGit);
        expect(marked).toEqual(['gen/top.tsx', 'y/out/c.tsx', 'y/out/deep/d.tsx']);
    });

    it('answers the same through createGitignoreQuery', () => {
        const root = tree(NESTED);
        for (const [file, walked, queried] of walkAgainstQuery(root))
            expect([file, queried]).toEqual([file, walked]);
    });
});

describe('a parent .gitignore that ignores the walk’s root', () => {
    it.each([
        ['ignores the folder holding it', 'examples/\n', true],
        ['ignores the root by name', 'examples/demo\n*.tsx\n', false],
        ['ignores every folder below one', 'examples/*\n', true],
        [
            'takes the root back after ignoring its folder',
            'examples\n!examples/demo\n*.tsx\n',
            true,
        ],
        ['ignores only what is inside the root', 'examples/demo/src/\n', false],
    ])('reads what Tailwind reads when it %s', (_name, patterns, git) => {
        const repo = tree({ '.gitignore': patterns });
        if (git) gitInit(repo);
        const root = writeUnder(join(repo, 'examples', 'demo'), {
            ...APP,
            'src/A.tsx': source('demoa'),
        });
        const seen = walkSees(root);
        expect(seen).toEqual(tailwindSees(root));
        expect(walkSees(root, 'mark')).toEqual(seen);
        for (const [file, walked, queried] of walkAgainstQuery(root))
            expect([file, queried]).toEqual([file, walked]);
    });

    it('reads every file, its own .gitignore included, once the root itself is ignored', () => {
        // Tailwind's Scanner reads no `.gitignore` at all for a base that one
        // above it ignores: an app kept under an ignored `examples/` folder is
        // scanned whole. Skipping it whole instead would leave the walk with
        // no file and no word about why.
        const repo = tree({ '.gitignore': 'examples/\n' });
        gitInit(repo);
        const root = writeUnder(join(repo, 'examples', 'demo'), APP);
        expect(walkSees(root)).toHaveLength(APP_SOURCES);
        const read = walkProject(root, { skipDirs: new Set(), gitignore: 'skip' }, () => {});
        expect(read.gitignoreFiles).toEqual([join(repo, '.gitignore')]);
    });
});

describe('parent .gitignore layers that disagree about the walk’s root', () => {
    /** An app under `apps/web` whose own `.gitignore` leaves `gen/` out. */
    const WEB: Record<string, string> = {
        'apps/web/.gitignore': 'gen/\n',
        'apps/web/gen/g.tsx': source('webgen'),
        'apps/web/k.tsx': source('webkeep'),
    };

    it.each([
        ['an outer one ignores it and an inner one takes it back', 'web/\n', '!web/\n'],
        ['an outer one ignores its folder and an inner one takes it back', 'apps/\n', '!web/\n'],
        ['an inner one ignores it and an outer one takes it back', '!apps/web/\n', 'web/\n'],
        ['the outermost one ignores its own folder with `/`', '/\n', ''],
        ['an outer `/` ignores its folder and an inner one takes the root back', '/\n', '!web/\n'],
    ])('reads every file, as Tailwind does, when %s', (_name, top, apps) => {
        // Tailwind asks every layer about the root, and any layer that ignores
        // it settles the question; an inner layer taking it back does not
        // stop the outer ones from being asked.
        const repo = tree({ '.gitignore': top, 'apps/.gitignore': apps, ...WEB });
        gitInit(repo);
        const root = join(repo, 'apps', 'web');
        expect(walkSees(root)).toEqual(tailwindSees(root));
        expect(walkSees(root)).toEqual(['cls-webgen', 'cls-webkeep']);
        for (const [file, walked, queried] of walkAgainstQuery(root))
            expect([file, queried]).toEqual([file, walked]);
    });
});

describe('a parent .gitignore that ignores its own folder', () => {
    it('is answered by a nearer folder first, as Tailwind does', () => {
        // `apps` is asked before the folder holding the `.gitignore`, so the
        // `!apps/` takes the root back before `/` is reached.
        const repo = tree({
            '.gitignore': '/\n!apps/\n',
            'apps/web/.gitignore': 'gen/\n',
            'apps/web/gen/g.tsx': source('webgen'),
            'apps/web/k.tsx': source('webkeep'),
        });
        gitInit(repo);
        const root = join(repo, 'apps', 'web');
        expect(walkSees(root)).toEqual(tailwindSees(root));
        expect(walkSees(root)).toEqual(['cls-webkeep']);
    });
});

describe('a root whose own .gitignore matches the root itself', () => {
    /**
     * A root holding `.gitignore` = `gen/` plus one pattern, and a file in
     * each place a pattern could leave out.
     *
     * @param pattern - The last line of the root's `.gitignore`.
     * @param sub - Whether the root is a folder inside the repository rather
     *        than its top.
     * @returns The root.
     */
    function rootWith(pattern: string, sub: boolean): string {
        const repo = tree({});
        gitInit(repo);
        return writeUnder(sub ? join(repo, 'app') : repo, {
            '.gitignore': `gen/\n${pattern}\n`,
            'gen/g.tsx': source('owngen'),
            'k.tsx': source('ownkeep'),
            'sub/s.tsx': source('ownsub'),
        });
    }

    it.each([
        ['*', false],
        ['*', true],
        ['**', false],
        ['*/', true],
        ['/*', false],
        ['**/*', false],
        ['/**/', true],
        ['/', false],
        ['* ', false],
        ['*\n!k.tsx', true],
    ])(
        'reads every file, as Tailwind does, for `%s` (inside the repository: %s)',
        (pattern, sub) => {
            // The pattern matches the empty path, the root asked about itself, and
            // Tailwind then reads no `.gitignore` at all for that base.
            const root = rootWith(pattern, sub);
            expect(walkSees(root)).toEqual(tailwindSees(root));
            expect(walkSees(root)).toEqual(['cls-owngen', 'cls-ownkeep', 'cls-ownsub']);
            expect(walkSees(root, 'mark')).toEqual(walkSees(root));
            const read = walkProject(root, { skipDirs: new Set(), gitignore: 'skip' }, () => {});
            expect(read.gitignoreFiles).toContain(join(root, '.gitignore'));
            for (const [file, walked, queried] of walkAgainstQuery(root))
                expect([file, queried]).toEqual([file, walked]);
        },
    );

    it.each([
        ['gen'],
        ['*\n!*/\n!k.tsx'],
        ['*/*'],
        ['*/**'],
        ['\\!*'],
        ['#*'],
        ['*\\ '],
        ['?'],
        ['a*'],
        ['./'],
        ['///'],
        ['***/*'],
    ])('is applied as usual, as Tailwind does, for `%s`', pattern => {
        const root = rootWith(pattern, false);
        expect(walkSees(root)).toEqual(tailwindSees(root));
        expect(walkSees(root)).not.toContain('cls-owngen');
        for (const [file, walked, queried] of walkAgainstQuery(root))
            expect([file, queried]).toEqual([file, walked]);
    });
});

describe('a relative root', () => {
    it('is the folder it names, so its own .gitignore is not read as a parent’s', () => {
        const repo = tree({
            '.gitignore': 'gen/\n',
            'app/.gitignore': 'local/\n',
            'app/gen/g.tsx': source('relgen'),
            'app/local/l.tsx': source('rellocal'),
            'app/k.tsx': source('relkeep'),
        });
        gitInit(repo);
        const previous = process.cwd();
        process.chdir(join(repo, 'app'));
        try {
            const visited: string[] = [];
            const read = walkProject('.', { skipDirs: new Set(), gitignore: 'skip' }, file =>
                visited.push(file.path),
            );
            expect(visited.filter(file => file.endsWith('.tsx'))).toEqual([
                join(repo, 'app', 'k.tsx'),
            ]);
            expect(read.gitignoreFiles).toEqual([
                join(repo, '.gitignore'),
                join(repo, 'app', '.gitignore'),
            ]);
            const query = createGitignoreQuery('.');
            expect(query(join(repo, 'app', 'gen', 'g.tsx'))).toBe(true);
            expect(query(join('local', 'l.tsx'))).toBe(true);
            expect(query('k.tsx')).toBe(false);
        } finally {
            process.chdir(previous);
        }
    });
});
