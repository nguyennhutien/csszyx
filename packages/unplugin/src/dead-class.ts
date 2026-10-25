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
 * is what ADR 0024 withdrew, and nothing reports them.
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
 * A dead class the project serves with one of its variants dropped
 * (`hidden:p-4`, served as `p-4`) is reported once, as `unserved-variant`,
 * naming that variant: Tailwind has no bare `hidden` variant. Asked the same
 * way, of the project's Tailwind: a project that defines `@custom-variant
 * hidden` serves the class, and nothing is said. Only the words come from a
 * table, the form of the name (an ARIA state, one that is an HTML attribute
 * too, or neither).
 *
 * A served class carrying a CSS-wide keyword that no property it sets takes
 * (`ring-[inherit]`, served as `--tw-ring-color: inherit`) is reported as
 * `inert-keyword` ({@link inertKeywordOf}): it produces CSS and styles
 * nothing, the same outcome in other words. Asked of the served keyword
 * classes only, of the same design system.
 *
 * No new CSS read: the question goes to the style model every lane already
 * opened (`css-reading-entry-points.test.ts`).
 *
 * @module
 */
import {
    renderSzDiagnostic,
    type SourcePosition,
    type StateVariantForm,
    SZ_DIAGNOSTIC_COMPUTED_VALUES,
    type SzMergeGroup,
    sortStrings,
    stateVariantForm,
    szMergeGroupKeyStarts,
} from '@csszyx/compiler';
import type { DiagnosticLimiter, LimitedFinding } from './diagnostic-limiter.js';
import { diagnosticMessage } from './diagnostic-message.js';
import type { DiagnosticPolicy } from './diagnostic-policy.js';
import { cssWideKeywordOf } from './inert-keyword.js';
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
    /**
     * `unserved-variant` when the class is served with this one variant
     * dropped, and with no other: the variant as the class writes it, and the
     * form its line takes. Absent for every other dead class.
     */
    variant?: UnservedVariant;
    /**
     * `inert-keyword` when the class is served and no property it sets takes
     * the CSS-wide keyword it carries: that keyword. Absent for every other
     * finding.
     */
    inert?: string;
    /** Every later file that emits the class, in path order. */
    others?: readonly DeadClassSite[];
}

/** The variant a dead class is served without, as `unserved-variant` names it. */
export interface UnservedVariant {
    /** The variant, as the class writes it (`hidden`). */
    name: string;
    /** An ARIA state, one that is an HTML attribute too, or a name csszyx does not know. */
    form: StateVariantForm | 'unknown';
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

/** The key one class is placed at: an entry of a group. */
interface Placement {
    readonly group: SzMergeGroup;
    readonly index: number;
    /** The key's byte offset, when every group of the result carries one. */
    readonly offset: number | undefined;
}

/**
 * Each class one transform emitted, at the entry of the key written first.
 *
 * Groups the compiler located carry the key offsets the engine reported, and
 * two offsets of one file order as their positions do, so they are compared
 * without resolving a line: a build places every class of every transform and
 * names only the few that are dead. When a group was built elsewhere, with
 * positions only, every group is compared by line and column.
 *
 * @param result - The first pass's result.
 * @returns Class to its entry.
 */
function placeClasses(result: EmittedClassPlacement): Map<string, Placement> {
    const groups = [...(result.mergeGroups ?? []), ...(result.singleClassGroups ?? [])];
    const offsets = groups.map(group => szMergeGroupKeyStarts(group));
    const byOffset = offsets.every(starts => starts !== undefined);
    const placed = new Map<string, Placement>();
    for (const [at, group] of groups.entries()) {
        const starts = offsets[at];
        const { classes } = group;
        for (let index = 0; index < classes.length; index++) {
            const className = classes[index] as string;
            const offset = starts?.[index];
            const held = placed.get(className);
            if (held !== undefined) {
                const earlier = byOffset
                    ? (offset as number) < (held.offset as number)
                    : writtenBefore(
                          group.positions[index] as SourcePosition,
                          held.group.positions[held.index] as SourcePosition,
                      );
                if (!earlier) continue;
            }
            placed.set(className, { group, index, offset });
        }
    }
    return placed;
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
 * Resolves the position of every class it places: for a store that keeps
 * them (a Next shard). A build that names only dead classes reads
 * {@link szClassSites}, which resolves none until one is named.
 *
 * @param result - The first pass's result.
 * @returns Class to site, for the classes the engine placed.
 */
export function emittedClassSites(result: EmittedClassPlacement): Map<string, EmittedClassSite> {
    const sites = new Map<string, EmittedClassSite>();
    for (const [className, { group, index }] of placeClasses(result)) {
        const { line, column } = group.positions[index] as SourcePosition;
        sites.set(className, { line, column, key: group.keys[index] as string });
    }
    return sites;
}

/**
 * A class's site as a build records it on every transform: the file, and the
 * entry of its key, which is looked for only when the site is read.
 */
class PlacedClassSite implements DeadClassSite {
    readonly file: string;
    readonly #className: string;
    readonly #placed: () => ReadonlyMap<string, Placement>;

    /**
     * @param file - The file, project-relative.
     * @param className - The class.
     * @param placed - The file's placements, placed on the first call.
     */
    constructor(file: string, className: string, placed: () => ReadonlyMap<string, Placement>) {
        this.file = file;
        this.#className = className;
        this.#placed = placed;
    }

    /** @returns The key's 1-based line, when the engine placed the class. */
    get line(): number | undefined {
        return this.#position()?.line;
    }

    /** @returns The key's 1-based column, when the engine placed the class. */
    get column(): number | undefined {
        return this.#position()?.column;
    }

    /** @returns The key the class was lowered from, when the engine placed it. */
    get key(): string | undefined {
        const placement = this.#placed().get(this.#className);
        return placement?.group.keys[placement.index];
    }

    /** @returns The site as plain fields, as {@link deadClassSite} hands it on. */
    resolved(): DeadClassSite {
        if (!this.#placed().has(this.#className)) return { file: this.file };
        return {
            file: this.file,
            line: this.line as number,
            column: this.column as number,
            key: this.key as string,
        };
    }

    /** @returns The key's position, when the engine placed the class. */
    #position(): SourcePosition | undefined {
        const placement = this.#placed().get(this.#className);
        return placement?.group.positions[placement.index];
    }
}

/**
 * A site as plain fields, its line and column resolved: what a finding
 * carries and a message names.
 *
 * @param site - A site from {@link szClassSites}, or one built elsewhere.
 * @returns The same site, as plain data.
 */
export function deadClassSite(site: DeadClassSite): DeadClassSite {
    return site instanceof PlacedClassSite ? site.resolved() : site;
}

/**
 * Where one file emits each of its classes.
 *
 * Runs on every transform a build records, so nothing is placed here: the
 * file's groups are read once, when the report names one of its classes
 * ({@link deadClassSite}). Placing every class of an 800-file app on every
 * transform cost 4.6 ms for a report that names a few.
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
    // The groups alone, not the result: a site outlives its transform.
    const groups = { mergeGroups: result.mergeGroups, singleClassGroups: result.singleClassGroups };
    let placements: Map<string, Placement> | undefined;
    const placed = (): Map<string, Placement> => {
        placements ??= placeClasses(groups);
        return placements;
    };
    const sites = new Map<string, DeadClassSite>();
    for (const className of classes) {
        sites.set(className, new PlacedClassSite(file, className, placed));
    }
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
 * Each variant of a class, with the class that variant dropped and everything
 * else kept: the questions `unserved-variant` asks. A variant is a segment
 * before a `:` outside brackets and parentheses (`data-[a=b:c]` is one), the
 * prefix (`tw:`) counted as one, so dropping it is simply never served.
 *
 * @param className - The class, as emitted.
 * @returns One entry per variant, in the order the class writes them.
 */
export function variantDroppedForms(
    className: string,
): Array<{ variant: string; without: string }> {
    const ends: number[] = [];
    let depth = 0;
    for (let index = 0; index < className.length; index++) {
        const char = className[index];
        if (char === '[' || char === '(') depth++;
        else if ((char === ']' || char === ')') && depth > 0) depth--;
        else if (char === ':' && depth === 0) ends.push(index);
    }
    return ends.map((end, index) => {
        const start = index === 0 ? 0 : (ends[index - 1] as number) + 1;
        return {
            variant: className.slice(start, end),
            without: className.slice(0, start) + className.slice(end + 1),
        };
    });
}

/**
 * The variant a dead class is served without, when there is exactly one.
 *
 * @param className - The dead class.
 * @param served - Whether the project serves a class.
 * @returns The variant and its form, or null when no single drop serves it.
 */
export function unservedVariantOf(
    className: string,
    served: (className: string) => boolean,
): UnservedVariant | null {
    const serving = variantDroppedForms(className).filter(form => served(form.without));
    if (serving.length !== 1) return null;
    const name = (serving[0] as { variant: string }).variant;
    return { name, form: stateVariantForm(name) ?? 'unknown' };
}

/** The ids the dead-class pass reports a class under. */
type DeadClassId = 'dead-class' | 'inert-keyword' | 'unsigned-value' | 'unserved-variant';

/**
 * The id a dead class is reported under.
 *
 * @param finding - The dead class.
 * @returns `inert-keyword` for a keyword no property takes, `unsigned-value`
 *          for a hoisted sign, `unserved-variant` for a variant the project
 *          does not serve, `dead-class` otherwise.
 */
function findingId(finding: DeadClassFinding): DeadClassId {
    if (finding.inert !== undefined) return 'inert-keyword';
    if (finding.unsigned !== undefined) return 'unsigned-value';
    return finding.variant === undefined ? 'dead-class' : 'unserved-variant';
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
 * stylesheet edit opens a new one. A dead class brings more questions, asked
 * together: with a hoisted sign, its {@link unsignedClass}, and `unsigned` is
 * set only when that one is served; with variants, each of its
 * {@link variantDroppedForms}, and `variant` is set when exactly one of them
 * is served and the sign is not the thing to name. A served class carrying a
 * CSS-wide keyword is asked once more, and is a finding with `inert` set when
 * no property it sets takes the keyword.
 *
 * @param model - The project's style model.
 * @param origins - Each emitted class, and the file that emits it or every
 *        site that does, in path order.
 * @returns The dead classes, sorted; empty without a design system.
 */
export function findDeadSzClasses(
    model: Pick<ProjectStyleModel, 'facts' | 'inert' | 'unserved'>,
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
    // served, and a dead class `unserved-variant` only when it is served with
    // one variant dropped: the second question, asked of the same design
    // system, of the dead classes only.
    ask(
        deadClasses.flatMap(className => [
            ...[unsignedClass(className)].filter(form => form !== null),
            ...variantDroppedForms(className).map(form => form.without),
        ]),
    );
    const served = (className: string): boolean => known.get(className) === false;
    const keywordClasses = classes.filter(
        className => served(className) && cssWideKeywordOf(className) !== null,
    );
    const inert = new Set(keywordClasses.length === 0 ? [] : model.inert(keywordClasses));
    // What a finding says beyond its class: the keyword, the sign or the variant.
    const detail = (className: string): Omit<DeadClassFinding, 'file'> => {
        if (inert.has(className))
            return { className, inert: cssWideKeywordOf(className) as string };
        const unsignedForm = unsignedClass(className);
        const unsigned =
            unsignedForm !== null && served(unsignedForm) ? hoistedSignUtility(className) : null;
        if (unsigned !== null) return { className, unsigned };
        const variant = unservedVariantOf(className, served);
        return variant === null ? { className } : { className, variant };
    };
    const findings = classes.filter(className => inert.has(className) || !served(className));
    return findings.map(className => {
        const origin = origins.get(className) as string | readonly DeadClassSite[];
        const found = detail(className);
        if (typeof origin === 'string') return { ...found, file: origin };
        // Resolved here, for the findings only.
        const [first, ...others] = (origin as readonly DeadClassSite[]).map(deadClassSite);
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
    return diagnosticMessage('dead-class', { className }, siteOf(file, site));
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
    return diagnosticMessage('unsigned-value', { className, utility }, siteOf(file, site));
}

/**
 * Where a build line points: the file, and the line and column when the
 * engine recorded them.
 *
 * @param file - The file that emits the class.
 * @param site - The line and column, when known.
 * @returns `file`, or `file:line:column`.
 */
function siteOf(file: string, site: Omit<DeadClassSite, 'file'>): string {
    return [file, site.line, site.column].filter(part => part !== undefined).join(':');
}

/**
 * The line a build prints for one served class whose CSS-wide keyword no
 * property takes.
 *
 * @param className - The class, as emitted.
 * @param keyword - The keyword it carries.
 * @param file - The file that emits it.
 * @param site - The line, column and key, when the engine recorded them.
 * @returns The warning, `[csszyx]`-prefixed.
 */
export function inertKeywordMessage(
    className: string,
    keyword: string,
    file: string,
    site: Omit<DeadClassSite, 'file'> = {},
): string {
    return diagnosticMessage('inert-keyword', { className, keyword }, siteOf(file, site));
}

/**
 * The line a build prints for one dead class served with one variant dropped,
 * in the registry's words.
 *
 * @param finding - The dead class and its variant.
 * @param site - Where it is named.
 * @returns The warning, headed by its code.
 */
export function unservedVariantMessage(
    finding: Pick<DeadClassFinding, 'className'> & { variant: UnservedVariant },
    site: DeadClassSite,
): string {
    const { name, form } = finding.variant;
    return renderSzDiagnostic({
        diagnostic: {
            code: 'unserved-variant',
            args: { form, variant: name, className: finding.className },
            ...(site.line === undefined ? {} : { line: site.line, column: site.column }),
        },
        file: site.file,
        computed: SZ_DIAGNOSTIC_COMPUTED_VALUES,
    });
}

/**
 * The line a build prints for one finding, under its id.
 *
 * @param finding - The dead class.
 * @param site - Where it is named.
 * @returns The warning.
 */
function findingMessage(finding: DeadClassFinding, site: DeadClassSite): string {
    if (finding.inert !== undefined) {
        return inertKeywordMessage(finding.className, finding.inert, site.file, site);
    }
    if (finding.unsigned !== undefined) {
        return unsignedValueMessage(finding.className, finding.unsigned, site.file, site);
    }
    return finding.variant === undefined
        ? deadClassMessage(finding.className, site.file, site)
        : unservedVariantMessage({ ...finding, variant: finding.variant }, site);
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
 * `unsigned-value` (`rule: 'dead-class'`, `kind: 'unsigned-value'`), one
 * served with a variant dropped under `unserved-variant`, and a served class
 * whose keyword no property takes under `inert-keyword`, so a level for any of
 * those ids reaches it, the kind's winning; every other one under
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
    const present: Record<DeadClassId, LimitedFinding[]> = {
        'dead-class': [],
        'inert-keyword': [],
        'unsigned-value': [],
        'unserved-variant': [],
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
    for (const [id, retained] of Object.entries(present)) input.limiter.retain(id, retained);
    return { lines, held };
}
