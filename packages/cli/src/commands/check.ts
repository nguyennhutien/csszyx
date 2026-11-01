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

import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
    nearestName,
    renderSzDiagnosticParts,
    SZ_DIAGNOSTIC_COMPUTED_VALUES,
    SZ_DIAGNOSTIC_URL_BASE,
    SZ_REMOVED_DIAGNOSTIC_IDS,
    SZ_SETTABLE_DIAGNOSTIC_IDS,
    type SzDiagnosticCode,
    type SzDiagnosticId,
    type SzDiagnosticIssue,
    type SzTypedDiagnostic,
    szDiagnosticPositionOf,
} from '@csszyx/compiler';
import { transformSource } from '@csszyx/compiler/engine';
import { isCsszyxError } from '@csszyx/compiler/errors';
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
    cssWideKeywordOf,
    type DiagnosticPolicy,
    diagnosticConfigProblemsMessage,
    diagnosticPolicyInputs,
    hoistedSignUtility,
    inertUnderEveryRoot,
    isAtLeastLevel,
    isRemovedRuleId,
    loadCurrentDiagnosticPolicy,
    loadDiagnosticPolicy,
    removedRuleIdDiagnostic,
    type UnservedVariant,
    unservedVariantOf,
    unsignedClass,
    variantDroppedForms,
} from '@csszyx/unplugin/diagnostics';
import fg from 'fast-glob';
import {
    type CheckRule,
    createReporter,
    type FindingInput,
    PREFIX_DISAGREEMENT,
    partLines,
    type Reporter,
    registryFinding,
    renderJsonReport,
} from '../scanner/check-report.js';
import {
    MERGE_AUDIT_RULES,
    type MergeAuditKind,
    reportMergeAudit,
} from '../scanner/merge-audit-report.js';
import { declaredThemeTokens } from '../scanner/theme-declarations.js';
import { relativePosix, withPosixSeparators } from '../utils/posix-path.js';
import { registryMessage } from '../utils/registry-words.js';
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
}

/** One captured sz diagnostic, with the project-relative file it came from. */
interface SzIssue {
    file: string;
    /** The main sentence, with no header. */
    message: string;
    /** The clause after `help:`, when the code has one. */
    help?: string;
    /** The clause after `note:`, when the code has one. */
    note?: string;
    code: SzDiagnosticCode;
    args: Readonly<Record<string, unknown>>;
    line?: number;
    column?: number;
}

/**
 * The engine diagnostics of one file that `check` lists. It leaves two to the
 * build log: a fallback whose classes were still collected, which is advice
 * about one sz prop, and every syntax error after a file's first, since a file
 * that does not parse is one finding however many errors it holds. A fallback
 * whose classes were never collected (`fallback-missing-css`) is listed: those
 * classes have no CSS.
 *
 * @param issues - The diagnostics of one file.
 * @returns The ones `check` lists, in order.
 */
function checkedIssues<T extends Pick<SzIssue, 'code'>>(issues: readonly T[]): T[] {
    let parseErrorListed = false;
    return issues.filter(issue => {
        if (issue.code === 'fallback-nudge') return false;
        if (issue.code !== 'parse-error') return true;
        if (parseErrorListed) return false;
        parseErrorListed = true;
        return true;
    });
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
/**
 * Group captured diagnostics by project-relative file.
 *
 * @param issues Captured compiler diagnostics.
 * @returns Diagnostics keyed by project-relative file.
 */
function groupIssuesByFile<T extends SzIssue>(issues: T[]): Map<string, T[]> {
    const byFile = new Map<string, T[]>();
    for (const issue of issues) {
        const inFile = byFile.get(issue.file) ?? [];
        inFile.push(issue);
        byFile.set(issue.file, inFile);
    }
    return byFile;
}

/** Every design system this project compiles, with why any were skipped. */
export interface OpenedOracles {
    oracles: Array<Extract<EmittedClassOracle, { ok: true }>>;
    /** One reason per stylesheet that produced no oracle. */
    skipped: string[];
    /** True when a stylesheet belonging to the project would not compile. */
    stylesheetFailed: boolean;
    /** False when nothing in the project imports Tailwind at all. */
    hadEntries: boolean;
    /** The prefix each compiled entry's `@import "tailwindcss"` line set, by entry. */
    prefixes: Array<{ entry: string; prefix: string | null }>;
    /** The project's stylesheets the compiles read beyond the entries, with the text read. */
    stylesheets: Array<{ path: string; text: string }>;
}

/**
 * A bare `@import` target read as the file next door, before Tailwind's own
 * resolver takes it as a package. The check does not know which bundler
 * builds the project, and Vite's resolver reads `@import "theme.css"` this way
 * where `@tailwindcss/postcss` fails, so a stylesheet one lane builds is not
 * reported as broken. No alias is followed: the check reads no bundler config.
 *
 * @param specifier - The target as written.
 * @param fromDir - The importing stylesheet's folder.
 * @returns The one path to try.
 */
function siblingFirst(specifier: string, fromDir: string): string[] {
    return [path.resolve(fromDir, specifier)];
}

/**
 * A stamp of what the project's prefix is read from before anything compiles:
 * each Tailwind entry, and `csszyx.config` with every module it imports,
 * which can turn a disagreement off. Taken before the compile, so a save made
 * while it runs reads as a change. Two equal stamps, with
 * {@link stylesheetsDigest} equal for what the compile read beyond the
 * entries, mean nothing the prefix is read from has changed, so a long-lived
 * caller can keep what it read.
 *
 * @param cwd - Project root.
 * @returns One line per file, `path NUL mtime`.
 */
export async function projectPrefixStamp(cwd: string): Promise<string> {
    const config = diagnosticPolicyInputs(cwd).map(input => {
        const state = input.missing === true ? 'missing' : `${input.mtimeMs}:${input.size}`;
        return `${input.file}\0${state}`;
    });
    const entries = (await findTailwindCssEntries(cwd)).map(file => `${file}\0${changeTime(file)}`);
    return [...entries, ...config].join('\n');
}

/**
 * A digest of stylesheets by path and text, so a file read since compares by
 * what it holds rather than by when it was saved.
 *
 * @param stylesheets - Each path with its text; null for a file that is gone.
 * @returns One line per file, `path NUL sha256`.
 */
export function stylesheetsDigest(
    stylesheets: ReadonlyArray<{ path: string; text: string | null }>,
): string {
    return stylesheets
        .map(({ path: file, text }) => {
            const digest = text === null ? 'gone' : createHash('sha256').update(text).digest('hex');
            return `${file}\0${digest}`;
        })
        .join('\n');
}

/**
 * When a file last changed and its size, for {@link projectPrefixStamp}. A
 * file removed since the walk stamps as gone rather than failing the call.
 *
 * @param file - Absolute path.
 * @returns `mtime:size`, or `gone`.
 */
function changeTime(file: string): string {
    const stat = statSync(file, { throwIfNoEntry: false });
    return stat === undefined ? 'gone' : `${stat.mtimeMs}:${stat.size}`;
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
export async function openOracles(cwd: string): Promise<OpenedOracles> {
    const entries = await findTailwindCssEntries(cwd);
    const oracles: Array<Extract<EmittedClassOracle, { ok: true }>> = [];
    const skipped: string[] = [];
    const prefixes: OpenedOracles['prefixes'] = [];
    const stylesheets = new Map<string, string>();
    let stylesheetFailed = false;
    // Two compiles at a time, as the build's own style model does; read in
    // entry order, so the skip reasons and prefixes keep that order.
    const compiled = await mapConcurrent(entries, STYLESHEET_COMPILE_CONCURRENCY, async entry =>
        createEmittedClassOracle({
            resolveFrom: cwd,
            css: await readFile(entry, 'utf8'),
            cssBase: path.dirname(entry),
            importCandidates: siblingFirst,
        }),
    );
    for (const [index, entry] of entries.entries()) {
        const oracle = compiled[index] as EmittedClassOracle;
        if (oracle.ok) {
            oracles.push(oracle);
            prefixes.push({ entry: relativePosix(cwd, entry), prefix: oracle.facts.prefix });
            for (const stylesheet of oracle.stylesheets) {
                stylesheets.set(stylesheet.path, stylesheet.text);
            }
        } else {
            skipped.push(oracle.reason);
            stylesheetFailed ||= oracle.kind === 'stylesheet';
        }
    }
    return {
        oracles,
        skipped,
        stylesheetFailed,
        hadEntries: entries.length > 0,
        prefixes,
        stylesheets: [...stylesheets].map(([file, text]) => ({ path: file, text })),
    };
}

/**
 * One entry and the prefix it sets, as `prefix-disagreement` lists it.
 *
 * @param entry - The entry and its prefix.
 * @returns `` `src/app.css` with `prefix(tw)` ``, or `` `src/app.css` with none ``.
 */
function prefixEntry(entry: OpenedOracles['prefixes'][number]): string {
    const prefix = entry.prefix === null ? 'none' : `\`prefix(${entry.prefix})\``;
    return `\`${entry.entry}\` with ${prefix}`;
}

/**
 * The Tailwind prefix every compiled entry agrees on.
 *
 * csszyx writes one prefix before every class, so a project whose entries set
 * different ones has classes that are dead under one of them whichever prefix
 * is used. Checking against a guess would report the half it did not guess, or
 * pass the half it did, so the disagreement is the finding — unless the config
 * turns that finding off: then the first entry's prefix is read, and a class
 * is still reported only when no entry serves it.
 *
 * @param opened - The project's compiled design systems.
 * @param opened.prefixes - Each compiled entry and the prefix it sets.
 * @param disagreementOff - Whether the config sets `prefix-disagreement` to `off`.
 * @returns The prefix to lower with, or null with each entry and the prefix it sets.
 */
function agreedPrefix(
    opened: { prefixes: ReadonlyArray<OpenedOracles['prefixes'][number]> },
    disagreementOff: boolean,
): {
    prefix: string | null;
    disagreement: string[] | null;
} {
    const [first, ...rest] = opened.prefixes;
    if (disagreementOff || rest.every(entry => entry.prefix === first?.prefix)) {
        return { prefix: first?.prefix ?? null, disagreement: null };
    }
    return { prefix: null, disagreement: opened.prefixes.map(prefixEntry) };
}

/** The prefix a project's classes carry, as `csszyx check` settles it. */
export interface SettledPrefix {
    /** The prefix to read classes with, or null for none. */
    prefix: string | null;
    /** Why the stylesheets gave no prefix to read with, or null when they did. */
    unread: string | null;
}

/**
 * The prefix this pass would lower with, for a reader outside it: the one the
 * compiled entries agree on, or the first entry's when the config turns
 * `prefix-disagreement` off.
 *
 * @param cwd - Project root, where `csszyx.config` is read.
 * @param opened - The project's compiled design systems.
 * @param opened.prefixes - Each compiled entry and the prefix it sets.
 * @param opened.skipped - Why each entry that did not compile was skipped.
 * @param opened.hadEntries - Whether the project has any Tailwind entry.
 * @returns The prefix, and why there is none to trust when the entries
 *   disagree or none compiled.
 */
export async function settledPrefix(
    cwd: string,
    opened: {
        prefixes: ReadonlyArray<OpenedOracles['prefixes'][number]>;
        skipped: readonly string[];
        hadEntries: boolean;
    },
): Promise<SettledPrefix> {
    if (opened.prefixes.length === 0) {
        const unread = opened.hadEntries
            ? `no Tailwind stylesheet compiled: ${opened.skipped.join('; ')}`
            : null;
        return { prefix: null, unread };
    }
    // Read as it is now: a module the config imports is one Node keeps for
    // the life of the process, and this one may be long-lived.
    const { policy } = await loadCurrentDiagnosticPolicy(cwd, diagnosticPolicyInputs(cwd));
    const off = policy.levelOf({ rule: 'dead-class', kind: PREFIX_DISAGREEMENT }) === 'off';
    const { prefix, disagreement } = agreedPrefix(opened, off);
    const unread = disagreement
        ? `the Tailwind stylesheets set different prefixes: ${disagreement.join(', ')}`
        : null;
    return { prefix, unread };
}

/**
 * The served classes whose CSS-wide keyword no property they set takes
 * (`ring-[inherit]`, served as `--tw-ring-color: inherit`), by the same
 * consensus as the dead pass: one stylesheet setting a property to it is
 * enough. Asked of the served keyword classes only.
 *
 * @param oracles - Every compiled stylesheet.
 * @param origins - Emitted class mapped to the file that first emitted it.
 * @param skip - The dead classes and the ones the project vouched for.
 * @returns Each such class with its origin.
 */
function inertKeywordClasses(
    oracles: OpenedOracles['oracles'],
    origins: ReadonlyMap<string, string>,
    skip: ReadonlySet<string>,
): Array<readonly [string, string]> {
    const asked = [...origins.keys()].filter(
        token => !skip.has(token) && cssWideKeywordOf(token) !== null,
    );
    if (asked.length === 0) return [];
    const inert = new Set(
        inertUnderEveryRoot(
            asked,
            oracles.map(oracle => oracle.cssFor(asked)),
        ),
    );
    return [...origins].filter(([token]) => inert.has(token));
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
 * @param disagreement - Each entry and the prefix it sets when they give no
 *        single prefix, or null.
 * @param failOn - The quietest level that fails the run.
 * @returns Whether the pass could not run on a project stylesheet, which
 *          fails the run whatever the levels say.
 */
function reportDeadClasses(
    out: Reporter,
    opened: OpenedOracles,
    origins: Map<string, string>,
    allow: readonly string[],
    wants: RuleSelection,
    disagreement: readonly string[] | null,
    failOn: SzDiagnosticLevel,
): boolean {
    if (origins.size === 0) return false;

    const { oracles, skipped, stylesheetFailed, hadEntries } = opened;
    if (!hadEntries) {
        out.runInfo('Dead-class check skipped: this project has no Tailwind stylesheet.');
        return false;
    }
    if (disagreement !== null) {
        const level = out.levelOf({ rule: 'dead-class', kind: PREFIX_DISAGREEMENT });
        const { mark, below } = summaryMark([level], failOn);
        const finding = registryFinding({
            rule: 'dead-class',
            code: PREFIX_DISAGREEMENT,
            args: { form: 'check', entries: disagreement },
        });
        out.warn(
            [
                `\n${mark} ${finding.message}${belowNote(below, failOn)}`,
                ...partLines(finding, '  '),
            ].join('\n'),
        );
        out.push(finding);
        return false;
    }
    if (oracles.length === 0) {
        // Every reason, not the first: there was at least one entry and none of
        // them produced an oracle, so each has something to say about why, and
        // a project whose stylesheets fail for different reasons is exactly the
        // one where hearing only the first sends the user to the wrong file.
        out.runInfo(`Dead-class check skipped: ${skipped.join('; ')}.`);
        // A stylesheet that will not compile is a broken project, not an absent
        // one, and passing it quietly is how a check stays green for months
        // after it stopped running. An environment with nothing to ask — no
        // Tailwind, a version without a design system — still passes: failing
        // there would break every consumer who does not build with one.
        if (stylesheetFailed) {
            out.runWarn(
                '\n✖ A Tailwind stylesheet of this project did not compile (named above), so ' +
                    'the dead-class check did not run and `csszyx check` fails until it compiles.',
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
    // A dead class with a hoisted sign is `unsigned-value` only when the class
    // without it is served, by the same consensus: `-p-medium` is dead
    // unsigned too, and "drop the sign" would be wrong advice.
    // A dead class is `unserved-variant` when the class with exactly one of
    // its variants dropped is served, by the same consensus. Both questions
    // are asked of the dead classes only, in one call per stylesheet.
    const secondForms = [
        ...new Set(
            dead.flatMap(([token]) => [
                ...[unsignedClass(token)].filter(form => form !== null),
                ...variantDroppedForms(token).map(form => form.without),
            ]),
        ),
    ];
    const secondDeadPerOracle = oracles.map(oracle => new Set(oracle.findDead(secondForms)));
    const served = (form: string): boolean =>
        !secondDeadPerOracle.every(deadSet => deadSet.has(form));
    const signed = (token: string): boolean => {
        const form = unsignedClass(token);
        return form !== null && served(form);
    };
    const variants = new Map<string, UnservedVariant>();
    for (const [token] of dead) {
        const variant = signed(token) ? null : unservedVariantOf(token, served);
        if (variant !== null) variants.set(token, variant);
    }
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
        inert: inertKeywordClasses(
            oracles,
            origins,
            new Set([...found.map(([token]) => token), ...vouched]),
        ),
        dead: dead.filter(([token]) => !signed(token) && !variants.has(token)),
        unsigned: dead.filter(([token]) => signed(token)),
        variants: dead
            .filter(([token]) => variants.has(token))
            .map(([token, origin]) => ({
                token,
                origin,
                variant: variants.get(token) as UnservedVariant,
            })),
        broken,
        acceptedCount: accepted.length,
        emittedCount: origins.size,
        wants,
        failOn,
    });
    return false;
}

/** One emitted class the project serves with one of its variants dropped. */
interface UnservedVariantFinding {
    token: string;
    origin: string;
    variant: UnservedVariant;
}

/** One emitted class that carries an opacity modifier the stylesheet drops. */
interface BrokenOpacityFinding {
    token: string;
    origin: string;
    value: string;
}

/** What the dead-class scan concluded, ready to print. */
interface DeadClassReport {
    /** The dead classes said as `dead-class`. */
    dead: ReadonlyArray<readonly [string, string]>;
    /** The dead classes with a hoisted sign whose unsigned form is served. */
    unsigned: ReadonlyArray<readonly [string, string]>;
    /** The served classes whose CSS-wide keyword no property takes. */
    inert: ReadonlyArray<readonly [string, string]>;
    /** The dead classes served with one variant dropped, with that variant. */
    variants: readonly UnservedVariantFinding[];
    broken: readonly BrokenOpacityFinding[];
    acceptedCount: number;
    emittedCount: number;
    /** Whether the run reports findings of a rule and kind. */
    wants: RuleSelection;
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

/** One dead-class kind listed under its own heading, in the registry's words. */
interface KindList {
    kind: 'inert-keyword' | 'unsigned-value';
    /** The line above the list. */
    heading: string;
    /** The classes, with their origin. */
    entries: ReadonlyArray<readonly [string, string]>;
    /** The registry arguments for one class. */
    args: (token: string) => Record<string, string>;
    /** The summary's words after its count. */
    summary: string;
}

/**
 * Print one dead-class kind: each class at its level, then a summary. Never
 * said again as `dead-class`, and a level or a `--rule` for either id reaches
 * it.
 *
 * @param out - Where this pass sends its prose and its findings.
 * @param list - The kind, its classes and its words.
 * @param wants - The run's rule selection.
 * @param failOn - The quietest level that fails the run.
 */
function printKindList(
    out: Reporter,
    list: KindList,
    wants: RuleSelection,
    failOn: SzDiagnosticLevel,
): void {
    const { kind } = list;
    if (!wants('dead-class', kind)) return;
    const shown = list.entries
        .map(([token, origin]) => ({
            token,
            origin,
            level: out.levelOf({ rule: 'dead-class', kind, file: origin }),
        }))
        .filter(entry => entry.level !== 'off');
    if (shown.length === 0) return;
    out.warn(`\n${list.heading}`);
    for (const { token, origin, level } of shown) {
        out.push(
            registryFinding({
                rule: 'dead-class',
                code: kind,
                file: origin,
                args: list.args(token),
            }),
        );
        out.info(`  ${levelTag(level)}${token.padEnd(28)} ${origin}`);
    }
    const { mark, below } = summaryMark(
        shown.map(entry => entry.level),
        failOn,
    );
    out.warn(`\n${mark} ${shown.length} ${list.summary}${belowNote(below, failOn)}`);
}

/**
 * Print the dead classes whose utility carries a hoisted sign: the project's
 * Tailwind serves no negative form of it (`{ p: -2 }` → `-p-2`), and serves
 * the class without the sign. Reported under the kind `unsigned-value`.
 *
 * @param out - Where this pass sends its prose and its findings.
 * @param unsigned - The dead classes with a hoisted sign, with their origin.
 * @param wants - The run's rule selection.
 * @param failOn - The quietest level that fails the run.
 */
function printUnsignedValues(
    out: Reporter,
    unsigned: ReadonlyArray<readonly [string, string]>,
    wants: RuleSelection,
    failOn: SzDiagnosticLevel,
): void {
    printKindList(
        out,
        {
            kind: 'unsigned-value',
            heading: "Negative values this project's Tailwind does not serve:",
            entries: unsigned,
            // Only a class with a hoisted sign reaches this list.
            args: token => ({ className: token, utility: hoistedSignUtility(token) as string }),
            summary:
                "emitted class(es) produce no CSS: this project's Tailwind serves no negative form " +
                "of their utility; drop the sign, or define the negative with Tailwind's `@utility`.",
        },
        wants,
        failOn,
    );
}

/**
 * Print the served classes whose CSS-wide keyword no property they set takes
 * (`{ ring: 'inherit' }` → `ring-inherit`, served as `--tw-ring-color:
 * inherit`). Reported under the kind `inert-keyword`.
 *
 * @param out - Where this pass sends its prose and its findings.
 * @param inert - The classes, with their origin.
 * @param wants - The run's rule selection.
 * @param failOn - The quietest level that fails the run.
 */
function printInertKeywords(
    out: Reporter,
    inert: ReadonlyArray<readonly [string, string]>,
    wants: RuleSelection,
    failOn: SzDiagnosticLevel,
): void {
    printKindList(
        out,
        {
            kind: 'inert-keyword',
            heading: 'CSS-wide keywords no property takes:',
            entries: inert,
            // Only a class carrying a keyword reaches this list.
            args: token => ({ className: token, keyword: cssWideKeywordOf(token) as string }),
            summary:
                'emitted class(es) style nothing: no property they set takes their CSS-wide ' +
                'keyword; set the property in `css: { … }`.',
        },
        wants,
        failOn,
    );
}

/**
 * Print the dead classes the project serves with one variant dropped: its
 * Tailwind serves no such variant (`{ hidden: { p: 4 } }` → `hidden:p-4`).
 * Reported by the dead-class pass under the kind `unserved-variant`, in the
 * registry's words, and never also as `dead-class`.
 *
 * @param out - Where this pass sends its prose and its findings.
 * @param variants - The classes, each with its origin and variant.
 * @param wants - The run's rule selection.
 * @param failOn - The quietest level that fails the run.
 */
function printUnservedVariants(
    out: Reporter,
    variants: readonly UnservedVariantFinding[],
    wants: RuleSelection,
    failOn: SzDiagnosticLevel,
): void {
    if (!wants('dead-class', 'unserved-variant')) return;
    const shown = variants
        .map(entry => ({
            ...entry,
            level: out.levelOf({
                rule: 'dead-class',
                kind: 'unserved-variant',
                file: entry.origin,
            }),
        }))
        .filter(entry => entry.level !== 'off');
    if (shown.length === 0) return;
    out.warn("\nVariants this project's Tailwind does not serve:");
    for (const { token, origin, variant, level } of shown) {
        const finding = registryFinding({
            rule: 'dead-class',
            code: 'unserved-variant',
            file: origin,
            args: { form: variant.form, variant: variant.name, className: token },
        });
        out.push(finding);
        out.info(`  ${levelTag(level)}${token.padEnd(28)} ${origin}`);
        // The advice depends on the name, so each line carries its own.
        out.info(`      help: ${finding.help}`);
    }
    const { mark, below } = summaryMark(
        shown.map(entry => entry.level),
        failOn,
    );
    out.warn(
        `\n${mark} ${shown.length} emitted class(es) produce no CSS: each uses a variant this ` +
            `project's Tailwind does not serve.${belowNote(below, failOn)}`,
    );
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
    const { dead, unsigned, inert, variants, broken, acceptedCount, emittedCount, wants, failOn } =
        report;
    // Say how many were waved through even on a clean run: an allow list that
    // silently covers a growing pile is the failure mode of every such list.
    const acceptedNote = acceptedCount > 0 ? `, ${acceptedCount} accepted` : '';

    if (
        dead.length === 0 &&
        unsigned.length === 0 &&
        inert.length === 0 &&
        variants.length === 0 &&
        broken.length === 0
    ) {
        out.success(
            `Every one of the ${emittedCount} emitted class(es) produces CSS under this project's Tailwind${acceptedNote}.`,
        );
        return;
    }

    // Judged on every class before narrowing, so a run narrowed to one rule
    // never prints "every class produces CSS" over a finding it left out. A
    // finding the config sets `off` is not reported at all. A dead class whose
    // utility carries a hoisted sign, served without it, is said once, as
    // `unsigned-value`.
    printUnsignedValues(out, unsigned, wants, failOn);
    printUnservedVariants(out, variants, wants, failOn);
    printInertKeywords(out, inert, wants, failOn);
    const shownDead = wants('dead-class', 'dead-class')
        ? dead
              .map(([token, origin]) => ({
                  token,
                  origin,
                  level: out.levelOf({ rule: 'dead-class', file: origin }),
              }))
              .filter(entry => entry.level !== 'off')
        : [];
    const shownBroken = wants('broken-opacity', 'broken-opacity')
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
            out.push(
                registryFinding({
                    rule: 'dead-class',
                    code: 'dead-class',
                    file: origin,
                    args: { className: token },
                }),
            );
            out.info(`  ${levelTag(level)}${token.padEnd(28)} ${origin}`);
        }
        const { mark, below } = summaryMark(
            shownDead.map(entry => entry.level),
            failOn,
        );
        out.warn(
            `\n${mark} ${shownDead.length} emitted class(es) produce no CSS: fix the sz key or value, ` +
                `or define the class with Tailwind's \`@utility\`.${belowNote(below, failOn)}`,
        );
    }

    if (shownBroken.length > 0) {
        // Judged from the compiled rule, never from the token's text: Tailwind
        // v4 wraps the modifier in color-mix(), which dims any valid color, so
        // the only broken shape is a var() chain ending in a bare comma
        // triplet — invalid inside color-mix(), silently dropped by browsers.
        out.warn('\nOpacity modifiers that do not apply:');
        for (const entry of shownBroken) {
            const finding = registryFinding({
                rule: 'broken-opacity',
                code: 'broken-opacity',
                file: entry.origin,
                args: { className: entry.token, value: entry.value },
            });
            out.push(finding);
            out.info(
                [
                    `  ${levelTag(entry.level)}${entry.token.padEnd(28)} ${entry.origin}`,
                    `      ${finding.message}`,
                    ...partLines(finding, '      '),
                ].join('\n'),
            );
        }
        const { mark, below } = summaryMark(
            shownBroken.map(entry => entry.level),
            failOn,
        );
        out.warn(
            `\n${mark} ${shownBroken.length} emitted class(es) carry an opacity modifier that does ` +
                `not apply.${belowNote(below, failOn)}`,
        );
    }
}

/**
 * One captured diagnostic as a machine-readable finding.
 *
 * @param issue - The diagnostic.
 * @returns The finding, its suggestion mirrored where version 1 put it.
 */
function findingOf(issue: ClassifiedIssue): FindingInput {
    const { file, message, help, note, kind, args, line, column } = issue;
    const suggestion = typeof args.suggestion === 'string' ? args.suggestion : undefined;
    return {
        rule: 'sz-diagnostic',
        kind,
        file,
        ...(line === undefined ? {} : { line, column }),
        // An absent part stays `undefined`, which the JSON leaves out.
        message,
        help,
        note,
        ...(suggestion === undefined ? {} : { suggestion }),
        args,
        url: `${SZ_DIAGNOSTIC_URL_BASE}${kind}`,
    };
}

/**
 * How far a labelled line of the prose report sits in: under the place, past
 * the reporter's icon and the two spaces the first line starts with.
 */
const CONTINUATION = '    ';

/**
 * One captured diagnostic as a line of the prose report.
 *
 * An error reads as it always has; a quieter level says so, since it is the
 * reason the run can still pass. The parts arrive bare, so the report lays
 * out its own `help:` and `note:` lines, each indented once.
 *
 * @param issue - The diagnostic.
 * @param level - The level the project gives it.
 * @returns The line, its labelled lines under the place.
 */
function issueLine(issue: ClassifiedIssue, level: SzDiagnosticLevel): string {
    const where = issue.line === undefined ? '' : `${issue.line}:${issue.column} `;
    const tag = level === 'error' ? '' : `(${level}) `;
    return [
        `  ${where}${tag}${issue.kind}: ${issue.message}`,
        ...labelled('help', issue.help),
        ...labelled('note', issue.note),
    ].join('\n');
}

/**
 * One labelled line of the prose report, or none when the part is absent.
 *
 * @param label - The label.
 * @param value - The part.
 * @returns The line, in a list of its own.
 */
function labelled(label: 'help' | 'note', value: string | undefined): string[] {
    return value === undefined ? [] : [`${CONTINUATION}${label}: ${value}`];
}

/**
 * Print captured diagnostics, each at its level.
 *
 * @param out - Where this pass sends its prose and its findings.
 * @param issues Captured compiler diagnostics, with the kind each one reports.
 * @param failOn - The quietest level that fails the run.
 */
function reportIssues(out: Reporter, issues: ClassifiedIssue[], failOn: SzDiagnosticLevel): void {
    for (const issue of issues) out.push(findingOf(issue));
    const byFile = groupIssuesByFile(issues);
    for (const [file, inFile] of byFile) {
        out.warn(file);
        for (const issue of inFile) out.info(issueLine(issue, issueLevel(out, issue)));
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
    /** Files the engine threw on, each with the first line of its error. */
    unchecked: { file: string; reason: string }[];
}

/** The engine could not run: its error message, for the run to print. */
interface EngineDown {
    engineDown: string;
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
 * @returns The diagnostics and the class origins found, or the engine's
 *          error when it cannot run.
 */
async function collectSzDiagnostics(
    files: string[],
    cwd: string,
    classPrefix: string | null,
): Promise<SzDiagnostics | EngineDown> {
    const issues: SzIssue[] = [];
    // One origin per class is enough to point at: the report answers "where did
    // this come from", not "everywhere it appears".
    const classOrigins = new Map<string, string>();
    // Read from the same source text the lowering pass sees, so a file skipped
    // there is skipped here too rather than reported by only one of them.
    const pairsByFile = new Map<string, SzValuePair[]>();
    const unchecked: SzDiagnostics['unchecked'] = [];

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
        const found = recordFileClasses(source, file, cwd, currentFile, classOrigins, classPrefix);
        // Every other file would fail the same way, so the scan ends here.
        if (typeof found === 'object' && 'engineDown' in found) return found;
        if (typeof found === 'string') {
            unchecked.push({ file: currentFile, reason: found });
            continue;
        }
        for (const issue of checkedIssues(found)) {
            const { text, help, note } = renderSzDiagnosticParts(
                issue,
                SZ_DIAGNOSTIC_COMPUTED_VALUES,
            );
            issues.push({
                file: currentFile,
                message: text,
                help,
                note,
                code: issue.code,
                args: issue.args as Readonly<Record<string, unknown>>,
                // A file-wide diagnostic sits at offset 0, which is not a line 1.
                ...(issue.line === undefined || szDiagnosticPositionOf(issue.code) !== 'site'
                    ? {}
                    : { line: issue.line, column: issue.column }),
            });
        }
    }
    return { issues, classOrigins, pairsByFile, unchecked };
}

/**
 * Lower one file and note which classes it was the first to produce.
 *
 * A syntax error comes back as a `parse-error` issue, so a throw is the engine
 * failing on this file. The file is left out and its reason returned, so the
 * scan goes on and the run names it. An engine that cannot run at all is not
 * one file's problem: it would fail every file, so that error is rethrown.
 *
 * @param source - File contents.
 * @param file - Absolute path, for diagnostics.
 * @param cwd - Project root.
 * @param relativePath - Path as reported to the user.
 * @param classOrigins - Origins map, extended in place.
 * @param classPrefix - The Tailwind prefix to lower with, or null.
 * @returns The file's compiler diagnostics, the first line of the error the
 *          engine threw on it, or the engine's error when it cannot run.
 */
function recordFileClasses(
    source: string,
    file: string,
    cwd: string,
    relativePath: string,
    classOrigins: Map<string, string>,
    classPrefix: string | null,
): SzDiagnosticIssue[] | string | EngineDown {
    try {
        const result = transformSource(source, { filename: file, rootDir: cwd, classPrefix });
        for (const token of result.classes) {
            if (!classOrigins.has(token)) classOrigins.set(token, relativePath);
        }
        return result.issues ?? [];
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isEngineDown(error)) return { engineDown: message };
        const end = message.indexOf('\n');
        return end === -1 ? message : message.slice(0, end);
    }
}

/**
 * Name each file the engine threw on, and fail the run: a gate that left a
 * file out has not checked the project.
 *
 * @param out - The reporter.
 * @param unchecked - The files, each with its reason.
 */
function reportUncheckedFiles(out: Reporter, unchecked: SzDiagnostics['unchecked']): void {
    if (unchecked.length === 0) return;
    out.runWarn('Files the engine threw on, so they were not checked:');
    for (const { file, reason } of unchecked) out.runInfo(`  ${file}: ${reason}`);
    out.runWarn(
        `\u2716 ${unchecked.length} file(s) were not checked: reinstall csszyx so its engine matches, and report the file at https://github.com/nguyennhutien/csszyx/issues if it still fails.`,
    );
    process.exitCode = 1;
}

/** Codes an engine throws when it cannot run at all, whatever the file. */
const ENGINE_DOWN_CODES: ReadonlySet<string> = new Set([
    'engine-version-skew',
    'native-engine-unavailable',
    'wasm-engine-unavailable',
]);

/**
 * Whether an error says the engine cannot run, rather than that it could not
 * read one file.
 *
 * @param error - What the engine threw.
 * @returns True for an engine that is missing, fails to load, or comes from
 *          another build.
 */
function isEngineDown(error: unknown): boolean {
    return isCsszyxError(error) && ENGINE_DOWN_CODES.has(error.code);
}

/**
 * Lower every file, or report that the engine cannot run and fail the run.
 *
 * Skipping each file the engine throws on would turn an engine that cannot
 * run into a project with no findings, so that one error stops the check.
 *
 * @param out - The reporter.
 * @param files - The files to lower.
 * @param cwd - Project root.
 * @param classPrefix - The Tailwind prefix to lower with, or null.
 * @returns The diagnostics, or null when the engine cannot run.
 */
async function collectSzDiagnosticsOrStop(
    out: Reporter,
    files: string[],
    cwd: string,
    classPrefix: string | null,
): Promise<SzDiagnostics | null> {
    const lowered = await collectSzDiagnostics(files, cwd, classPrefix);
    if (!('engineDown' in lowered)) return lowered;
    out.runWarn(lowered.engineDown);
    out.runWarn(
        `\u2716 The engine cannot run, so no file was checked: fix the error above and run \`csszyx check\` again.`,
    );
    process.exitCode = 1;
    return null;
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
        const reported = registryFinding({
            rule: 'sibling-keyword',
            code: 'sibling-keyword',
            file,
            line: finding.line,
            args: {
                key: finding.key,
                value: finding.value,
                className: finding.className,
                // CSS property names, each a code span in the sentence.
                sets: finding.sets.map(property => `\`${property}\``),
            },
        });
        out.push(reported);
        out.info(`  ${levelTag(level)}${file}:${finding.line}`);
        out.info(`    ${reported.message}`);
    }
    const { mark, below } = summaryMark(
        found.map(entry => entry.level),
        failOn,
    );
    out.warn(
        `\n${mark} ${found.length} value(s) emit a class that sets another property than their key: ` +
            'move each to the key that sets that property, or declare a theme token named after ' +
            `it if the spelling was deliberate.${belowNote(below, failOn)}`,
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
        const reported = registryFinding({
            rule: 'theme-collision',
            code: 'theme-collision',
            file: finding.file,
            line: finding.line,
            args: { form: 'classes', name: finding.name, classes: finding.classes },
        });
        out.push(reported);
        out.info(`  ${levelTag(level)}${finding.file}:${finding.line}`);
        out.info(`    ${reported.message}`);
    }
    const { mark, below } = summaryMark(
        found.map(entry => entry.level),
        failOn,
    );
    out.warn(
        `\n${mark} ${found.length} theme token(s) share a name with a built-in utility: rename ` +
            'them, or keep one with `--allow-token <name>` or `diagnostics.allow.tokens` in ' +
            `\`csszyx.config\`.${belowNote(below, failOn)}`,
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
        refusal = `A directory and \`--files\` both choose the files to check: pass \`${dir}\` or \`--files\`, not both.`;
    } else if (options.pattern !== undefined && path.win32.isAbsolute(options.pattern)) {
        // fast-glob reads an absolute pattern as absolute whatever root it is
        // given, so the scan would leave the directory without saying so.
        refusal = `\`--pattern ${options.pattern}\` is an absolute path, so it would not stay inside \`${dir}\`: pass a pattern relative to the directory.`;
    } else if (stat?.isDirectory()) {
        return root;
    } else if (stat) {
        refusal = `\`${dir}\` is a file: to check single files, pass \`--files ${dir}\`.`;
    } else {
        refusal = `\`${dir}\` does not exist under \`${cwd}\`, so there is nothing to check: pass a directory under it, or leave \`[dir]\` out to check the whole project.`;
    }
    out.runWarn(`\u2716 ${refusal}`);
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
        out.runWarn(
            `\u2716 Could not list the files to check: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
        return null;
    }
    s?.succeed(`Found ${files.length} files`);

    if (missing.length === 0) return files;

    out.runWarn('Files given to `--files` that do not exist:');
    for (const file of missing) out.runInfo(`  ${file}`);
    out.runWarn(
        `\u2716 ${missing.length} file(s) given to \`--files\` do not exist, so no file was checked: ` +
            'fix each path above; a relative path is read from `--cwd`, or the current directory.',
    );
    process.exitCode = 1;
    return null;
}

/** Whether a run reports a finding of this rule and kind. */
type RuleSelection = (rule: CheckRule, kind: string) => boolean;

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
    // Every pass and every kind the registry makes settable.
    const known = new Set<string>(SZ_SETTABLE_DIAGNOSTIC_IDS);
    // A removed id shipped once, so a script naming it keeps running; it
    // selects nothing, and the warning names the id to use instead.
    for (const id of new Set([...include, ...exclude].filter(isRemovedRuleId))) {
        out.runWarn(registryMessage(removedRuleIdDiagnostic(id, SZ_REMOVED_DIAGNOSTIC_IDS[id])));
    }
    const unknown = [
        ...new Set([...include, ...exclude].filter(id => !known.has(id) && !isRemovedRuleId(id))),
    ];
    if (unknown.length > 0) {
        // One id is likely a typo of a near one; for several the help says
        // to check the spelling, since one guess would fit only one of them.
        const suggestion = unknown.length === 1 ? nearestId(unknown[0] as string, known) : null;
        refuse(out, {
            code: 'unknown-rule-id',
            args: {
                form: 'cli',
                ids: unknown,
                ...(suggestion === null ? {} : { suggestion }),
            },
        });
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
        const kind = issue.code;
        if (!wants('sz-diagnostic', kind)) continue;
        // Set `off` in csszyx.config: not reported, and not "left out" by a flag.
        if (out.levelOf({ rule: 'sz-diagnostic', kind, file: issue.file }) === 'off') {
            silenced++;
            continue;
        }
        selected.push({ ...issue, kind });
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
        'Scope: static `sz` props and `szv()`/`szr()` catalogs; keys built from runtime data ' +
            '(an array, a spread, a `dynamic()` value) cannot be checked.',
    );
}

/**
 * The id a misspelt one most likely means, by the distance the config lane
 * allows for its rule ids.
 *
 * @param id - The id as written.
 * @param known - The ids it could mean.
 * @returns The nearest, or null when none is near.
 */
function nearestId(id: string, known: ReadonlySet<string>): string | null {
    return nearestName(
        id,
        [...known].map(entry => [entry, entry] as const),
        Math.max(1, Math.floor(id.length / 4)),
    );
}

/**
 * Fail the run before it scans anything, in the registry's words.
 *
 * @param out - Reporter the failure is written to; stderr in `--json`.
 * @param diagnostic - Why the run cannot start.
 */
function refuse<C extends SzDiagnosticId>(out: Reporter, diagnostic: SzTypedDiagnostic<C>): void {
    out.runWarn(`\u2716 ${registryMessage(diagnostic)}`);
    process.exitCode = 1;
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
    refuse(out, { code: 'cli-option-invalid', args: { form: 'fail-on', value: String(level) } });
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
        stylesheets: [],
    });
}

/**
 * Run the dead-class pass when the run selects it, and fail the run on what it finds.
 *
 * Selected by either `dead-class` or `broken-opacity`. When the entries
 * disagree on a prefix and `--rule` or `--ignore-rule` left that finding out, the pass is
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
        disagreement: readonly string[] | null;
        failOn: SzDiagnosticLevel;
    },
): void {
    const { wants, disagreement } = pass;
    const wantsRule = (rule: CheckRule) => wants(rule, rule);
    const deadClassPass =
        wantsRule('dead-class') ||
        wantsRule('broken-opacity') ||
        wants('dead-class', 'unsigned-value') ||
        wants('dead-class', 'unserved-variant') ||
        wants('dead-class', 'inert-keyword');
    const disagreementLeftOut = disagreement !== null && !wants('dead-class', PREFIX_DISAGREEMENT);
    if (!deadClassPass) return;
    if (disagreementLeftOut) {
        out.runInfo(
            `Dead-class check skipped: the Tailwind stylesheets set different prefixes, and \`--rule\` or \`--ignore-rule\` leaves \`${PREFIX_DISAGREEMENT}\` out of this run.`,
        );
        return;
    }
    if (
        reportDeadClasses(out, opened, classOrigins, pass.allow, wants, disagreement, pass.failOn)
    ) {
        process.exitCode = 1;
    }
}

/**
 * Lower every file with the Tailwind prefix the project's stylesheets set.
 *
 * The first pass runs without a prefix, which is right only when no entry
 * sets one: a prefixed project serves `tw:p-4`, and asking about `p-4` would
 * call every class dead. Only a prefixed project pays for the second pass.
 *
 * @param out - The reporter.
 * @param files - The files to lower.
 * @param cwd - Project root.
 * @returns The diagnostics, the opened stylesheets and any prefix
 *          disagreement, or null when the engine cannot run.
 */
async function lowerWithProjectPrefix(
    out: Reporter,
    files: string[],
    cwd: string,
): Promise<{
    lowered: SzDiagnostics;
    opened: OpenedOracles;
    disagreement: string[] | null;
} | null> {
    const unprefixed = await collectSzDiagnosticsOrStop(out, files, cwd, null);
    if (!unprefixed) return null;
    const opened = await openOraclesWhenAsked(cwd, unprefixed);
    const { prefix, disagreement } = agreedPrefix(
        opened,
        out.levelOf({ rule: 'dead-class', kind: PREFIX_DISAGREEMENT }) === 'off',
    );
    const lowered =
        prefix === null ? unprefixed : await collectSzDiagnosticsOrStop(out, files, cwd, prefix);
    return lowered && { lowered, opened, disagreement };
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

    if (!json) printHeader('csszyx check');
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

    const scanned = await lowerWithProjectPrefix(out, files, cwd);
    if (!scanned) return;
    const { opened, disagreement } = scanned;
    const { issues, classOrigins, pairsByFile, unchecked } = scanned.lowered;

    reportSelectedIssues(out, issues, files.length, wants, failOn);
    reportUncheckedFiles(out, unchecked);

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

    const mergeAuditFailed = await reportMergeAudit(out, {
        cwd,
        files,
        selected: mergeAuditRules(options, wantsRule, policy),
        failOn,
    });

    if (mergeAuditFailed || out.findings.some(finding => isAtLeastLevel(finding.level, failOn))) {
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
