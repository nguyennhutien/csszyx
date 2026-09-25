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
    type ClassHooks,
    type ClassOrigin,
    collectClassHooks,
    createEmittedClassOracle,
    isHook,
    loadCandidateScanner,
    noClassHooks,
    type OracleSkipKind,
    readStylesheetRole,
    type ScanSource,
    type StylesheetAlias,
    type StylesheetFacts,
    type TailwindLoader,
} from '@csszyx/tailwind-oracle';
import { type MergeSignature, mergeSignatureFromCss } from './merge-signature.js';
import { isMonorepoPackage } from './monorepo.js';
import { sortStrings } from './sort.js';

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
    /**
     * Why a compiled root cannot tell Tailwind's own classes from the
     * project's. Every class then keeps its place in a merge.
     */
    originFailure?: string;
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
     * Real paths of every stylesheet a root imports, Tailwind's own included.
     * One of them can set the prefix, so an edit to it can change the facts.
     */
    imports: readonly string[];
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
    /**
     * Merge signature agreed by every compiled root.
     *
     * @param candidate - Tailwind candidate class.
     * @returns The shared signature, or null when missing or disputed.
     */
    signature(candidate: string): MergeSignature | null;
    /**
     * The signature a merge reads: {@link ProjectStyleModel.signature}, for a
     * class every root reads as Tailwind's own utility and no project rule
     * selects on. Null for the rest, so a class from `@utility`, a plugin or
     * plain CSS is never removed and never removes another.
     *
     * @param candidate - Tailwind candidate class.
     * @returns The signature a merge may use, or null.
     */
    mergeSignature(candidate: string): MergeSignature | null;
    /**
     * The class names the project's Tailwind finds in its sources.
     *
     * @returns Candidates, sorted; empty when no scanner could be loaded.
     */
    candidates(): string[];
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

/** What a message calls the setting that names the stylesheets an app loads, by default. */
export const TAILWIND_STYLESHEET_OPTION = 'the csszyx `tailwindStylesheet` option';

/**
 * What stops the build when the project's stylesheets give no single answer.
 *
 * @param model - The opened style model.
 * @param root - Project root, so the message names files the way the author does.
 * @param setting - What the help calls the setting that names the stylesheets:
 *        a command-line lane takes a flag where a bundler takes an option.
 * @param ignoreSetting - What the help calls the setting that leaves a
 *        directory out, on a lane that has one; other lanes are not told of it.
 * @returns The message, or null when the stylesheets agree.
 */
export function styleModelError(
    model: ProjectStyleModel,
    root: string,
    setting: string = TAILWIND_STYLESHEET_OPTION,
    ignoreSetting?: string,
): string | null {
    // First: a broken entry leaves the facts of the others unreliable, so a
    // disagreement between those is not the thing to fix.
    const broken = failedStylesheets(model, root, true);
    if (broken.length > 0) {
        return [
            '[csszyx] stylesheets that reach Tailwind did not compile, so csszyx cannot read the prefix its classes need:',
            ...broken,
            `  help: fix the stylesheet; if this build does not load it, list the stylesheets it does load in ${setting}.`,
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
        ignoreSetting === undefined
            ? `  help: give every entry the same \`@import "tailwindcss"\` line, or list the stylesheets this build loads in ${setting}.`
            : `  help: give every entry the same \`@import "tailwindcss"\` line, list the stylesheets this build loads in ${setting}, or leave another app's directory out with ${ignoreSetting}.`,
        '  note: the build stopped before transforming any module; nothing was written.',
    ].join('\n');
}

/**
 * What the build should say, without stopping, about stylesheets it could not
 * read.
 *
 * @param model - The opened style model.
 * @param root - Project root, so the message names files the way the author does.
 * @param setting - What the help calls the setting that names the stylesheets.
 * @returns The message, or null when there is nothing to say.
 */
export function styleModelWarning(
    model: ProjectStyleModel,
    root: string,
    setting: string = TAILWIND_STYLESHEET_OPTION,
): string | null {
    const skipped = failedStylesheets(model, root, false);
    if (skipped.length === 0) return null;
    return [
        '[csszyx] these stylesheets did not compile and never reached Tailwind, so csszyx read the prefix without them:',
        ...skipped,
        `  help: if the app loads one of them, fix its import; otherwise list the stylesheets the app loads in ${setting}.`,
    ].join('\n');
}

/**
 * What the build must say when a root cannot tell Tailwind's own classes from
 * the project's: no class is merged then, which changes output silently.
 *
 * Said in every mode, production included, since what it reports is the
 * build's output and not a style nudge.
 *
 * @param model - The opened style model.
 * @param root - Project root, so the message names files the way the author does.
 * @returns The message, or null when every root can tell.
 */
export function originWarning(model: ProjectStyleModel, root: string): string | null {
    const failed = model.entries.filter(entry => entry.originFailure !== undefined);
    if (failed.length === 0) return null;
    return [
        ...failed.map(
            entry =>
                `[csszyx] csszyx merges no class in this build: ${relativeName(root, entry.file)} did not compile with its \`@utility\` blocks and plugin classes taken out (${entry.originFailure}).`,
        ),
        '  help: report it at https://github.com/nguyennhutien/csszyx/issues with the plugin or `@utility` block the stylesheet uses.',
        '  note: every class is kept: `{ pb: 2, p: 4 }` emits `pb-2 p-4`, a `className` class stays next to the `sz` classes, and `szcn` removes only exact repeats.',
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
 * @param setting - What the message calls the setting that listed them.
 * @returns The message.
 */
export function missingTailwindStylesheetMessage(
    missing: readonly string[],
    root: string,
    setting: string = TAILWIND_STYLESHEET_OPTION,
): string {
    return (
        `[csszyx] ${setting} lists stylesheets that are not there: ${missing.join(', ')} (relative to ${root}).\n` +
        '  help: list the stylesheet that imports Tailwind for this build, relative to the project root.'
    );
}

/** One entry's compiled answers. */
interface CompiledEntry {
    facts: StylesheetFacts;
    findDead(classes: readonly string[]): string[];
    signature(candidate: string): MergeSignature | null;
    /** Null when this root cannot tell. */
    origin(candidate: string): ClassOrigin | null;
}

/**
 * The project facts selected from every compiled entry.
 *
 * Taking the first entry apart from the rest makes "at least one" part of the
 * signature, so there is no empty case to invent a default for.
 * Prefix is a shared vocabulary and is retained only when every entry agrees.
 * Forced important is a hazard, so one entry enabling it is enough to retain
 * it for the existing unsupported-configuration warning.
 *
 * For R roots this performs O(R) comparisons in one pass and stores O(1)
 * aggregation state. Build startup pays the cost when opening the style model.
 *
 * @param first - One compiled entry.
 * @param rest - The other compiled entries, possibly none.
 * @returns The agreed prefix and whether any entry forces important.
 */
function agreedFacts(first: CompiledEntry, rest: readonly CompiledEntry[]): StylesheetFacts {
    const { facts } = first;
    let prefixAgrees = true;
    let important = facts.important;

    for (const entry of rest) {
        if (entry.facts.prefix !== facts.prefix) prefixAgrees = false;
        if (entry.facts.important) important = true;
    }

    return {
        prefix: prefixAgrees ? facts.prefix : null,
        important,
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
    /** With the classes its rules select on, which a merge must keep. */
    | { role: 'not-root'; hooks: ClassHooks }
    | { role: 'failed'; failure: NonNullable<StyleEntry['failure']>; hooks: ClassHooks }
    | { role: 'root'; css: string; imports: readonly string[]; scanSources: ScanSource[] };

/** How to reach the project's Tailwind: where to resolve from, and with what. */
interface CompileContext {
    /** Project directory whose `package.json` anchors resolution. */
    resolveFrom: string;
    /** The bundler's aliases, tsconfig paths included. */
    aliases: readonly StylesheetAlias[];
    /** Resolver override, for tests; the project's own Tailwind otherwise. */
    loadTailwind: TailwindLoader | undefined;
}

/**
 * What one stylesheet's rules select on.
 *
 * @param css - Stylesheet text.
 * @returns Its hooks.
 */
function hooksOf(css: string): ClassHooks {
    const hooks = noClassHooks();
    collectClassHooks(css, hooks);
    return hooks;
}

/**
 * Add one stylesheet's hooks to the project's.
 *
 * @param into - The project's hooks.
 * @param from - One stylesheet's.
 */
function addHooks(into: ClassHooks, from: ClassHooks): void {
    for (const name of from.names) into.names.add(name);
    for (const matcher of from.attributes) into.attributes.push(matcher);
}

/**
 * Read one stylesheet and decide whether it is a root, from its text and a
 * compile that reports features only.
 *
 * @param file - Stylesheet path.
 * @param context - How to reach the project's Tailwind.
 * @returns What the stylesheet is, with the text and imports of a root.
 */
async function classifyStylesheet(
    file: string,
    context: CompileContext,
): Promise<ClassifiedStylesheet> {
    let css: string;
    try {
        css = await readFile(file, 'utf8');
    } catch {
        // A stylesheet that cannot be read cannot be an entry point.
        return { role: 'not-root', hooks: noClassHooks() };
    }
    if (!mayReachTailwind(css)) return { role: 'not-root', hooks: hooksOf(css) };
    const role = await readStylesheetRole(
        {
            resolveFrom: context.resolveFrom,
            css,
            cssBase: path.dirname(file),
            aliases: context.aliases,
        },
        context.loadTailwind,
    );
    if (!role.ok) {
        return {
            role: 'failed',
            failure: {
                kind: role.kind,
                reason: role.reason,
                reachedTailwind: role.reachedTailwind,
            },
            // The bundler may resolve what the oracle could not; its rules
            // select on the element all the same.
            hooks: hooksOf(css),
        };
    }
    return role.utilities
        ? { role: 'root', css, imports: role.imports, scanSources: role.scanSources }
        : { role: 'not-root', hooks: hooksOf(css) };
}

/** Every stylesheet classified, with where its roots and failures sit. */
interface ClassifiedStylesheets {
    /** One entry per stylesheet, in the order given; roots not compiled yet. */
    entries: StyleEntry[];
    /** Each root's index in `entries`, with its text. */
    roots: Array<{ index: number; css: string; scanSources: ScanSource[] }>;
    /** The index in `entries` of each stylesheet that did not compile. */
    failed: number[];
    /** Real paths of every stylesheet a root imports. */
    importedByRoots: Set<string>;
    /**
     * Classes the rules of every stylesheet no root compiles select on, one
     * that failed to compile included: CSS a component or page imports on its
     * own still selects on the element.
     */
    hooks: ClassHooks;
}

/** Two Tailwind compiles overlap without multiplying their peak memory unboundedly. */
const STYLESHEET_COMPILE_CONCURRENCY = 2;

/**
 * Apply an asynchronous operation with a fixed worker count and ordered results.
 *
 * For N items and C workers this performs O(N) scheduling work, retains O(N + C)
 * state, and shortens the independent I/O/compile critical path toward O(N / C).
 * Style-model startup and watch refresh pay this cost, so C stays deliberately
 * small while Tailwind compilation owns comparatively large transient state.
 *
 * @param items - Values to process in their caller-provided order.
 * @param concurrency - Maximum operations allowed to overlap.
 * @param operation - Independent asynchronous work for one value.
 * @returns Results in the same order as `items`, regardless of completion order.
 */
async function mapConcurrent<T, U>(
    items: readonly T[],
    concurrency: number,
    operation: (item: T) => Promise<U>,
): Promise<U[]> {
    const results = new Array<U>(items.length);
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await operation(items[index] as T);
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, async () => worker()),
    );
    return results;
}

/**
 * Classify every stylesheet the caller walked.
 *
 * @param cssFiles - Stylesheet paths the caller already walked.
 * @param context - How to reach the project's Tailwind.
 * @returns The entries, and where the roots and failures among them are.
 */
async function classifyStylesheets(
    cssFiles: readonly string[],
    context: CompileContext,
): Promise<ClassifiedStylesheets> {
    const classified: ClassifiedStylesheets = {
        entries: [],
        roots: [],
        failed: [],
        importedByRoots: new Set<string>(),
        hooks: noClassHooks(),
    };
    const stylesheets = await mapConcurrent(cssFiles, STYLESHEET_COMPILE_CONCURRENCY, async file =>
        classifyStylesheet(file, context),
    );
    for (const [candidateIndex, stylesheet] of stylesheets.entries()) {
        const file = cssFiles[candidateIndex] as string;
        if (stylesheet.role === 'root') {
            const index = classified.entries.push({ file, role: 'root' }) - 1;
            classified.roots.push({
                index,
                css: stylesheet.css,
                scanSources: stylesheet.scanSources,
            });
            for (const imported of stylesheet.imports) {
                classified.importedByRoots.add(realPath(imported));
            }
        } else if (stylesheet.role === 'failed') {
            const index =
                classified.entries.push({ file, role: 'failed', failure: stylesheet.failure }) - 1;
            classified.failed.push(index);
            addHooks(classified.hooks, stylesheet.hooks);
        } else {
            classified.entries.push({ file, role: 'not-root' });
            addHooks(classified.hooks, stylesheet.hooks);
        }
    }
    return classified;
}

/**
 * Build the design system for one root nothing else imports.
 *
 * @param file - Stylesheet path.
 * @param css - Its text.
 * @param context - How to reach the project's Tailwind.
 * @returns The root's entry, and its compiled answers unless it failed.
 */
async function compileRoot(
    file: string,
    css: string,
    context: CompileContext,
): Promise<{ entry: StyleEntry; compiled: CompiledEntry | null }> {
    const oracle = await createEmittedClassOracle(
        {
            resolveFrom: context.resolveFrom,
            css,
            cssBase: path.dirname(file),
            aliases: context.aliases,
        },
        context.loadTailwind,
    );
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
    const signatures = new Map<string, MergeSignature | null>();
    const origins = await oracle.loadOriginOracle();
    const originOf = new Map<string, ClassOrigin>();
    return {
        entry: origins.ok
            ? { file, role: 'root', facts: oracle.facts }
            : { file, role: 'root', facts: oracle.facts, originFailure: origins.reason },
        compiled: {
            facts: oracle.facts,
            findDead: classes => oracle.findDead(classes),
            origin(candidate) {
                if (!origins.ok) return null;
                let origin = originOf.get(candidate);
                if (origin === undefined) {
                    origin = origins.origin(candidate);
                    originOf.set(candidate, origin);
                }
                return origin;
            },
            signature(candidate) {
                if (!signatures.has(candidate)) {
                    signatures.set(
                        candidate,
                        mergeSignatureFromCss(candidate, oracle.cssFor([candidate])[0] ?? null),
                    );
                }
                return signatures.get(candidate) ?? null;
            },
        },
    };
}

/** How to open the style model beyond the stylesheets it compiles. */
export interface OpenStyleModelOptions {
    /**
     * The bundler's aliases, tsconfig paths included, so an `@import` written
     * the way the app's own code imports resolves.
     */
    aliases?: readonly StylesheetAlias[];
    /**
     * Stylesheets read only for the classes their rules select on: the ones a
     * named `tailwindStylesheet` list leaves out, which a component or page may
     * still import.
     */
    hookStylesheets?: readonly string[];
    /** Resolver override, for tests; the project's own Tailwind otherwise. */
    loadTailwind?: TailwindLoader;
}

/**
 * Read stylesheets the model does not compile for the classes their rules
 * select on.
 *
 * @param hooks - The project's hooks, added to.
 * @param files - The stylesheets.
 * @param compiled - Stylesheets the model already read; skipped.
 */
async function addHookStylesheets(
    hooks: ClassHooks,
    files: readonly string[],
    compiled: readonly string[],
): Promise<void> {
    const read = new Set(compiled);
    for (const file of files) {
        if (read.has(file)) continue;
        try {
            addHooks(hooks, hooksOf(await readFile(file, 'utf8')));
        } catch {
            // A stylesheet gone since the walk selects on nothing.
        }
    }
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
 * @param options - Aliases, stylesheets read for hooks only, and a resolver
 *        override.
 * @returns The model, with every stylesheet accounted for.
 */
export async function openProjectStyleModel(
    resolveFrom: string,
    cssFiles: readonly string[],
    options: OpenStyleModelOptions = {},
): Promise<ProjectStyleModel> {
    const context: CompileContext = {
        resolveFrom,
        aliases: options.aliases ?? [],
        loadTailwind: options.loadTailwind,
    };
    const { entries, roots, failed, importedByRoots, hooks } = await classifyStylesheets(
        cssFiles,
        context,
    );
    await addHookStylesheets(hooks, options.hookStylesheets ?? [], cssFiles);

    const selectedRoots: Array<{
        index: number;
        css: string;
        file: string;
        scanSources: ScanSource[];
    }> = [];
    for (const { index, css, scanSources } of roots) {
        const { file } = entries[index] as StyleEntry;
        if (importedByRoots.has(realPath(file))) {
            entries[index] = { file, role: 'imported' };
            continue;
        }
        selectedRoots.push({ index, css, file, scanSources });
    }
    const openedRoots = await mapConcurrent(
        selectedRoots,
        STYLESHEET_COMPILE_CONCURRENCY,
        async ({ file, css }) => compileRoot(file, css, context),
    );
    const compiled: CompiledEntry[] = [];
    for (const [rootIndex, root] of openedRoots.entries()) {
        const { index } = selectedRoots[rootIndex] as (typeof selectedRoots)[number];
        entries[index] = root.entry;
        if (root.compiled !== null) compiled.push(root.compiled);
    }
    // A partial that fails on its own compiles as part of the root that imports
    // it, which is how the build reads it.
    for (const index of failed) {
        const { file } = entries[index] as StyleEntry;
        if (importedByRoots.has(realPath(file))) entries[index] = { file, role: 'imported' };
    }

    /**
     * The signature every compiled root gives a class.
     *
     * @param candidate - Tailwind candidate class.
     * @returns The shared signature, or null when missing or disputed.
     */
    const agreedSignature = (candidate: string): MergeSignature | null => {
        if (compiled.length === 0) return null;
        const signatures = compiled.map(entry => entry.signature(candidate));
        const [firstSignature, ...otherSignatures] = signatures;
        if (firstSignature === null || firstSignature === undefined) return null;
        const canonical = JSON.stringify(firstSignature);
        return otherSignatures.every(signature => JSON.stringify(signature) === canonical)
            ? firstSignature
            : null;
    };
    const [first, ...rest] = compiled;
    return {
        entries,
        facts: first === undefined ? null : agreedFacts(first, rest),
        imports: [...importedByRoots],
        unserved(classes) {
            if (compiled.length === 0) return [];
            const perEntry = compiled.map(entry => new Set(entry.findDead(classes)));
            return classes.filter(token => perEntry.every(dead => dead.has(token)));
        },
        candidates() {
            // Every root's sources, once each: two roots that scan one tree
            // would otherwise read it twice for the same answer.
            // Automatic detection inside a workspace walks every linked package
            // under node_modules: 26,942 files and 10 s measured on one
            // playground. The build warns about that setup already; the table
            // does not pay for it again, and keeps what it cannot prove.
            const unscoped = (source: ScanSource): boolean =>
                source.pattern === '**/*' && source.base === resolveFrom && !source.negated;
            const inWorkspace = selectedRoots.some(root => root.scanSources.some(unscoped))
                ? isMonorepoPackage(resolveFrom)
                : false;
            const sources = new Map<string, ScanSource>();
            for (const root of selectedRoots) {
                for (const source of root.scanSources) {
                    if (inWorkspace && unscoped(source)) continue;
                    sources.set(JSON.stringify(source), source);
                }
            }
            if (sources.size === 0) return [];
            const scan = loadCandidateScanner(resolveFrom);
            // No scanner to load: the census stays what the build saw, and the
            // merge keeps what it cannot prove.
            if (scan === null) return [];
            return sortStrings(new Set(scan([...sources.values()])));
        },
        mergeSignature(candidate) {
            return !isHook(hooks, candidate) &&
                compiled.every(entry => entry.origin(candidate) === 'tailwind')
                ? agreedSignature(candidate)
                : null;
        },
        signature: agreedSignature,
    };
}
