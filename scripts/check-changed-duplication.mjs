#!/usr/bin/env node
// Duplicated blocks on changed lines, measured before the push.
//
// Sonar reports duplication on new code and was the only thing measuring it,
// so a block copied instead of shared arrived as a review comment. The tree
// already holds duplication this gate is not asking anyone to clean: it fails
// only when a clone lands on a line the diff touched, the same scoping the
// cognitive-complexity gate uses and for the same reason.
//
// Usage: node scripts/check-changed-duplication.mjs [--base=<ref>]

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isSonarScoped } from './check-changed-complexity.mjs';
import { changedLines } from './check-patch-coverage.mjs';

/** Sonar counts a block from ten duplicated lines. */
const MIN_LINES = '10';

/** Below this a shared shape is a coincidence of syntax, not a copy. */
const MIN_TOKENS = '50';

/** The tree jscpd is pointed at, and what its reported paths are relative to. */
const SCAN_ROOT = 'packages';

/** `sonar.exclusions`, plus the tests Sonar measures separately. */
const IGNORE = [
    '**/dist/**',
    '**/node_modules/**',
    '**/generated/**',
    '**/*.d.ts',
    '**/*.type-test.ts',
    'packages/core/fuzz/**',
    'packages/e2e/**',
    '**/tests/**',
    '**/*.test.ts',
].join(',');

/**
 * Whether a block of a clone covers any line the diff touched.
 *
 * jscpd names a file relative to the directory it was told to scan, so the
 * scan root has to be put back before the name can be looked up against a
 * diff, whose paths are relative to the repository.
 *
 * @param block - One `firstFile`/`secondFile` entry from jscpd.
 * @param touched - Repo-relative path mapped to the lines the diff changed.
 * @param scanRoot - Repo-relative directory jscpd was pointed at.
 * @returns True when the diff reaches into this block.
 */
function blockIsChanged(block, touched, scanRoot) {
    const lines = touched.get(path.posix.join(scanRoot, block.name));
    if (lines === undefined) return false;
    for (const line of lines) {
        if (line >= block.start && line <= block.end) return true;
    }
    return false;
}

/**
 * Keep the clones this change is responsible for.
 *
 * A clone counts when EITHER of its two blocks was touched: copying a block
 * into a new file and editing the block it was copied from are the same
 * mistake seen from two ends.
 *
 * @param duplicates - The `duplicates` array of a jscpd JSON report.
 * @param touched - Repo-relative path mapped to the lines the diff changed.
 * @param scanRoot - Repo-relative directory jscpd was pointed at.
 * @returns The subset landing on changed lines.
 */
export function clonesOnChangedLines(duplicates, touched, scanRoot) {
    return duplicates.filter(
        clone =>
            blockIsChanged(clone.firstFile, touched, scanRoot) ||
            blockIsChanged(clone.secondFile, touched, scanRoot),
    );
}

/**
 * Run jscpd over the Sonar-scoped sources and read its report.
 *
 * The whole tree is scanned rather than the changed files alone, because jscpd
 * reduces an explicit file list to bare basenames in its report, which cannot
 * be matched back to a diff. Filtering to the change happens afterwards.
 *
 * @returns The `duplicates` array, or null when jscpd could not be run.
 */
function detect() {
    const out = mkdtempSync(path.join(tmpdir(), 'csszyx-dup-'));
    try {
        execFileSync(
            'pnpm',
            [
                'exec',
                'jscpd',
                '--min-lines',
                MIN_LINES,
                '--min-tokens',
                MIN_TOKENS,
                '--silent',
                '--reporters',
                'json',
                '--output',
                out,
                '--ignore',
                IGNORE,
                '--pattern',
                '**/*.ts',
                SCAN_ROOT,
            ],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
        );
        const report = path.join(out, 'jscpd-report.json');
        // jscpd writes no report when it found nothing worth reporting.
        if (!existsSync(report)) return [];
        return JSON.parse(readFileSync(report, 'utf8')).duplicates ?? [];
    } catch {
        // A crash here must not read as "no duplication": say so and let the
        // caller decide, rather than passing on an empty answer.
        return null;
    } finally {
        rmSync(out, { recursive: true, force: true });
    }
}

/**
 * Report every clone landing on a changed line.
 *
 * @param base - Revision to compare against.
 * @returns Process exit code.
 */
function main(base) {
    let touched;
    try {
        touched = changedLines(base);
    } catch {
        console.log(`[duplication] base ref '${base}' not available — skipping.`);
        return 0;
    }

    const files = [...touched.keys()].filter(file => isSonarScoped(file) && existsSync(file));
    if (files.length === 0) {
        console.log('[duplication] no changed files in Sonar scope — nothing to check.');
        return 0;
    }

    console.log(`[duplication] checking ${files.length} changed file(s) for copied blocks...`);
    const duplicates = detect();
    if (duplicates === null) {
        console.error('[duplication] jscpd could not be run — treating that as a failure.');
        return 1;
    }

    const offending = clonesOnChangedLines(duplicates, touched, SCAN_ROOT);
    if (offending.length === 0) {
        console.log('[duplication] no copied block on a changed line.');
        return 0;
    }

    console.error('\n[duplication] copied blocks on changed lines:');
    for (const clone of offending) {
        const first = `${path.posix.join(SCAN_ROOT, clone.firstFile.name)}:${clone.firstFile.start}`;
        const second = `${path.posix.join(SCAN_ROOT, clone.secondFile.name)}:${clone.secondFile.start}`;
        console.error(`  ${clone.lines} lines — ${first} and ${second}`);
    }
    console.error(
        '\nSonar reports these on the pull request. Share the block rather than\n' +
            'copying it: a rule that lives in two places is a rule only one of\n' +
            'them will be updated to follow.',
    );
    return 1;
}

// Guarded so the pure filter above can be imported by its tests without the
// gate running as a side effect.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const flag = process.argv.slice(2).find(argument => argument.startsWith('--base='));
    process.exit(main(flag === undefined ? 'origin/main' : flag.slice('--base='.length)));
}
