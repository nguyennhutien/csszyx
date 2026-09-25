/**
 * The settled merge registration, as a file every lane can read.
 *
 * The bundler plugins hand `registerUnservedClasses` and
 * `registerMergeSignatures` their data through a virtual module filled at
 * bundle time. Two consumers cannot take it that way. A Turbopack loader runs
 * one module at a time and cannot compile the project's CSS, and a jest run
 * has no bundler at all; both import a real file under `.csszyx` instead, from
 * every module that calls `szcn`.
 *
 * Whoever settles the table writes the file: a bundler build, once every
 * module is transformed, and `csszyx next prebuild` or `csszyx next watch`,
 * which see the whole Next project and its design system. The content is the
 * same module the bundlers embed, with nothing left to fill in.
 *
 * The file changes only when its content does: Turbopack re-runs every module
 * that imports it when it changes, and jest keys its cache on it.
 *
 * @module
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineMergeTable } from '@csszyx/compiler';
import { insertAfterUseDirective } from './directive-prologue.js';
import {
    createMergeSignatureTable,
    ENGINE_MERGE_TABLE_FORMAT,
    type MergeOverride,
    type MergeSignatureTable,
    tableOverrideRemovesFrom,
    tableRemovesFrom,
} from './merge-signature.js';
import type { ProjectStyleModel } from './project-style-model.js';
import { themeGroupsSpecifier } from './theme-groups-file.js';
import { unservedAuthoredClasses } from './unserved-classes.js';
import { createUnservedRuntimeModule } from './virtual-modules.js';

/**
 * File name of the settled module, under the project's `.csszyx` directory.
 *
 * Not `unserved-runtime.mjs`: the webpack lane writes that one, with
 * placeholders its `processAssets` fills in over the emitted assets, and
 * `next dev --webpack` and `next dev --turbo` share one `.csszyx`.
 */
export const MERGE_REGISTRATION_FILE = 'merge-registration.mjs';

/**
 * The CommonJS twin. jest in its default mode transforms no `.mjs` and cannot
 * require an ES module, so a suite imports this one; both register the same
 * data.
 */
export const MERGE_REGISTRATION_CJS_FILE = 'merge-registration.cjs';

/**
 * The same table as JSON, for the Turbopack loader's engine pass.
 *
 * The loader cannot compile the project's CSS, so it cannot tell which class a
 * later `sz` key covers; it reads the rows for its module's classes from here.
 * JSON, not the module: the loader reads it, it does not import it.
 */
export const MERGE_TABLE_FILE = 'merge-table.json';

/**
 * Where the table the loader reads lives for a project.
 *
 * @param root - The project root.
 * @returns Absolute path of the JSON file.
 */
export function mergeTablePath(root: string): string {
    return path.join(root, '.csszyx', MERGE_TABLE_FILE);
}

/**
 * The JSON the loader reads, in the format this plugin hands the engine.
 *
 * @param table - The settled merge table.
 * @returns The file's text.
 */
function mergeTableJson(table: MergeSignatureTable): string {
    const [signatures, coverage] = table;
    return `${JSON.stringify({ format: ENGINE_MERGE_TABLE_FORMAT, signatures, coverage })}\n`;
}

/**
 * Where the settled module lives for a project.
 *
 * @param root - The project root.
 * @param format - Which of the two twins.
 * @returns Absolute path of the module.
 */
export function mergeRegistrationPath(root: string, format: 'esm' | 'cjs' = 'esm'): string {
    return path.join(
        root,
        '.csszyx',
        format === 'esm' ? MERGE_REGISTRATION_FILE : MERGE_REGISTRATION_CJS_FILE,
    );
}

/** What a Next command knows about the project when it writes the module. */
export interface MergeRegistrationInput {
    /** The project root. */
    root: string;
    /** The compiled design system, or null when no stylesheet gave one. */
    model: ProjectStyleModel | null;
    /** Classes lowering emitted across the project. */
    classes: Iterable<string>;
    /** Class names written in `className` attributes across the project. */
    authoredClasses: Iterable<string>;
    /** String literals written inside `szcn(...)` calls across the project. */
    mergeLiterals: Iterable<string>;
}

/**
 * Write the settled module for a project from its census, when its content
 * changed.
 *
 * O(c) signature lookups for c distinct classes, then the quadratic coverage
 * pass of `createMergeSignatureTable` over the distinct signatures.
 *
 * @param input - The project's classes and design system.
 * @returns Where the module lives, and whether this call rewrote it.
 */
export function writeMergeRegistration(input: MergeRegistrationInput): {
    path: string;
    changed: boolean;
} {
    const { unserved, table } = settle(input);
    return writeMergeRegistrationModule(input.root, unserved, table);
}

/**
 * Write the settled module and its CommonJS twin for a project, when they
 * changed.
 *
 * @param root - The project root.
 * @param unserved - The names the design system serves nothing for.
 * @param table - The settled merge table.
 * @returns Where the ES module lives, and whether this call rewrote either.
 */
export function writeMergeRegistrationModule(
    root: string,
    unserved: readonly string[],
    table: MergeSignatureTable,
): { path: string; changed: boolean } {
    const esm = writeWhenChanged(
        mergeRegistrationPath(root, 'esm'),
        createUnservedRuntimeModule(unserved, table, 'esm'),
    );
    const cjs = writeWhenChanged(
        mergeRegistrationPath(root, 'cjs'),
        createUnservedRuntimeModule(unserved, table, 'cjs'),
    );
    const json = writeWhenChanged(mergeTablePath(root), mergeTableJson(table));
    return { path: mergeRegistrationPath(root, 'esm'), changed: esm || cjs || json };
}

/**
 * Write a file when its content differs from what is on disk.
 *
 * @param target - Absolute path.
 * @param content - The text it should hold.
 * @returns Whether the file was rewritten.
 */
function writeWhenChanged(target: string, content: string): boolean {
    if (readText(target) === content) return false;
    mkdirSync(path.dirname(target), { recursive: true });
    // Written then renamed: Next compiles the server and the client in parallel
    // over one project directory, and a plain write would truncate the file
    // while the other compiler reads it.
    const staging = `${target}.${process.pid}.tmp`;
    writeFileSync(staging, content, 'utf8');
    renameSync(staging, target);
    return true;
}

/**
 * Whether a module can call `szcn`, so it is the one that imports the module.
 *
 * The compiler flags the calls it rewrote; a module that only merges, with no
 * `sz` of its own, is not transformed at all and is found by text.
 *
 * @param source - The module's source.
 * @param usage - What the compiler saw in it.
 * @param usage.usesSzcn - Whether it rewrote a call.
 * @returns True when the module can call `szcn`.
 */
export function callsSzcn(source: string, usage: { usesSzcn?: boolean }): boolean {
    return usage.usesSzcn === true || /\bszcn\s*\(/.test(source);
}

/**
 * The csszyx runtime's specifier, through any of its entries, quoted.
 *
 * Linear: a fixed prefix, one optional segment of word characters, a quote.
 */
const RUNTIME_SPECIFIER_RE = /['"](?:csszyx|@csszyx\/runtime)(?:\/[\w-]+)?['"]/g;

/**
 * Whether a module loads the csszyx runtime, so it is the one that imports
 * the settled module.
 *
 * Not "calls `szcn`": a `cn` helper that re-exports `szcn` under another name
 * is the only module that names it, and its callers write `cn(...)`. Every
 * caller reaches `szcn` through a module that loads the runtime, and one
 * registration there reaches them all, since the runtime keeps one table.
 *
 * @param code - The module's code, transformed, so the imports the compiler
 *        injected are seen too.
 * @returns True when the module imports the runtime.
 */
export function loadsCsszyxRuntime(code: string): boolean {
    for (const match of code.matchAll(RUNTIME_SPECIFIER_RE)) {
        // What stands before the specifier: `from` in an import or re-export,
        // `require(` in CommonJS. A string that merely spells the name is data.
        const before = code.slice(Math.max(0, match.index - 12), match.index).trimEnd();
        if (before.endsWith('from') || before.endsWith('require(')) return true;
    }
    return false;
}

/**
 * Import the settled module from a module that merges, when a build wrote it.
 *
 * The import goes after any `use client` directive, which must stay first.
 * Nothing is imported before a build has written the file: the module is
 * then the same as before this existed, and `szcn` keeps every class.
 *
 * @param code - The module's code, transformed.
 * @param fromFile - Absolute path of the module.
 * @param root - The project root.
 * @param format - Which twin: `cjs` for a jest that cannot load ES modules.
 * @returns The code, and the file it imports or null.
 */
export function importMergeRegistration(
    code: string,
    fromFile: string,
    root: string,
    format: 'esm' | 'cjs' = 'esm',
): { code: string; file: string | null } {
    const file = mergeRegistrationPath(root, format);
    if (!existsSync(file)) return { code, file: null };
    return {
        code: insertAfterUseDirective(code, `import '${themeGroupsSpecifier(fromFile, file)}';\n`),
        file,
    };
}

/**
 * Make sure the settled module exists, writing an empty one only if none does.
 *
 * `csszyx next watch` writes the table after its first full prebuild, and
 * Turbopack compiles pages meanwhile. A page that imported nothing then would
 * never re-run when the table appears; one that imports this file and
 * depends on it re-runs when the watch writes it. The write is exclusive, so
 * it never replaces a table a Next command wrote first.
 * One exclusive create attempt, with constant empty-module bytes; the loader
 * pays the filesystem calls even when another writer already owns the file.
 *
 * @param root - The project root.
 */
export function ensureMergeRegistration(root: string): void {
    const target = mergeRegistrationPath(root, 'esm');
    try {
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, createUnservedRuntimeModule([], [{}, []], 'esm'), {
            encoding: 'utf8',
            flag: 'wx',
        });
    } catch {
        // Written by a Next command in between, or not writable: either way
        // the import below reads what is there, or nothing, as before.
    }
}

/**
 * Make sure the table the loader reads exists, writing an empty one only if
 * none does.
 *
 * The same reason as {@link ensureMergeRegistration}: a module lowered before
 * `csszyx next watch` has written the table depends on this file, so the
 * write re-runs it. The write is exclusive and never replaces a table.
 *
 * @param root - The project root.
 */
export function ensureMergeTable(root: string): void {
    const target = mergeTablePath(root);
    try {
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, mergeTableJson([{}, []]), { encoding: 'utf8', flag: 'wx' });
    } catch {
        // Written by a Next command in between, or not writable.
    }
}

/**
 * The rows of the settled table that one module's lists can use.
 *
 * Only the signatures are narrowed: the coverage rows are indexed by id, and
 * the engine ignores a row no class of the module maps to. After reading and
 * parsing the table, groups of lengths `nᵢ`, `c` total classes, and longest row
 * `r` cost `O(c + Σ nᵢ² · (1 + r))` worst-case time: checking whether a group
 * merges scans earlier classes and performs a linear coverage-row lookup.
 *
 * @param root - The project root.
 * @param groups - The class lists a merge would read, from a pass without a
 *        table.
 * @param overrides - Each static class name and the `sz` classes beside it.
 * @returns The table to hand the engine, or null when merging no list would
 *          remove a class, or no readable table exists.
 */
export function mergeTableFor(
    root: string,
    groups: ReadonlyArray<readonly string[]>,
    overrides: readonly MergeOverride[] = [],
): EngineMergeTable | null {
    if (groups.length === 0 && overrides.length === 0) return null;
    const text = readText(mergeTablePath(root));
    if (text === null) return null;
    let table: EngineMergeTable;
    try {
        table = JSON.parse(text) as EngineMergeTable;
    } catch {
        return null;
    }
    if (typeof table?.signatures !== 'object' || !Array.isArray(table.coverage)) return null;
    const removes =
        groups.some(group => tableRemovesFrom(table.signatures, table.coverage, group)) ||
        overrides.some(pair =>
            tableOverrideRemovesFrom(table.signatures, table.coverage, pair.base, pair.over),
        );
    if (!removes) return null;
    const signatures: Record<string, number> = {};
    const classes = [...groups.flat(), ...overrides.flatMap(pair => [...pair.base, ...pair.over])];
    for (const className of new Set(classes)) {
        const id: unknown = table.signatures[className];
        if (typeof id === 'number') signatures[className] = id;
    }
    return { format: table.format, signatures, coverage: table.coverage };
}

/**
 * What a project registers, from its census and design system.
 *
 * @param input - The project's classes and design system.
 * @returns The unserved names and the merge table.
 */
function settle(input: MergeRegistrationInput): {
    unserved: string[];
    table: MergeSignatureTable;
} {
    const { model } = input;
    // No design system is no answer. Registering nothing is right: every class
    // keeps the placement it has today, and every merge keeps both sides.
    const facts = model?.facts ?? null;
    if (model === null || facts === null) return { unserved: [], table: [{}, []] };
    const authored = new Set(input.authoredClasses);
    // Tailwind's own scan as well as the shards' census, as the bundler lanes do.
    const table = createMergeSignatureTable(
        [...input.classes, ...authored, ...input.mergeLiterals, ...model.candidates()],
        candidate => model.mergeSignature(candidate),
    );
    const unserved =
        authored.size === 0
            ? []
            : unservedAuthoredClasses(authored, classes => model.unserved(classes), facts.prefix);
    return { unserved, table };
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
