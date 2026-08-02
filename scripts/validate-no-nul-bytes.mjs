import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * A raw NUL byte in a tracked source file flips Git's binary heuristic for the
 * whole file: the PR renders "Binary file not shown", `git grep` goes blind,
 * and diff-scoped scanners skip it. A NUL is never meaningful in these text
 * formats — a string that needs the character spells it as an escape
 * (`'\u0000'` in TypeScript, `"\u{0}"` in Rust) — so any raw occurrence is an
 * accident worth failing fast on.
 *
 * The extension list is an allowlist on purpose: tracked binary assets may
 * legitimately contain NUL, so only formats where text is an invariant are
 * checked.
 */
const TEXT_EXTENSIONS = new Set([
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.rs',
    '.md',
    '.mdx',
    '.json',
    '.yml',
    '.yaml',
    '.toml',
    '.css',
    '.html',
    '.sh',
]);

/**
 * Whether a tracked path participates in the NUL check.
 *
 * @param {string} filePath repository-relative path
 * @returns {boolean} true when the extension marks a text format
 */
export function isCheckedTextFile(filePath) {
    return TEXT_EXTENSIONS.has(path.extname(filePath));
}

/**
 * Find files whose content contains a raw NUL byte.
 *
 * @param {string[]} filePaths repository-relative paths to check
 * @param {(filePath: string) => Buffer} readFile content reader
 * @returns {string[]} offending paths, in input order
 */
export function findNulByteFiles(filePaths, readFile) {
    const offenders = [];
    for (const filePath of filePaths) {
        if (readFile(filePath).includes(0)) {
            offenders.push(filePath);
        }
    }
    return offenders;
}

/**
 * List tracked files eligible for the NUL check.
 *
 * @param {string} repositoryRoot absolute repository root
 * @returns {string[]} repository-relative text file paths
 */
export function listTrackedTextFiles(repositoryRoot) {
    const output = execFileSync('git', ['ls-files', '-z'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
    });
    return output
        .split('\0')
        .filter(filePath => filePath.length > 0 && isCheckedTextFile(filePath));
}

function main() {
    const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
    }).trim();
    const files = listTrackedTextFiles(repositoryRoot);
    const offenders = findNulByteFiles(files, filePath =>
        readFileSync(path.join(repositoryRoot, filePath)),
    );

    if (offenders.length > 0) {
        throw new Error(
            `Raw NUL byte in tracked text files (write the escape instead, e.g. '\\u0000'):\n- ${offenders.join('\n- ')}`,
        );
    }
    console.log(`NUL byte validation passed (${files.length} files checked).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
