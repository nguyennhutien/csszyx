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

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { transformSource } from '@csszyx/compiler';
import fg from 'fast-glob';
import { createReporter, type Reporter, renderJsonReport } from '../scanner/check-report.js';
import {
    createEmittedClassOracle,
    type EmittedClassOracle,
    findTailwindCssEntries,
} from '../scanner/emitted-class-oracle.js';
import {
    findSiblingKeywordValues,
    type SiblingKeywordFinding,
    type SzValuePair,
    szValuePairs,
} from '../scanner/sibling-keyword.js';
import { type DeclaredToken, findThemeCollisions } from '../scanner/theme-collision.js';
import { declaredThemeTokens } from '../scanner/theme-declarations.js';
import { spinner } from '../utils/terminal-ui.js';

/** Options for the `check` command. */
export interface CheckOptions {
    /** Project root to scan. Defaults to `process.cwd()`. */
    cwd?: string;
    /** Glob to match source files. Defaults to `**\/*.{jsx,tsx}`. */
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

/** One captured sz diagnostic, with the project-relative file it came from. */
interface SzIssue {
    file: string;
    message: string;
}

const DEFAULT_IGNORE = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/.astro/**',
];

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

/**
 * Read a path the way the caller's shell wrote it.
 *
 * A hook on Windows hands over `src\\App.tsx`. Joined onto a posix cwd that
 * becomes a filename containing a literal backslash, which exists nowhere —
 * and the scan then reported it as a file it had checked and found clean.
 * The separator a hook happens to use is not a statement about the
 * filesystem, so it is normalised at the door.
 *
 * @param file - A path as given.
 * @returns The same path with forward slashes.
 */
function withPosixSeparators(file: string): string {
    return file.includes('\\') ? file.replaceAll('\\', '/') : file;
}

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
    let stylesheetFailed = false;
    for (const entry of entries) {
        const oracle = await createEmittedClassOracle({
            resolveFrom: cwd,
            css: await readFile(entry, 'utf8'),
            cssBase: path.dirname(entry),
        });
        if (oracle.ok) {
            oracles.push(oracle);
        } else {
            skipped.push(oracle.reason);
            stylesheetFailed ||= oracle.kind === 'stylesheet';
        }
    }
    return { oracles, skipped, stylesheetFailed, hadEntries: entries.length > 0 };
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
 * @returns Whether anything dead was found.
 */
async function reportDeadClasses(
    out: Reporter,
    opened: OpenedOracles,
    origins: Map<string, string>,
    allow: readonly string[],
): Promise<boolean> {
    if (origins.size === 0) return false;

    const { oracles, skipped, stylesheetFailed, hadEntries } = opened;
    if (!hadEntries) {
        out.info(
            'Dead-class check skipped: no stylesheet in this project imports Tailwind, so ' +
                'there is no design system to ask which classes are real.',
        );
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
    return printDeadClassReport(out, {
        dead,
        broken,
        acceptedCount: accepted.length,
        emittedCount: origins.size,
    });
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
}

/**
 * Print what the dead-class scan found.
 *
 * Split from the scan so each side stays readable on its own: the scan decides
 * what is dead across every stylesheet, and this decides how to say it.
 *
 * @param out - Where this pass sends its prose and its findings.
 * @param report - What the scan concluded.
 * @returns Whether anything was found that should fail the command.
 */
function printDeadClassReport(out: Reporter, report: DeadClassReport): boolean {
    const { dead, broken, acceptedCount, emittedCount } = report;
    // Say how many were waved through even on a clean run: an allow list that
    // silently covers a growing pile is the failure mode of every such list.
    const acceptedNote = acceptedCount > 0 ? `, ${acceptedCount} accepted` : '';

    if (dead.length === 0 && broken.length === 0) {
        out.success(
            `Every one of the ${emittedCount} emitted class(es) produces CSS under this project's Tailwind${acceptedNote}.`,
        );
        return false;
    }

    if (dead.length > 0) {
        out.warn('\nClasses that produce no CSS:');
        for (const [token, origin] of dead) {
            out.push({
                rule: 'dead-class',
                file: origin,
                message: `"${token}" is emitted but produces no CSS under this project's Tailwind.`,
            });
            out.info(`  ${token.padEnd(28)} ${origin}`);
        }
        out.warn(
            `\n✖ ${dead.length} emitted class(es) style nothing. Each is in the DOM and does ` +
                "nothing: fix the sz key, or define the class with Tailwind's @utility.",
        );
    }

    if (broken.length > 0) {
        // Judged from the compiled rule, never from the token's text: Tailwind
        // v4 wraps the modifier in color-mix(), which dims any valid color, so
        // the only broken shape is a var() chain ending in a bare comma
        // triplet — invalid inside color-mix(), silently dropped by browsers.
        out.warn('\nOpacity modifiers the compiled stylesheet drops:');
        for (const entry of broken) {
            out.push({
                rule: 'broken-opacity',
                file: entry.origin,
                message: `"${entry.token}" carries an opacity modifier this stylesheet drops.`,
            });
            out.info(`  ${entry.token.padEnd(28)} ${entry.origin}`);
            out.info(
                `      its theme token resolves to the bare triplet "${entry.value}", which ` +
                    'color-mix() cannot dim — wrap the variable, e.g. rgb(var(--your-triplet)).',
            );
        }
        out.warn(
            `\n✖ ${broken.length} emitted class(es) carry an opacity modifier that does not ` +
                'survive compilation.',
        );
    }
    return true;
}

/**
 * Print captured diagnostics and mark the process as failed.
 *
 * @param out - Where this pass sends its prose and its findings.
 * @param issues Captured compiler diagnostics.
 */
function reportIssues(out: Reporter, issues: SzIssue[]): void {
    for (const { file, message } of issues) {
        out.push({ rule: 'sz-diagnostic', file, line: lineFromMessage(message), message });
    }
    const byFile = groupIssuesByFile(issues);
    for (const [file, messages] of byFile) {
        out.warn(file);
        for (const message of messages) {
            out.info(`  ${message}`);
        }
    }
    out.warn(`\n✖ ${issues.length} sz issue(s) in ${byFile.size} file(s).`);
    process.exitCode = 1;
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
 * @returns The diagnostics and the class origins found.
 */
async function collectSzDiagnostics(files: string[], cwd: string): Promise<SzDiagnostics> {
    const issues: SzIssue[] = [];
    // One origin per class is enough to point at: the report answers "where did
    // this come from", not "everywhere it appears".
    const classOrigins = new Map<string, string>();
    // Read from the same source text the lowering pass sees, so a file skipped
    // there is skipped here too rather than reported by only one of them.
    const pairsByFile = new Map<string, SzValuePair[]>();

    for (const file of files) {
        const source = await readSzSource(file);
        if (source === null) continue;
        const currentFile = path.relative(cwd, file);
        const pairs = szValuePairs(source);
        if (pairs.length > 0) pairsByFile.set(currentFile, pairs);
        for (const message of recordFileClasses(source, file, cwd, currentFile, classOrigins)) {
            if (message.startsWith('[csszyx]')) {
                issues.push({
                    file: currentFile,
                    message: message.replace(/^\[csszyx\]\s*/, ''),
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
 * @returns The file's compiler diagnostics (empty when unreadable).
 */
function recordFileClasses(
    source: string,
    file: string,
    cwd: string,
    relativePath: string,
    classOrigins: Map<string, string>,
): string[] {
    try {
        const result = transformSource(source, file, { rootDir: cwd });
        for (const token of result.classes) {
            if (!classOrigins.has(token)) classOrigins.set(token, relativePath);
        }
        return result.diagnostics;
    } catch {
        // Unreadable by the engine; see the note above.
        return [];
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
 * @returns Whether anything was found.
 */
function reportSiblingKeywords(
    out: Reporter,
    opened: OpenedOracles,
    pairsByFile: Map<string, SzValuePair[]>,
): boolean {
    if (opened.oracles.length === 0 || pairsByFile.size === 0) return false;

    const found: Array<{ file: string; finding: SiblingKeywordFinding }> = [];
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
            if (everywhere) found.push({ file, finding });
        }
    }
    if (found.length === 0) return false;

    out.warn('\nValues that belong to a different sz key:');
    for (const { file, finding } of found) {
        out.push({
            rule: 'sibling-keyword',
            file,
            line: finding.line,
            message:
                `${finding.key}: '${finding.value}' emits ${finding.className}, which sets ` +
                `${finding.sets.join(', ')} — not what ${finding.key} sets.`,
        });
        out.info(`  ${file}:${finding.line}`);
        out.info(
            `    ${finding.key}: '${finding.value}' emits ${finding.className}, which sets ` +
                `${finding.sets.join(', ')} — not what ${finding.key} sets.`,
        );
    }
    out.warn(
        `\n✖ ${found.length} value(s) written on a key that does not own them. Each one ` +
            'compiles, ships CSS and renders, so nothing else reports it; the style asked for ' +
            'is simply absent. Move the value to the key that owns it, or declare a theme ' +
            'token by that name if the spelling was deliberate.',
    );
    return true;
}

/**
 * Report theme tokens whose names a built-in utility already claims.
 *
 * Declaring a colour named after a keyword does not add a colour class: the
 * name is already a static utility, so Tailwind merges the readings and the
 * class carries both. szcn cannot tell them apart, keeps both classes, and the
 * stylesheet decides the winner instead of the order the author passed. That is
 * wrong output, which is why this fails rather than reporting and passing.
 *
 * @param out - Where this pass sends its prose and its findings.
 * @param opened - The project's compiled design systems.
 * @param cwd - Project root, for relative paths.
 * @param allowToken - Token names the project accepted deliberately.
 * @returns Whether anything was found.
 */
async function reportThemeCollisions(
    out: Reporter,
    opened: OpenedOracles,
    cwd: string,
    allowToken: readonly string[],
): Promise<boolean> {
    if (opened.oracles.length === 0) return false;

    const declared: DeclaredToken[] = [];
    for (const entry of await findTailwindCssEntries(cwd)) {
        try {
            declared.push(
                ...declaredThemeTokens(await readFile(entry, 'utf8'), path.relative(cwd, entry)),
            );
        } catch {
            // A stylesheet that cannot be read declares nothing this pass can
            // see; the dead-class pass already reports an unreadable entry.
        }
    }
    if (declared.length === 0) return false;

    // The probe compile is paid only now, once there is something to ask about.
    const oracle = await opened.oracles[0].loadCollisionOracle();
    if (oracle === null) return false;

    const found = findThemeCollisions(declared, oracle, allowToken);
    if (found.length === 0) return false;

    out.warn('\nTheme tokens a built-in utility already claims:');
    for (const finding of found) {
        out.push({
            rule: 'theme-collision',
            file: finding.file,
            line: finding.line,
            message:
                `"${finding.name}" also names ${finding.classes.join(', ')}. Tailwind merges ` +
                'both meanings into one rule, so szcn keeps the classes apart instead of ' +
                'merging them and the stylesheet decides which wins — not the order you wrote.',
        });
        out.info(`  ${finding.file}:${finding.line}`);
        out.info(
            `    "${finding.name}" also names ${finding.classes.join(', ')}. Tailwind merges ` +
                'both meanings into one rule, so szcn keeps the classes apart instead of ' +
                'merging them and the stylesheet decides which wins — not the order you ' +
                'wrote.',
        );
    }
    out.warn(
        `\n✖ ${found.length} theme token(s) shadow a built-in utility. Rename them; no ` +
            'spelling of the merge can fix this while the name is shared. To keep one anyway, ' +
            'pass --allow-token <name>.',
    );
    return true;
}

/**
 * Scan the project for unknown/aliased `sz` keys and report them in one pass.
 *
 * Sets `process.exitCode` to 1 when any issue is found so the command can gate
 * CI. The scan runs the engine itself (native when available, wasm
 * otherwise), so what it flags is exactly what the build flags.
 *
 * @param options - scan options.
 */
export async function check(options: CheckOptions = {}): Promise<void> {
    const out = createReporter(options.json === true);
    const cwd = options.cwd ?? process.cwd();
    // fast-glob reads a backslash as an escape, so a Windows-shaped glob
    // matches nothing and the run passes having scanned no files at all.
    const patterns = options.pattern ? [withPosixSeparators(options.pattern)] : ['**/*.{jsx,tsx}'];
    const ignore = [...DEFAULT_IGNORE, ...(options.ignore ?? [])];

    // This command IS the full project scan, so suppress the compiler's
    // "run `csszyx check`" hint while it runs over every file.
    process.env.CSSZYX_NO_PROJECT_SCAN_HINT = '1';

    out.header('csszyx check — static sz diagnostics');

    // ora writes straight to the tty, so it has to be skipped rather than
    // routed: a spinner frame in the middle of a JSON document is not parseable.
    const s = out.quiet ? null : spinner.start('Scanning for files...');
    let files: string[];
    let missing: string[] = [];
    try {
        if (options.files) {
            const listed = listedSourceFiles(options.files, cwd);
            missing = listed.missing;
            files = listed.files;
        } else {
            files = await fg(patterns, { cwd, ignore, absolute: true });
        }
    } catch (err) {
        s?.fail('File scan failed');
        out.warn(`Could not scan files: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
    }
    s?.succeed(`Found ${files.length} files`);

    // Reported before anything is scanned, and fatal: every later line counts
    // only the files that were read, so a run that quietly dropped one would
    // report a clean subset as if it were the whole list.
    if (missing.length > 0) {
        out.warn('Files that could not be read:');
        for (const file of missing) out.info(`  ${file}`);
        out.warn(
            `\u2716 ${missing.length} listed file(s) could not be read, so they were not ` +
                'checked. A pass here would report a subset as if it were the whole list. ' +
                'Check the paths, and note that a separator is normalised rather than ' +
                'trusted, so this is a missing file rather than a Windows path.',
        );
        process.exitCode = 1;
        return;
    }

    const { issues, classOrigins, pairsByFile } = await collectSzDiagnostics(files, cwd);
    // Compiling a stylesheet is the expensive part of this command, so it is
    // skipped when neither pass that reads it has anything to ask.
    const opened =
        classOrigins.size > 0 || pairsByFile.size > 0
            ? await openOracles(cwd)
            : { oracles: [], skipped: [], stylesheetFailed: false, hadEntries: false };

    if (issues.length === 0) {
        out.success(`No sz issues found across ${files.length} files.`);
        out.info(
            'Scope: static sz props and szv()/szr() catalog definitions. Keys that ' +
                'only exist at runtime (an array or spread built from runtime data, a ' +
                'dynamic() value) cannot be checked statically.',
        );
    } else {
        reportIssues(out, issues);
    }

    // Runs whichever way the key pass went: a canonical key can still lower to
    // a class this project's Tailwind does not serve.
    if (await reportDeadClasses(out, opened, classOrigins, options.allow ?? [])) {
        process.exitCode = 1;
    }

    // Runs last and independently: a value on the wrong key survives both
    // passes above, which is the whole reason it needs its own.
    if (reportSiblingKeywords(out, opened, pairsByFile)) {
        process.exitCode = 1;
    }

    if (await reportThemeCollisions(out, opened, cwd, options.allowToken ?? [])) {
        process.exitCode = 1;
    }

    // Written last, after every pass has recorded what it found, so the
    // document is the whole run rather than whatever had arrived by then.
    if (out.quiet) console.log(renderJsonReport(out));
}
