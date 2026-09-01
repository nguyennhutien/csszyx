/**
 * csszyx migrate - Convert Tailwind className to sz prop.
 *
 * Runs on the native engine: the JSX/TSX files in one call and the HTML files
 * one by one, as the text pass is. Supports --dry-run, --ignore patterns.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {
    type CsszyxTodoMap,
    type MigrateRustResult,
    migrateRustBatch,
    migrateRustHtml,
    RustMigrateUnavailableError,
} from '@csszyx/compiler/migrate';
import fg from 'fast-glob';

import { withPosixSeparators } from '../utils/posix-path.js';
import {
    printError,
    printHeader,
    printInfo,
    printSuccess,
    printWarn,
    spinner,
} from '../utils/terminal-ui.js';

/**
 *
 */
export interface MigrateOptions {
    dryRun?: boolean;
    ignore?: string[];
    cwd?: string;
    pattern?: string;
    /** Wrap HTML sz attribute values in outer { } braces (default: false). */
    braces?: boolean;
    /** Inject FOUC-prevention CSS into HTML files (default: true). */
    injectFouc?: boolean;
    /** Inject runtime script tag into HTML files: 'local' | 'cdn' | false. */
    injectRuntime?: 'local' | 'cdn' | false;
    /** CDN URL for --inject-runtime cdn. */
    cdnUrl?: string;
    /** Local script path for --inject-runtime local. */
    localPath?: string;
    /** Scan without modifying files and generate a resolution map for unrecognized classes. */
    audit?: boolean;
    /** Inject migration follow-up comments above unrecognized classes instead of failing. */
    injectTodos?: boolean;
    /** Path to a JSON map that resolves previously unrecognized classes. */
    resolveTodos?: string;
    /**
     * Only normalize legacy sz-prop keys to their single-way canonical (e.g.
     * `fontWeight`→`weight`, `padding`→`p`, `{ flex: true }`→`{ display: 'flex' }`)
     * and leave every `className` 100% untouched. The sz-key-only upgrade for
     * 0.9.10 → 0.10.0, for projects already on sz that do not want a Tailwind
     * className migration. TRANSITIONAL — remove at v1.
     */
    keysOnly?: boolean;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Create a timestamped log file writer under .csszyx/logs/.
 * @param cwd - Project root directory.
 * @returns Object with writeLine, filePath, and flush helpers.
 */
function createLogFile(cwd: string): {
    writeLine: (line: string) => void;
    filePath: string;
    flush: () => void;
} {
    const now = new Date();
    // Format: 2026-04-12_14-05-30
    const ts = now.toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-');
    const logDir = path.join(cwd, '.csszyx', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const filePath = path.join(logDir, `migrate-${ts}.log`);
    const lines: string[] = [`csszyx migrate — ${now.toISOString()}`, ''];
    return {
        filePath,
        writeLine: (line: string) => lines.push(line),
        flush: () => fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8'),
    };
}

/**
 * Find the exclusive end offset of one valid migration follow-up comment.
 *
 * @param source Source containing the comment opener.
 * @param open Comment opener offset.
 * @returns End offset including one trailing newline, or null when invalid.
 */
function findSzTodoCommentEnd(source: string, open: number): number | null {
    const marker = '@sz-todo:';
    let markerStart = open + '{/*'.length;
    while (markerStart < source.length && /\s/.test(source[markerStart] as string)) {
        markerStart++;
    }
    if (!source.startsWith(marker, markerStart)) {
        return null;
    }
    const close = source.indexOf('*/}', markerStart);
    const newline = source.indexOf('\n', markerStart);
    if (close === -1 || (newline !== -1 && newline < close)) {
        return null;
    }
    let contentStart = markerStart + marker.length;
    while (contentStart < close && /\s/.test(source[contentStart] as string)) {
        contentStart++;
    }
    if (contentStart >= close) {
        return null;
    }
    const end = close + '*/}'.length;
    // Consume the line break the comment sits on, in whichever convention
    // the file uses; a CRLF file otherwise keeps a blank line where the
    // comment stood.
    if (source.startsWith('\r\n', end)) return end + 2;
    return source[end] === '\n' ? end + 1 : end;
}

/**
 * Return true if `pattern` appears in the root .gitignore.
 * @param cwd - Project root directory.
 * @param pattern - Pattern string to search for.
 * @returns True if the pattern is present in .gitignore.
 */
function isGitignored(cwd: string, pattern: string): boolean {
    try {
        const content = fs.readFileSync(path.join(cwd, '.gitignore'), 'utf-8');
        return content.split('\n').some(l => {
            const t = l.trim();
            return t === pattern || t === `${pattern}/` || t === `/${pattern}`;
        });
    } catch {
        return false;
    }
}

/**
 * Prompt a yes/no question on TTY. Returns true only for explicit 'y'. Default is no.
 * @param question - The question string to display.
 * @returns Promise resolving to true if user answered 'y'.
 */
async function askYesNo(question: string): Promise<boolean> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer.trim().toLowerCase() === 'y');
        });
    });
}

// ============================================================================
// MAIN COMMAND
// ============================================================================

/**
 * Run the csszyx migration tool.
 * @param options - Migration configuration options
 */
export async function migrate(options: MigrateOptions = {}): Promise<void> {
    const context = await prepareMigration(options);
    if (!context) return;
    const log = startMigrationLog(context);
    const files = await scanMigrationFiles(context, log);
    if (!files || files.length === 0) return;

    const summary = createMigrationSummary();
    const progress = spinner.start('Migrating...');
    try {
        processMigrationBatch(files, context, summary, log);
    } catch (error) {
        // The one failure with nothing behind it: migrate has no second
        // implementation, so an install without the engine cannot be answered
        // by working differently. Letting it escape a command action loses the
        // sentence naming the package under a stack trace.
        if (!(error instanceof RustMigrateUnavailableError)) throw error;
        progress.fail('Migration stopped');
        printError(error.message);
        log.flush();
        process.exitCode = 1;
        return;
    }
    progress.succeed('Migration complete');

    reportMigrationSummary(context, summary, log);
    // Every other file was migrated, but a script must not read the run as
    // clean while some files were left as they were.
    if (summary.failed.length > 0) process.exitCode = 1;
    if (!writeAuditMap(context, summary, log)) return;
    reportRemainingTodos(context, summary, log);
    reportUnusedImports(summary, log);
    flushMigrationLog(context.cwd, log);
}

type MigrationLog = ReturnType<typeof createLogFile>;

interface MigrationContext {
    options: MigrateOptions;
    cwd: string;
    dryRun: boolean;
    audit: boolean;
    resolveTodosPath?: string;
    injectTodos: boolean;
    customMap?: CsszyxTodoMap;
    /** `customMap` serialised once, shared by every run of files. */
    customMapJson?: string;
}

interface MigrationSummary {
    transformed: number;
    skipped: number;
    skippedComponent: number;
    normalized: number;
    files: number;
    /**
     * Distinct unrecognized class names. A set, not a list of occurrences: a
     * legacy repository repeats the same few thousand names a million times,
     * and holding every occurrence cost more memory than the sources did.
     */
    unrecognized: Set<string>;
    warnings: string[];
    unusedImports: { file: string; imports: string[] }[];
    /** Files the engine refused even on their own; the run exits non-zero. */
    failed: string[];
}

/* eslint-disable jsdoc/require-param, jsdoc/require-returns -- Internal stages operate on the shared migration context. */

/** Prepares mode flags, prompts, and an optional resolution map. */
async function prepareMigration(options: MigrateOptions): Promise<MigrationContext | null> {
    const cwd = options.cwd || process.cwd();
    const audit = options.audit || false;
    const dryRun = audit || options.dryRun || false;
    const resolveTodosPath = options.resolveTodos;
    let injectTodos = options.injectTodos || Boolean(resolveTodosPath);
    printHeader('csszyx Migration Tool');
    if (process.stdout.isTTY && !injectTodos && !audit && !resolveTodosPath) {
        injectTodos = await askYesNo(
            'Add {/* @sz-todo */} comments above elements with unrecognized classes? [y/N] ',
        );
    }
    const customMap = resolveTodosPath ? loadResolutionMap(cwd, resolveTodosPath) : undefined;
    if (resolveTodosPath && !customMap) return null;
    if (audit) reportAuditMode();
    else if (dryRun) reportDryRunMode();
    return {
        options,
        cwd,
        dryRun,
        audit,
        resolveTodosPath,
        injectTodos,
        customMap,
        customMapJson: customMap ? JSON.stringify(customMap) : undefined,
    };
}

/** Loads a user-edited migration-resolution map. */
function loadResolutionMap(cwd: string, filePath: string): CsszyxTodoMap | undefined {
    try {
        const content = fs.readFileSync(path.resolve(cwd, filePath), 'utf-8');
        const map = JSON.parse(content) as CsszyxTodoMap;
        printInfo(`Loaded resolution map from ${filePath}`);
        return map;
    } catch {
        printWarn(
            `Could not load resolve map from ${filePath}. Ensure the file exists and is valid JSON.`,
        );
        return undefined;
    }
}

/** Reports that migration is collecting unresolved classes without writing sources. */
function reportAuditMode(): void {
    printInfo('Audit mode — scanning for unrecognized classes to generate a mapping file...');
}

/** Reports that migration will preview changes without writing sources. */
function reportDryRunMode(): void {
    printInfo('Dry run mode — no files will be modified');
}

/** Creates and initializes the migration log. */
function startMigrationLog(context: MigrationContext): MigrationLog {
    const log = createLogFile(context.cwd);
    let mode = 'migrate';
    if (context.audit) mode = 'audit';
    else if (context.dryRun) mode = 'dry-run';
    const resolution = context.resolveTodosPath
        ? ` (resolve-todos: ${context.resolveTodosPath})`
        : '';
    log.writeLine(`Mode: ${mode}${resolution}`);
    log.writeLine(`injectTodos: ${context.injectTodos}`);
    log.writeLine('');
    if (!isGitignored(context.cwd, '.csszyx')) {
        printWarn(
            'Tip: add .csszyx/ to your .gitignore to exclude migration logs from version control.',
        );
    }
    return log;
}

/** Scans migration input files and handles empty/error reporting. */
async function scanMigrationFiles(
    context: MigrationContext,
    log: MigrationLog,
): Promise<string[] | null> {
    const ignore = [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
        '**/.nuxt/**',
        ...(context.options.ignore || []),
    ];
    const progress = spinner.start('Scanning for files...');
    try {
        // Normalised inside the guarded region on purpose: a pattern that is
        // not a string must land on the same soft failure as a glob fast-glob
        // rejects, not on a TypeError before the spinner exists.
        const patterns = context.options.pattern
            ? [withPosixSeparators(context.options.pattern)]
            : ['**/*.{jsx,tsx,html}'];
        const files = await fg(patterns, { cwd: context.cwd, ignore, absolute: true });
        progress.succeed(`Found ${files.length} files`);
        if (files.length === 0) reportNoMigrationFiles(context, log);
        return files;
    } catch (error) {
        progress.fail('File scan failed');
        printWarn(
            `Could not scan files: ${error instanceof Error ? error.message : String(error)}`,
        );
        log.flush();
        return null;
    }
}

/** Reports an empty migration scan and persists its log. */
function reportNoMigrationFiles(context: MigrationContext, log: MigrationLog): void {
    printWarn(
        context.options.pattern
            ? `No files found matching pattern: ${context.options.pattern}`
            : 'No JSX/TSX/HTML files found',
    );
    log.writeLine('No files found.');
    log.flush();
}

/** Creates neutral aggregation state for one migration run. */
function createMigrationSummary(): MigrationSummary {
    return {
        transformed: 0,
        skipped: 0,
        skippedComponent: 0,
        normalized: 0,
        files: 0,
        unrecognized: new Set(),
        warnings: [],
        unusedImports: [],
        failed: [],
    };
}

/** One file read and screened for the selected mode, ready to transform. */
interface MigrationInput {
    filePath: string;
    isHtml: boolean;
    /** The source the transformer sees: markers stripped on a resolve pass. */
    source: string;
}

/** Reads one candidate file, or null when the selected mode has nothing to do in it. */
function readMigrationInput(filePath: string, context: MigrationContext): MigrationInput | null {
    const source = fs.readFileSync(filePath, 'utf-8');
    const isHtml = filePath.endsWith('.html');
    if (context.options.keysOnly && isHtml) return null;
    if (!hasMigrationAttributes(source, isHtml, Boolean(context.options.keysOnly))) return null;
    return {
        filePath,
        isHtml,
        source: context.resolveTodosPath && !isHtml ? stripSzTodoComments(source) : source,
    };
}

/** The HTML options the command passes through. */
function htmlOptions(context: MigrationContext) {
    return {
        braces: context.options.braces,
        injectFouc: context.options.injectFouc,
        injectRuntime: context.options.injectRuntime,
        cdnUrl: context.options.cdnUrl,
        localPath: context.options.localPath,
    };
}

/** The JSX options the command passes through. */
function sourceOptions(context: MigrationContext) {
    return {
        injectTodos: context.injectTodos,
        customMap: context.customMap,
        customMapJson: context.customMapJson,
        keysOnly: context.options.keysOnly,
    };
}

/** Aggregates, writes and reports one transformed file. */
function finishMigrationFile(
    filePath: string,
    result: MigrateRustResult,
    context: MigrationContext,
    summary: MigrationSummary,
    log: MigrationLog,
): void {
    summary.warnings.push(...result.warnings);
    if (!result.changed) return;
    aggregateMigrationResult(filePath, result, context, summary);
    if (!writeMigratedFile(filePath, result.code, context, log)) return;
    reportMigratedFile(filePath, result.stats, context, log);
}

/** Files per engine call: past this the run is sent before the next file is read. */
const RUN_FILES = 25;
/** Source bytes per engine call, the other trigger; whichever fills first sends. */
const RUN_BYTES = 2 * 1024 * 1024;

/**
 * Processes every candidate file through the native engine, in runs.
 *
 * A run is sent when it holds 25 files or 2 MiB of source, whichever comes
 * first, and every run is finished - written, counted - before the next is
 * read. Both triggers are needed: a repository nobody has refactored keeps a
 * few files that carry half its bytes, and they sit together, so a count
 * alone lets one run hold 30 MB while a byte budget alone lets a run of tiny
 * files grow to thousands of results. Measured on such a tree, one call for
 * everything peaked at 1 041 MB; either single trigger at 400-550 MB; the two
 * together at 234 MB, with no change in time.
 *
 * The engine is asked once, with nothing, before the first file is read: runs
 * are written as they finish, so an install that cannot run the engine at all
 * has to be found out while no file has been touched.
 */
function processMigrationBatch(
    files: string[],
    context: MigrationContext,
    summary: MigrationSummary,
    log: MigrationLog,
): void {
    migrateRustBatch([], sourceOptions(context));
    const pending: MigrationInput[] = [];
    let pendingBytes = 0;
    const send = (): void => {
        if (pending.length === 0) return;
        processMigrationRun(pending.splice(0), context, summary, log);
        pendingBytes = 0;
    };
    for (const filePath of files) {
        // A file the process cannot open costs itself, not the run: reported
        // as a warning and skipped, the way a scan that throws is.
        let input: MigrationInput | null;
        try {
            input = readMigrationInput(filePath, context);
        } catch (error) {
            summary.warnings.push(`Could not read ${filePath}: ${String(error)}`);
            continue;
        }
        if (!input) continue;
        if (input.isHtml) {
            // Sent ahead of the HTML file so the log keeps discovery order.
            send();
            migrateHtmlFile(input, context, summary, log);
            continue;
        }
        pending.push(input);
        pendingBytes += input.source.length;
        if (pending.length >= RUN_FILES || pendingBytes >= RUN_BYTES) send();
    }
    send();
}

/**
 * Migrates one HTML file, charging a refusal to that file alone.
 *
 * Markup goes to the engine on its own rather than in a run, and this call had
 * no guard while the JSX path had two. An engine that threw here escaped the
 * command: the files already rewritten were never summarised, the caller got a
 * stack trace instead of an exit code, and nothing named the file that caused
 * it. An engine that cannot run at all is still rethrown — that failure has
 * nothing behind it and already stopped the command before any file was read.
 *
 * @param input - The file and its source.
 * @param context - Migration context.
 * @param summary - Collected counts and warnings.
 * @param log - Per-file migration log.
 */
function migrateHtmlFile(
    input: MigrationInput,
    context: MigrationContext,
    summary: MigrationSummary,
    log: MigrationLog,
): void {
    let result: MigrateRustResult;
    try {
        result = migrateRustHtml(input.source, htmlOptions(context));
    } catch (error) {
        if (error instanceof RustMigrateUnavailableError) throw error;
        recordFailedMigration(
            input.filePath,
            error instanceof Error ? error.message : String(error),
            context,
            summary,
        );
        return;
    }
    finishMigrationFile(input.filePath, result, context, summary, log);
}

/**
 * Sends one run of JSX files to the engine and finishes each result.
 *
 * The engine answers a run as a whole: a source it cannot handle (a panic
 * surfaces as a throw for the call) takes every file in the run down with it.
 * Such a run is retried one file at a time, so the file is named and the rest
 * still migrate. An engine that cannot run here at all is not retried - that
 * is the one failure with nothing behind it, and it already stopped the
 * command before any file was read.
 */
function processMigrationRun(
    inputs: MigrationInput[],
    context: MigrationContext,
    summary: MigrationSummary,
    log: MigrationLog,
): void {
    let results: MigrateRustResult[];
    try {
        results = migrateRustBatch(
            inputs.map(input => ({ filename: input.filePath, source: input.source })),
            sourceOptions(context),
        );
    } catch (error) {
        if (error instanceof RustMigrateUnavailableError) throw error;
        for (const input of inputs) processMigrationFileAlone(input, context, summary, log);
        return;
    }
    for (const [index, input] of inputs.entries()) {
        const result = results[index];
        if (result === undefined) {
            recordFailedMigration(
                input.filePath,
                'the engine returned no result',
                context,
                summary,
            );
            continue;
        }
        finishMigrationFile(input.filePath, result, context, summary, log);
    }
}

/** Retries one file from a run the engine refused, naming it if it fails again. */
function processMigrationFileAlone(
    input: MigrationInput,
    context: MigrationContext,
    summary: MigrationSummary,
    log: MigrationLog,
): void {
    let result: MigrateRustResult | undefined;
    try {
        [result] = migrateRustBatch(
            [{ filename: input.filePath, source: input.source }],
            sourceOptions(context),
        );
    } catch (error) {
        if (error instanceof RustMigrateUnavailableError) throw error;
        recordFailedMigration(
            input.filePath,
            error instanceof Error ? error.message : String(error),
            context,
            summary,
        );
        return;
    }
    if (result === undefined) {
        recordFailedMigration(input.filePath, 'the engine returned no result', context, summary);
        return;
    }
    finishMigrationFile(input.filePath, result, context, summary, log);
}

/** Records a file the engine could not migrate; the file is left as it was. */
function recordFailedMigration(
    filePath: string,
    reason: string,
    context: MigrationContext,
    summary: MigrationSummary,
): void {
    const relative = path.relative(context.cwd, filePath);
    summary.failed.push(relative);
    summary.warnings.push(`Could not migrate ${relative}: ${reason}`);
}

/** Checks whether a source file contains attributes relevant to the selected mode. */
function hasMigrationAttributes(source: string, isHtml: boolean, keysOnly: boolean): boolean {
    if (isHtml) return source.includes('class=');
    if (keysOnly) return source.includes('sz=');
    return source.includes('className=') || source.includes('sz=');
}

/** Aggregates one changed transformation result. */
function aggregateMigrationResult(
    filePath: string,
    result: MigrateRustResult,
    context: MigrationContext,
    summary: MigrationSummary,
): void {
    summary.files++;
    summary.transformed += result.stats.classNamesTransformed;
    summary.skipped += result.stats.classNamesSkipped;
    summary.skippedComponent += result.stats.classNamesSkippedComponent;
    summary.normalized += result.stats.szKeysNormalized ?? 0;
    for (const className of result.stats.classesUnrecognized) summary.unrecognized.add(className);
    if (result.potentiallyUnusedImports.length > 0) {
        summary.unusedImports.push({
            file: path.relative(context.cwd, filePath),
            imports: result.potentiallyUnusedImports,
        });
    }
}

/** Writes one transformed source file unless the run is dry. */
function writeMigratedFile(
    filePath: string,
    code: string,
    context: MigrationContext,
    log: MigrationLog,
): boolean {
    if (context.dryRun) return true;
    try {
        fs.writeFileSync(filePath, code, 'utf-8');
        return true;
    } catch (error) {
        const relative = path.relative(context.cwd, filePath);
        printWarn(
            `Could not write ${relative}: ${error instanceof Error ? error.message : String(error)}`,
        );
        log.writeLine(`  Write error: ${relative}`);
        return false;
    }
}

/** Reports one changed file to the console and migration log. */
function reportMigratedFile(
    filePath: string,
    stats: MigrateRustResult['stats'],
    context: MigrationContext,
    log: MigrationLog,
): void {
    const relative = path.relative(context.cwd, filePath);
    const detail = context.options.keysOnly
        ? `${stats.szKeysNormalized ?? 0} sz key(s) normalized`
        : `${stats.classNamesTransformed} className(s) → sz`;
    if (context.dryRun) printInfo(`  ${relative}: ${detail}`);
    log.writeLine(`  ${relative}: ${detail}`);
}

/** Reports aggregate counts, warnings, and unknown classes. */
function reportMigrationSummary(
    context: MigrationContext,
    summary: MigrationSummary,
    log: MigrationLog,
): void {
    console.info();
    printSuccess(`Files modified: ${summary.files}`);
    if (!context.options.keysOnly) printSuccess(`classNames converted: ${summary.transformed}`);
    log.writeLine(`Files modified: ${summary.files}`);
    log.writeLine(`classNames converted: ${summary.transformed}`);
    reportOptionalCounts(summary, log);
    reportUnknownClasses(summary.unrecognized, log);
    reportMigrationWarnings(summary.warnings, log);
}

/** Reports non-zero normalization and skip counters. */
function reportOptionalCounts(summary: MigrationSummary, log: MigrationLog): void {
    if (summary.normalized > 0) {
        printSuccess(`legacy sz keys normalized: ${summary.normalized}`);
        log.writeLine(`legacy sz keys normalized: ${summary.normalized}`);
    }
    if (summary.skipped > 0) {
        printWarn(`classNames skipped (dynamic): ${summary.skipped}`);
        log.writeLine(`classNames skipped (dynamic): ${summary.skipped}`);
    }
    if (summary.skippedComponent > 0) {
        printWarn(`classNames kept on components (no sz support): ${summary.skippedComponent}`);
        log.writeLine(`classNames kept on components (no sz support): ${summary.skippedComponent}`);
    }
}

/** Reports unique unrecognized classes. */
function reportUnknownClasses(classes: ReadonlySet<string>, log: MigrationLog): void {
    if (classes.size === 0) return;
    const unique = [...classes];
    printWarn(
        `Unrecognized classes (${unique.length}): ${unique.slice(0, 10).join(', ')}${unique.length > 10 ? '...' : ''}`,
    );
    log.writeLine(`Unrecognized classes (${unique.length}): ${unique.join(', ')}`);
}

/** Reports transformation diagnostics with a concise console cap. */
function reportMigrationWarnings(warnings: string[], log: MigrationLog): void {
    if (warnings.length === 0) return;
    console.info();
    for (const warning of warnings.slice(0, 5)) printWarn(warning);
    if (warnings.length > 5) printWarn(`... and ${warnings.length - 5} more warnings`);
    log.writeLine('');
    log.writeLine('Warnings:');
    for (const warning of warnings) log.writeLine(`  ${warning}`);
}

/** Writes the audit resolution map when audit mode is active. */
function writeAuditMap(
    context: MigrationContext,
    summary: MigrationSummary,
    log: MigrationLog,
): boolean {
    if (!context.audit) return true;
    const todoPath = path.join(context.cwd, '.csszyx-todo.json');
    const unique = [...summary.unrecognized];
    console.info();
    if (unique.length === 0) {
        printSuccess('Audit complete. 100% of your classes are perfectly recognized by csszyx!');
        log.writeLine('Audit: 100% recognized.');
        return true;
    }
    const todoObject = Object.fromEntries(unique.map(value => [value, 'sz:todo']));
    try {
        fs.writeFileSync(todoPath, JSON.stringify(todoObject, null, 2));
    } catch (error) {
        printWarn(
            `Could not write ${path.relative(context.cwd, todoPath)}: ${error instanceof Error ? error.message : String(error)}`,
        );
        log.flush();
        return false;
    }
    reportAuditMapWritten(context.cwd, todoPath, unique.length, log);
    return true;
}

/** Reports a successfully written audit map. */
function reportAuditMapWritten(
    cwd: string,
    todoPath: string,
    count: number,
    log: MigrationLog,
): void {
    const relative = path.relative(cwd, todoPath);
    printSuccess(`Audit complete. Exported ${count} unrecognized classes to ${relative}.`);
    printInfo(
        'Edit this file to map custom classes, then run: npx @csszyx/cli migrate --resolve-todos .csszyx-todo.json',
    );
    log.writeLine(`Audit: ${count} unrecognized classes written to ${relative}`);
}

/** Reports unresolved classes after applying a migration-resolution map. */
function reportRemainingTodos(
    context: MigrationContext,
    summary: MigrationSummary,
    log: MigrationLog,
): void {
    if (!context.resolveTodosPath) return;
    const unique = [...summary.unrecognized];
    if (unique.length === 0) return;
    console.info();
    printWarn(
        `Still unresolved after this pass (${unique.length}): ${unique.slice(0, 10).join(', ')}${unique.length > 10 ? '...' : ''}`,
    );
    printInfo('Re-run --audit to generate a fresh snapshot when ready.');
    log.writeLine(`Still unresolved (${unique.length}): ${unique.join(', ')}`);
}

/** Reports imports that may be unused after migration. */
function reportUnusedImports(summary: MigrationSummary, log: MigrationLog): void {
    if (summary.unusedImports.length === 0) return;
    console.info();
    printWarn('Potentially unused imports (run ESLint to clean up):');
    for (const { file, imports } of summary.unusedImports) {
        const importNames = imports.map(name => `import { ${name} }`).join(', ');
        printInfo(`  ${file}: ${importNames}`);
        log.writeLine(`  Unused import in ${file}: ${imports.join(', ')}`);
    }
}

/** Flushes the migration log without turning logging failures into command failures. */
function flushMigrationLog(cwd: string, log: MigrationLog): void {
    try {
        log.flush();
        printInfo(`Migration log saved to ${path.relative(cwd, log.filePath)}`);
    } catch {
        // Logging is diagnostic and must not invalidate a completed migration.
    }
}

/* eslint-enable jsdoc/require-param, jsdoc/require-returns */

/**
 * Remove every migration follow-up comment (with an optional trailing
 * newline), the linear equivalent of
 * regular-expression replacement used with an empty
 * replacement. The old `\S(?:.*\S)?` content run was quadratic-by-search; this
 * finds each `{/*` opener once and scans forward to its `*​/}`. Content is
 * line-scoped (the regex used `.`), so a comment that has no `*​/}` before the
 * next newline is left intact, exactly as the regex left it.
 *
 * @param source - Source to strip migration follow-up comments from.
 * @returns Source with the migration follow-up comments removed.
 */
function stripSzTodoComments(source: string): string {
    const OPEN = '{/*';
    let out = '';
    let i = 0;
    for (;;) {
        const open = source.indexOf(OPEN, i);
        if (open === -1) {
            return out + source.slice(i);
        }
        const end = findSzTodoCommentEnd(source, open);
        if (end === null) {
            out += source.slice(i, open + OPEN.length);
            i = open + OPEN.length;
            continue;
        }
        out += source.slice(i, open);
        i = end;
    }
}
