/**
 * Every published package ships the repository's license.
 *
 * npm puts a `LICENSE` file from a package's own directory into its tarball
 * whatever `files` says, and only from there: the one at the repository root
 * reaches no package. Every csszyx package declared `"license": "MIT"` and
 * shipped no license text, which the MIT terms require.
 *
 * Each published package holds a copy of the root `LICENSE`, byte for byte, so
 * a change to the root is a change this check makes visible everywhere.
 *
 * Run: node scripts/check-package-license.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Check every published package under `packages/`.
 *
 * @param {{ root?: string }} [options] - The repository to read; this one by default.
 * @returns {{ problems: string[], checked: number }} One line per package whose
 *   license is missing or differs from the root's, and how many were read.
 */
export function checkLicenses({ root = ROOT } = {}) {
    const license = readFileSync(path.join(root, 'LICENSE'), 'utf8');
    const problems = [];
    let checked = 0;
    for (const name of readdirSync(path.join(root, 'packages')).sort()) {
        const directory = path.join(root, 'packages', name);
        const manifestPath = path.join(directory, 'package.json');
        if (!existsSync(manifestPath)) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (manifest.private === true) continue;
        checked += 1;
        const copy = path.join(directory, 'LICENSE');
        if (!existsSync(copy)) {
            problems.push(`${manifest.name}: no LICENSE in packages/${name}`);
        } else if (readFileSync(copy, 'utf8') !== license) {
            problems.push(
                `${manifest.name}: packages/${name}/LICENSE differs from the root LICENSE`,
            );
        }
    }
    return { problems, checked };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const { problems, checked } = checkLicenses();
    if (problems.length > 0) {
        console.error(`[package-license] ${problems.length} of ${checked} published packages:`);
        for (const problem of problems) console.error(`  ${problem}`);
        console.error('help: copy the root LICENSE into each of them');
        process.exitCode = 1;
    } else {
        console.log(`[package-license] ${checked} published packages ship the root LICENSE.`);
    }
}
