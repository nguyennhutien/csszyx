/**
 * The `sz` classes a project's Tailwind serves no CSS for, said at build time.
 *
 * `{ break: 'bogus' }` lowers to `break-bogus`: the key is real, so no key
 * diagnostic fires, and the class sits in the DOM styling nothing. `csszyx
 * check` has reported these as `dead-class` since it learned to ask Tailwind;
 * a build compiles the same design system to settle the merge table, so it
 * asks the same question and prints the answer under the same id.
 *
 * Only classes `sz` EMITTED are asked about. The `className` vocabulary has
 * unserved names too — an app's own `card`, `end`, `row` — and reporting those
 * is what ADR 0024 withdrew; they are `custom-class`/`unknown-class`, off unless
 * a project opts in.
 *
 * A dead class whose utility carries the sign `sz` hoisted in front of it
 * (`{ p: -2 }` → `-p-2`) is reported once, as `unsigned-value`, instead: the
 * project's Tailwind serves no negative form of that utility, and the advice
 * differs. Only when the class without its sign (variants kept, `hover:p-2`)
 * is served: `-p-medium` is dead unsigned too, so "drop the sign" would be
 * wrong advice, and it is a plain `dead-class`. Both are the project's answer,
 * never a table (ADR 0012, PROJECT-RULES §4): a project that defines
 * `@utility -p-*` serves `-p-2`, and nothing is said.
 *
 * No new CSS read: the question goes to the style model every lane already
 * opened (`css-reading-entry-points.test.ts`).
 *
 * @module
 */
import { type SourcePosition, type SzMergeGroup, sortStrings } from '@csszyx/compiler';

import type { DiagnosticLimiter, LimitedFinding } from './diagnostic-limiter.js';
import type { DiagnosticPolicy } from './diagnostic-policy.js';
import type { ProjectStyleModel } from './project-style-model.js';
import { channelOfLevel, type QuietMode } from './transform-diagnostics.js';

/** Where one file emits a class: the key it was lowered from, when the engine recorded it. */
export interface DeadClassSite {
    /** Project-relative, forward slashes. */
    file: string;
    /** The line of the key, 1-based. */
    line?: number;
    /** The column of the key, 1-based. */
    column?: number;
    /** The `sz` key the class was lowered from. */
    key?: string;
}

/**
 * One emitted class that produces no CSS, at the first file, in path order,
 * that emits it; `others` are the rest, so a level that turns the first file
 * off can name the next.
 */
export interface DeadClassFinding extends DeadClassSite {
    className: string;
    /**
     * `unsigned-value` when the class's utility carries a hoisted sign and
     * the class without it is served, with the utility it negates; absent for
     * every other dead class.
     */
    unsigned?: string;
    /** Every later file that emits the class, in path order. */
    others?: readonly DeadClassSite[];
}

/** Where the engine placed one emitted class: the key it was lowered from. */
export interface EmittedClassSite {
    /** The line of the key, 1-based. */
    line: number;
    /** The column of the key, 1-based. */
    column: number;
    /** The `sz` key the class was lowered from. */
    key: string;
}

/** What a transform result says about where its classes were written. */
export interface EmittedClassPlacement {
    /** The first pass's merge groups; absent from an older cache entry. */
    readonly mergeGroups?: readonly SzMergeGroup[];
    /** The first pass's one-class objects; absent from an older engine or cache entry. */
    readonly singleClassGroups?: readonly SzMergeGroup[];
}

/**
 * Whether one position is written before another.
 *
 * @param left - A position.
 * @param right - Another.
 * @returns `true` when `left` comes strictly first in the source.
 */
function writtenBefore(left: SourcePosition, right: SourcePosition): boolean {
    return left.line < right.line || (left.line === right.line && left.column < right.column);
}

/**
 * Each class one transform emitted that the engine placed at its key.
 *
 * Every lane reads class positions through this one function. The engine
 * places a class only in a first pass: an object a merge reads (two classes
 * or more) in `mergeGroups`, a one-class object in `singleClassGroups`. A
 * class several objects emit is placed at the key written first in the
 * source (line, then column), whichever list holds it; on the same position
 * the first one read wins, `mergeGroups` before `singleClassGroups`.
 *
 * @param result - The first pass's result.
 * @returns Class to site, for the classes the engine placed.
 */
export function emittedClassSites(result: EmittedClassPlacement): Map<string, EmittedClassSite> {
    const placed = new Map<string, EmittedClassSite>();
    for (const group of [...(result.mergeGroups ?? []), ...(result.singleClassGroups ?? [])]) {
        for (const [index, className] of group.classes.entries()) {
            const { line, column } = group.positions[index] as SourcePosition;
            const held = placed.get(className);
            if (held !== undefined && !writtenBefore({ line, column }, held)) continue;
            placed.set(className, { line, column, key: group.keys[index] as string });
        }
    }
    return placed;
}

/**
 * Where one file emits each of its classes.
 *
 * @param file - The file, project-relative.
 * @param classes - The classes the file's `sz` lowered to.
 * @param result - The first pass's result, for {@link emittedClassSites}.
 * @returns Class to site.
 */
export function szClassSites(
    file: string,
    classes: Iterable<string>,
    result: EmittedClassPlacement,
): Map<string, DeadClassSite> {
    const placed = emittedClassSites(result);
    const sites = new Map<string, DeadClassSite>();
    for (const className of classes) sites.set(className, { file, ...placed.get(className) });
    return sites;
}

/**
 * Where a class's variants end: just past the last `:` outside brackets and
 * parentheses, or 0 when it has none.
 *
 * @param className - The class, as emitted.
 * @returns The index its utility starts at.
 */
function utilityStart(className: string): number {
    let depth = 0;
    let start = 0;
    for (let index = 0; index < className.length; index++) {
        const char = className[index];
        if (char === '[' || char === '(') depth++;
        else if ((char === ']' || char === ')') && depth > 0) depth--;
        else if (char === ':' && depth === 0) start = index + 1;
    }
    return start;
}

/**
 * A class split at the sign `sz` hoists in front of its utility, the way
 * Tailwind spells a negative: after every variant and the prefix (`hover:`,
 * `data-[state=open]:`, `tw:`), and after a leading `!`, `-<utility>`. A sign
 * inside a bracket (`mt-[-10px]`) is the value's own and not hoisted.
 *
 * @param className - The class, as emitted.
 * @returns What comes before the sign (variants, prefix, `!`) and the utility
 *          after it, or null when the class carries no hoisted sign.
 */
function splitHoistedSign(className: string): { head: string; utility: string } | null {
    let start = utilityStart(className);
    if (className[start] === '!') start++;
    if (!/^-[a-z]/i.test(className.slice(start))) return null;
    return { head: className.slice(0, start), utility: className.slice(start + 1) };
}

/**
 * The utility a class negates with the sign `sz` hoists in front of it
 * ({@link splitHoistedSign}).
 *
 * @param className - The class, as emitted.
 * @returns The utility without its sign (`p-2` for `hover:-p-2`), or null when
 *          the class carries no hoisted sign.
 */
export function hoistedSignUtility(className: string): string | null {
    return splitHoistedSign(className)?.utility ?? null;
}

/**
 * The class with its hoisted sign dropped and everything else kept: the class
 * `unsigned-value` tells the user to write instead (`hover:!p-2` for
 * `hover:!-p-2`). Whether the project serves it is asked, never assumed: a
 * class dead unsigned too (`-p-medium`) is a `dead-class`, and "drop the sign"
 * would be wrong advice.
 *
 * @param className - The class, as emitted.
 * @returns The class without its sign, or null when it carries no hoisted sign.
 */
export function unsignedClass(className: string): string | null {
    const split = splitHoistedSign(className);
    return split === null ? null : split.head + split.utility;
}

/**
 * The id a dead class is reported under.
 *
 * @param finding - The dead class.
 * @returns `unsigned-value` for a hoisted sign, `dead-class` otherwise.
 */
function findingId(finding: DeadClassFinding): 'dead-class' | 'unsigned-value' {
    return finding.unsigned === undefined ? 'dead-class' : 'unsigned-value';
}

/**
 * The verdicts already asked of each style model. A dev server settles the
 * table on every edit; only the classes the edit brought are new questions.
 */
const verdicts = new WeakMap<object, Map<string, boolean>>();

/**
 * Ask the design system which emitted `sz` classes it serves nothing for.
 *
 * Dead means dead under every root the model compiled, as `check` decides.
 * Each class is asked once per model: a model is one design system, and a
 * stylesheet edit opens a new one. A dead class with a hoisted sign brings
 * one more question, its {@link unsignedClass}: `unsigned` is set only when
 * that one is served.
 *
 * @param model - The project's style model.
 * @param origins - Each emitted class, and the file that emits it or every
 *        site that does, in path order.
 * @returns The dead classes, sorted; empty without a design system.
 */
export function findDeadSzClasses(
    model: Pick<ProjectStyleModel, 'facts' | 'unserved'>,
    origins: ReadonlyMap<string, string | readonly DeadClassSite[]>,
): DeadClassFinding[] {
    if (model.facts === null || origins.size === 0) return [];
    let known = verdicts.get(model);
    if (known === undefined) {
        known = new Map();
        verdicts.set(model, known);
    }
    const classes = sortStrings(origins.keys());
    const ask = (questions: readonly string[]): void => {
        const asked = [...new Set(questions)].filter(className => !known.has(className));
        if (asked.length === 0) return;
        const dead = new Set(model.unserved(asked));
        for (const className of asked) known.set(className, dead.has(className));
    };
    ask(classes);
    const deadClasses = classes.filter(className => known.get(className) === true);
    // A dead signed class is `unsigned-value` only when its unsigned form is
    // served: the second question, asked of the same design system.
    ask(deadClasses.map(unsignedClass).filter(className => className !== null));
    return deadClasses.map(className => {
        const origin = origins.get(className) as string | readonly DeadClassSite[];
        const unsignedForm = unsignedClass(className);
        const unsigned =
            unsignedForm !== null && known.get(unsignedForm) === false
                ? hoistedSignUtility(className)
                : null;
        const found = unsigned === null ? { className } : { className, unsigned };
        if (typeof origin === 'string') return { ...found, file: origin };
        const [first, ...others] = origin as readonly DeadClassSite[];
        return others.length === 0 ? { ...found, ...first } : { ...found, ...first, others };
    });
}

/**
 * The line a build prints for one dead class.
 *
 * @param className - The class, as emitted.
 * @param file - The file that emits it.
 * @param site - The line, column and key, when the engine recorded them.
 * @returns The warning, `[csszyx]`-prefixed.
 */
export function deadClassMessage(
    className: string,
    file: string,
    site: Omit<DeadClassSite, 'file'> = {},
): string {
    const where = [file, site.line, site.column].filter(part => part !== undefined).join(':');
    const from = site.key === undefined ? '' : ` (sz key \`${site.key}\`)`;
    return (
        `[csszyx] ${where}: \`${className}\`${from} is emitted by an sz prop and produces no CSS under this project's Tailwind (dead-class).\n` +
        "  help: fix the sz key or value, or define the class with Tailwind's @utility; `csszyx check --rule dead-class` lists every one."
    );
}

/**
 * The line a build prints for one dead class whose utility carries a hoisted
 * sign the project's Tailwind serves no negative form of.
 *
 * @param className - The class, as emitted.
 * @param utility - The utility it negates, without the sign.
 * @param file - The file that emits it.
 * @param site - The line, column and key, when the engine recorded them.
 * @returns The warning, `[csszyx]`-prefixed.
 */
export function unsignedValueMessage(
    className: string,
    utility: string,
    file: string,
    site: Omit<DeadClassSite, 'file'> = {},
): string {
    const where = [file, site.line, site.column].filter(part => part !== undefined).join(':');
    const from = site.key === undefined ? '' : ` (sz key \`${site.key}\`)`;
    return (
        `[csszyx] ${where}: \`${className}\`${from} is emitted by an sz prop and produces no CSS: this project's Tailwind serves no negative \`${utility}\`; drop the sign, or define it with @utility (unsigned-value).\n` +
        '  help: `csszyx check --rule unsigned-value` lists every one.'
    );
}

/**
 * The line a build prints for one finding, under its id.
 *
 * @param finding - The dead class.
 * @param site - Where it is named.
 * @returns The warning.
 */
function findingMessage(finding: DeadClassFinding, site: DeadClassSite): string {
    return finding.unsigned === undefined
        ? deadClassMessage(finding.className, site.file, site)
        : unsignedValueMessage(finding.className, finding.unsigned, site.file, site);
}

/** How a lane reports dead classes. */
export interface DeadClassReportInput {
    policy: DiagnosticPolicy;
    quiet: QuietMode;
    /** Whether this run counts `info` findings instead of listing them. */
    holdInfo: boolean;
    /** The lane's dedupe record and cap. */
    limiter: DiagnosticLimiter;
}

/**
 * The first file, in path order, whose level lists a dead class.
 *
 * A file an override turns off is passed over, and so is one that holds the
 * class at `info`: a later file an override raises to `warn` or `error` is
 * still listed.
 *
 * @param finding - The dead class and every file that emits it.
 * @param input - The policy and the run.
 * @returns The site to list, or null when none lists it, and whether any file
 *          before the listed one (or any file at all, when none lists it)
 *          held it back.
 */
function firstListedSite(
    finding: DeadClassFinding,
    input: DeadClassReportInput,
): { site: DeadClassSite | null; heldAtSomeSite: boolean } {
    let heldAtSomeSite = false;
    const kind = findingId(finding);
    for (const site of [finding, ...(finding.others ?? [])]) {
        const level = input.policy.levelOf({ rule: 'dead-class', kind, file: site.file });
        const channel = channelOfLevel(level, input.quiet, input.holdInfo);
        if (channel === 'list') return { site, heldAtSomeSite };
        if (channel === 'held') heldAtSomeSite = true;
    }
    return { site: null, heldAtSomeSite };
}

/**
 * The lines to print for a lane's dead classes, at the levels the policy sets.
 *
 * A class whose utility carries a hoisted sign is said under
 * `unsigned-value` (`rule: 'dead-class'`, `kind: 'unsigned-value'`), so a
 * level for either id reaches it, the kind's winning; every other one under
 * `dead-class`. Each class is said once, under one id.
 *
 * `allow.classes` leaves a class out, as `check --allow` does. The level is
 * resolved per file: a class is named at the first file, in path order, whose
 * level lists it, so a file an override turns off or holds at `info` does not
 * hide a later file set to `warn` or `error`. A class no file lists is counted
 * once if any file holds it. A level never fails the build. A class that
 * stopped being dead, or emitted, is forgotten, so it is said again if it
 * comes back — a watch build has no file version to say so.
 *
 * @param findings - The dead classes.
 * @param input - The policy and the run.
 * @returns The lines to list, and how many `info` findings were held back.
 */
export function reportDeadSzClasses(
    findings: readonly DeadClassFinding[],
    input: DeadClassReportInput,
): { lines: string[]; held: number } {
    const lines: string[] = [];
    let held = 0;
    const present = {
        'dead-class': [] as LimitedFinding[],
        'unsigned-value': [] as LimitedFinding[],
    };
    for (const finding of findings) {
        if (input.policy.allowsClass(finding.className)) continue;
        const { site, heldAtSomeSite } = firstListedSite(finding, input);
        if (site === null) {
            if (heldAtSomeSite) held++;
            continue;
        }
        const id = findingId(finding);
        const limited = {
            id,
            file: site.file,
            line: site.line,
            column: site.column,
            key: finding.className,
        };
        present[id].push(limited);
        if (input.limiter.admit(limited)) lines.push(findingMessage(finding, site));
    }
    input.limiter.retain('dead-class', present['dead-class']);
    input.limiter.retain('unsigned-value', present['unsigned-value']);
    return { lines, held };
}
