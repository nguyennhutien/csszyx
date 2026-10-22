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
//     by linting the base revision of each changed file as text and
//     keeping the head diagnostics that have no counterpart there.
//
//   - WHAT IT READS. The report once came from `pnpm exec eslint` on stdout,
//     where pnpm writes its own warnings; one began with a bracket, the parse
//     failed, and the gate passed two functions Sonar scored 18 and 20 (#396).
//     It lints through the API now, fails when a file yields no result, and
//     lints the JavaScript files Sonar analyses and the eslint config ignores.
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
import { readSonarProperties } from './check-sonar-rule-drift.mjs';

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
 * Whether Sonar reads a file as a test, by `sonar.test.inclusions`.
 *
 * @param file - Repo-relative path.
 * @param properties - `sonar-project.properties`, read.
 * @returns True for a test file.
 */
export function isSonarTest(file, properties) {
    return (properties['sonar.test.inclusions'] ?? '')
        .split(',')
        .map(glob => glob.trim())
        .filter(Boolean)
        .some(glob => path.matchesGlob(file, glob));
}

/**
 * Read an eslint JSON report into one record per complexity diagnostic.
 *
 * The report is the line that parses as a JSON array, not whatever follows the
 * first bracket: a warning is written to the same stream ahead of it, and one
 * can open with a bracket of its own. `pnpm exec` printed `[WARN] The "$"
 * version reference syntax ...` there once an override used that syntax, the
 * parse from that bracket failed, and the gate passed every function on pull
 * request #396 while Sonar reported two.
 *
 * @param output - Whatever eslint wrote.
 * @param file - Repo-relative path the report is about.
 * @returns One entry per diagnostic, or null when eslint produced no report,
 *   which the caller must treat as a failure rather than as a clean file.
 */
export function parseEslintDiagnostics(output, file) {
    const report = output
        .split('\n')
        .filter(line => line.startsWith('['))
        .map(line => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .find(parsed => Array.isArray(parsed));
    if (report === undefined) return null;
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

/** Sonar's JavaScript sources: the repository's eslint config ignores every one. */
const JAVASCRIPT = /\.(?:[cm]?js|jsx)$/;

/**
 * Whether a file is JavaScript, which the repository's eslint config ignores
 * and Sonar analyses (`javascript:` rules, as on `tsdown.config.mjs` in #396).
 *
 * @param file - Repo-relative path.
 * @returns True for a `.js`, `.mjs`, `.cjs` or `.jsx` file.
 */
export function isJavaScript(file) {
    return JAVASCRIPT.test(file);
}

/**
 * A linter for Sonar's sources in both languages, running `rules` on them.
 *
 * Built on the API rather than `pnpm exec eslint`, so nothing else writes to
 * the stream the report is read from, and given the JavaScript files the
 * repository's config ignores: ignore patterns are off (the caller has scoped
 * the files to Sonar's), and a block registers the plugins for JavaScript,
 * which the config registers for TypeScript only.
 *
 * @param {Record<string, unknown>} rules - eslint rule settings, by name.
 * @param {{ javascript?: Record<string, unknown> }} [options] - Rules for
 *   JavaScript files instead, where they differ (a typed rule cannot run there).
 * @returns {Promise<import('eslint').ESLint>} The linter.
 */
export async function sonarScopedLinter(rules, options = {}) {
    // Each file is linted twice, the second time as its base revision's text,
    // which is not on disk; a single-run program (what `CI=true` turns on)
    // would type that text as the working tree's.
    process.env.TSESTREE_SINGLE_RUN ??= 'false';
    const { ESLint } = await import('eslint');
    const sonarjsModule = await import('eslint-plugin-sonarjs');
    const unicornModule = await import('eslint-plugin-unicorn');
    return new ESLint({
        ignore: false,
        overrideConfig: [
            { files: ['packages/**/*.ts', 'packages/**/*.tsx'], rules },
            {
                files: ['packages/**/*.js', 'packages/**/*.mjs', 'packages/**/*.cjs'],
                languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
                plugins: {
                    sonarjs: sonarjsModule.default ?? sonarjsModule,
                    unicorn: unicornModule.default ?? unicornModule,
                },
                rules: options.javascript ?? rules,
            },
        ],
    });
}

/**
 * Lint one source text as if it were the given file.
 *
 * Linted as text so the base revision never touches the working tree, and
 * named so eslint's flat config resolves the same blocks it would for the real
 * file: the `sonarjs` plugin is registered per path, so an out-of-tree
 * temporary file would silently lint without it.
 *
 * @param {import('eslint').ESLint} eslint - From {@link sonarScopedLinter}.
 * @param {string} file - Repo-relative path, used for config resolution.
 * @param {string} source - The text to lint.
 * @returns {Promise<{ file: string, line: number, message: string }[]>} One
 *   entry per complexity diagnostic.
 */
async function lintSource(eslint, file, source) {
    const [result] = await eslint.lintText(source, { filePath: file });
    const fatal = (result?.messages ?? []).find(message => message.fatal);
    if (result === undefined || fatal !== undefined) {
        // Silence here once read as "within the limit"; it means nothing ran.
        throw new Error(`eslint could not lint ${file}: ${fatal?.message ?? 'no result'}`);
    }
    return parseEslintDiagnostics(JSON.stringify([result]), file) ?? [];
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
 * @param eslint - From {@link sonarScopedLinter}.
 * @param file - Repo-relative path.
 * @param base - Revision to compare against.
 * @returns The diagnostics this change is answerable for.
 */
async function offendingIn(eslint, file, base) {
    const head = readFileSync(file, 'utf8');
    const found = withLineText(await lintSource(eslint, file, head), head);
    if (found.length === 0) return [];
    const before = baseSource(base, file);
    if (before === null) return found;
    return newDiagnostics(found, withLineText(await lintSource(eslint, file, before), before));
}

/**
 * Report every function this change put over the cognitive-complexity limit.
 *
 * @param base - Revision to compare against.
 * @returns Process exit code.
 */
async function main(base) {
    let touched;
    try {
        touched = changedLines(base);
    } catch {
        console.log(`[complexity] base ref '${base}' not available — skipping.`);
        return 0;
    }

    // The profile runs S3776 on main code only (scope MAIN), so a test file is
    // not measured there and is not here.
    const properties = readSonarProperties('sonar-project.properties');
    const files = [...touched.keys()].filter(
        file => isSonarScoped(file) && !isSonarTest(file, properties) && existsSync(file),
    );
    if (files.length === 0) {
        console.log('[complexity] no changed files in Sonar scope — nothing to check.');
        return 0;
    }

    console.log(
        `[complexity] checking ${files.length} changed file(s) against a limit of ${LIMIT}...`,
    );
    const eslint = await sonarScopedLinter({ [RULE]: ['error', LIMIT] });
    const offending = [];
    for (const file of files) offending.push(...(await offendingIn(eslint, file, base)));

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
    main(flag === undefined ? 'origin/main' : flag.slice('--base='.length))
        .then(code => process.exit(code))
        .catch(error => {
            console.error(`[complexity] ${error.stack ?? error.message}`);
            process.exit(1);
        });
}
