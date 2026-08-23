#!/usr/bin/env node

// Run both migrate engines over a set of files and report every difference.
//
// The committed corpora prove parity on the cases the project knows about.
// This points the same comparison at code the project does NOT hold: a
// checkout, a component library someone shared, a private app. Nothing is
// written and nothing is recorded — the files never have to enter the repo
// for their shapes to be checked, which is the whole point.
//
// Usage:
//   node --import tsx/esm scripts/check-migrate-engine-parity.mjs [dir-or-glob...]
//   node --import tsx/esm scripts/check-migrate-engine-parity.mjs --json
//
// With no argument it checks every JSX and HTML file the repo itself holds.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
    isRustMigrateAvailable,
    migrateRustBatch,
    migrateRustHtml,
} from '@csszyx/compiler/migrate';
import fg from 'fast-glob';

import {
    transformHtmlSourceSimple,
    transformSource,
} from '../packages/cli/src/migrate/ast-transformer.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');

/** The option sets a run is checked under, named for the report. */
const OPTION_SETS = [
    ['default', {}],
    ['injectTodos', { injectTodos: true }],
    ['keysOnly', { keysOnly: true }],
];

/** The HTML option sets. */
const HTML_OPTION_SETS = [
    ['default', {}],
    ['braces', { braces: true }],
    ['runtime', { injectRuntime: 'cdn' }],
];

const asJson = process.argv.includes('--json');
const inputs = process.argv.slice(2).filter(argument => !argument.startsWith('--'));

if (!isRustMigrateAvailable()) {
    fail(
        'the native engine is not available here. Build it with `pnpm --filter @csszyx/core native:build`, ' +
            'or install the platform package.',
    );
}

const files = await resolveFiles(inputs);
if (files.length === 0) {
    fail(`no .jsx/.tsx/.html files matched: ${inputs.join(' ') || '(the repo itself)'}`);
}

const report = compare(files);
if (asJson) {
    console.log(JSON.stringify(report, null, 2));
} else {
    render(report);
}
process.exit(report.mismatches.length > 0 ? 1 : 0);

/**
 * Every JSX and HTML file under the given paths, or the repo's own when none
 * is given.
 *
 * @param {string[]} patterns - Directories or globs.
 * @returns {Promise<string[]>} Absolute file paths.
 */
async function resolveFiles(patterns) {
    const globs = patterns.length > 0 ? patterns.map(toGlob) : ['**/*.{jsx,tsx,html}'];
    return fg(globs, {
        cwd: patterns.length > 0 ? process.cwd() : repoRoot,
        absolute: true,
        ignore: [
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
            '**/.next/**',
            '**/target/**',
            '**/coverage/**',
        ],
    });
}

/**
 * A directory reads as everything under it; anything else is already a glob.
 *
 * @param {string} pattern - A directory or glob.
 * @returns {string} A glob.
 */
function toGlob(pattern) {
    return /[*?[\]{}]/.test(pattern) || /\.(jsx|tsx|html)$/.test(pattern)
        ? pattern
        : `${pattern.replace(/\/$/, '')}/**/*.{jsx,tsx,html}`;
}

/**
 * Run every file through both engines under every option set.
 *
 * @param {string[]} files - Absolute paths.
 * @returns {{checked: number, comparisons: number, changed: number, mismatches: object[]}} The report.
 */
function compare(files) {
    const jsxFiles = files.filter(file => !file.endsWith('.html'));
    const htmlFiles = files.filter(file => file.endsWith('.html'));
    const mismatches = [];
    let comparisons = 0;
    let changed = 0;

    for (const [name, options] of OPTION_SETS) {
        const sources = jsxFiles.map(file => ({
            filename: file,
            source: readFileSync(file, 'utf8'),
        }));
        // One call for the whole set, the way a migrate run sends a job.
        const rustResults = migrateRustBatch(sources, options);
        sources.forEach((entry, index) => {
            const ts = transformSource(entry.source, entry.filename, options);
            const rust = rustResults[index];
            comparisons++;
            if (ts.changed) changed++;
            const difference = diff(ts, rust, entry.filename);
            if (difference)
                mismatches.push({ file: rel(entry.filename), options: name, difference });
        });
    }

    for (const file of htmlFiles) {
        const source = readFileSync(file, 'utf8');
        for (const [name, options] of HTML_OPTION_SETS) {
            const ts = transformHtmlSourceSimple(source, options);
            const rust = migrateRustHtml(source, options);
            comparisons++;
            if (ts.changed) changed++;
            const difference = diff(ts, rust, file);
            if (difference) mismatches.push({ file: rel(file), options: name, difference });
        }
    }

    return { checked: files.length, comparisons, changed, mismatches };
}

/**
 * What differs between two results, or null when they agree.
 *
 * A parse failure is worded by whichever parser rejected the file, so only
 * the fact of it is compared.
 *
 * @param {object} ts - The TypeScript engine's result.
 * @param {object} rust - The native engine's result.
 * @param {string} file - The file both read.
 * @returns {object|null} The first field that differs, with both values.
 */
function diff(ts, rust, file) {
    const prefix = `Parse error in ${file}: `;
    const parseError = result =>
        result.warnings.length === 1 && result.warnings[0].startsWith(prefix);
    if (parseError(ts) && parseError(rust)) {
        return diffFields({ ...ts, warnings: [prefix] }, { ...rust, warnings: [prefix] });
    }
    return diffFields(ts, rust);
}

/**
 * The first field of two results that differs.
 *
 * @param {object} ts - The TypeScript engine's result.
 * @param {object} rust - The native engine's result.
 * @returns {object|null} The differing field, with both values.
 */
function diffFields(ts, rust) {
    for (const field of ['code', 'changed', 'warnings', 'stats', 'potentiallyUnusedImports']) {
        const left = JSON.stringify(ts[field]);
        const right = JSON.stringify(rust[field]);
        if (left !== right) {
            return { field, ts: truncate(left), rust: truncate(right) };
        }
    }
    return null;
}

/**
 * A value short enough to read in a terminal.
 *
 * @param {string} value - A JSON value.
 * @returns {string} The value, cut to 400 characters.
 */
function truncate(value) {
    return value.length > 400 ? `${value.slice(0, 400)}…` : value;
}

/**
 * A path relative to the repo when it is inside it.
 *
 * @param {string} file - An absolute path.
 * @returns {string} The shortest readable form.
 */
function rel(file) {
    const relative = path.relative(repoRoot, file);
    return relative.startsWith('..') ? file : relative;
}

/**
 * Print the report.
 *
 * @param {object} report - What `compare` returned.
 */
function render(report) {
    console.log(
        `[migrate-engine-parity] ${report.checked} file(s), ${report.comparisons} comparison(s), ` +
            `${report.changed} that migrate changes.`,
    );
    if (report.mismatches.length === 0) {
        console.log('[migrate-engine-parity] both engines answered identically.');
        return;
    }
    console.error(`[migrate-engine-parity] ${report.mismatches.length} difference(s):`);
    for (const mismatch of report.mismatches.slice(0, 20)) {
        console.error(`  ${mismatch.file} (${mismatch.options}) — ${mismatch.difference.field}`);
        console.error(`      ts   = ${mismatch.difference.ts}`);
        console.error(`      rust = ${mismatch.difference.rust}`);
    }
}

/**
 * Report a failure and stop.
 *
 * @param {string} message - What went wrong.
 */
function fail(message) {
    console.error(`[migrate-engine-parity] ${message}`);
    process.exit(1);
}
