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

import {
    createEmittedClassOracle,
    type EmittedClassOracle,
    findTailwindCssEntries,
} from '../scanner/emitted-class-oracle.js';
import { printHeader, printInfo, printSuccess, printWarn, spinner } from '../utils/terminal-ui.js';

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
 * @param allow - Classes the project vouched for.
 * @returns Whether anything dead was found.
 */
async function reportDeadClasses(
    cwd: string,
    origins: Map<string, string>,
    allow: readonly string[],
): Promise<boolean> {
    if (origins.size === 0) return false;

    const entries = await findTailwindCssEntries(cwd);
    if (entries.length === 0) {
        printInfo(
            'Dead-class check skipped: no stylesheet in this project imports Tailwind, so ' +
                'there is no design system to ask which classes are real.',
        );
        return false;
    }

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
    if (oracles.length === 0) {
        // Every reason, not the first: there was at least one entry and none of
        // them produced an oracle, so each has something to say about why, and
        // a project whose stylesheets fail for different reasons is exactly the
        // one where hearing only the first sends the user to the wrong file.
        printInfo(`Dead-class check skipped: ${skipped.join('; ')}.`);
        // A stylesheet that will not compile is a broken project, not an absent
        // one, and passing it quietly is how a check stays green for months
        // after it stopped running. An environment with nothing to ask — no
        // Tailwind, a version without a design system — still passes: failing
        // there would break every consumer who does not build with one.
        if (stylesheetFailed) {
            printWarn(
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
    // Say how many were waved through even on a clean run: an allow list that
    // silently covers a growing pile is the failure mode of every such list.
    const acceptedNote = accepted.length > 0 ? `, ${accepted.length} accepted` : '';

    if (dead.length === 0) {
        printSuccess(
            `Every one of the ${origins.size} emitted class(es) produces CSS under this project's Tailwind${acceptedNote}.`,
        );
        return false;
    }

    printWarn('\nClasses that produce no CSS:');
    for (const [token, origin] of dead) {
        printInfo(`  ${token.padEnd(28)} ${origin}`);
    }
    printWarn(
        `\n✖ ${dead.length} emitted class(es) style nothing. Each is in the DOM and does ` +
            "nothing: fix the sz key, or define the class with Tailwind's @utility.",
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

/** What one scan pass learned about a project. */
interface SzDiagnostics {
    issues: SzIssue[];
    /** Class name to the first file that produced it. */
    classOrigins: Map<string, string>;
}

/**
 * Lower every candidate file once, capturing diagnostics and class origins.
 *
 * The compiler reports unknown and aliased sz keys through `console.warn`,
 * tagged `[csszyx]` and carrying `at <file>:<line>` once `rootDir` is set.
 * They are captured into a structured report here rather than streaming one by
 * one, which is also why the swap is undone in a `finally`: leaving a project
 * scan's console patched behind would silence every later warning.
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
            if (source === null) continue;
            currentFile = path.relative(cwd, file);
            recordFileClasses(source, file, cwd, currentFile, classOrigins);
        }
    } finally {
        console.warn = originalWarn;
    }
    return { issues, classOrigins };
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
 */
function recordFileClasses(
    source: string,
    file: string,
    cwd: string,
    relativePath: string,
    classOrigins: Map<string, string>,
): void {
    try {
        const result = transformSourceCode(source, file, { rootDir: cwd });
        for (const token of result.classes) {
            if (!classOrigins.has(token)) classOrigins.set(token, relativePath);
        }
    } catch {
        // Unreadable by the reference parser; see the note above.
    }
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

    const { issues, classOrigins } = await collectSzDiagnostics(files, cwd);

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
    if (await reportDeadClasses(cwd, classOrigins, options.allow ?? [])) {
        process.exitCode = 1;
    }
}
