/**
 * `csszyx check` — a static diagnostic pass over a whole project.
 *
 * Dev-mode warnings about unknown/aliased `sz` keys are emitted lazily: a file
 * is only transformed when its route is requested, so a typo in an unvisited
 * file stays hidden until you happen to load it. This command runs the same
 * lowering over every source file up front and reports the issues in one place,
 * without touching the dev server. It is meant to be run on demand or in CI.
 *
 * @module
 */

import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
    SZ_DIAGNOSTIC_KIND_IDS,
    type SzDiagnosticCode,
    szDiagnosticKindOf,
    szKeySuggestionFor,
    transformSource,
} from '@csszyx/compiler';
import {
    createEmittedClassOracle,
    DEPENDENCY_OUTPUT_DIRS,
    type DeclaredToken,
    type EmittedClassOracle,
    FILE_READ_CONCURRENCY,
    findSiblingKeywordValues,
    findTailwindCssEntries,
    findThemeCollisions,
    mapConcurrent,
    readTextFiles,
    type SiblingKeywordFinding,
    STYLESHEET_COMPILE_CONCURRENCY,
    type SzValuePair,
    skippedDirGlobs,
    szValuePairs,
} from '@csszyx/tailwind-oracle';
import type { SzDiagnosticLevel } from '@csszyx/types';
import {
    type DiagnosticPolicy,
    diagnosticConfigProblemsMessage,
    isAtLeastLevel,
    loadDiagnosticPolicy,
} from '@csszyx/unplugin/diagnostics';
import fg from 'fast-glob';
import {
    CHECK_RULES,
    type CheckRule,
    createReporter,
    type Reporter,
    renderJsonReport,
} from '../scanner/check-report.js';
import {
    MERGE_AUDIT_RULES,
    type MergeAuditKind,
    reportMergeAudit,
} from '../scanner/merge-audit-report.js';
import { declaredThemeTokens } from '../scanner/theme-declarations.js';
import { relativePosix, withPosixSeparators } from '../utils/posix-path.js';
import { printHeader, printWarn, spinner } from '../utils/terminal-ui.js';

/** Options for the `check` command. */
export interface CheckOptions {
    /** Project root to scan, absolute or relative to `process.cwd()`. Defaults to `process.cwd()`. */
    cwd?: string;
    /**
     * Directory to scan, relative to `cwd`. Narrows the glob and nothing else:
     * the stylesheet and Tailwind are still resolved from `cwd`, and findings
     * keep paths relative to it.
     */
    dir?: string;
    /** Glob to match source files, relative to `dir` when one is given. Defaults to `**\/*.{jsx,tsx}`. */
    pattern?: string;
    /** Extra ignore globs appended to the defaults. */
    ignore?: string[];
    /**
     * Emitted classes to accept even when they produce no CSS.
     *
     * A project can hold a class the design system cannot see — one a later
     * build step defines, or one emitted for a consumer that supplies its own
     * stylesheet. Without a way to say so, the only lever left is to stop
     * running the check, which costs every other finding too.
     */
    allow?: string[];
    /**
     * Theme token names to accept even though a built-in utility claims them.
     *
     * The collision is wrong output, not a missed optimisation, so it fails by
     * default. A project that wants the name anyway says so here, and the
     * exemption becomes a line in a diff someone reviews rather than a check
     * nobody runs.
     */
    allowToken?: string[];
    /**
     * The quietest level that fails the run. Defaults to `error`: an `info`
     * or `warn` finding is reported and the run still passes.
     */
    failOn?: SzDiagnosticLevel;
    /**
     * Rule or diagnostic-kind ids to report; every other finding is left out of
     * the report and the exit code. Empty or absent means every rule. A
     * selection, not a level: a selected `info` finding still passes.
     */
    rule?: string[];
    /** Rule or diagnostic-kind ids to leave out of the report and the exit code. */
    ignoreRule?: string[];
    /**
     * Emit one machine-readable document instead of the prose report.
     *
     * The verdict does not change with the format: the exit code is the same
     * either way, so a pipeline can switch on this without re-reading what it
     * means to fail.
     */
    json?: boolean;
    /**
     * An explicit list of files to check, absolute or project-relative.
     *
     * What a git hook has to offer: lefthook and husky hand over the staged
     * paths, not a glob. Given, this replaces the glob scan entirely — a hook
     * that also walked the project would report files the author did not touch.
     *
     * Scoping is sound because the scan lowers each file on its own, with no
     * cross-module registry, so a file checked alone yields exactly what it
     * yields in a whole-project run.
     */
    files?: string[];
}

/** One captured sz diagnostic, with the kind the compiler reads from its code. */
interface ClassifiedIssue extends SzIssue {
    kind: string;
    /** The known key an `unknown-key` issue most likely misspells, or null. */
    suggestion: string | null;
}

/** One captured sz diagnostic, with the project-relative file it came from. */
interface SzIssue {
    file: string;
    message: string;
    /** The code the engine gave it; absent only for a result with no codes. */
    code?: SzDiagnosticCode;
}

/**
 * Dependencies and framework output only. A gitignored or report-named folder
 * among the sources is still audited: the build safelists what it holds.
 */
const DEFAULT_IGNORE = skippedDirGlobs(DEPENDENCY_OUTPUT_DIRS, { anchored: false });

/**
 * Read one source file, returning null when it cannot contribute diagnostics.
 *
 * @param file Absolute source path.
 * @returns Source text containing sz syntax, or null when irrelevant/unreadable.
 */
async function readSzSource(file: string): Promise<string | null> {
    try {
        const source = await readFile(file, 'utf8');
        return source.includes('sz') ? source : null;
    } catch {
        return null;
    }
}

/** Extensions the scan can lower. */
const SOURCE_EXTENSIONS = new Set(['.jsx', '.tsx']);

/** An explicit file list, split into what can be read and what cannot. */
interface ListedFiles {
    /** Absolute paths of the source files that exist. */
    files: string[];
    /** Paths that named a source file which could not be read. */
    missing: string[];
}

/**
 * Resolve an explicit file list to the paths this scan can read.
 *
 * A hook passes everything that was staged, so a README or a lockfile arrives
 * alongside the components. Those are dropped rather than refused: a run that
 * failed because a doc was committed in the same change would be switched off
 * within a day.
 *
 * A path that DOES name a source file and still cannot be read is the
 * opposite case, and is kept rather than dropped. Counting it as scanned is
 * how the command came to print "no issues found across 1 files" for a file
 * it never opened, which is the one answer a commit gate must never give.
 *
 * @param listed - Paths as given, absolute or project-relative.
 * @param cwd - Project root.
 * @returns The readable source files, and the ones that were not.
 */
function listedSourceFiles(listed: readonly string[], cwd: string): ListedFiles {
    const files: string[] = [];
    const missing: string[] = [];
    for (const given of listed) {
        const file = withPosixSeparators(given);
        if (!SOURCE_EXTENSIONS.has(path.extname(file))) continue;
        const absolute = path.isAbsolute(file) ? file : path.join(cwd, file);
        if (existsSync(absolute)) files.push(absolute);
        else missing.push(given);
    }
    return { files, missing };
}

/**
 * The line a compiler diagnostic names, when it names one.
 *
 * The engine already renders `at path/File.tsx:12` into its message, and
 * re-deriving the position here would mean a second answer free to disagree
 * with the one the author reads.
 *
 * @param message - The diagnostic text.
 * @returns The 1-based line, or undefined when the message carries none.
 */
function lineFromMessage(message: string): number | undefined {
    const match = /:(\d+)(?::\d+)?\b/.exec(message);
    return match ? Number(match[1]) : undefined;
}

/**
 * Group captured diagnostics by project-relative file.
 *
 * @param issues Captured compiler diagnostics.
 * @returns Diagnostics keyed by project-relative file.
 */
function groupIssuesByFile(issues: SzIssue[]): Map<string, string[]> {
    const byFile = new Map<string, string[]>();
    for (const { file, message } of issues) {
        const messages = byFile.get(file) ?? [];
        messages.push(message);
        byFile.set(file, messages);
    }
    return byFile;
}

/** Every design system this project compiles, with why any were skipped. */
interface OpenedOracles {
    oracles: Array<Extract<EmittedClassOracle, { ok: true }>>;
    /** One reason per stylesheet that produced no oracle. */
    skipped: string[];
    /** True when a stylesheet belonging to the project would not compile. */
    stylesheetFailed: boolean;
    /** False when nothing in the project imports Tailwind at all. */
    hadEntries: boolean;
    /** The prefix each compiled entry's `@import "tailwindcss"` line set, by entry. */
    prefixes: Array<{ entry: string; prefix: string | null }>;
}

/**
 * Compile every Tailwind entry the project has, once.
 *
 * Several passes need the project's own design system, and compiling it per
 * pass would both cost the work twice and let two passes disagree about a
 * project whose stylesheet is mid-edit.
 *
 * @param cwd - Project root.
 * @returns The compiled design systems and the reasons any were skipped.
 */
async function openOracles(cwd: string): Promise<OpenedOracles> {
    const entries = await findTailwindCssEntries(cwd);
    const oracles: Array<Extract<EmittedClassOracle, { ok: true }>> = [];
    const skipped: string[] = [];
    const prefixes: OpenedOracles['prefixes'] = [];
    let stylesheetFailed = false;
    // Two compiles at a time, as the build's own style model does; read in
    // entry order, so the skip reasons and prefixes keep that order.
    const compiled = await mapConcurrent(entries, STYLESHEET_COMPILE_CONCURRENCY, async entry =>
        createEmittedClassOracle({
            resolveFrom: cwd,
            css: await readFile(entry, 'utf8'),
            cssBase: path.dirname(entry),
        }),
    );
    for (const [index, entry] of entries.entries()) {
        const oracle = compiled[index] as EmittedClassOracle;
        if (oracle.ok) {
            oracles.push(oracle);
            prefixes.push({ entry: relativePosix(cwd, entry), prefix: oracle.facts.prefix });
        } else {
            skipped.push(oracle.reason);
            stylesheetFailed ||= oracle.kind === 'stylesheet';
        }
    }
    return { oracles, skipped, stylesheetFailed, hadEntries: entries.length > 0, prefixes };
}

/**
 * A prefix the way an `@import "tailwindcss"` line spells it.
 *
 * @param prefix - A prefix, or null.
 * @returns `prefix(tw)`, or `no prefix`.
 */
function prefixLabel(prefix: string | null): string {
    return prefix === null ? 'no prefix' : `prefix(${prefix})`;
}

/**
 * The Tailwind prefix every compiled entry agrees on.
 *
 * csszyx writes one prefix before every class, so a project whose entries set
 * different ones has classes that are dead under one of them whichever prefix
 * is used. Checking against a guess would report the half it did not guess, or
 * pass the half it did, so the disagreement is the finding.
 *
 * @param opened - The project's compiled design systems.
 * @returns The agreed prefix, or null with the message naming each entry.
 */
function agreedPrefix(opened: OpenedOracles): {
    prefix: string | null;
    disagreement: string | null;
} {
    const [first, ...rest] = opened.prefixes;
    if (rest.every(entry => entry.prefix === first?.prefix)) {
        return { prefix: first?.prefix ?? null, disagreement: null };
    }
    const listed = opened.prefixes
        .map(entry => `${entry.entry}: ${prefixLabel(entry.prefix)}`)
        .join('; ');
    return {
        prefix: null,
        disagreement: `The Tailwind entries in this project set different prefixes (${listed}), so sz cannot be checked against all of them. Give every entry the same @import "tailwindcss" line.`,
    };
}

/**
 * Ask Tailwind which of the emitted classes produce no CSS, and report them.
 *
 * A class that styles nothing is the failure csszyx exists to prevent, and it
 * is invisible in the source: the class is right there in the DOM. Only the
 * project's own Tailwind can answer, because the answer depends on its theme,
 * its custom breakpoints and its `@utility` definitions.
 *
 * Anything that stops the question being asked is reported as a skip, never as
 * a finding — a project without Tailwind v4 is not a project full of dead
 * classes.
 *
 * @param out - Where this pass sends its prose and its findings.
 * @param opened - The project's compiled design systems.
 * @param origins - Emitted class mapped to the file that first emitted it.
 * @param allow - Classes the project vouched for.
 * @param wants - Whether the run reports findings of a rule.
 * @param disagreement - Why the entries give no single prefix, or null.
 * @param failOn - The quietest level that fails the run.
 * @returns Whether the pass could not run on a project stylesheet, which
 *          fails the run whatever the levels say.
 */
function reportDeadClasses(
    out: Reporter,
    opened: OpenedOracles,
    origins: Map<string, string>,
    allow: readonly string[],
    wants: (rule: CheckRule) => boolean,
    disagreement: string | null,
    failOn: SzDiagnosticLevel,
): boolean {
    if (origins.size === 0) return false;

    const { oracles, skipped, stylesheetFailed, hadEntries } = opened;
    if (!hadEntries) {
        out.info(
            'Dead-class check skipped: no stylesheet in this project imports Tailwind, so ' +
                'there is no design system to ask which classes are real.',
        );
        return false;
    }
    if (disagreement !== null) {
        const level = out.levelOf({ rule: 'dead-class', kind: PREFIX_DISAGREEMENT });
        if (level === 'off') return false;
        const { mark, below } = summaryMark([level], failOn);
        out.warn(`\n${mark} ${disagreement}${belowNote(below, failOn)}`);
        out.push({ rule: 'dead-class', kind: PREFIX_DISAGREEMENT, message: disagreement });
        return false;
    }
    if (oracles.length === 0) {
        // Every reason, not the first: there was at least one entry and none of
        // them produced an oracle, so each has something to say about why, and
        // a project whose stylesheets fail for different reasons is exactly the
        // one where hearing only the first sends the user to the wrong file.
        out.info(`Dead-class check skipped: ${skipped.join('; ')}.`);
        // A stylesheet that will not compile is a broken project, not an absent
        // one, and passing it quietly is how a check stays green for months
        // after it stopped running. An environment with nothing to ask — no
        // Tailwind, a version without a design system — still passes: failing
        // there would break every consumer who does not build with one.
        if (stylesheetFailed) {
            out.warn(
                '\n✖ The dead-class check did not run. Its stylesheet is part of this project, ' +
                    'so this is reported as a failure rather than a skip — otherwise a check ' +
                    'that never runs is indistinguishable from one that found nothing.',
            );
        }
        return stylesheetFailed;
    }

    const vouched = new Set(allow);
    // Dead means dead under EVERY design system the project has. One that
    // serves the class is enough for it to be real — the project ships that
    // stylesheet too, and this command has no page-to-stylesheet mapping to
    // narrow it further. Erring the other way would report live classes.
    const emitted = [...origins.keys()];
    const deadPerOracle = oracles.map(oracle => new Set(oracle.findDead(emitted)));
    // Carried as class-with-origin from here on. Splitting them and looking the
    // origin up again at print time asks a question the map cannot answer for
    // sure, when the answer was in hand all along.
    const found = [...origins].filter(([token]) => deadPerOracle.every(dead => dead.has(token)));
    const accepted = found.filter(([token]) => vouched.has(token));
    const dead = found.filter(([token]) => !vouched.has(token));
    // The opacity verdict follows the dead-class consensus rule for the same
    // reason: one stylesheet serving the modifier is enough for it to be real,
    // and erring the other way would report working classes.
    const brokenPerOracle = oracles.map(
        oracle =>
            new Map(oracle.findBrokenOpacity(emitted).map(entry => [entry.token, entry.value])),
    );
    const broken = [...origins]
        .filter(
            ([token]) =>
                !vouched.has(token) && brokenPerOracle.every(byToken => byToken.has(token)),
        )
        .map(([token, origin]) => ({
            token,
            origin,
            value: brokenPerOracle[0].get(token) as string,
        }));
    printDeadClassReport(out, {
        dead,
        broken,
        acceptedCount: accepted.length,
        emittedCount: origins.size,
        wants,
        failOn,
    });
    return false;
}

/** One emitted class that carries an opacity modifier the stylesheet drops. */
interface BrokenOpacityFinding {
    token: string;
    origin: string;
    value: string;
}

/** What the dead-class scan concluded, ready to print. */
interface DeadClassReport {
    dead: ReadonlyArray<readonly [string, string]>;
    broken: readonly BrokenOpacityFinding[];
    acceptedCount: number;
    emittedCount: number;
    /** Whether the run reports findings of this rule. */
    wants: (rule: CheckRule) => boolean;
    /** The quietest level that fails the run. */
    failOn: SzDiagnosticLevel;
}

/**
 * How a pass marks its summary line, from the levels of what it reported.
 *
 * `✖` while any finding fails the run; `!` when none does, so a run that
 * exits 0 never prints a failure cross. `below` counts the findings under
 * `--fail-on`, which each summary says do not fail the run.
 *
 * @param levels - The level of each reported finding.
 * @param failOn - The quietest level that fails the run.
 * @returns The mark and how many findings are below the threshold.
 */
function summaryMark(
    levels: readonly SzDiagnosticLevel[],
    failOn: SzDiagnosticLevel,
): { mark: string; below: number } {
    const below = levels.filter(level => !isAtLeastLevel(level, failOn)).length;
    return { mark: below === levels.length ? '!' : '\u2716', below };
}

/**
 * The sentence a summary ends with when some findings do not fail the run.
 *
 * @param below - How many findings are below `--fail-on`.
 * @param failOn - The threshold.
 * @returns The sentence with a leading space, or an empty string.
 */
function belowNote(below: number, failOn: SzDiagnosticLevel): string {
    return below === 0 ? '' : ` ${below} below --fail-on ${failOn}, which do not fail the run.`;
}

/**
 * The tag a listed finding carries when its level is quieter than `error`,
 * as the sz-issue report writes it.
 *
 * @param level - The finding's level.
 * @returns `(warn) ` and the like, or an empty string for `error`.
 */
function levelTag(level: SzDiagnosticLevel): string {
    return level === 'error' ? '' : `(${level}) `;
}

/**
 * Print what the dead-class scan found.
 *
 * Split from the scan so each side stays readable on its own: the scan decides
 * what is dead across every stylesheet, and this decides how to say it.
 *
 * @param out - Where this pass sends its prose and its findings.
 * @param report - What the scan concluded.
 */
function printDeadClassReport(out: Reporter, report: DeadClassReport): void {
    const { dead, broken, acceptedCount, emittedCount, wants, failOn } = report;
    // Say how many were waved through even on a clean run: an allow list that
    // silently covers a growing pile is the failure mode of every such list.
    const acceptedNote = acceptedCount > 0 ? `, ${acceptedCount} accepted` : '';

    if (dead.length === 0 && broken.length === 0) {
        out.success(
            `Every one of the ${emittedCount} emitted class(es) produces CSS under this project's Tailwind${acceptedNote}.`,
        );
        return;
    }

    // Judged on every class before narrowing, so a run narrowed to one rule
    // never prints "every class produces CSS" over a finding it left out. A
    // finding the config sets `off` is not reported at all.
    const shownDead = wants('dead-class')
        ? dead
              .map(([token, origin]) => ({
                  token,
                  origin,
                  level: out.levelOf({ rule: 'dead-class', file: origin }),
              }))
              .filter(entry => entry.level !== 'off')
        : [];
    const shownBroken = wants('broken-opacity')
        ? broken
              .map(entry => ({
                  ...entry,
                  level: out.levelOf({ rule: 'broken-opacity', file: entry.origin }),
              }))
              .filter(entry => entry.level !== 'off')
        : [];

    if (shownDead.length > 0) {
        out.warn('\nClasses that produce no CSS:');
        for (const { token, origin, level } of shownDead) {
            out.push({
                rule: 'dead-class',
                file: origin,
                message: `"${token}" is emitted but produces no CSS under this project's Tailwind.`,
            });
            out.info(`  ${levelTag(level)}${token.padEnd(28)} ${origin}`);
        }
        const { mark, below } = summaryMark(
            shownDead.map(entry => entry.level),
            failOn,
        );
        out.warn(
            `\n${mark} ${shownDead.length} emitted class(es) style nothing. Each is in the DOM and does ` +
                `nothing: fix the sz key, or define the class with Tailwind's @utility.${belowNote(below, failOn)}`,
        );
    }

    if (shownBroken.length > 0) {
        // Judged from the compiled rule, never from the token's text: Tailwind
        // v4 wraps the modifier in color-mix(), which dims any valid color, so
        // the only broken shape is a var() chain ending in a bare comma
        // triplet — invalid inside color-mix(), silently dropped by browsers.
        out.warn('\nOpacity modifiers the compiled stylesheet drops:');
        for (const entry of shownBroken) {
            out.push({
                rule: 'broken-opacity',
                file: entry.origin,
                message: `"${entry.token}" carries an opacity modifier this stylesheet drops.`,
            });
            out.info(`  ${levelTag(entry.level)}${entry.token.padEnd(28)} ${entry.origin}`);
            out.info(
                `      its theme token resolves to the bare triplet "${entry.value}", which ` +
                    'color-mix() cannot dim — wrap the variable, e.g. rgb(var(--your-triplet)).',
            );
        }
        const { mark, below } = summaryMark(
            shownBroken.map(entry => entry.level),
            failOn,
        );
        out.warn(
            `\n${mark} ${shownBroken.length} emitted class(es) carry an opacity modifier that does not ` +
                `survive compilation.${belowNote(below, failOn)}`,
        );
    }
}

/**
 * Print captured diagnostics, each at its level.
 *
 * @param out - Where this pass sends its prose and its findings.
 * @param issues Captured compiler diagnostics, with the kind each one reports.
 * @param failOn - The quietest level that fails the run.
 */
function reportIssues(out: Reporter, issues: ClassifiedIssue[], failOn: SzDiagnosticLevel): void {
    for (const { file, message, kind, suggestion } of issues) {
        out.push({
            rule: 'sz-diagnostic',
            kind,
            file,
            line: lineFromMessage(message),
            message,
            ...(suggestion === null ? {} : { suggestion }),
        });
    }
    const suggestionOf = new Map(issues.map(issue => [issue.message, issue.suggestion]));
    const levelOf = new Map(issues.map(issue => [issue.message, issueLevel(out, issue)]));
    const byFile = groupIssuesByFile(issues);
    for (const [file, messages] of byFile) {
        out.warn(file);
        for (const message of messages) {
            // An error reads as it always has; a quieter level says so, since
            // it is the reason the run can still pass.
            const level = levelOf.get(message);
            out.info(level === 'error' ? `  ${message}` : `  (${level}) ${message}`);
            const suggestion = suggestionOf.get(message);
            if (suggestion) out.info(`    Did you mean "${suggestion}"?`);
        }
    }
    const { mark, below } = summaryMark(
        issues.map(issue => issueLevel(out, issue)),
        failOn,
    );
    if (below === 0) {
        out.warn(`\n${mark} ${issues.length} sz issue(s) in ${byFile.size} file(s).`);
        return;
    }
    out.warn(
        `\n${mark} ${issues.length} sz issue(s) in ${byFile.size} file(s); ${below} below --fail-on ${failOn}, which do not fail the run.`,
    );
}

/**
 * The level the project gives one sz diagnostic.
 *
 * @param out - The run's reporter.
 * @param issue - The diagnostic.
 * @returns Its level.
 */
function issueLevel(out: Reporter, issue: ClassifiedIssue): SzDiagnosticLevel {
    return out.levelOf({ rule: 'sz-diagnostic', kind: issue.kind, file: issue.file });
}

/** What one scan pass learned about a project. */
interface SzDiagnostics {
    issues: SzIssue[];
    /** Class name to the first file that produced it. */
    classOrigins: Map<string, string>;
    /** Literal sz pairs, keyed by project-relative file. */
    pairsByFile: Map<string, SzValuePair[]>;
}

/**
 * Lower every candidate file once, capturing diagnostics and class origins.
 *
 * The engine reports unknown and aliased sz keys — on elements AND inside
 * szv()/szr() catalogs — through each result's `diagnostics`, tagged
 * `[csszyx]` and carrying `at <file>:<line>` once `rootDir` is set. Reading
 * the per-result channel (rather than the console latch the deleted
 * TypeScript lanes used) means nothing global is patched and nothing later is
 * silenced.
 *
 * @param files - Absolute paths to scan.
 * @param cwd - Project root, for relative reporting.
 * @param classPrefix - The Tailwind prefix to lower with, or null.
 * @returns The diagnostics and the class origins found.
 */
async function collectSzDiagnostics(
    files: string[],
    cwd: string,
    classPrefix: string | null,
): Promise<SzDiagnostics> {
    const issues: SzIssue[] = [];
    // One origin per class is enough to point at: the report answers "where did
    // this come from", not "everywhere it appears".
    const classOrigins = new Map<string, string>();
    // Read from the same source text the lowering pass sees, so a file skipped
    // there is skipped here too rather than reported by only one of them.
    const pairsByFile = new Map<string, SzValuePair[]>();

    // Read ahead, then lowered in the order given: the first file to produce a
    // class is the origin reported for it.
    const sources = await mapConcurrent(files, FILE_READ_CONCURRENCY, readSzSource);
    for (const [index, source] of sources.entries()) {
        if (source === null) continue;
        // Lowered once; let its text go rather than hold every file's to the end.
        sources[index] = null;
        const file = files[index] as string;
        const currentFile = relativePosix(cwd, file);
        const pairs = szValuePairs(source);
        if (pairs.length > 0) pairsByFile.set(currentFile, pairs);
        const { diagnostics, codes } = recordFileClasses(
            source,
            file,
            cwd,
            currentFile,
            classOrigins,
            classPrefix,
        );
        for (const [index, message] of diagnostics.entries()) {
            if (message.startsWith('[csszyx]')) {
                const code = codes[index];
                issues.push({
                    file: currentFile,
                    message: message.replace(/^\[csszyx\]\s*/, ''),
                    ...(code === undefined ? {} : { code }),
                });
            }
        }
    }
    return { issues, classOrigins, pairsByFile };
}

/**
 * Lower one file and note which classes it was the first to produce.
 *
 * A file the reference parser cannot read yields no usable sz signal here; the
 * bundler surfaces real parse errors at build time, so it is skipped rather
 * than failing a whole-project scan.
 *
 * @param source - File contents.
 * @param file - Absolute path, for diagnostics.
 * @param cwd - Project root.
 * @param relativePath - Path as reported to the user.
 * @param classOrigins - Origins map, extended in place.
 * @param classPrefix - The Tailwind prefix to lower with, or null.
 * @returns The file's compiler diagnostics and the code of each, index-parallel
 *          (both empty when unreadable).
 */
function recordFileClasses(
    source: string,
    file: string,
    cwd: string,
    relativePath: string,
    classOrigins: Map<string, string>,
    classPrefix: string | null,
): { diagnostics: string[]; codes: Array<SzDiagnosticCode | undefined> } {
    try {
        const result = transformSource(source, file, { rootDir: cwd, classPrefix });
        for (const token of result.classes) {
            if (!classOrigins.has(token)) classOrigins.set(token, relativePath);
        }
        return {
            diagnostics: result.diagnostics,
            codes: result.diagnostics.map((_, index) => result.issues?.[index]?.code),
        };
    } catch {
        // Unreadable by the engine; see the note above.
        return { diagnostics: [], codes: [] };
    }
}

/**
 * Report values written on a key that owns neither the value nor its property.
 *
 * Runs against the project's own design system because that is what decides:
 * a project declaring `--color-balance` has given `color: 'balance'` a meaning,
 * and this must disappear for it.
 *
 * Silent when there is no design system to ask. The dead-class pass already
 * reports that, and a second copy of the same skip would read as two problems.
 *
 * @param out - Where this pass sends its prose and its findings.
 * @param opened - The project's compiled design systems.
 * @param pairsByFile - Literal sz pairs, keyed by project-relative file.
 * @param failOn - The quietest level that fails the run.
 */
function reportSiblingKeywords(
    out: Reporter,
    opened: OpenedOracles,
    pairsByFile: Map<string, SzValuePair[]>,
    failOn: SzDiagnosticLevel,
): void {
    if (opened.oracles.length === 0 || pairsByFile.size === 0) return;

    const found: Array<{
        file: string;
        finding: SiblingKeywordFinding;
        level: SzDiagnosticLevel;
    }> = [];
    for (const [file, pairs] of pairsByFile) {
        // Reported only when EVERY design system agrees the value is foreign.
        // One stylesheet that resolves it as a token is enough to make the
        // spelling meaningful, and this command cannot map a file to the
        // stylesheet it renders under.
        const perOracle = opened.oracles.map(oracle =>
            findSiblingKeywordValues(pairs, oracle.keywords),
        );
        for (const finding of perOracle[0]) {
            const everywhere = perOracle.every(findings =>
                findings.some(other => other.key === finding.key && other.value === finding.value),
            );
            const level = out.levelOf({ rule: 'sibling-keyword', file });
            if (everywhere && level !== 'off') found.push({ file, finding, level });
        }
    }
    if (found.length === 0) return;

    out.warn('\nValues that belong to a different sz key:');
    for (const { file, finding, level } of found) {
        out.push({
            rule: 'sibling-keyword',
            file,
            line: finding.line,
            message:
                `${finding.key}: '${finding.value}' emits ${finding.className}, which sets ` +
                `${finding.sets.join(', ')} — not what ${finding.key} sets.`,
        });
        out.info(`  ${levelTag(level)}${file}:${finding.line}`);
        out.info(
            `    ${finding.key}: '${finding.value}' emits ${finding.className}, which sets ` +
                `${finding.sets.join(', ')} — not what ${finding.key} sets.`,
        );
    }
    const { mark, below } = summaryMark(
        found.map(entry => entry.level),
        failOn,
    );
    out.warn(
        `\n${mark} ${found.length} value(s) written on a key that does not own them. Each one ` +
            'compiles, ships CSS and renders, so nothing else reports it; the style asked for ' +
            'is simply absent. Move the value to the key that owns it, or declare a theme ' +
            `token by that name if the spelling was deliberate.${belowNote(below, failOn)}`,
    );
}

/**
 * Report theme tokens whose names a built-in utility already claims.
 *
 * Declaring a colour named after a keyword does not add a colour class: the
 * name is already a static utility, so Tailwind merges the readings and the
 * class carries both. A later class that sets only one of the two does not
 * cover it, so szcn keeps both and the stylesheet decides the winner instead
 * of the order the author passed. That is
 * wrong output, which is why this fails rather than reporting and passing.
 *
 * @param out - Where this pass sends its prose and its findings.
 * @param opened - The project's compiled design systems.
 * @param cwd - Project root, for relative paths.
 * @param allowToken - Token names the project accepted deliberately.
 * @param failOn - The quietest level that fails the run.
 */
async function reportThemeCollisions(
    out: Reporter,
    opened: OpenedOracles,
    cwd: string,
    allowToken: readonly string[],
    failOn: SzDiagnosticLevel,
): Promise<void> {
    if (opened.oracles.length === 0) return;

    const declared: DeclaredToken[] = [];
    // A stylesheet that cannot be read declares nothing this pass can see; the
    // dead-class pass already reports an unreadable entry.
    for (const stylesheet of await readTextFiles(await findTailwindCssEntries(cwd))) {
        declared.push(...declaredThemeTokens(stylesheet.text, relativePosix(cwd, stylesheet.path)));
    }
    if (declared.length === 0) return;

    // The probe compile is paid only now, once there is something to ask about.
    const oracle = await opened.oracles[0].loadCollisionOracle();
    if (oracle === null) return;

    const found = findThemeCollisions(declared, oracle, allowToken)
        .map(finding => ({
            finding,
            level: out.levelOf({ rule: 'theme-collision', file: finding.file }),
        }))
        .filter(entry => entry.level !== 'off');
    if (found.length === 0) return;

    out.warn('\nTheme tokens a built-in utility already claims:');
    for (const { finding, level } of found) {
        const message =
            `"${finding.name}" also names ${finding.classes.join(', ')}. Tailwind merges ` +
            'both meanings into one rule, so a later class that sets only one of them does ' +
            'not replace it in szcn and the stylesheet decides which wins — not the order ' +
            'you wrote.';
        out.push({ rule: 'theme-collision', file: finding.file, line: finding.line, message });
        out.info(`  ${levelTag(level)}${finding.file}:${finding.line}`);
        out.info(`    ${message}`);
    }
    const { mark, below } = summaryMark(
        found.map(entry => entry.level),
        failOn,
    );
    out.warn(
        `\n${mark} ${found.length} theme token(s) shadow a built-in utility. Rename them; no ` +
            'spelling of the merge can fix this while the name is shared. To keep one anyway, ' +
            `pass --allow-token <name>.${belowNote(below, failOn)}`,
    );
}

/**
 * The directory the glob is rooted at, or fail the run explaining why it cannot be.
 *
 * A directory that does not exist globs zero files, and zero files reads as a
 * clean run — the answer a gate must never give for a path it never opened.
 * Given together with `--files`, each would silently drop what the other asked
 * for, so that is refused as well.
 *
 * @param options - scan options.
 * @param out - reporter the failure is written to.
 * @param cwd - project root.
 * @returns Absolute glob root, or null when the run has already failed.
 */
function scanRootFor(options: CheckOptions, out: Reporter, cwd: string): string | null {
    if (options.dir === undefined) return cwd;
    const dir = withPosixSeparators(options.dir);
    const root = path.resolve(cwd, dir);
    const stat = statSync(root, { throwIfNoEntry: false });
    let refusal: string;
    if (options.files) {
        refusal = `A directory and --files both choose the files to check. Pass "${dir}" or --files, not both.`;
    } else if (options.pattern !== undefined && path.win32.isAbsolute(options.pattern)) {
        // fast-glob reads an absolute pattern as absolute whatever root it is
        // given, so the scan would leave the directory without saying so.
        refusal = `--pattern "${options.pattern}" is an absolute path, so it would not stay inside "${dir}". Pass a pattern relative to the directory.`;
    } else if (stat?.isDirectory()) {
        return root;
    } else if (stat) {
        refusal = `"${dir}" is a file, not a directory. To check single files, pass --files ${dir}.`;
    } else {
        refusal = `"${dir}" does not exist under ${cwd}, so there is nothing to check.`;
    }
    out.warn(`\u2716 ${refusal}`);
    process.exitCode = 1;
    return null;
}

/**
 * Resolve the files this run will scan, or fail the run explaining why.
 *
 * Two ways to end with nothing to scan, and both are fatal rather than empty:
 * the glob itself threw, or a listed path could not be read. Every later line
 * counts only the files that were read, so a run that quietly dropped one
 * would report a clean subset as if it were the whole list.
 *
 * @param options - scan options.
 * @param out - reporter the failure is written to.
 * @param cwd - directory the scan is rooted at.
 * @param patterns - globs used when no explicit file list is given.
 * @param ignore - globs to skip.
 * @returns Absolute paths to scan, or null when the run has already failed.
 */
async function resolveScanFiles(
    options: CheckOptions,
    out: Reporter,
    cwd: string,
    patterns: readonly string[],
    ignore: readonly string[],
): Promise<string[] | null> {
    const root = scanRootFor(options, out, cwd);
    if (root === null) return null;
    // ora writes straight to the tty, so it has to be skipped rather than
    // routed: a spinner frame in the middle of a JSON document is not parseable.
    const s = out.quiet ? null : spinner.start('Scanning for files...');
    let files: string[];
    let missing: readonly string[] = [];
    try {
        if (options.files) {
            const listed = listedSourceFiles(options.files, cwd);
            missing = listed.missing;
            files = listed.files;
        } else {
            files = await fg([...patterns], { cwd: root, ignore: [...ignore], absolute: true });
        }
    } catch (err) {
        s?.fail('File scan failed');
        out.warn(`Could not scan files: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return null;
    }
    s?.succeed(`Found ${files.length} files`);

    if (missing.length === 0) return files;

    out.warn('Files that could not be read:');
    for (const file of missing) out.info(`  ${file}`);
    out.warn(
        `\u2716 ${missing.length} listed file(s) could not be read, so they were not ` +
            'checked. A pass here would report a subset as if it were the whole list. ' +
            'Check the paths, and note that a separator is normalised rather than ' +
            'trusted, so this is a missing file rather than a Windows path.',
    );
    process.exitCode = 1;
    return null;
}

/** Whether a run reports a finding of this rule and kind. */
type RuleSelection = (rule: CheckRule, kind: string) => boolean;

/**
 * The finding for entries that set different prefixes. It can be left out by
 * id like a diagnostic kind, which skips the dead-class pass: that pass needs
 * one prefix to ask about.
 */
const PREFIX_DISAGREEMENT = 'prefix-disagreement';

/**
 * Read `--rule` and `--ignore-rule` into one predicate, or fail the run.
 *
 * An id is either a pass (`dead-class`) or a diagnostic kind (`unknown-key`),
 * so a gate can take a whole pass or one kind of sz diagnostic. An id that is
 * neither fails the run: a misspelt `--rule` would select nothing, and a run
 * that reports nothing passes.
 *
 * @param options - scan options.
 * @param out - reporter the failure is written to.
 * @returns The predicate, or null when the run has already failed.
 */
function ruleSelection(options: CheckOptions, out: Reporter): RuleSelection | null {
    const include = options.rule ?? [];
    const exclude = options.ignoreRule ?? [];
    const known = new Set<string>([...CHECK_RULES, ...SZ_DIAGNOSTIC_KIND_IDS, PREFIX_DISAGREEMENT]);
    const unknown = [...include, ...exclude].filter(id => !known.has(id));
    if (unknown.length > 0) {
        const given = unknown.map(id => `"${id}"`).join(', ');
        const ids = [...known].join(', ');
        out.warn(
            `\u2716 ${given} is not a rule or a diagnostic kind, so it would select nothing. ` +
                `Known ids: ${ids}.`,
        );
        process.exitCode = 1;
        return null;
    }
    return (rule, kind) =>
        (include.length === 0 || include.includes(rule) || include.includes(kind)) &&
        !exclude.includes(rule) &&
        !exclude.includes(kind);
}

/**
 * Report the sz diagnostics a run selected, and how many the selection left out.
 *
 * An issue left out by `--rule` or `--ignore-rule` is not an issue that was not
 * found, and a report that said so would read as clean to anyone skimming a CI
 * log.
 *
 * @param out - Where this pass sends its prose and its findings.
 * @param issues - Every captured diagnostic, before selection.
 * @param fileCount - How many files the run scanned.
 * @param wants - The run's rule selection.
 * @param failOn - The quietest level that fails the run.
 */
function reportSelectedIssues(
    out: Reporter,
    issues: SzIssue[],
    fileCount: number,
    wants: RuleSelection,
    failOn: SzDiagnosticLevel,
): void {
    const selected: ClassifiedIssue[] = [];
    let silenced = 0;
    for (const issue of issues) {
        const kind = szDiagnosticKindOf(issue.message, issue.code);
        if (!wants('sz-diagnostic', kind)) continue;
        // Set `off` in csszyx.config: not reported, and not "left out" by a flag.
        if (out.levelOf({ rule: 'sz-diagnostic', kind, file: issue.file }) === 'off') {
            silenced++;
            continue;
        }
        const suggestion = kind === 'unknown-key' ? szKeySuggestionFor(issue.message) : null;
        selected.push({ ...issue, kind, suggestion });
    }
    const leftOut = issues.length - selected.length - silenced;
    if (selected.length > 0) {
        reportIssues(out, selected, failOn);
        if (leftOut > 0) {
            out.info(`${leftOut} more sz issue(s) left out by --rule or --ignore-rule.`);
        }
        return;
    }
    out.success(
        leftOut === 0
            ? `No sz issues found across ${fileCount} files.`
            : `No selected sz issues across ${fileCount} files; ${leftOut} left out by --rule or --ignore-rule.`,
    );
    out.info(
        'Scope: static sz props and szv()/szr() catalog definitions. Keys that ' +
            'only exist at runtime (an array or spread built from runtime data, a ' +
            'dynamic() value) cannot be checked statically.',
    );
}

/** The levels `--fail-on` accepts; `off` is never reported, so it cannot be one. */
const FAIL_ON_LEVELS: ReadonlySet<SzDiagnosticLevel> = new Set(['info', 'warn', 'error']);

/**
 * Read `--fail-on`, or fail the run explaining why it cannot be.
 *
 * @param options - scan options.
 * @param out - reporter the failure is written to.
 * @returns The level, or null when the run has already failed.
 */
function failOnLevel(options: CheckOptions, out: Reporter): SzDiagnosticLevel | null {
    const level = options.failOn ?? 'error';
    if (FAIL_ON_LEVELS.has(level)) return level;
    const refusal = level === 'off' ? 'cannot be a threshold' : 'is not a level';
    out.warn(
        `\u2716 --fail-on "${level}" ${refusal}: use info, warn or error. Nothing was scanned.`,
    );
    process.exitCode = 1;
    return null;
}

/**
 * Load `csszyx.config` and say what is wrong with it.
 *
 * A problem is printed, tagged with its severity; an `error` problem — an id
 * that would set nothing, a config that does not load — also fails the run,
 * since a gate whose levels silently fell back to the defaults is not the gate
 * that was configured. In `--json` mode it goes to stderr, keeping stdout one
 * document.
 *
 * @param cwd - Project root.
 * @param json - Whether stdout is reserved for the JSON document.
 * @returns The project's policy, and the line that closes the run when the
 * config fails it.
 */
async function loadCheckPolicy(
    cwd: string,
    json: boolean,
): Promise<{ policy: DiagnosticPolicy; failure: string | null }> {
    const loaded = await loadDiagnosticPolicy(cwd);
    if (loaded.file === null || loaded.problems.length === 0) {
        return { policy: loaded.policy, failure: null };
    }
    const file = relativePosix(cwd, loaded.file);
    const message = diagnosticConfigProblemsMessage(file, loaded.problems);
    if (json) console.error(message);
    else printWarn(message);
    const errors = loaded.problems.filter(problem => problem.severity === 'error').length;
    if (errors === 0) return { policy: loaded.policy, failure: null };
    process.exitCode = 1;
    return {
        policy: loaded.policy,
        failure: `\u2716 ${errors} config error(s) in ${file}, which fail the run.`,
    };
}

/**
 * The merge-audit rules this run answers: the ones `--rule` names, and the
 * ones `csszyx.config` reports at `warn` or louder, which an app reviewing
 * what a merge changed sets so the audit runs on every check.
 *
 * @param options - scan options.
 * @param wants - The run's rule selection.
 * @param policy - The project's policy.
 * @returns The rules to run, possibly none.
 */
function mergeAuditRules(
    options: CheckOptions,
    wants: (rule: CheckRule) => boolean,
    policy: DiagnosticPolicy,
): MergeAuditKind[] {
    const { overrides } = policy.toJSON().config;
    const loud = (rule: MergeAuditKind) =>
        isAtLeastLevel(policy.levelOf({ rule }), 'warn') ||
        overrides.some(override => {
            const level = override.rules[rule];
            return level !== undefined && isAtLeastLevel(level, 'warn');
        });
    return MERGE_AUDIT_RULES.filter(
        rule => wants(rule) && (options.rule?.includes(rule) === true || loud(rule)),
    );
}

/**
 * Open the project's stylesheets, or skip them when no pass has anything to ask.
 *
 * Compiling a stylesheet is the expensive part of this command, so it is
 * skipped when no pass that reads it has anything to ask. The className pass
 * counts here too: a component that writes only class strings has no sz signal
 * at all, and it is exactly the file that pass exists for.
 *
 * @param cwd - Absolute project directory.
 * @param scanned - The unprefixed scan, whose findings decide the question.
 * @returns The opened oracles, or an empty set when nothing was compiled.
 */
function openOraclesWhenAsked(cwd: string, scanned: SzDiagnostics): Promise<OpenedOracles> {
    if (scanned.classOrigins.size > 0 || scanned.pairsByFile.size > 0) return openOracles(cwd);
    return Promise.resolve({
        oracles: [],
        skipped: [],
        stylesheetFailed: false,
        hadEntries: false,
        prefixes: [],
    });
}

/**
 * Run the dead-class pass when the run selects it, and fail the run on what it finds.
 *
 * Selected by either `dead-class` or `broken-opacity`. When the entries
 * disagree on a prefix and `--ignore-rule` left that finding out, the pass is
 * skipped with a note instead: it needs one prefix to ask about.
 *
 * @param out - Where this pass sends its prose and its findings.
 * @param opened - The project's stylesheet oracles.
 * @param classOrigins - Each lowered class and the file it came from.
 * @param pass - What the run decided before this pass.
 * @param pass.allow - Classes the project allows anyway.
 * @param pass.wants - The run's rule selection.
 * @param pass.disagreement - The prefix disagreement, or null when the entries agree.
 * @param pass.failOn - The quietest level that fails the run.
 */
function runDeadClassPass(
    out: Reporter,
    opened: OpenedOracles,
    classOrigins: Map<string, string>,
    pass: {
        allow: readonly string[];
        wants: RuleSelection;
        disagreement: string | null;
        failOn: SzDiagnosticLevel;
    },
): void {
    const { wants, disagreement } = pass;
    const wantsRule = (rule: CheckRule) => wants(rule, rule);
    const deadClassPass = wantsRule('dead-class') || wantsRule('broken-opacity');
    const disagreementLeftOut = disagreement !== null && !wants('dead-class', PREFIX_DISAGREEMENT);
    if (!deadClassPass) return;
    if (disagreementLeftOut) {
        out.info(
            `Dead-class check skipped: the Tailwind entries set different prefixes, and --ignore-rule ${PREFIX_DISAGREEMENT} left that finding out.`,
        );
        return;
    }
    if (
        reportDeadClasses(
            out,
            opened,
            classOrigins,
            pass.allow,
            wantsRule,
            disagreement,
            pass.failOn,
        )
    ) {
        process.exitCode = 1;
    }
}

/**
 * Scan the project for unknown/aliased `sz` keys and report them in one pass.
 *
 * Each finding carries the level `csszyx.config` gives it. `process.exitCode`
 * is set to 1 when a finding is at `--fail-on` (default `error`) or louder,
 * or when the run itself failed — a scan that could not read its files, a
 * stylesheet that would not compile, a config with an id it does not know —
 * so the command can gate CI. The scan runs the engine itself (native when
 * available, wasm otherwise), so what it flags is exactly what the build
 * flags.
 *
 * @param options - scan options.
 */
export async function check(options: CheckOptions = {}): Promise<void> {
    const json = options.json === true;
    // Resolved once here: Tailwind and the content scanner are required from
    // this directory, and `createRequire` rejects a relative path.
    const cwd = path.resolve(options.cwd ?? process.cwd());
    // fast-glob reads a backslash as an escape, so a Windows-shaped glob
    // matches nothing and the run passes having scanned no files at all.
    const patterns = options.pattern ? [withPosixSeparators(options.pattern)] : ['**/*.{jsx,tsx}'];
    const ignore = [...DEFAULT_IGNORE, ...(options.ignore ?? [])];

    // This command IS the full project scan, so suppress the compiler's
    // "run `csszyx check`" hint while it runs over every file.
    process.env.CSSZYX_NO_PROJECT_SCAN_HINT = '1';

    if (!json) printHeader('csszyx check — static sz diagnostics');
    const { policy, failure: configFailure } = await loadCheckPolicy(cwd, json);
    const out = createReporter(json, policy);

    const failOn = failOnLevel(options, out);
    if (!failOn) return;
    const wants = ruleSelection(options, out);
    if (!wants) return;
    const wantsRule = (rule: CheckRule) => wants(rule, rule);
    const configAllow = policy.toJSON().config.allow;

    const files = await resolveScanFiles(options, out, cwd, patterns, ignore);
    if (!files) return;

    const unprefixed = await collectSzDiagnostics(files, cwd, null);
    const opened = await openOraclesWhenAsked(cwd, unprefixed);
    // Lowered without a prefix above, which is right only when no entry sets
    // one: a prefixed project serves `tw:p-4`, and asking about `p-4` would
    // call every class dead. Only a prefixed project pays for the second pass.
    const { prefix, disagreement } = agreedPrefix(opened);
    const { issues, classOrigins, pairsByFile } =
        prefix === null ? unprefixed : await collectSzDiagnostics(files, cwd, prefix);

    reportSelectedIssues(out, issues, files.length, wants, failOn);

    // Runs whichever way the key pass went: a canonical key can still lower to
    // a class this project's Tailwind does not serve.
    runDeadClassPass(out, opened, classOrigins, {
        allow: [...(options.allow ?? []), ...configAllow.classes],
        wants,
        disagreement,
        failOn,
    });

    // Runs last and independently: a value on the wrong key survives both
    // passes above, which is the whole reason it needs its own.
    if (wantsRule('sibling-keyword')) reportSiblingKeywords(out, opened, pairsByFile, failOn);

    if (wantsRule('theme-collision')) {
        await reportThemeCollisions(
            out,
            opened,
            cwd,
            [...(options.allowToken ?? []), ...configAllow.tokens],
            failOn,
        );
    }

    await reportMergeAudit(out, {
        cwd,
        files,
        selected: mergeAuditRules(options, wantsRule, policy),
    });

    if (out.findings.some(finding => isAtLeastLevel(finding.level, failOn))) {
        process.exitCode = 1;
    }
    // Last, so a run whose passes all came back clean does not end on a tick
    // while it exits 1; in --json, on stderr beside the problems it counts.
    if (configFailure !== null) {
        if (json) console.error(configFailure);
        else out.warn(`\n${configFailure}`);
    }

    // Written last, after every pass has recorded what it found, so the
    // document is the whole run rather than whatever had arrived by then.
    if (out.quiet) console.log(renderJsonReport(out));
}
