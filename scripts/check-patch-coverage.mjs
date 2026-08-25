#!/usr/bin/env node
// Patch coverage, measured where the change is made instead of after it lands.
//
// Codecov reports this on every pull request and nothing here reproduced it, so
// the first time an author learns a changed line is untested is after a push.
// The rule the project already holds itself to — 100% of changed lines covered,
// measured before pushing — had no runnable check behind it.
//
// The measurement is the intersection of two things this repository already
// produces: the lines a diff touches, and the lines the coverage run recorded.
// Both come from files on disk, so nothing here talks to a service.
//
// Usage:
//   node scripts/check-patch-coverage.mjs [--base=<ref>] [--report=<lcov>]...
//
// Run the coverage suites first — `pnpm test:coverage` and `pnpm cov:rust` —
// or the reports describe an older tree than the diff does.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Reports read when none are named. Each is written by a coverage script. */
const DEFAULT_REPORTS = [
    'coverage/lcov.info',
    'coverage/rust-lcov.info',
    'packages/ts-plugin/coverage/lcov.info',
];

/**
 * Paths that carry no coverable lines, so a diff touching them proves nothing.
 * Mirrors `vitest.config.ts` — a narrower list here would report a gap in a
 * file the coverage run was never asked to measure.
 */
const UNMEASURED = [
    /(^|\/)tests?\//,
    /\.test\.[cm]?tsx?$/,
    /\.type-test\.ts$/,
    /\.d\.ts$/,
    /(^|\/)scripts\//,
    /^packages\/e2e\//,
    /^packages\/types\//,
    /^packages\/vscode\/src\/extension\.ts$/,
    // Nothing instruments the docs site, so calling its changed lines
    // uncovered reports a missing test that could not be written: the
    // TypeScript coverage run includes `packages/*/src/**` only, and CI never
    // runs the site's own vitest project either. Keep this list matching what
    // the coverage runs actually measure — an entry here that later becomes
    // instrumented is a gate silently not doing its job.
    /^apps\//,
    // The TypeScript coverage run measures `packages/*/src/**`. A package's
    // build, test or lint config sits beside `src`, is read by a tool rather
    // than executed by a test, and can never carry a hit. The workspace's own
    // configs sit at the root for the same reason and are read the same way —
    // `vitest.config.ts` among them, which is how a run that edits the
    // coverage settings ends up reporting the settings file as untested.
    /^packages\/[^/]+\/[^/]+\.[cm]?ts$/,
    /^[^/]+\.[cm]?ts$/,
    // A snippet written for a reader to copy, not a code path the package
    // takes. It imports the built wasm artifact, so no unit test can drive it
    // without a build first. Sonar excludes it for the same reason, and the
    // two lists disagreeing is what this gate exists to prevent.
    /^packages\/[^/]+\/examples\//,
    // The Rust coverage run enables `native-engine,migrate`. The napi
    // bindings live behind `native`, so they are not compiled into the run
    // that produces the report and cannot appear in it. They are exercised
    // through the built addon instead — see the compiler's migrate suites.
    /^packages\/core\/src\/native\.rs$/,
    // Build output. It never mattered while `.js` was unmeasurable outright;
    // now that the shipped loader is measured, a committed `dist` would be
    // reported as source with no test.
    /(^|\/)dist\//,
];

/**
 * Extensions the coverage runs instrument. Anything else is not measurable.
 *
 * `.js` is here for the hand-written JavaScript that ships beside a package's
 * `src` — the native loader is the only one today. Leaving it out did not make
 * the gate lenient in a visible way: it made the gate decline to ask, so a
 * changed file with no test reported as fully covered. Sonar reads the same
 * report against its own file list and said 0 of 6, which is how the gap was
 * found. Widen `include` in vitest.config.ts alongside this, or the lines land
 * in no report and read as an unmeasured language instead.
 */
const MEASURED_EXTENSION = /\.(?:[cm]?tsx?|rs|js)$/;

/**
 * Resolve an lcov source path to one the diff also uses.
 *
 * lcov records paths relative to wherever the coverage tool ran, and this
 * repository runs coverage in two places: once at the root and once inside
 * `packages/ts-plugin`, whose report therefore says `src/…` for a file the
 * diff calls `packages/ts-plugin/src/…`. Keying on the raw path silently
 * matched nothing for that package, which reads as full coverage.
 *
 * @param source - Path as written in the report.
 * @param report - Path of the report it came from.
 * @returns Repo-relative source path.
 */
export function repoRelativeSource(source, report) {
    // `<pkg>/coverage/lcov.info` describes files under `<pkg>`; a root report
    // sits in `coverage/`, whose parent is the root, so one rule covers both.
    const reportRoot = path.resolve(path.dirname(report), '..');
    for (const candidate of [path.resolve(reportRoot, source), path.resolve(source)]) {
        if (existsSync(candidate)) return path.relative(process.cwd(), candidate);
    }
    // Unresolvable: keep the raw path so the file is still reported rather than
    // quietly dropped into a bucket nothing compares against.
    return source;
}

/**
 * Read one lcov report into covered and uncovered line numbers per file.
 *
 * @param file - Path to an lcov report.
 * @returns Repo-relative source path mapped to its recorded lines.
 */
function readLcov(file) {
    return parseLcov(readFileSync(file, 'utf8'), file);
}

/**
 * Read one lcov report's text into covered and uncovered line numbers per file.
 *
 * A line counts as covered only when it was executed AND every branch on it was
 * taken. Codecov calls the executed-but-not-fully-branched case a "partial" and
 * scores it as uncovered in its line metric — `codecov.yml` says so in its own
 * comment — so a gate that read only `DA:` records would call such a line
 * covered and disagree with the service it exists to predict. That disagreement
 * is exactly what let a pull request pass here and then report 97% patch
 * coverage upstream.
 *
 * Split from {@link readLcov} so the record arithmetic is testable without
 * writing a report to disk.
 *
 * @param text - lcov report contents.
 * @param report - Path the report came from, for source-path resolution.
 * @returns Repo-relative source path mapped to its recorded lines.
 */
export function parseLcov(text, report) {
    const records = new Map();
    /** Per file: line number to hit count, and the lines with an untaken branch. */
    let hits = null;
    let partial = null;
    const perFile = new Map();
    let source = null;

    const startFile = next => {
        source = next;
        const existing = perFile.get(source);
        if (existing === undefined) {
            hits = new Map();
            partial = new Set();
            perFile.set(source, { hits, partial });
            return;
        }
        hits = existing.hits;
        partial = existing.partial;
    };

    for (const line of text.split('\n')) {
        if (line.startsWith('SF:')) {
            startFile(repoRelativeSource(line.slice(3).trim(), report));
            continue;
        }
        if (source === null) continue;
        if (line.startsWith('DA:')) {
            const [rawLine, rawHits] = line.slice(3).split(',');
            const lineNumber = Number(rawLine);
            if (!Number.isInteger(lineNumber)) continue;
            hits.set(lineNumber, Math.max(hits.get(lineNumber) ?? 0, Number(rawHits) || 0));
            continue;
        }
        if (!line.startsWith('BRDA:')) continue;
        const parts = line.slice(5).split(',');
        const lineNumber = Number(parts[0]);
        // lcov writes `-` when the branch was never reached at all, which is
        // strictly worse than reached-and-not-taken; both mean not covered.
        const taken = parts[3];
        if (Number.isInteger(lineNumber) && (taken === '-' || Number(taken) === 0)) {
            partial.add(lineNumber);
        }
    }

    for (const [file, { hits: fileHits, partial: filePartial }] of perFile) {
        const covered = new Set();
        const uncovered = new Set();
        // A partial line need not carry a hit record of its own. v8 writes one
        // DA per statement, so a branch inside a multi-line expression lands on
        // a line the hit map never mentions, and reading only the hit map would
        // drop it from both answers instead of reporting it.
        for (const lineNumber of new Set([...fileHits.keys(), ...filePartial])) {
            const count = fileHits.get(lineNumber) ?? 0;
            // A line recorded as covered by ANY report stays covered: the rust
            // and TypeScript runs describe different files, and ts-plugin
            // measures its own package that the root run deliberately skips.
            // Reading them as one set is what makes "covered somewhere" the
            // answer.
            if (count > 0 && !filePartial.has(lineNumber)) covered.add(lineNumber);
            else uncovered.add(lineNumber);
        }
        records.set(file, { covered, uncovered });
    }
    return records;
}

/**
 * Line numbers each file gained or changed, relative to a base revision.
 *
 * @param base - Revision to compare against.
 * @returns Repo-relative path mapped to the set of added or changed lines.
 */
export function changedLines(base) {
    const diff = execFileSync('git', ['diff', '-U0', `${base}...HEAD`], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    return parseDiffHunks(diff);
}

/**
 * Read added-line numbers out of a unified diff produced with zero context.
 *
 * Split out so the hunk arithmetic is testable without a repository: the `+`
 * side of a hunk header names the first added line and how many follow, and a
 * header with no count is one line.
 *
 * @param diff - Unified diff text.
 * @returns Repo-relative path mapped to the set of added or changed lines.
 */
export function parseDiffHunks(diff) {
    const perFile = new Map();
    let file = null;
    for (const line of diff.split('\n')) {
        if (line.startsWith('+++ ')) {
            const target = line.slice(4).trim();
            file = target === '/dev/null' ? null : target.replace(/^b\//, '');
            if (file !== null && !perFile.has(file)) perFile.set(file, new Set());
            continue;
        }
        if (file === null || !line.startsWith('@@')) continue;
        const header = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (header === null) continue;
        const start = Number(header[1]);
        const count = header[2] === undefined ? 1 : Number(header[2]);
        for (let offset = 0; offset < count; offset++) perFile.get(file).add(start + offset);
    }
    return perFile;
}

/**
 * Whether a changed file carries lines a coverage run would record.
 *
 * @param file - Repo-relative path.
 * @returns True when the file should be measured.
 */
export function isMeasurable(file, readSource = path => readFileSync(path, 'utf8')) {
    if (!MEASURED_EXTENSION.test(file)) return false;
    if (UNMEASURED.some(pattern => pattern.test(file))) return false;
    return !isRustWithoutCode(file, readSource);
}

/**
 * Whether a Rust file declares no function, and so has nothing to execute.
 *
 * `llvm-cov` writes no record for such a file — a module that only lists its
 * submodules and re-exports them is the usual case — and a missing record
 * would otherwise read as a file the run forgot to measure. Keyed on the
 * absence of a function rather than on the name `mod.rs`, so a module that
 * grows one stops being exempt without anyone remembering to notice.
 *
 * @param file - Repo-relative path.
 * @param readSource - Reader, injected for tests.
 * @returns True when the file cannot carry a hit.
 */
function isRustWithoutCode(file, readSource) {
    if (!file.endsWith('.rs')) return false;
    try {
        return !/\bfn\s/.test(readSource(path.resolve(process.cwd(), file)));
    } catch {
        // A file the diff names but the tree no longer has was deleted; the
        // report cannot mention it either way.
        return true;
    }
}

/**
 * Compare a diff against coverage reports and print what the diff left untested.
 *
 * @param options - Base revision and report paths.
 * @returns Process exit code.
 */
function main({ base, reports }) {
    const present = reports.filter(report => existsSync(report));
    if (present.length === 0) {
        console.error(
            `[patch-coverage] no coverage report found (looked for ${reports.join(', ')}).\n` +
                'Run `pnpm test:coverage` and `pnpm cov:rust` first — without them this ' +
                'check would pass by having nothing to read, which is worse than not running.',
        );
        return 1;
    }

    const recorded = new Map();
    for (const report of present) {
        for (const [file, lines] of readLcov(report)) {
            const merged = recorded.get(file);
            if (merged === undefined) {
                recorded.set(file, lines);
                continue;
            }
            for (const line of lines.covered) {
                merged.covered.add(line);
                merged.uncovered.delete(line);
            }
            for (const line of lines.uncovered) {
                if (!merged.covered.has(line)) merged.uncovered.add(line);
            }
        }
    }

    const gaps = [];
    const unmeasured = [];
    let changedCount = 0;
    for (const [file, lines] of changedLines(base)) {
        if (!isMeasurable(file)) continue;
        const record = recorded.get(file);
        if (record === undefined) {
            // Present in the diff, absent from every report: a source file the
            // coverage run never loaded, which is a zero rather than a pass.
            unmeasured.push(file);
            continue;
        }
        const missed = [...lines].filter(line => record.uncovered.has(line)).sort((a, b) => a - b);
        changedCount += [...lines].filter(
            line => record.uncovered.has(line) || record.covered.has(line),
        ).length;
        if (missed.length > 0) gaps.push({ file, missed });
    }

    console.log(
        `[patch-coverage] ${changedCount} changed coverable line(s) against ${base}, ` +
            `read from ${present.length} report(s).`,
    );

    // A whole language missing from the reports is a different failure from a
    // file nobody tested, and saying the second when it is the first blames the
    // author for a step that did not run. It happened here: vitest cleans
    // `coverage/` before writing, so a rust report produced BEFORE it was gone
    // by the time this read, and every changed .rs line came back unmeasured.
    const measuredExtensions = new Set([...recorded.keys()].map(file => path.extname(file)));
    for (const file of unmeasured) {
        const extension = path.extname(file);
        console.error(
            measuredExtensions.has(extension)
                ? `  ${file}: changed, and no coverage report mentions it`
                : `  ${file}: changed, and NO report covers ${extension} files at all — ` +
                      'the run that produces them did not happen, or its output was overwritten',
        );
    }
    for (const { file, missed } of gaps) {
        console.error(`  ${file}: uncovered changed line(s) ${missed.join(',')}`);
    }

    if (gaps.length === 0 && unmeasured.length === 0) {
        console.log('[patch-coverage] Every changed line is covered.');
        return 0;
    }
    console.error(
        '\n✖ Changed lines are not covered. Add the test, or state the reason in ' +
            'review — this is the same measurement Codecov reports on the pull request.',
    );
    return 1;
}

/**
 * Read the command line.
 *
 * @param argv - Arguments after the script name.
 * @returns Base revision and report paths.
 */
export function parseArgs(argv) {
    let base = 'origin/main';
    const reports = [];
    for (const arg of argv) {
        if (arg.startsWith('--base=')) base = arg.slice('--base='.length);
        else if (arg.startsWith('--report=')) reports.push(arg.slice('--report='.length));
    }
    return { base, reports: reports.length > 0 ? reports : DEFAULT_REPORTS };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    process.exitCode = main(parseArgs(process.argv.slice(2)));
}
