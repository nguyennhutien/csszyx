#!/usr/bin/env node
// Sonar's rules on the code a change introduces, measured before the push.
//
// SonarCloud runs a quality profile of several hundred rules on every pull
// request and reports what is new. Locally only a handful were on, so a finding
// arrived after the push: three times on two pull requests in one day, each from
// a rule `eslint-plugin-sonarjs` implements but nothing here switched on
// (S1874 deprecated API, S5976 similar tests, S4323 repeated union type).
//
// This runs every profile rule a local plugin implements — the list in
// `scripts/sonar-profile-rules.json`, written by
// `node scripts/check-sonar-rule-drift.mjs --write-profile` — on each changed
// file Sonar analyses, and reports what the base revision of that file does not
// already have. That is Sonar's question too ("is this issue new?"), and it is
// why the existing tree's backlog does not fail every run.
//
// What this does not do:
//   - Rules the profile runs with no local implementation still arrive only on
//     the pull request; the drift script lists them.
//   - Rules run with eslint's default options, not the profile's parameters.
//   - Cognitive complexity has its own gate (check-changed-complexity.mjs) with
//     the profile's limit, and is left to it.
//
// Usage: node scripts/check-changed-sonar.mjs [--base=<ref>]

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { isSonarScoped } from './check-changed-complexity.mjs';
import { changedLines } from './check-patch-coverage.mjs';
import { PROFILE_RULES_FILE, readSonarProperties } from './check-sonar-rule-drift.mjs';

/** Rules a dedicated gate runs with the profile's own options. */
const GATED_ELSEWHERE = new Set(['sonarjs/cognitive-complexity']);

/**
 * The eslint rules to run on one kind of file: the profile's locally
 * implemented rules whose Sonar scope covers it, minus the ones another gate
 * owns. Sonar reads test files with TEST and ALL rules only, and main files
 * with MAIN and ALL: `no-alphabetical-sort` is MAIN, so a test's bare
 * `.sort()` is not reported there.
 *
 * @param profile - The parsed `sonar-profile-rules.json`.
 * @param isTest - Whether the file is one of Sonar's test files.
 * @returns Rule name to Sonar key.
 */
export function rulesToRun(profile, isTest) {
    if (profile.format !== 1) {
        throw new Error(`${PROFILE_RULES_FILE} is format ${profile.format}; this reads format 1`);
    }
    const wanted = isTest ? 'TEST' : 'MAIN';
    return new Map(
        profile.rules
            .filter(entry => !GATED_ELSEWHERE.has(entry.rule))
            .filter(entry => entry.scope === 'ALL' || entry.scope === wanted)
            .map(entry => [entry.rule, entry.key]),
    );
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
 * The `sonar.issue.ignore.multicriteria` entries, as Sonar key and path glob.
 *
 * @param properties - `sonar-project.properties`, read.
 * @returns One entry per criterion.
 */
export function ignoredIssues(properties) {
    const ids = (properties['sonar.issue.ignore.multicriteria'] ?? '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);
    return ids.map(id => ({
        key: properties[`sonar.issue.ignore.multicriteria.${id}.ruleKey`] ?? '',
        glob: properties[`sonar.issue.ignore.multicriteria.${id}.resourceKey`] ?? '',
    }));
}

/**
 * Whether Sonar is told to ignore this rule on this file.
 *
 * @param key - Sonar key, `typescript:S6747`.
 * @param file - Repo-relative path.
 * @param ignored - What {@link ignoredIssues} returned.
 * @returns True when a criterion matches both.
 */
export function isIgnored(key, file, ignored) {
    return ignored.some(entry => entry.key === key && path.matchesGlob(file, entry.glob));
}

/**
 * The head diagnostics with no counterpart in the base revision.
 *
 * Identity is the rule, the message and the trimmed text of the line it points
 * at, so a finding survives the code above it growing, and counted, so a
 * second copy of an old finding is new.
 *
 * @param head - Diagnostics on the working tree, each with `text`.
 * @param base - Diagnostics on the base revision, same shape.
 * @returns The ones this change is answerable for.
 */
export function newDiagnostics(head, base) {
    const key = diagnostic => `${diagnostic.ruleId} ${diagnostic.message} ${diagnostic.text}`;
    const known = new Map();
    for (const diagnostic of base)
        known.set(key(diagnostic), (known.get(key(diagnostic)) ?? 0) + 1);
    return head.filter(diagnostic => {
        const left = known.get(key(diagnostic)) ?? 0;
        if (left === 0) return true;
        known.set(key(diagnostic), left - 1);
        return false;
    });
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
 * Lint one text as the given file with the profile's rules.
 *
 * @param eslint - An ESLint instance carrying the rules.
 * @param ruleKeys - Rule name to Sonar key.
 * @param file - Repo-relative path, for config resolution.
 * @param source - The text.
 * @returns Diagnostics of the profile's rules, each with its line text.
 */
async function lint(eslint, ruleKeys, file, source) {
    const [result] = await eslint.lintText(source, { filePath: file });
    const lines = source.split('\n');
    return (result?.messages ?? [])
        .filter(message => ruleKeys.has(message.ruleId))
        .map(message => ({
            file,
            line: message.line,
            ruleId: message.ruleId,
            key: ruleKeys.get(message.ruleId),
            message: message.message,
            text: (lines[message.line - 1] ?? '').trim(),
        }));
}

/**
 * A violation of a profile rule that reads types, linted before the change.
 *
 * Such a rule compares a type's flags with the `typescript` it loads itself.
 * When that copy is not the one typescript-eslint built the program with, the
 * flags are numbered differently and the rule reports nothing, so this gate
 * printed "nothing new" while SonarCloud raised S2301 on #387. The canary
 * turns that silence into a failure, whatever its cause.
 */
export const TYPED_CANARY = {
    rule: 'sonarjs/no-selector-parameter',
    // Any file in `tsconfig.eslint.json`: its text is replaced, its place
    // gives the program.
    file: 'packages/compiler/src/index.ts',
    source:
        'export function pick(a: string, upper: boolean): string {\n' +
        '    return upper ? a.toUpperCase() : a.toLowerCase();\n' +
        '}\n',
};

/**
 * The `typescript` each side of a type-aware sonarjs rule loads.
 *
 * @param from - Where to resolve the packages from.
 * @returns The resolved file of each copy.
 */
export function typescriptCopies(from = import.meta.url) {
    const require = createRequire(from);
    const sonarjs = createRequire(require.resolve('eslint-plugin-sonarjs'));
    const parser = createRequire(require.resolve('@typescript-eslint/parser'));
    return { sonarjs: sonarjs.resolve('typescript'), parser: parser.resolve('typescript') };
}

/**
 * Fail unless the type-aware rules report on the canary.
 *
 * @param eslint - The source-file linter, carrying the profile's rules.
 * @returns Null when the canary is reported, the failure to print otherwise.
 */
export async function typedCanaryProblem(eslint) {
    const [result] = await eslint.lintText(TYPED_CANARY.source, { filePath: TYPED_CANARY.file });
    if ((result?.messages ?? []).some(message => message.ruleId === TYPED_CANARY.rule)) {
        return null;
    }
    const copies = typescriptCopies();
    return (
        `[sonar] ${TYPED_CANARY.rule} did not report a deliberate violation, so every ` +
        'profile rule that reads types is silent here and its findings would reach only ' +
        'SonarCloud.\n' +
        `  eslint-plugin-sonarjs loads ${copies.sonarjs}\n` +
        `  @typescript-eslint/parser loads ${copies.parser}\n` +
        'Two copies number type flags differently; the override in pnpm-workspace.yaml ' +
        'keeps them one.'
    );
}

/**
 * Report every profile finding this change introduces.
 *
 * @param base - Revision to compare against.
 * @returns Process exit code.
 */
async function main(base) {
    let touched;
    try {
        touched = changedLines(base);
    } catch {
        console.log(`[sonar] base ref '${base}' not available — skipping.`);
        return 0;
    }
    const files = [...touched.keys()].filter(file => isSonarScoped(file) && existsSync(file));
    if (files.length === 0) {
        console.log('[sonar] no changed files in Sonar scope — nothing to check.');
        return 0;
    }

    const profile = JSON.parse(readFileSync(PROFILE_RULES_FILE, 'utf8'));
    const properties = readSonarProperties('sonar-project.properties');
    const ignored = ignoredIssues(properties);
    const { ESLint } = await import('eslint');
    const linterFor = isTest => {
        const ruleKeys = rulesToRun(profile, isTest);
        const eslint = new ESLint({
            overrideConfig: [
                {
                    files: ['packages/**/*.ts', 'packages/**/*.tsx'],
                    rules: Object.fromEntries([...ruleKeys.keys()].map(rule => [rule, 'error'])),
                },
            ],
        });
        return { eslint, ruleKeys };
    };
    const linters = { main: linterFor(false), test: linterFor(true) };
    const canary = await typedCanaryProblem(linters.main.eslint);
    if (canary !== null) {
        console.error(canary);
        return 1;
    }

    console.log(
        `[sonar] checking ${files.length} changed file(s) against ${linters.main.ruleKeys.size} ` +
            `profile rules (${linters.test.ruleKeys.size} on tests)...`,
    );
    const found = [];
    for (const file of files) {
        const { eslint, ruleKeys } = isSonarTest(file, properties) ? linters.test : linters.main;
        const head = await lint(eslint, ruleKeys, file, readFileSync(file, 'utf8'));
        if (head.length === 0) continue;
        const before = baseSource(base, file);
        const fresh =
            before === null
                ? head
                : newDiagnostics(head, await lint(eslint, ruleKeys, file, before));
        found.push(...fresh.filter(diagnostic => !isIgnored(diagnostic.key, file, ignored)));
    }

    if (found.length === 0) {
        console.log('[sonar] nothing new from the profile rules this repository can run.');
        return 0;
    }
    console.error('\n[sonar] new findings Sonar reports on this change:');
    for (const diagnostic of found) {
        console.error(
            `  ${diagnostic.file}:${diagnostic.line} ${diagnostic.key} (${diagnostic.ruleId}) — ${diagnostic.message}`,
        );
    }
    console.error(
        '\nSonar raises these on the pull request. Fix them here, or, when a rule\n' +
            'does not apply to this repository, deactivate it on the Sonar profile and\n' +
            'rewrite the list with `node scripts/check-sonar-rule-drift.mjs --write-profile`.',
    );
    return 1;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const flag = process.argv.slice(2).find(argument => argument.startsWith('--base='));
    main(flag === undefined ? 'origin/main' : flag.slice('--base='.length))
        .then(code => process.exit(code))
        .catch(error => {
            console.error(`[sonar] ${error.stack ?? error.message}`);
            process.exit(1);
        });
}
