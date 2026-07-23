import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const INDEX_ENTRY = /^(\d+) ([0-9a-f]+) \d+\t([\s\S]+)$/;
const SYMLINK_MODE = '120000';

/**
 * Find tracked symlinks that cannot resolve within the repository.
 *
 * @param {{ path: string; target: string }[]} entries tracked symlink entries
 * @param {string} repositoryRoot absolute repository root
 * @param {(candidate: string) => boolean} [pathExists] filesystem existence check
 * @returns {string[]} validation errors
 */
export function validateTrackedSymlinks(entries, repositoryRoot, pathExists = existsSync) {
    const errors = [];
    for (const entry of entries) {
        if (path.isAbsolute(entry.target) || path.win32.isAbsolute(entry.target)) {
            errors.push(
                `Tracked symlink ${JSON.stringify(entry.path)} uses an absolute target: ${JSON.stringify(entry.target)}.`,
            );
            continue;
        }

        const destination = path.resolve(repositoryRoot, path.dirname(entry.path), entry.target);
        const relativeDestination = path.relative(repositoryRoot, destination);
        if (
            relativeDestination === '..' ||
            relativeDestination.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativeDestination)
        ) {
            errors.push(
                `Tracked symlink ${JSON.stringify(entry.path)} escapes the repository: ${JSON.stringify(entry.target)}.`,
            );
            continue;
        }

        if (!pathExists(destination)) {
            errors.push(
                `Tracked symlink ${JSON.stringify(entry.path)} has a missing target: ${JSON.stringify(entry.target)}.`,
            );
        }
    }
    return errors;
}

/**
 * Read symlinks directly from the Git index so validation does not depend on
 * whether the checkout platform materializes links or plain-text link files.
 *
 * @param {string} repositoryRoot absolute repository root
 * @returns {{ path: string; target: string }[]} tracked symlink entries
 */
export function readTrackedSymlinks(repositoryRoot) {
    const index = execFileSync('git', ['ls-files', '--stage', '-z'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
    });
    const targetsByBlob = new Map();
    const entries = [];

    for (const record of index.split('\0')) {
        if (record.length === 0) {
            continue;
        }

        const match = record.match(INDEX_ENTRY);
        if (!match) {
            throw new Error(`Unable to parse Git index entry: ${JSON.stringify(record)}`);
        }
        const [, mode, blob, filePath] = match;
        if (mode !== SYMLINK_MODE) {
            continue;
        }

        let target = targetsByBlob.get(blob);
        if (target === undefined) {
            target = execFileSync('git', ['cat-file', 'blob', blob], {
                cwd: repositoryRoot,
                encoding: 'utf8',
            });
            targetsByBlob.set(blob, target);
        }
        entries.push({ path: filePath, target });
    }
    return entries;
}

function main() {
    const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
    }).trim();
    const entries = readTrackedSymlinks(repositoryRoot);
    const errors = validateTrackedSymlinks(entries, repositoryRoot);

    if (errors.length > 0) {
        throw new Error(`Tracked symlink validation failed:\n- ${errors.join('\n- ')}`);
    }
    console.log(`Tracked symlink validation passed (${entries.length} checked).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
