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

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { transformSourceCode } from '@csszyx/compiler';
import fg from 'fast-glob';

import { printHeader, printInfo, printSuccess, printWarn, spinner } from '../utils/terminal-ui.js';

/** Options for the `check` command. */
export interface CheckOptions {
    /** Project root to scan. Defaults to `process.cwd()`. */
    cwd?: string;
    /** Glob to match source files. Defaults to `**\/*.{jsx,tsx}`. */
    pattern?: string;
    /** Extra ignore globs appended to the defaults. */
    ignore?: string[];
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

/**
 * Print captured diagnostics and mark the process as failed.
 *
 * @param issues Captured compiler diagnostics.
 */
function reportIssues(issues: SzIssue[]): void {
    const byFile = groupIssuesByFile(issues);
    for (const [file, messages] of byFile) {
        printWarn(file);
        for (const message of messages) {
            printInfo(`  ${message}`);
        }
    }
    printWarn(`\n✖ ${issues.length} sz issue(s) in ${byFile.size} file(s).`);
    process.exitCode = 1;
}

/**
 * Scan the project for unknown/aliased `sz` keys and report them in one pass.
 *
 * Sets `process.exitCode` to 1 when any issue is found so the command can gate
 * CI. The check is engine-independent — every parser flags the same unknown
 * keys — so it runs the reference (Babel) lowering regardless of `build.parser`.
 *
 * @param options - scan options.
 */
export async function check(options: CheckOptions = {}): Promise<void> {
    const cwd = options.cwd ?? process.cwd();
    const patterns = options.pattern ? [options.pattern] : ['**/*.{jsx,tsx}'];
    const ignore = [...DEFAULT_IGNORE, ...(options.ignore ?? [])];

    // This command IS the full project scan, so suppress the compiler's
    // "run `csszyx check`" hint while it runs over every file.
    process.env.CSSZYX_NO_PROJECT_SCAN_HINT = '1';

    printHeader('csszyx check — static sz diagnostics');

    const s = spinner.start('Scanning for files...');
    let files: string[];
    try {
        files = await fg(patterns, { cwd, ignore, absolute: true });
    } catch (err) {
        s.fail('File scan failed');
        printWarn(`Could not scan files: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
    }
    s.succeed(`Found ${files.length} files`);

    // The compiler reports unknown/aliased sz keys through console.warn, tagged
    // `[csszyx]` and carrying `at <file>:<line>` once rootDir is set. Capture
    // those into a structured report instead of letting them stream one-by-one.
    const issues: SzIssue[] = [];
    let currentFile = '';
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]): void => {
        const message = args.map(String).join(' ');
        if (message.startsWith('[csszyx]')) {
            issues.push({ file: currentFile, message: message.replace(/^\[csszyx\]\s*/, '') });
        }
    };

    try {
        for (const file of files) {
            const source = await readSzSource(file);
            if (source === null) {
                continue;
            }
            currentFile = path.relative(cwd, file);
            try {
                transformSourceCode(source, file, { rootDir: cwd });
            } catch {
                // A file the reference parser can't read yields no usable sz
                // signal here; the bundler surfaces real parse errors at build.
            }
        }
    } finally {
        console.warn = originalWarn;
    }

    if (issues.length === 0) {
        printSuccess(`No sz issues found across ${files.length} files.`);
        printInfo(
            'Scope: static sz props and szv()/szr() catalog definitions. Keys that ' +
                'only exist at runtime (an array or spread built from runtime data, a ' +
                'dynamic() value) cannot be checked statically.',
        );
        return;
    }

    reportIssues(issues);
}
