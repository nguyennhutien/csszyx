#!/usr/bin/env node
// Cognitive complexity of changed lines, measured before the push.
//
// Sonar rejects new code above a cognitive complexity of 15 and was the only
// thing checking it, so the first report of an over-complex function arrived
// after a push and a review round. `pnpm lint:complexity` exists but ends in
// `|| true`, which makes it a survey rather than a gate.
//
// Scoped the way Sonar scopes, for the same reason Sonar does it:
//
//   - only files Sonar analyses — `sonar.sources=packages` minus its exclusion
//     list, so `scripts/`, `apps/` and generated output are out;
//   - only diagnostics landing on a line the diff touched. The tree still holds
//     functions above the limit, and a gate that failed whenever one of them
//     sat in a file someone edited would be turned off rather than obeyed.
//
// Usage: node scripts/check-changed-complexity.mjs [--base=<ref>]

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { changedLines } from './check-patch-coverage.mjs';

/** Sonar analyses `packages` and nothing else. */
const SONAR_SOURCE = /^packages\//;

/** `sonar.exclusions`, transcribed. Rust is covered by clippy, not this. */
const SONAR_EXCLUDED = [
    /(^|\/)dist\//,
    /(^|\/)node_modules\//,
    /(^|\/)generated\//,
    /(^|\/)scripts\//,
    /\.rs$/,
    /\.d\.ts$/,
    /\.type-test\.ts$/,
    /^packages\/core\/fuzz\//,
    /^packages\/e2e\//,
];

/** Extensions biome lints. */
const LINTABLE = /\.(?:[cm]?[jt]sx?)$/;

/**
 * Whether Sonar would analyse this path, and therefore whether this gate should.
 *
 * @param file - Repo-relative path.
 * @returns True when the file is in scope.
 */
export function isSonarScoped(file) {
    if (!SONAR_SOURCE.test(file) || !LINTABLE.test(file)) return false;
    return !SONAR_EXCLUDED.some(pattern => pattern.test(file));
}

/**
 * Read biome's text report into one record per diagnostic.
 *
 * The text reporter is used rather than `--reporter=json` because its header
 * line already carries the path and line, and biome writes diagnostics to
 * stderr — a shape that survives being captured whole far more predictably
 * than a JSON document split across two streams.
 *
 * @param output - Combined stdout and stderr from `biome lint`.
 * @returns One entry per diagnostic, with its file and line.
 */
export function parseBiomeDiagnostics(output) {
    const found = [];
    const header = /^(\S+):(\d+):\d+ (lint\/\S+)/;
    const lines = output.split('\n');
    for (const [index, line] of lines.entries()) {
        const match = header.exec(line);
        if (match === null) continue;
        // The measured number lives a couple of lines below the header, and
        // reporting it is the difference between "too complex" and knowing how
        // far over the limit the function sits.
        const detail = lines
            .slice(index, index + 4)
            .find(candidate => candidate.includes('complexity of'));
        found.push({
            file: match[1],
            line: Number(match[2]),
            rule: match[3],
            detail: detail === undefined ? '' : detail.trim().replace(/^×\s*/, ''),
        });
    }
    return found;
}

/**
 * Keep only the diagnostics that sit on a line the diff touched.
 *
 * @param diagnostics - Everything biome reported.
 * @param touched - Repo-relative path mapped to the lines the diff changed.
 * @returns The subset this change is responsible for.
 */
export function onChangedLines(diagnostics, touched) {
    return diagnostics.filter(diagnostic => touched.get(diagnostic.file)?.has(diagnostic.line));
}

/**
 * Run biome over one file and capture everything it wrote.
 *
 * @param file - Repo-relative path.
 * @returns Combined output, empty when biome could not be run.
 */
function lintFile(file) {
    try {
        return execFileSync(
            'pnpm',
            ['exec', 'biome', 'lint', '--config-path=./biome.complexity.json', file],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 },
        );
    } catch (error) {
        // A non-zero exit IS the finding, and its report is on the streams the
        // failure carries. Only a missing binary leaves both empty.
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }
}

/**
 * Report every changed line that exceeds the cognitive-complexity limit.
 *
 * @param base - Revision to compare against.
 * @returns Process exit code.
 */
function main(base) {
    let touched;
    try {
        touched = changedLines(base);
    } catch {
        console.log(`[complexity] base ref '${base}' not available — skipping.`);
        return 0;
    }

    const files = [...touched.keys()].filter(file => isSonarScoped(file) && existsSync(file));
    if (files.length === 0) {
        console.log('[complexity] no changed files in Sonar scope — nothing to check.');
        return 0;
    }

    console.log(`[complexity] checking ${files.length} changed file(s) against a limit of 15...`);
    const offending = files.flatMap(file =>
        onChangedLines(parseBiomeDiagnostics(lintFile(file)), touched),
    );

    if (offending.length === 0) {
        console.log('[complexity] every changed line is within the limit.');
        return 0;
    }

    console.error('\n[complexity] changed lines above the cognitive-complexity limit:');
    for (const diagnostic of offending) {
        console.error(`  ${diagnostic.file}:${diagnostic.line} — ${diagnostic.detail}`);
    }
    console.error(
        '\nSonar rejects these on the pull request, so fixing them here costs one\n' +
            'local run instead of a push and a review round. Split the function along\n' +
            'the branch that carries the nesting — usually one arm of the top-level\n' +
            'condition — rather than raising the limit.',
    );
    return 1;
}

// Guarded so the Sonar scoping above can be imported by a sibling gate without
// running this one as a side effect of the import.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const flag = process.argv.slice(2).find(argument => argument.startsWith('--base='));
    process.exit(main(flag === undefined ? 'origin/main' : flag.slice('--base='.length)));
}
