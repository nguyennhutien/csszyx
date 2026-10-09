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
    /** Every later file that emits the class, in path order. */
    others?: readonly DeadClassSite[];
}

/**
 * Where one file emits each of its classes.
 *
 * The engine places a class at its key only in a first pass, and only for an
 * object a merge reads (two classes or more); any other class is named by its
 * file alone. A class two objects emit is placed at the first.
 *
 * @param file - The file, project-relative.
 * @param classes - The classes the file's `sz` lowered to.
 * @param groups - The first pass's merge groups; absent from an older cache entry.
 * @returns Class to site.
 */
export function szClassSites(
    file: string,
    classes: Iterable<string>,
    groups: readonly SzMergeGroup[] = [],
): Map<string, DeadClassSite> {
    const placed = new Map<string, DeadClassSite>();
    for (const group of groups) {
        for (const [index, className] of group.classes.entries()) {
            if (placed.has(className)) continue;
            const { line, column } = group.positions[index] as SourcePosition;
            placed.set(className, { file, line, column, key: group.keys[index] as string });
        }
    }
    const sites = new Map<string, DeadClassSite>();
    for (const className of classes) sites.set(className, placed.get(className) ?? { file });
    return sites;
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
 * stylesheet edit opens a new one.
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
    const asked = classes.filter(className => !known.has(className));
    if (asked.length > 0) {
        const dead = new Set(model.unserved(asked));
        for (const className of asked) known.set(className, dead.has(className));
    }
    return classes
        .filter(className => known.get(className) === true)
        .map(className => {
            const origin = origins.get(className) as string | readonly DeadClassSite[];
            if (typeof origin === 'string') return { className, file: origin };
            const [first, ...others] = origin as readonly DeadClassSite[];
            return others.length === 0 ? { className, ...first } : { className, ...first, others };
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
    for (const site of [finding, ...(finding.others ?? [])]) {
        const level = input.policy.levelOf({ rule: 'dead-class', file: site.file });
        const channel = channelOfLevel(level, input.quiet, input.holdInfo);
        if (channel === 'list') return { site, heldAtSomeSite };
        if (channel === 'held') heldAtSomeSite = true;
    }
    return { site: null, heldAtSomeSite };
}

/**
 * The lines to print for a lane's dead classes, at the levels the policy sets.
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
    const present: LimitedFinding[] = [];
    for (const finding of findings) {
        if (input.policy.allowsClass(finding.className)) continue;
        const { site, heldAtSomeSite } = firstListedSite(finding, input);
        if (site === null) {
            if (heldAtSomeSite) held++;
            continue;
        }
        const limited = {
            id: 'dead-class',
            file: site.file,
            line: site.line,
            column: site.column,
            key: finding.className,
        };
        present.push(limited);
        if (input.limiter.admit(limited)) {
            lines.push(deadClassMessage(finding.className, site.file, site));
        }
    }
    input.limiter.retain('dead-class', present);
    return { lines, held };
}
