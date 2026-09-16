/**
 * The Tailwind prefix, read ahead of time for the Next Turbopack lane.
 *
 * A Turbopack loader runs synchronously, one module at a time, and reading the
 * prefix means compiling the project's stylesheets, which is asynchronous. So
 * `csszyx next prebuild` and `csszyx next watch` read them with the same style
 * model every other lane opens, and write down what they settled. The loader
 * reads the file.
 *
 * The file records the content hash of every stylesheet it was read from, so a
 * reader can tell when an edit left it describing stylesheets that have since
 * changed, instead of lowering against a prefix the project no longer sets.
 *
 * @module
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { StylesheetFacts } from '@csszyx/tailwind-oracle';

import { type AtomicWriteOptions, atomicWriteFileSync } from './atomic-write.js';
import {
    mayReachTailwind,
    missingTailwindStylesheetMessage,
    openProjectStyleModel,
    styleModelError,
    styleModelWarning,
} from './project-style-model.js';
import { collectSpecifierAliases } from './specifier-aliases.js';
import { discoverProjectTheme } from './theme-discovery.js';

/** One stylesheet the facts were read from, with the content they were read against. */
export interface NextStylesheetFactsEntry {
    file: string;
    sha256: string;
}

/** What `csszyx next prebuild` and `next watch` record for the loader. */
export interface NextStylesheetFactsRecord {
    schema: 1;
    /** The app root the stylesheets were read from. */
    root: string;
    /** What the stylesheets settled, or null when none reaches Tailwind. */
    facts: StylesheetFacts | null;
    /** Every stylesheet read, so a reader can tell when one changed. */
    entries: NextStylesheetFactsEntry[];
}

/** The facts file's name, under the Next app's csszyx cache directory. */
export const NEXT_STYLESHEET_FACTS_FILE = 'stylesheet-facts.json';

/**
 * Where the facts file for an app lives.
 *
 * @param cacheDir - The csszyx cache directory for the app.
 * @returns Absolute path of the facts file.
 */
export function resolveNextStylesheetFactsPath(cacheDir: string): string {
    return path.join(cacheDir, NEXT_STYLESHEET_FACTS_FILE);
}

/**
 * A file's content hash.
 *
 * @param content - File content.
 * @returns Hex sha256.
 */
function sha256Of(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

/**
 * A file's text, or null when it cannot be read.
 *
 * @param file - Absolute path.
 * @returns The text, or null.
 */
function readText(file: string): string | null {
    try {
        return readFileSync(file, 'utf8');
    } catch {
        return null;
    }
}

/**
 * Read the project's stylesheets and record what they settled.
 *
 * Stops, exactly as a bundler build does, when the stylesheets give no single
 * prefix or one that reaches Tailwind does not compile.
 *
 * @param input - Where the app is and which stylesheets it loads.
 * @param input.root - The Next app root.
 * @param input.cacheDir - The csszyx cache directory for that app.
 * @param input.tailwindStylesheet - The stylesheets the app loads, when named.
 * @param input.writeOptions - Atomic write options.
 * @returns The record, where it lives, and any warning to print.
 */
export async function writeNextStylesheetFacts(input: {
    root: string;
    cacheDir: string;
    tailwindStylesheet?: readonly string[];
    writeOptions?: AtomicWriteOptions;
}): Promise<{ record: NextStylesheetFactsRecord; path: string; warning: string | null }> {
    const listed = (input.tailwindStylesheet ?? []).map(file => ({
        file,
        absolute: path.resolve(input.root, file),
    }));
    const missing = listed.filter(entry => !existsSync(entry.absolute)).map(entry => entry.file);
    if (missing.length > 0) {
        throw new Error(missingTailwindStylesheetMessage(missing, input.root));
    }
    const candidates =
        listed.length > 0
            ? listed.map(entry => entry.absolute)
            : discoverProjectTheme(input.root).scanned;
    const model = await openProjectStyleModel(
        input.root,
        candidates,
        collectSpecifierAliases(input.root),
    );
    const problem = styleModelError(model, input.root);
    if (problem !== null) throw new Error(problem);

    const record: NextStylesheetFactsRecord = {
        schema: 1,
        root: input.root,
        facts: model.facts,
        entries: model.entries.map(entry => ({
            file: entry.file,
            sha256: sha256Of(readFileSync(entry.file, 'utf8')),
        })),
    };
    const file = resolveNextStylesheetFactsPath(input.cacheDir);
    const content = `${JSON.stringify(record, null, 2)}\n`;
    // Rewritten only when it changed: the loader declares this file as a
    // dependency, so identical bytes written again would recompile every module.
    if (readText(file) !== content) atomicWriteFileSync(file, content, input.writeOptions);
    return { record, path: file, warning: styleModelWarning(model, input.root) };
}

/**
 * Read the facts a prebuild recorded, and whether they still describe the stylesheets.
 *
 * @param cacheDir - The csszyx cache directory for the app.
 * @returns The record, or why it cannot be used.
 */
export function readNextStylesheetFacts(
    cacheDir: string,
): { ok: true; record: NextStylesheetFactsRecord } | { ok: false; reason: string } {
    const text = readText(resolveNextStylesheetFactsPath(cacheDir));
    if (text === null) return { ok: false, reason: 'no stylesheet facts have been written yet' };
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, reason: 'the stylesheet facts file is not valid JSON' };
    }
    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        (parsed as { schema?: unknown }).schema !== 1
    ) {
        return {
            ok: false,
            reason: 'the stylesheet facts file has a shape this csszyx does not read',
        };
    }
    const record = parsed as NextStylesheetFactsRecord;
    for (const entry of record.entries) {
        const current = readText(entry.file);
        if (current === null || sha256Of(current) !== entry.sha256) {
            const name = path.relative(record.root, entry.file).split(path.sep).join('/');
            return { ok: false, reason: `${name} changed since the stylesheet facts were written` };
        }
    }
    return { ok: true, record };
}

/** The prefix a Next lane lowers with, and the files that decided it. */
export type NextClassPrefix =
    | { ok: true; prefix: string | null; dependencies: string[] }
    | { ok: false; reason: string };

/**
 * The prefix a synchronous Next lane lowers with.
 *
 * Fresh facts answer it. A project none of whose stylesheets could reach
 * Tailwind has no prefix, which needs no compile and so no facts file. Every
 * other case has to wait for the stylesheets to be read.
 *
 * @param input - Where the app is and which stylesheets it loads.
 * @param input.root - The Next app root.
 * @param input.cacheDir - The csszyx cache directory for that app.
 * @param input.tailwindStylesheet - The stylesheets the app loads; empty when not named.
 * @returns The prefix and its dependencies, or why it is not known yet.
 */
export function resolveNextClassPrefix(input: {
    root: string;
    cacheDir: string;
    tailwindStylesheet: readonly string[];
}): NextClassPrefix {
    const factsPath = resolveNextStylesheetFactsPath(input.cacheDir);
    const read = readNextStylesheetFacts(input.cacheDir);
    if (read.ok) {
        return {
            ok: true,
            prefix: read.record.facts?.prefix ?? null,
            dependencies: [factsPath, ...read.record.entries.map(entry => entry.file)],
        };
    }
    const listed = input.tailwindStylesheet.map(file => path.resolve(input.root, file));
    const candidates = listed.length > 0 ? listed : discoverProjectTheme(input.root).scanned;
    if (candidates.some(file => mayReachTailwind(readText(file) ?? '@import'))) {
        return { ok: false, reason: read.reason };
    }
    // The candidates are dependencies too: an `@import "tailwindcss"` added to
    // one later has to re-run the loader.
    return { ok: true, prefix: null, dependencies: [factsPath, ...candidates] };
}

/**
 * What a synchronous Next lane says when it has no prefix to lower with.
 *
 * @param root - The Next app root.
 * @param reason - Why the facts could not be used.
 * @param lane - Which lane is asking, as the message names it.
 * @returns The message.
 */
export function unreadNextPrefixMessage(root: string, reason: string, lane: string): string {
    return (
        `[csszyx] ${lane} has not read the Tailwind prefix for ${root}: ${reason}.\n` +
        '  help: run `csszyx next prebuild` before `next build`, and `csszyx next watch` beside `next dev`; both read the stylesheets first.\n' +
        '  note: without the prefix every class this lane emits could style nothing.'
    );
}
