/**
 * The stylesheet walk: what `.gitignore` leaves out, and the imports that bring
 * a gitignored stylesheet back.
 */
import fs, {
    existsSync,
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import { isCsszyxError } from '@csszyx/compiler/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';

import packageJson from '../package.json' with { type: 'json' };

import { walkProject, walkProjectStylesheets } from '../src/project-walk.js';

const roots: string[] = [];

/**
 * Whether the temporary folder tells `upper.css` from `upper.CSS`. macOS's
 * default APFS volume does not, so there an extensionless import finds
 * `upper.CSS` by adding `.css` — for Tailwind's resolver as for the walk — and
 * the case where neither follows it exists only on Linux.
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

afterEach(() => {
    vi.doUnmock('ignore');
    vi.resetModules();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * Write files under a fresh temporary directory.
 *
 * @param files - Paths relative to it, with their content.
 * @returns The directory.
 */
function tree(files: Record<string, string>): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-stylesheet-walk-')));
    roots.push(root);
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), content);
    }
    return root;
}

/**
 * The stylesheets a walk of some bases finds, relative to a root and sorted.
 *
 * @param root - What the paths are made relative to.
 * @param bases - Folders walked.
 * @returns Relative posix paths.
 */
function stylesheets(root: string, bases: readonly string[] = [root]): string[] {
    return walkProjectStylesheets(bases)
        .files.map(file => relative(root, file).split(sep).join('/'))
        .sort();
}

describe('a gitignored stylesheet another one imports', () => {
    // Each import below is one Tailwind's own `compile()` (@tailwindcss/node
    // 4.3.3) follows: the walk reads the files Tailwind reads, no more.
    it.each([
        ['a quoted string', '"../gen/theme.css"', 'theme.css'],
        ['a single-quoted string', "'../gen/theme.css'", 'theme.css'],
        ['an apostrophe inside double quotes', '"../gen/it\'s.css"', "it's.css"],
        ['an upper-case extension', '"../gen/theme.CSS"', 'theme.CSS'],
        ['no extension, `.css` added', '"../gen/theme"', 'theme.css'],
        ['no extension, the file itself', '"../gen/theme"', 'theme'],
        ['another extension', '"../gen/theme.scss"', 'theme.scss'],
        ['a folder, by its index.css', '"../gen/theme"', 'theme/index.css'],
        ['a folder, by its package.json style', '"../gen/pkg"', 'pkg/main.css'],
        ['a folder whose package.json style names a folder', '"../gen/pkg"', 'pkg/main/index.css'],
        ['a folder whose package.json style names nothing', '"../gen/pkg"', 'pkg/index.css'],
        ['a folder whose package.json is not JSON', '"../gen/bad"', 'bad/index.css'],
        ['a folder whose package.json style is not a string', '"../gen/num"', 'num/index.css'],
        ['an absolute path', 'ABSOLUTE', 'theme.css'],
        ['a comment before the string', '/* c */ "../gen/theme.css"', 'theme.css'],
        ['a line break before the string', '\n  "../gen/theme.css"', 'theme.css'],
    ])('is read when the import names it with %s', (_name, specifier, file) => {
        const root = tree({
            '.gitignore': 'gen/\n',
            [`gen/${file}`]: '@theme { --color-brand: #123456; }\n',
            'gen/unused.css': '@theme { --color-unused: #000; }\n',
            'gen/pkg/package.json':
                file === 'pkg/index.css' ? '{"style":"missing.css"}' : '{"style":"main"}',
            'gen/bad/package.json': '{',
            'gen/num/package.json': '{"style":1}',
        });
        const written = specifier === 'ABSOLUTE' ? `"${join(root, 'gen', file)}"` : specifier;
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(
            join(root, 'src/app.css'),
            `@import "tailwindcss";\n@import ${written} layer(theme);\n`,
        );
        expect(stylesheets(root)).toEqual([`gen/${file}`, 'src/app.css']);
    });

    it.each([
        ['a quoted path', '@reference "../gen/theme.css";'],
        ['no extension', "@reference '../gen/theme';"],
        ['a comment before the string', '@reference /* c */ "../gen/theme.css";'],
        ['a block around it', '.y { @reference "../gen/theme.css"; }'],
    ])(
        'is read when @reference names it with %s, as Tailwind compiles it as an import',
        (_name, line) => {
            const root = tree({
                '.gitignore': 'gen/\n',
                'src/app.css': `${line}\n`,
                'gen/theme.css': '@theme { --color-brand: #123456; }\n',
            });
            expect(stylesheets(root)).toEqual(['gen/theme.css', 'src/app.css']);
        },
    );

    it('is read when the import sits inside a block', () => {
        const root = tree({
            '.gitignore': 'gen/\n',
            'src/app.css':
                '@media screen { @import "../gen/a.css"; }\n.y { @import "../gen/b.css"; }\n',
            'gen/a.css': '.a {}\n',
            'gen/b.css': '.b {}\n',
        });
        expect(stylesheets(root)).toEqual(['gen/a.css', 'gen/b.css', 'src/app.css']);
    });

    it.each([
        ['an unquoted url()', '@import url(../gen/theme.css);'],
        ['an unquoted url() with spaces inside', '@import url( ../gen/theme.css );'],
        ['a double-quoted url()', '@import url("../gen/theme.css");'],
        ['a single-quoted url()', "@import url('../gen/theme.css');"],
        ['no space after @import', '@import"../gen/theme.css";'],
        ['an upper-case @IMPORT', '@IMPORT "../gen/theme.css";'],
        ['a longer at-rule name', '@imports "../gen/theme.css";'],
        ['an escaped @', '\\@import "../gen/theme.css";'],
        ['@import inside a string', '.x { content: "@import \'../gen/theme.css\'"; }'],
        [
            '@import after an escaped quote inside a string',
            '.x { content: "\\"; @import \'../gen/theme.css\';"; }',
        ],
        ['a bare path, which Tailwind resolves as a package', '@import "gen/theme.css";'],
        ['a query, which Tailwind keeps in the file name', '@import "../gen/theme.css?inline";'],
        ...(CASE_SENSITIVE_FS
            ? [['an upper-case extension Tailwind does not add', '@import "../gen/upper";']]
            : []),
        ['an unterminated string', '@import "../gen/theme.css'],
        ['inside an unterminated comment', '@import /* "../gen/theme.css";'],
        ['nothing after @import', '@import '],
        ['a url() after @reference', '@reference url(../gen/theme.css);'],
        ['an upper-case @REFERENCE', '@REFERENCE "../gen/theme.css";'],
        ['no space after @reference', '@reference"../gen/theme.css";'],
        ['a longer name than @reference', '@references "../gen/theme.css";'],
        ['@reference inside a comment', '/* @reference "../gen/theme.css"; */'],
    ])('is not read when the import is %s, which Tailwind does not follow', (_name, line) => {
        const root = tree({
            '.gitignore': 'gen/\n',
            'src/app.css': `${line}\n`,
            'gen/theme.css': '@theme { --color-brand: #123456; }\n',
            'gen/upper.CSS': '@theme { --color-brand: #123456; }\n',
        });
        expect(stylesheets(root)).toEqual(['src/app.css']);
    });

    it('is not read when the import is commented out', () => {
        const root = tree({
            '.gitignore': 'gen/\n',
            'src/app.css': '/* @import url(../gen/theme.css); */\n',
            'gen/theme.css': '@theme { --color-brand: #123456; }\n',
        });
        expect(stylesheets(root)).toEqual(['src/app.css']);
    });

    it('is not read from outside every walked base', () => {
        // The base is `src/`; `../gen/theme.css` exists, but no walk of this
        // project would have reached it.
        const root = tree({
            'src/.gitignore': 'local/\n',
            'src/app.css': '@import "../gen/theme.css";\n@import "./local/l.css";\n',
            'src/local/l.css': '.l {}\n',
            'gen/theme.css': '@theme { --color-brand: #123456; }\n',
        });
        expect(stylesheets(root, [join(root, 'src')])).toEqual(['src/app.css', 'src/local/l.css']);
    });
});

describe('an import the walk does not follow', () => {
    it('adds nothing for a walked, missing, remote, non-CSS or caller-excluded target', () => {
        const root = tree({
            '.gitignore': 'gen/\n',
            'src/app.css': [
                '@import "./tokens.css";',
                '@import "./tokens.css?inline";',
                '@import url(./missing.css);',
                '@import url(https://example.com/remote.css);',
                '@import "tailwindcss";',
                '@import "../gen/excluded.css";',
                '@import "../gen/kept.css";',
                '',
            ].join('\n'),
            'src/tokens.css': '@import "./app.css";\n',
            'gen/excluded.css': '.e {}\n',
            'gen/kept.css': '.k {}\n',
        });
        const walked = walkProjectStylesheets([root], {
            ignoresFile: file => file.endsWith('excluded.css'),
        });
        const found = walked.files.map(file => relative(root, file).split(sep).join('/'));
        expect(found.slice(0, 2).sort()).toEqual(['src/app.css', 'src/tokens.css']);
        expect(found.slice(2)).toEqual(['gen/kept.css']);
    });
});

describe('an import the build’s own resolver expands', () => {
    // `@tailwindcss/vite` resolves every `@import` through Vite's resolver
    // first, so a `resolve.alias` reaches the file Tailwind reads (measured on
    // Vite 8.3.1). The lane hands the walk the paths its resolver tries.
    const ALIASED: Record<string, string> = {
        '.gitignore': 'src/gen/\n',
        'src/app.css':
            '@import "@/gen/theme.css";\n@import "@/gen/plain";\n@import "@/gen/notcss.tw";\n',
        'src/gen/theme.css': '@theme { --color-a: red; }\n',
        'src/gen/plain.css': '@theme { --color-b: red; }\n',
        'src/gen/notcss.tw': '@theme { --color-c: red; }\n',
    };

    /**
     * The stylesheets a walk finds with an `@` alias for `src`.
     *
     * @param root - The folder walked.
     * @param asked - Where each specifier the walk asks about is recorded.
     * @returns Relative posix paths, sorted.
     */
    function aliased(root: string, asked: string[] = []): string[] {
        return walkProjectStylesheets([root], {
            importCandidates: (specifier, fromDir) => {
                asked.push(`${specifier} from ${relative(root, fromDir) || '.'}`);
                return specifier.startsWith('@/') ? [join(root, 'src', specifier.slice(2))] : [];
            },
        })
            .files.map(file => relative(root, file).split(sep).join('/'))
            .sort();
    }

    it('follows an aliased import to a stylesheet, with `.css` added', () => {
        // Which answers count is the lane's: `@tailwindcss/vite` keeps a
        // `.css` one only, Vite's inlining in front of `@tailwindcss/postcss`
        // any. This lane answers `notcss.tw`, so it is read.
        expect(aliased(tree(ALIASED))).toEqual([
            'src/app.css',
            'src/gen/notcss.tw',
            'src/gen/plain.css',
            'src/gen/theme.css',
        ]);
    });

    it('follows none without the lane’s resolver', () => {
        expect(stylesheets(tree(ALIASED))).toEqual(['src/app.css']);
    });

    it('asks only about a specifier that is not a path', () => {
        const root = tree({
            'app.css': '@import "./a.css";\n@import "/abs.css";\n@import "pkg";\n',
            'a.css': '',
        });
        const asked: string[] = [];
        aliased(root, asked);
        expect(asked).toEqual(['pkg from .']);
    });

    it('keeps out a target outside every base or under a skipped folder', () => {
        const outside = tree({ 'theme.css': '@theme { --color-o: red; }\n' });
        const root = tree({
            'app.css': '@import "@/x";\n@import "@/y";\n',
            'node_modules/y.css': '',
        });
        const files = walkProjectStylesheets([root], {
            importCandidates: specifier =>
                specifier === '@/x' ? [join(outside, 'theme')] : [join(root, 'node_modules', 'y')],
        }).files;
        expect(files.map(file => relative(root, file))).toEqual(['app.css']);
    });

    it('takes the first candidate that names a file', () => {
        const root = tree({
            'app.css': '@import "@/t";\n',
            'b/t.css': '',
            'c/t.css': '',
        });
        const files = walkProjectStylesheets([root], {
            importCandidates: () => [
                join(root, 'a', 't'),
                join(root, 'b', 't'),
                join(root, 'c', 't'),
            ],
        }).files;
        expect(files.map(file => relative(root, file).split(sep).join('/')).sort()).toEqual([
            'app.css',
            'b/t.css',
            'c/t.css',
        ]);
        // Both `b/t.css` and `c/t.css` are walked as files of the base; with
        // `b/` gitignored only the first candidate comes back through the import.
        writeFileSync(join(root, '.gitignore'), 'b/\nc/\n');
        const again = walkProjectStylesheets([root], {
            importCandidates: () => [
                join(root, 'a', 't'),
                join(root, 'b', 't'),
                join(root, 'c', 't'),
            ],
        }).files;
        expect(again.map(file => relative(root, file).split(sep).join('/'))).toEqual([
            'app.css',
            'b/t.css',
        ]);
    });
});

describe('a .gitignore that is not a file', () => {
    it('is no layer: a folder of that name ignores nothing', () => {
        const root = tree({
            '.gitignore/readme.css': '.r {}\n',
            'src/app.css': '.a {}\n',
        });
        const visited: string[] = [];
        const read = walkProject(
            root,
            { skipDirs: new Set(), skipDotDirs: false, gitignore: 'skip' },
            file => visited.push(relative(root, file.path).split(sep).join('/')),
        );
        expect(visited.sort()).toEqual(['.gitignore/readme.css', 'src/app.css']);
        expect(read.gitignoreFiles).toEqual([]);
    });
});

describe('a stylesheet that cannot be read', () => {
    it('is listed with no text, and the walk goes on', () => {
        const root = tree({ 'src/app.css': '.a {}\n', 'src/locked.css': '.b {}\n' });
        const locked = join(root, 'src', 'locked.css');
        const read = fs.readFileSync;
        // A file the process may not read; `chmod` does not stop root, which
        // runs the container's tests.
        vi.spyOn(fs, 'readFileSync').mockImplementation(((file: string, ...rest: unknown[]) => {
            if (file === locked) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
            return (read as (...args: unknown[]) => unknown)(file, ...rest);
        }) as typeof fs.readFileSync);
        const walked = walkProjectStylesheets([root]);
        vi.restoreAllMocks();
        expect(walked.files.map(file => relative(root, file)).sort()).toEqual([
            join('src', 'app.css'),
            join('src', 'locked.css'),
        ]);
        expect([...walked.texts.keys()]).toEqual([join(root, 'src', 'app.css')]);
    });
});

describe('an `ignore` release that no longer matches a path apart from its parents', () => {
    it('stops the walk with a message instead of misreading a nested negation', async () => {
        vi.resetModules();
        vi.doMock('ignore', () => ({
            default: () => ({
                add: () => ({ test: () => ({ ignored: false, unignored: false }) }),
            }),
        }));
        const fresh = await import('../src/project-walk.js');
        const root = tree({ '.gitignore': 'gen/\n', 'src/app.css': '.a {}\n' });
        let thrown: unknown;
        try {
            fresh.walkProject(root, { skipDirs: new Set(), gitignore: 'skip' }, () => {});
        } catch (error) {
            thrown = error;
        }
        expect(isCsszyxError(thrown)).toBe(true);
        expect(thrown).toMatchObject({
            code: 'ignore-package-incompatible',
            args: { pinned: packageJson.dependencies.ignore },
            message:
                '[csszyx] ignore-package-incompatible:\n' +
                '  The installed `ignore` package lacks the internal matcher csszyx calls, so csszyx cannot read `.gitignore` and stops.\n' +
                `  help: remove any override or resolution that forces another version of \`ignore\`, so csszyx gets \`ignore@${packageJson.dependencies.ignore}\`, the version it pins.\n` +
                '  docs: https://csszyx.com/e/ignore-package-incompatible',
        });
    });
});
