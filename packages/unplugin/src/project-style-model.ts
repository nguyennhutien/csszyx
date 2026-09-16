/**
 * One compiled view of the project's own stylesheets.
 *
 * The build asks the same CSS three things: which classes this project's
 * Tailwind serves, what each one sets, and what the `@import "tailwindcss"`
 * line settled for all of them — a prefix renames every utility, `important`
 * forces every declaration. Two independent paths grew for those answers: a
 * regex scan over `@theme` blocks, and the design system Tailwind itself
 * compiles. Only the second sees a theme shipped inside a package, a `@plugin`
 * or a `@config`, so a feature wired to the first misses them without saying
 * so.
 *
 * This module is the one path. It compiles each entry stylesheet once and
 * answers from those compiles; `.agent/flows/css-design-system-pipeline.md`
 * carries the map, and `tests/css-reading-entry-points.test.ts` fails when a
 * new caller opens a second one.
 *
 * @module
 */
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
    createEmittedClassOracle,
    type OracleSkipKind,
    readStylesheetRole,
    type StylesheetAlias,
    type StylesheetFacts,
} from '@csszyx/tailwind-oracle';

/** What one stylesheet is to the project. */
export type StyleEntryRole =
    /** Generates utilities and no other root imports it: it decides the facts. */
    | 'root'
    /** Another root imports it, so that root's compile already includes it. */
    | 'imported'
    /** Generates no utilities: a theme, a partial, or plain CSS. */
    | 'not-root'
    /** Could not be compiled, and no root that did compile imports it. */
    | 'failed';

/** One stylesheet the build handed over, and what the model made of it. */
export interface StyleEntry {
    /** The stylesheet path as the caller gave it. */
    file: string;
    /** What it is to the project. */
    role: StyleEntryRole;
    /** What its `@import "tailwindcss"` line settled, for a root. */
    facts?: StylesheetFacts;
    /** Why it could not be compiled, for a failed entry. */
    failure?: { kind: OracleSkipKind; reason: string; reachedTailwind?: boolean };
}

/** What the project's stylesheets say, from one compile of each root. */
export interface ProjectStyleModel {
    /** Every stylesheet handed over, in the order given. */
    entries: readonly StyleEntry[];
    /**
     * What the `@import "tailwindcss"` line settled for every class, or null
     * when no root compiled.
     *
     * Reported only when every root agrees. A project whose roots disagree has
     * no answer that is true of all of it, and guessing one would rename
     * classes for half the build.
     */
    facts: StylesheetFacts | null;
    /**
     * Which of these classes produce no CSS anywhere in the project.
     *
     * A class counts as unserved only when EVERY root agrees it is — one
     * stylesheet serving it is enough for the project to serve it. Empty when
     * no root compiled: there is nothing to ask.
     *
     * @param classes - Class names, without variants.
     * @returns The subset that styles nothing, in the given order.
     */
    unserved(classes: readonly string[]): string[];
}

/**
 * What the build must say when the project's Tailwind is configured in a way
 * csszyx does not emit for yet.
 *
 * `important` makes every declaration `!important`, so a `sz` class loses to the
 * library class it is meant to override: a green build whose overrides silently
 * lose, with nothing in the log to search for. A prefix is not on this list —
 * the build reads it and the engine writes it before every class.
 *
 * @param facts - What the project's import line settled.
 * @returns The message, or null when nothing is unsupported.
 */
export function unsupportedStylesheetFactsMessage(facts: StylesheetFacts): string | null {
    if (!facts.important) return null;
    return (
        '[csszyx] your Tailwind entry sets important, which csszyx does not emit for yet: every utility is `!important`, so a class csszyx emits cannot override one the project already applies.\n' +
        '  help: drop important from the `@import "tailwindcss"` line, or keep it and style those elements with `className` until csszyx supports it.'
    );
}

/**
 * What stops the build when the project's stylesheets give no single answer.
 *
 * @param model - The opened style model.
 * @param root - Project root, so the message names files the way the author does.
 * @returns The message, or null when the stylesheets agree.
 */
export function styleModelError(model: ProjectStyleModel, root: string): string | null {
    // First: a broken entry leaves the facts of the others unreliable, so a
    // disagreement between those is not the thing to fix.
    const broken = failedStylesheets(model, root, true);
    if (broken.length > 0) {
        return [
            '[csszyx] stylesheets that reach Tailwind did not compile, so csszyx cannot read the prefix its classes need:',
            ...broken,
            '  help: fix the stylesheet; if this build does not load it, list the stylesheets it does load in the csszyx `tailwindStylesheet` option.',
            '  note: no module was transformed; without the prefix every emitted class could style nothing.',
        ].join('\n');
    }
    const roots: Array<{ file: string; facts: StylesheetFacts }> = [];
    for (const entry of model.entries) {
        // Only a root decides: one another root imports is served by that
        // root's import line, and everything else generates no utility.
        if (entry.role === 'root' && entry.facts !== undefined) {
            roots.push({ file: entry.file, facts: entry.facts });
        }
    }
    // `important` is left out on purpose: it forces declarations, it renames
    // no class, so a disagreement over it cannot make one of them dead.
    if (new Set(roots.map(entry => entry.facts.prefix)).size <= 1) return null;
    const named = roots.map(entry => ({
        file: relativeName(root, entry.file),
        prefix: entry.facts.prefix === null ? 'no prefix' : `prefix(${entry.facts.prefix})`,
    }));
    const width = Math.max(...named.map(entry => entry.file.length));
    return [
        '[csszyx] your Tailwind entries set different prefixes, so no class name csszyx emits can be served by all of them:',
        ...named.map(entry => `  ${entry.file.padEnd(width)}   ${entry.prefix}`),
        '  help: give every entry the same `@import "tailwindcss"` line, or list the stylesheets this build loads in the csszyx `tailwindStylesheet` option.',
        '  note: the build stopped before transforming any module; nothing was written.',
    ].join('\n');
}

/**
 * What the build should say, without stopping, about stylesheets it could not
 * read.
 *
 * @param model - The opened style model.
 * @param root - Project root, so the message names files the way the author does.
 * @returns The message, or null when there is nothing to say.
 */
export function styleModelWarning(model: ProjectStyleModel, root: string): string | null {
    const skipped = failedStylesheets(model, root, false);
    if (skipped.length === 0) return null;
    return [
        '[csszyx] these stylesheets did not compile and never reached Tailwind, so csszyx read the prefix without them:',
        ...skipped,
        '  help: if the app loads one of them, fix its import; otherwise list the stylesheets the app loads in the csszyx `tailwindStylesheet` option.',
    ].join('\n');
}

/**
 * The stylesheets that did not compile, split by whether they reached Tailwind.
 *
 * An `environment` skip is left out: with no Tailwind 4 to ask there is no
 * prefix to lose, and a project that does not build with Tailwind must not
 * hear about it.
 *
 * @param model - The opened style model.
 * @param root - Project root, for the names.
 * @param reachedTailwind - Which half to return.
 * @returns One indented `file: reason` line per stylesheet.
 */
function failedStylesheets(
    model: ProjectStyleModel,
    root: string,
    reachedTailwind: boolean,
): string[] {
    const lines: string[] = [];
    for (const entry of model.entries) {
        const failure = entry.failure;
        if (
            failure?.kind !== 'stylesheet' ||
            (failure.reachedTailwind === true) !== reachedTailwind
        ) {
            continue;
        }
        // The oracle's reason restates what the heading already says, and a
        // resolver appends a require stack no author needs to read here.
        const [first = ''] = failure.reason
            .replace(/^the stylesheet did not compile: /, '')
            .split('\n');
        lines.push(`  ${relativeName(root, entry.file)}: ${first}`);
    }
    return lines;
}

/**
 * A stylesheet path the way the author writes it: relative, with forward slashes.
 *
 * @param root - Project root.
 * @param file - Absolute stylesheet path.
 * @returns The relative name.
 */
function relativeName(root: string, file: string): string {
    return path.relative(root, file).split(path.sep).join('/');
}

/**
 * What stops the build when `tailwindStylesheet` names a file that is not there.
 *
 * A mistyped path would otherwise leave nothing to read the prefix from.
 *
 * @param missing - The listed paths that do not exist, as the author wrote them.
 * @param root - The project root they were resolved against.
 * @returns The message.
 */
export function missingTailwindStylesheetMessage(missing: readonly string[], root: string): string {
    return (
        `[csszyx] the csszyx \`tailwindStylesheet\` option lists stylesheets that are not there: ${missing.join(', ')} (relative to ${root}).\n` +
        '  help: list the stylesheet that imports Tailwind for this build, relative to the project root.'
    );
}

/** One entry's compiled answers. */
interface CompiledEntry {
    facts: StylesheetFacts;
    findDead(classes: readonly string[]): string[];
}

/**
 * The facts every entry agrees on.
 *
 * Taking the first entry apart from the rest makes "at least one" part of the
 * signature, so there is no empty case to invent a default for.
 *
 * @param first - One compiled entry.
 * @param rest - The other compiled entries, possibly none.
 * @returns The shared facts, with a disagreement reported as the default.
 */
function agreedFacts(first: CompiledEntry, rest: readonly CompiledEntry[]): StylesheetFacts {
    const { facts } = first;
    return {
        prefix: rest.every(entry => entry.facts.prefix === facts.prefix) ? facts.prefix : null,
        important: rest.every(entry => entry.facts.important === facts.important)
            ? facts.important
            : false,
    };
}

/** Text a stylesheet must contain to reach Tailwind at all: an import or a directive. */
const MAY_REACH_TAILWIND = /@(?:import|tailwind)\b/;

/**
 * Whether a stylesheet could reach Tailwind, read from its text alone.
 *
 * A stylesheet without an `@import` or an `@tailwind` directive cannot, so a
 * caller that has only such stylesheets knows there is no prefix without
 * compiling anything.
 *
 * @param css - Stylesheet text.
 * @returns False only when the stylesheet cannot reach Tailwind.
 */
export function mayReachTailwind(css: string): boolean {
    return MAY_REACH_TAILWIND.test(css);
}

/**
 * The path a stylesheet resolves to on disk, so one reached through a symlink
 * and one named directly compare equal.
 *
 * @param file - Stylesheet path.
 * @returns The real path, or the path itself when it cannot be resolved.
 */
function realPath(file: string): string {
    try {
        return realpathSync(file);
    } catch {
        return file;
    }
}

/** What one stylesheet is before any root is compiled. */
type ClassifiedStylesheet =
    | { role: 'not-root' }
    | { role: 'failed'; failure: NonNullable<StyleEntry['failure']> }
    | { role: 'root'; css: string; imports: readonly string[] };

/**
 * Read one stylesheet and decide whether it is a root, from its text and a
 * compile that reports features only.
 *
 * @param file - Stylesheet path.
 * @param resolveFrom - Project directory whose `package.json` anchors resolution.
 * @param aliases - The bundler's aliases, tsconfig paths included.
 * @returns What the stylesheet is, with the text and imports of a root.
 */
async function classifyStylesheet(
    file: string,
    resolveFrom: string,
    aliases: readonly StylesheetAlias[],
): Promise<ClassifiedStylesheet> {
    let css: string;
    try {
        css = await readFile(file, 'utf8');
    } catch {
        // A stylesheet that cannot be read cannot be an entry point.
        return { role: 'not-root' };
    }
    if (!mayReachTailwind(css)) return { role: 'not-root' };
    const role = await readStylesheetRole({
        resolveFrom,
        css,
        cssBase: path.dirname(file),
        aliases,
    });
    if (!role.ok) {
        return {
            role: 'failed',
            failure: {
                kind: role.kind,
                reason: role.reason,
                reachedTailwind: role.reachedTailwind,
            },
        };
    }
    return role.utilities ? { role: 'root', css, imports: role.imports } : { role: 'not-root' };
}

/** Every stylesheet classified, with where its roots and failures sit. */
interface ClassifiedStylesheets {
    /** One entry per stylesheet, in the order given; roots not compiled yet. */
    entries: StyleEntry[];
    /** Each root's index in `entries`, with its text. */
    roots: Array<{ index: number; css: string }>;
    /** The index in `entries` of each stylesheet that did not compile. */
    failed: number[];
    /** Real paths of every stylesheet a root imports. */
    importedByRoots: Set<string>;
}

/**
 * Classify every stylesheet the caller walked.
 *
 * @param cssFiles - Stylesheet paths the caller already walked.
 * @param resolveFrom - Project directory whose `package.json` anchors resolution.
 * @param aliases - The bundler's aliases, tsconfig paths included.
 * @returns The entries, and where the roots and failures among them are.
 */
async function classifyStylesheets(
    cssFiles: readonly string[],
    resolveFrom: string,
    aliases: readonly StylesheetAlias[],
): Promise<ClassifiedStylesheets> {
    const classified: ClassifiedStylesheets = {
        entries: [],
        roots: [],
        failed: [],
        importedByRoots: new Set<string>(),
    };
    for (const file of cssFiles) {
        const stylesheet = await classifyStylesheet(file, resolveFrom, aliases);
        if (stylesheet.role === 'root') {
            const index = classified.entries.push({ file, role: 'root' }) - 1;
            classified.roots.push({ index, css: stylesheet.css });
            for (const imported of stylesheet.imports) {
                classified.importedByRoots.add(realPath(imported));
            }
        } else if (stylesheet.role === 'failed') {
            const index =
                classified.entries.push({ file, role: 'failed', failure: stylesheet.failure }) - 1;
            classified.failed.push(index);
        } else {
            classified.entries.push({ file, role: 'not-root' });
        }
    }
    return classified;
}

/**
 * Build the design system for one root nothing else imports.
 *
 * @param file - Stylesheet path.
 * @param css - Its text.
 * @param resolveFrom - Project directory whose `package.json` anchors resolution.
 * @param aliases - The bundler's aliases, tsconfig paths included.
 * @returns The root's entry, and its compiled answers unless it failed.
 */
async function compileRoot(
    file: string,
    css: string,
    resolveFrom: string,
    aliases: readonly StylesheetAlias[],
): Promise<{ entry: StyleEntry; compiled: CompiledEntry | null }> {
    const oracle = await createEmittedClassOracle({
        resolveFrom,
        css,
        cssBase: path.dirname(file),
        aliases,
    });
    if (!oracle.ok) {
        return {
            entry: {
                file,
                role: 'failed',
                // It compiled as a root a moment ago, so it had reached Tailwind.
                failure: { kind: oracle.kind, reason: oracle.reason, reachedTailwind: true },
            },
            compiled: null,
        };
    }
    return {
        entry: { file, role: 'root', facts: oracle.facts },
        compiled: { facts: oracle.facts, findDead: classes => oracle.findDead(classes) },
    };
}

/**
 * Compile the project's stylesheets and answer from its roots.
 *
 * The caller has already walked the project for stylesheets, so the list is
 * handed over rather than globbed again — measured at 1 ms for one app against
 * 96 ms at the root of this monorepo, and the gap widens with the tree.
 *
 * A root is a stylesheet whose compile generates utilities, the rule
 * Tailwind's own bundler integrations use: an entry that reaches Tailwind
 * through a package stylesheet counts, a commented-out import and a
 * theme-only file do not. A root another root imports has no say of its own,
 * because Tailwind serves what the importing line settled.
 *
 * @param resolveFrom - Project directory whose `package.json` anchors resolution.
 * @param cssFiles - Stylesheet paths the caller already walked.
 * @param aliases - The bundler's aliases, tsconfig paths included, so an
 *        `@import` written the way the app's own code imports resolves.
 * @returns The model, with every stylesheet accounted for.
 */
export async function openProjectStyleModel(
    resolveFrom: string,
    cssFiles: readonly string[],
    aliases: readonly StylesheetAlias[] = [],
): Promise<ProjectStyleModel> {
    const { entries, roots, failed, importedByRoots } = await classifyStylesheets(
        cssFiles,
        resolveFrom,
        aliases,
    );

    const compiled: CompiledEntry[] = [];
    for (const { index, css } of roots) {
        const { file } = entries[index] as StyleEntry;
        if (importedByRoots.has(realPath(file))) {
            entries[index] = { file, role: 'imported' };
            continue;
        }
        const root = await compileRoot(file, css, resolveFrom, aliases);
        entries[index] = root.entry;
        if (root.compiled !== null) compiled.push(root.compiled);
    }
    // A partial that fails on its own compiles as part of the root that imports
    // it, which is how the build reads it.
    for (const index of failed) {
        const { file } = entries[index] as StyleEntry;
        if (importedByRoots.has(realPath(file))) entries[index] = { file, role: 'imported' };
    }

    const [first, ...rest] = compiled;
    return {
        entries,
        facts: first === undefined ? null : agreedFacts(first, rest),
        unserved(classes) {
            if (compiled.length === 0) return [];
            const perEntry = compiled.map(entry => new Set(entry.findDead(classes)));
            return classes.filter(token => perEntry.every(dead => dead.has(token)));
        },
    };
}
