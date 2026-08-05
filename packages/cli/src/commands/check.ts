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

import { createEmittedClassOracle, findTailwindCssEntry } from '../scanner/emitted-class-oracle.js';
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
 * @param cwd - Project root.
 * @param origins - Emitted class mapped to the file that first emitted it.
 * @returns Whether anything dead was found.
 */
async function reportDeadClasses(cwd: string, origins: Map<string, string>): Promise<boolean> {
    if (origins.size === 0) return false;

    const entry = await findTailwindCssEntry(cwd);
    if (entry === null) {
        printInfo(
            'Dead-class check skipped: no stylesheet in this project imports Tailwind, so ' +
                'there is no design system to ask which classes are real.',
        );
        return false;
    }

    const oracle = await createEmittedClassOracle({
        resolveFrom: cwd,
        css: await readFile(entry, 'utf8'),
        cssBase: path.dirname(entry),
    });
    if (!oracle.ok) {
        printInfo(`Dead-class check skipped: ${oracle.reason}.`);
        return false;
    }

    const dead = oracle.findDead([...origins.keys()]);
    if (dead.length === 0) {
        printSuccess(
            `Every one of the ${origins.size} emitted class(es) produces CSS under this project's Tailwind.`,
        );
        return false;
    }

    printWarn('\nClasses that produce no CSS:');
    for (const token of dead) {
        printInfo(`  ${token.padEnd(28)} ${origins.get(token) ?? ''}`);
    }
    printWarn(
        `\n✖ ${dead.length} emitted class(es) style nothing. Each is in the DOM and does ` +
            'nothing: fix the sz key, or define the class with Tailwind’s @utility.',
    );
    return true;
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
    // One origin per class is enough to point at: the report answers "where did
    // this come from", not "everywhere it appears".
    const classOrigins = new Map<string, string>();
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
                const result = transformSourceCode(source, file, { rootDir: cwd });
                for (const token of result.classes) {
                    if (!classOrigins.has(token)) classOrigins.set(token, currentFile);
                }
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
    } else {
        reportIssues(issues);
    }

    // Runs whichever way the key pass went: a canonical key can still lower to
    // a class this project's Tailwind does not serve.
    if (await reportDeadClasses(cwd, classOrigins)) {
        process.exitCode = 1;
    }
}
