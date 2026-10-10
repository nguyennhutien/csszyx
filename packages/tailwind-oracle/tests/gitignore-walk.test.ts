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
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

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

/**
 * Write files and symbolic links under a fresh temporary directory.
 *
 * @param files - Paths relative to it, with their content.
 * @param links - Link paths relative to it, each with the target written
 *        into the link as given (relative to the link's folder).
 * @returns The directory.
 */
function linkedTree(files: Record<string, string>, links: Record<string, string>): string {
    const root = tree(files);
    for (const [link, target] of Object.entries(links)) {
        mkdirSync(dirname(join(root, link)), { recursive: true });
        symlinkSync(target, join(root, link));
    }
    return root;
}

/**
 * The files a walk visits and the verdict on each, relative to a folder.
 *
 * @param root - Directory walked.
 * @param mode - How the walk treats `.gitignore`.
 * @param from - The folder the paths are made relative to.
 * @returns `path` for a kept file, `path (ignored)` for a marked one, sorted.
 */
function walkedFiles(root: string, mode: GitignoreMode, from = root): string[] {
    const files: string[] = [];
    walkProject(root, { skipDirs: new Set(['node_modules']), gitignore: mode }, file => {
        if (file.path.endsWith('.gitignore')) return;
        const name = relative(from, file.path).split(sep).join('/');
        files.push(file.gitignored ? `${name} (ignored)` : name);
    });
    return files.sort();
}

describe('symlinked folders and files', () => {
    // Tailwind 4.3.3's Scanner follows links (the `ignore` crate with
    // `follow_links`): it lists a linked folder's files under the link's path,
    // a folder reached by two paths once per path, and stops only at a link
    // whose target is a folder the walk is already inside.

    it('enters a linked folder inside the root and outside it, as Tailwind does', () => {
        const top = linkedTree(
            {
                'real/a.tsx': source('outside'),
                'app/k.tsx': source('keep'),
                'app/src/inner/b.tsx': source('inside'),
            },
            { 'app/linked': '../real', 'app/alias': 'src/inner', 'app/twice': '../real' },
        );
        const root = join(top, 'app');
        expect(walkedFiles(root, 'skip')).toEqual([
            'alias/b.tsx',
            'k.tsx',
            'linked/a.tsx',
            'src/inner/b.tsx',
            'twice/a.tsx',
        ]);
        expect([...new Set(walkSees(root))]).toEqual(tailwindSees(root));
    });

    it.each([
        [
            'a link to the folder above it',
            { 'a/x.tsx': source('x') },
            { 'a/link': '..' },
            '',
            ['a/x.tsx'],
        ],
        [
            'a link to its own folder',
            { 'a/x.tsx': source('x') },
            { 'a/link': '.' },
            '',
            ['a/x.tsx'],
        ],
        [
            'two folders linking to each other',
            { 'a/x.tsx': source('x'), 'b/y.tsx': source('y') },
            { 'a/l': '../b', 'b/l': '../a' },
            '',
            ['a/l/y.tsx', 'a/x.tsx', 'b/l/x.tsx', 'b/y.tsx'],
        ],
        [
            'a link out of the root to a folder above it',
            { 'app/k.tsx': source('k'), 'o.tsx': source('o') },
            { 'app/up': '..' },
            'app',
            ['app/k.tsx', 'app/up/app/k.tsx', 'app/up/o.tsx'],
        ],
    ])('stops at %s, where Tailwind stops', (_name, files, links, sub, expected) => {
        const top = linkedTree(files, links);
        const root = join(top, sub);
        expect(walkedFiles(root, 'skip', top)).toEqual(expected);
        expect([...new Set(walkSees(root))]).toEqual(tailwindSees(root));
    });

    it('leaves out a broken link and a link loop, as Tailwind does', () => {
        const root = linkedTree(
            { 'k.tsx': source('keep') },
            { gone: 'nowhere', 'gone.tsx': 'nowhere.tsx', 'loop-a': 'loop-b', 'loop-b': 'loop-a' },
        );
        expect(walkedFiles(root, 'mark')).toEqual(['k.tsx']);
        expect(walkedFiles(root, 'off')).toEqual(['k.tsx']);
        expect(walkSees(root)).toEqual(tailwindSees(root));
    });

    it('visits nothing under a root that does not exist', () => {
        expect(walkedFiles(join(tree({}), 'missing'), 'skip')).toEqual([]);
    });

    it('visits a linked file under its link’s path', () => {
        const top = linkedTree(
            { 'real/f.tsx': source('linkedfile'), 'app/k.tsx': source('keep') },
            { 'app/fl.tsx': '../real/f.tsx' },
        );
        const root = join(top, 'app');
        expect(walkedFiles(root, 'skip')).toEqual(['fl.tsx', 'k.tsx']);
        expect(walkSees(root)).toEqual(tailwindSees(root));
    });

    it('skips a linked folder by the link’s name', () => {
        const top = linkedTree({ 'real/a.tsx': source('deps') }, { 'app/node_modules': '../real' });
        expect(walkedFiles(join(top, 'app'), 'skip')).toEqual([]);
    });

    it.each([
        [
            'ignores the link as a folder',
            { '.gitignore': 'alias/\n' },
            ['fl.tsx', 'src/inner/b.tsx'],
        ],
        ['ignores the link by name', { '.gitignore': 'alias\n' }, ['fl.tsx', 'src/inner/b.tsx']],
        [
            'ignores the target, not the link',
            { '.gitignore': 'src/inner/\n' },
            ['alias/b.tsx', 'fl.tsx'],
        ],
        [
            'takes the link back as a folder',
            { '.gitignore': 'alias\n!alias/\n' },
            ['alias/b.tsx', 'fl.tsx', 'src/inner/b.tsx'],
        ],
        [
            'is the linked folder’s own, read under the link',
            { 'src/inner/.gitignore': 'gen/\n', 'src/inner/gen/g.tsx': source('gen') },
            ['alias/b.tsx', 'fl.tsx', 'src/inner/b.tsx'],
        ],
        [
            'names a path through the link',
            { '.gitignore': 'alias/gen/\n', 'src/inner/gen/g.tsx': source('gen') },
            ['alias/b.tsx', 'fl.tsx', 'src/inner/b.tsx', 'src/inner/gen/g.tsx'],
        ],
        // Measured with the Scanner's file list: `fl.tsx` here is left out, and a
        // `.gitignore` naming `other.tsx` leaves the link in.
        [
            'ignores a linked file by the link’s path',
            { '.gitignore': 'fl.tsx\n' },
            ['alias/b.tsx', 'src/inner/b.tsx'],
        ],
        [
            'ignores a linked file’s target, not the link',
            { '.gitignore': 'other.tsx\n' },
            ['alias/b.tsx', 'fl.tsx', 'src/inner/b.tsx'],
        ],
    ])('reads a .gitignore that %s, as Tailwind does', (_name, extra, expected) => {
        const root = linkedTree(
            { 'src/inner/b.tsx': source('inside'), 'other.tsx': '', ...extra },
            { alias: 'src/inner', 'fl.tsx': 'other.tsx' },
        );
        gitInit(root);
        const kept = walkedFiles(root, 'skip').filter(file => file !== 'other.tsx');
        expect(kept).toEqual(expected);
        expect([...new Set(walkSees(root))]).toEqual(tailwindSees(root));
        const marked = walkedFiles(root, 'mark').filter(file => !file.endsWith('(ignored)'));
        expect(marked).toEqual(walkedFiles(root, 'skip'));
        for (const [file, walked, queried] of walkAgainstQuery(root))
            expect([file, queried]).toEqual([file, walked]);
    });
});

describe('a walk root that is itself a link', () => {
    // Measured with Tailwind 4.3.3's Scanner: a base that is a link is
    // canonicalized first, so its files are listed under the real path and the
    // parent `.gitignore`s that apply are the real location's, not the link's.
    // The walk takes the same files by the same `.gitignore`s and hands them
    // back under the path its caller gave, which every caller compares with.

    /**
     * `link/app` links to `real/app`; each parent ignores a different folder.
     *
     * @param git - Whether both parents are repositories.
     * @returns The top folder and the root as the caller names it.
     */
    function linkedRoot(git: boolean): { top: string; root: string } {
        const top = linkedTree(
            {
                'real/.gitignore': 'gen/\n',
                'real/app/gen/a.tsx': source('realignored'),
                'real/app/other/b.tsx': source('linkignored'),
                'real/app/k.tsx': source('keep'),
                'real/app/.gitignore': 'local.tsx\n',
                'real/app/local.tsx': source('local'),
                'link/.gitignore': 'other/\n',
            },
            { 'link/app': '../real/app' },
        );
        if (git) {
            gitInit(join(top, 'real'));
            gitInit(join(top, 'link'));
        }
        return { top, root: join(top, 'link', 'app') };
    }

    it.each([
        ['with no git repository', false],
        ['inside git repositories', true],
    ])('reads the real location’s parent .gitignore %s, as Tailwind does', (_name, git) => {
        const { root } = linkedRoot(git);
        expect(walkSees(root)).toEqual(tailwindSees(root));
        expect(walkSees(root)).toEqual(['cls-keep', 'cls-linkignored']);
        expect(walkSees(root, 'mark')).toEqual(['cls-keep', 'cls-linkignored']);
    });

    it('hands every path back under the link, and names the .gitignores it read', () => {
        const { top, root } = linkedRoot(true);
        const visited: string[] = [];
        const pruned: string[] = [];
        const { gitignoreFiles } = walkProject(
            root,
            {
                skipDirs: new Set(),
                gitignore: 'skip',
                prune: dir => {
                    pruned.push(dir);
                    return false;
                },
            },
            file => visited.push(file.path),
        );
        expect(visited.sort()).toEqual(
            ['.gitignore', 'k.tsx', 'other/b.tsx'].map(file => join(root, file)),
        );
        expect(pruned.sort()).toEqual([join(root, 'gen'), join(root, 'other')]);
        expect(gitignoreFiles).toEqual([join(top, 'real/.gitignore'), join(root, '.gitignore')]);
    });

    it('answers a query under either spelling the way the walk decides', () => {
        const { top, root } = linkedRoot(false);
        const query = createGitignoreQuery(root);
        expect(query(join(root, 'gen/a.tsx'))).toBe(true);
        expect(query(join(root, 'local.tsx'))).toBe(true);
        expect(query(join(root, 'other/b.tsx'))).toBe(false);
        expect(query(join(top, 'real/app/gen/a.tsx'))).toBe(true);
        expect(query(join(top, 'real/app/k.tsx'))).toBe(false);
        expect(query(join(top, 'real/app'))).toBe(false);
        expect(query(join(top, 'real/x.tsx'))).toBe(false);
        for (const [file, walked, queried] of walkAgainstQuery(root))
            expect([file, queried]).toEqual([file, walked]);
    });
});
