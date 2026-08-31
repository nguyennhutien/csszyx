#!/usr/bin/env node
// Cognitive complexity of the code a change introduces, measured before the push.
//
// Sonar rejects new code above a cognitive complexity of 15 and was the only
// thing checking it, so the first report of an over-complex function arrived
// after a push and a review round. `pnpm lint:complexity` exists but ends in
// `|| true`, which makes it a survey rather than a gate.
//
// Two things this gate has to get right, and an earlier version got both wrong
// (measured on pull request #257):
//
//   - THE RULER. Biome's `noExcessiveCognitiveComplexity` counts differently
//     from Sonar's S3776: the same function scored 42 under biome and 16 under
//     Sonar, and a helper extracted to satisfy Sonar then scored 17 under biome
//     while Sonar read 0. A gate that reports a number nobody else measures
//     fails in both directions. `sonarjs/cognitive-complexity` is Sonar's own
//     implementation and prints its exact sentence, so a clean run here means a
//     clean report there.
//
//   - WHAT COUNTS AS NEW. The rule reports at the function HEADER, so scoping
//     by "diagnostics on a line the diff touched" missed every function whose
//     body grew without its header moving, which is most of them. Sonar asks a
//     different question: is this issue present in the base? So does this gate,
//     by linting the base revision of each changed file through stdin and
//     keeping the head diagnostics that have no counterpart there.
//
// Scoped to `sonar.sources=packages` minus its exclusion list, so `scripts/`,
// `apps/` and generated output are out.
//
// `pnpm lint:complexity` still surveys the whole tree with biome's ruler and
// still ends in `|| true`. Its numbers are not Sonar's and never were; it is a
// browsing aid, not a second opinion, and this gate is what a push is measured
// against. Moving it over needs the file scoping above, because the `sonarjs`
// plugin is registered for one glob and `--rule` fails on any file outside it.
//
// Usage: node scripts/check-changed-complexity.mjs [--base=<ref>]

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

/** Extensions eslint lints here. */
const LINTABLE = /\.(?:[cm]?[jt]sx?)$/;

/** The limit Sonar's quality profile enforces. */
const LIMIT = 15;

/** The one rule this gate reads. */
const RULE = 'sonarjs/cognitive-complexity';

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
 * Read an eslint JSON report into one record per complexity diagnostic.
 *
 * The report is located by its opening bracket rather than parsed from the
 * first byte: a warning about a config or an engine version is written to the
 * same stream ahead of it, and losing every diagnostic to that would make the
 * gate silently pass.
 *
 * @param output - Whatever eslint wrote.
 * @param file - Repo-relative path the report is about.
 * @returns One entry per diagnostic; empty when eslint produced no report.
 */
export function parseEslintDiagnostics(output, file) {
    const start = output.indexOf('[');
    if (start === -1) return [];
    let report;
    try {
        report = JSON.parse(output.slice(start));
    } catch {
        return [];
    }
    return report.flatMap(result =>
        (result.messages ?? [])
            .filter(message => message.ruleId === RULE)
            .map(message => ({ file, line: message.line, message: message.message })),
    );
}

/**
 * The head diagnostics that have no counterpart in the base revision.
 *
 * Identity is the message plus the text of the line it points at, which is the
 * function's own header. That survives the function moving down the file as
 * code above it grows, and still separates two functions that happen to score
 * the same. It deliberately does NOT survive the measured number changing: a
 * function this change pushed from 17 to 19 is one this change made worse, and
 * Sonar reports it too because the edit is in its new code.
 *
 * @param head - Diagnostics from the working tree, each carrying its line text.
 * @param base - Diagnostics from the base revision, same shape.
 * @returns The subset this change is answerable for.
 */
export function newDiagnostics(head, base) {
    const key = diagnostic => `${diagnostic.message} ${diagnostic.text}`;
    const known = new Set(base.map(key));
    return head.filter(diagnostic => !known.has(key(diagnostic)));
}

/**
 * Lint one source text as if it were the given file.
 *
 * Fed through stdin so the base revision never touches the working tree, and
 * named so eslint's flat config resolves the same blocks it would for the real
 * file: the `sonarjs` plugin is registered per path, so an out-of-tree
 * temporary file would silently lint without it.
 *
 * @param file - Repo-relative path, used for config resolution.
 * @param source - The text to lint.
 * @returns One entry per complexity diagnostic.
 */
function lintSource(file, source) {
    let output;
    try {
        output = execFileSync(
            'pnpm',
            [
                'exec',
                'eslint',
                '--stdin',
                '--stdin-filename',
                file,
                '--format',
                'json',
                '--rule',
                `${RULE}: ["error", ${LIMIT}]`,
            ],
            {
                encoding: 'utf8',
                input: source,
                stdio: ['pipe', 'pipe', 'pipe'],
                maxBuffer: 32 * 1024 * 1024,
            },
        );
    } catch (error) {
        // A non-zero exit IS the finding, and the report is on the streams the
        // failure carries. Only a missing binary leaves both empty.
        output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }
    return parseEslintDiagnostics(output, file);
}

/**
 * Attach the source text each diagnostic points at.
 *
 * @param diagnostics - Records carrying a 1-based line.
 * @param source - The text they were measured on.
 * @returns The same records with a `text` field.
 */
function withLineText(diagnostics, source) {
    const lines = source.split('\n');
    return diagnostics.map(diagnostic => ({
        ...diagnostic,
        text: (lines[diagnostic.line - 1] ?? '').trim(),
    }));
}

/**
 * The file's content at the base revision.
 *
 * @param base - Revision to read.
 * @param file - Repo-relative path.
 * @returns The text, or null when the change added the file.
 */
function baseSource(base, file) {
    try {
        return execFileSync('git', ['show', `${base}:${file}`], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            maxBuffer: 32 * 1024 * 1024,
        });
    } catch {
        return null;
    }
}

/**
 * Every function one changed file puts over the limit for the first time.
 *
 * The base revision is linted only when the head has something to report, so an
 * unremarkable file costs one eslint run rather than two.
 *
 * @param file - Repo-relative path.
 * @param base - Revision to compare against.
 * @returns The diagnostics this change is answerable for.
 */
function offendingIn(file, base) {
    const head = readFileSync(file, 'utf8');
    const found = withLineText(lintSource(file, head), head);
    if (found.length === 0) return [];
    const before = baseSource(base, file);
    if (before === null) return found;
    return newDiagnostics(found, withLineText(lintSource(file, before), before));
}

/**
 * Report every function this change put over the cognitive-complexity limit.
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

    console.log(
        `[complexity] checking ${files.length} changed file(s) against a limit of ${LIMIT}...`,
    );
    const offending = files.flatMap(file => offendingIn(file, base));

    if (offending.length === 0) {
        console.log('[complexity] every function this change touches is within the limit.');
        return 0;
    }

    console.error('\n[complexity] functions this change put over the limit:');
    for (const diagnostic of offending) {
        console.error(`  ${diagnostic.file}:${diagnostic.line} — ${diagnostic.message}`);
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
