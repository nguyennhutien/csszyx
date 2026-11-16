import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * One reader per language for text read without a parse: comments, strings,
 * templates and regexes are skipped by the shared modules below, and a new
 * private copy of that logic fails here. A copy drifts from the shared one in
 * silence: measured on the repository against TypeScript's parser, the
 * private comment mask in `rsc-boundary.ts` read 99 modules wrong and the
 * shared lexer 1.
 *
 * Found by name, so a helper named otherwise passes; the names below are the
 * ones every such helper in the repository has carried, read as a function
 * declaration, a function or arrow bound to a name, or a method. The check
 * reads the source of the packages, the apps and the scripts. The allowlist
 * is the debt still to move, each entry with its reason and covering one
 * helper; an entry whose helper is gone fails too, so the list only shrinks.
 */
export const SHARED_SCANNER_MODULES = new Set([
    'packages/unplugin/src/js-lexer.ts',
    'packages/tailwind-oracle/src/css-comments.ts',
]);

/** A function name a comment, string or token skipper carries. */
const NAME =
    '((?:skip|strip)\\w*Comments?\\w*|\\w*[cC]ommentEnd|\\w*[qQ]uotedEnd|lex[A-Z]\\w*|mask[A-Z]\\w*|after(?:Comment|String)|withoutComments|commentAt|leadingTriviaLength|stringEnd)';

/**
 * A line that defines a function by that name: a declaration, a `const`,
 * `let` or `var` bound to a function or an arrow, or a method, whose line
 * ends in the `{` that opens its body.
 */
const SCANNER_DEFINITION = new RegExp(
    [
        `^\\s*(?:export\\s+)?(?:async\\s+)?function\\s*\\*?\\s*${NAME}\\s*[(<]`,
        `^\\s*(?:export\\s+)?(?:const|let|var)\\s+${NAME}\\s*(?::(?:[^=]|=>)+)?=(?!>)\\s*(?:async\\b\\s*)?(?:function\\b|\\(|<|[\\w$]+\\s*=>)`,
        `^\\s*(?:(?:public|private|protected|static|readonly|async|override)\\s+)*${NAME}\\s*(?:<[^>]*>)?\\([^;]*\\)\\s*(?::[^;{]+)?\\{\\s*$`,
    ].join('|'),
);

/** Source files the check reads. */
const SOURCE_FILE =
    /^(?:packages\/[^/]+\/src|apps\/[^/]+\/src|scripts)\/.+\.(?:ts|tsx|mts|cts|mjs|cjs|js)$/;

/**
 * Whether the check reads a tracked file.
 *
 * @param {string} file repository-relative path
 * @returns {boolean} true for source outside a declaration file
 */
export function isScannedSource(file) {
    return SOURCE_FILE.test(file) && !file.endsWith('.d.ts');
}

/**
 * The debt: helpers not yet moved onto a shared module, and why.
 *
 * @type {ReadonlyArray<{ file: string; name: string; reason: string }>}
 */
export const ALLOWLIST = [
    {
        file: 'packages/unplugin/src/authored-class-scanner.ts',
        name: 'quotedEnd',
        reason: 'reads class sinks and decodes string contents; moving it needs a census differential',
    },
    {
        file: 'packages/unplugin/src/authored-class-scanner.ts',
        name: 'commentEnd',
        reason: 'reads class sinks and decodes string contents; moving it needs a census differential',
    },
    {
        file: 'packages/unplugin/src/class-mark-inline.ts',
        name: 'lexStrings',
        reason: 'the mangle census lexer reads string pieces and placeholders; moving it needs a census differential',
    },
    {
        file: 'packages/unplugin/src/class-mark-inline.ts',
        name: 'lexToken',
        reason: 'the mangle census lexer reads string pieces and placeholders; moving it needs a census differential',
    },
    {
        file: 'packages/unplugin/src/class-mark-inline.ts',
        name: 'skipCommentOrRegex',
        reason: 'the mangle census lexer reads string pieces and placeholders; moving it needs a census differential',
    },
    {
        file: 'packages/unplugin/src/specifier-aliases.ts',
        name: 'stripComments',
        reason: 'JSONC, another grammar: double-quoted strings only and no regex',
    },
    {
        file: 'packages/tailwind-oracle/src/sibling-keyword.ts',
        name: 'quotedEnd',
        reason: 'reads quoted values inside a CSS declaration value, not stylesheet text',
    },
    {
        file: 'packages/cli/src/commands/migrate.ts',
        name: 'findSzTodoCommentEnd',
        reason: 'finds the TODO comment migrate itself writes, not any comment',
    },
    {
        file: 'packages/cli/src/commands/migrate.ts',
        name: 'stripSzTodoComments',
        reason: 'removes the TODO comments migrate itself writes, not any comment',
    },
];

/**
 * Every function named like a text scanner, outside the shared modules.
 *
 * @param {Record<string, string>} files repository-relative path to text
 * @returns {Array<{ file: string; name: string; line: number }>} in input order
 */
export function findScannerHelpers(files) {
    const found = [];
    for (const [file, text] of Object.entries(files)) {
        if (SHARED_SCANNER_MODULES.has(file)) continue;
        text.split('\n').forEach((line, index) => {
            const match = SCANNER_DEFINITION.exec(line);
            const name = match?.slice(1).find(group => group !== undefined);
            if (name !== undefined) found.push({ file, name, line: index + 1 });
        });
    }
    return found;
}

/**
 * What the allowlist does not cover, and what it names that is gone. An
 * entry covers the first helper of its name in its file; a second is new.
 *
 * @param {Array<{ file: string; name: string; line: number }>} found helpers found
 * @param {ReadonlyArray<{ file: string; name: string }>} allowlist the debt
 * @returns {{ added: string[]; stale: string[] }} each as `file:line name` / `file name`
 */
export function judgeScannerHelpers(found, allowlist) {
    const key = entry => `${entry.file} ${entry.name}`;
    const allowed = new Set(allowlist.map(key));
    const present = new Set(found.map(key));
    const covered = new Set();
    return {
        added: found
            .filter(entry => {
                const name = key(entry);
                if (!allowed.has(name) || covered.has(name)) return true;
                covered.add(name);
                return false;
            })
            .map(e => `${e.file}:${e.line} ${e.name}`),
        stale: allowlist.filter(entry => !present.has(key(entry))).map(key),
    };
}

function main() {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const tracked = execFileSync('git', ['ls-files', '-z', 'packages', 'apps', 'scripts'], {
        cwd: root,
        encoding: 'utf8',
    })
        .split('\0')
        .filter(isScannedSource);
    const files = Object.fromEntries(
        tracked.map(file => [file, readFileSync(path.join(root, file), 'utf8')]),
    );
    const { added, stale } = judgeScannerHelpers(findScannerHelpers(files), ALLOWLIST);
    const problems = [
        ...added.map(
            entry =>
                `${entry}: read the text with packages/unplugin/src/js-lexer.ts or packages/tailwind-oracle/src/css-comments.ts, adding what is missing there`,
        ),
        ...stale.map(
            entry =>
                `${entry}: gone, so remove it from ALLOWLIST in scripts/check-shared-scanners.mjs`,
        ),
    ];
    if (problems.length > 0) {
        throw new Error(`Shared scanner check failed:\n- ${problems.join('\n- ')}`);
    }
    console.log(
        `Shared scanner check passed (${tracked.length} files, ${ALLOWLIST.length} allowlisted helpers).`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
