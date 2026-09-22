/**
 * Derive merge signatures from CSS emitted by the project's Tailwind.
 *
 * @module
 */

import type { MergeSignatureTable } from '@csszyx/runtime';
import postcss, { type AtRule, type Declaration, type Node, type Rule } from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { LONGHANDS } from './longhand-table.generated.js';

export type { MergeSignatureTable } from '@csszyx/runtime';

/**
 * The table format this plugin writes, carried beside the table.
 *
 * Its own number rather than the runtime's: a plugin and a runtime from
 * different releases can meet in one install, and the runtime refuses a table
 * written in a format it does not read. Change it with the table's shape, and
 * the runtime's `MERGE_TABLE_FORMAT` with it.
 */
export const MERGE_TABLE_FORMAT = 1;

/**
 * The format of the per-file table this plugin hands the transform engine.
 *
 * Not {@link MERGE_TABLE_FORMAT}: the runtime reads the table it is shipped and
 * the engine the one it is handed per file, and the two can change apart. The
 * engine keeps its own number and refuses any other, so a plugin and an engine
 * from different releases keep every class rather than merge on a misread.
 */
export const ENGINE_MERGE_TABLE_FORMAT = 1;

/** The CSS evidence used to decide whether one class can replace another. */
export interface MergeSignature {
    /** Leaf properties grouped by the selector and at-rule context that writes them. */
    rules: ReadonlyArray<{ context: string; properties: readonly string[] }>;
    /** Whether any emitted declaration carries `!important`. */
    important: boolean;
}

/** The two directions text can run in a horizontal writing mode. */
const DIRECTIONS = ['ltr', 'rtl'] as const;

/**
 * The physical property a leaf property lands on where text runs horizontally.
 *
 * `padding` names four physical sides and `padding-inline` two logical ones, so
 * by name neither holds the other although they are sides of one box. Resolved
 * here they compare as sets again. A vertical writing mode would turn the
 * inline axis to top and bottom; the merge assumes a horizontal one, and that
 * is the only assumption it makes — a side must be covered in BOTH directions,
 * so `ps-2` never stands in for `pl-4`.
 *
 * O(length of the property name); a physical property is returned unchanged.
 *
 * @param property - Leaf CSS property.
 * @param direction - Inline text direction.
 * @returns The physical property it resolves to.
 */
export function horizontalProperty(property: string, direction: 'ltr' | 'rtl'): string {
    // Custom identifiers are opaque, even when they contain logical CSS names.
    if (property.startsWith('--')) return property;
    const inlineStart = direction === 'ltr' ? 'left' : 'right';
    const inlineEnd = direction === 'ltr' ? 'right' : 'left';
    const corner = /^border-(start|end)-(start|end)-radius$/u.exec(property);
    if (corner !== null) {
        const block = corner[1] === 'start' ? 'top' : 'bottom';
        const inline = corner[2] === 'start' ? inlineStart : inlineEnd;
        return `border-${block}-${inline}-radius`;
    }
    if (property === 'inset-block-start') return 'top';
    if (property === 'inset-block-end') return 'bottom';
    if (property === 'inset-inline-start') return inlineStart;
    if (property === 'inset-inline-end') return inlineEnd;
    return property
        .replace('inline-size', 'width')
        .replace('block-size', 'height')
        .replace('block-start', 'top')
        .replace('block-end', 'bottom')
        .replace('inline-start', inlineStart)
        .replace('inline-end', inlineEnd);
}

/** One signature with its properties resolved for each text direction. */
interface ResolvedSignature {
    important: MergeSignature['important'];
    /** Every property it sets is a custom property (`--*`). */
    customOnly: boolean;
    /** Per direction: the physical properties each context declares. */
    sides: ReadonlyArray<ReadonlyMap<string, ReadonlySet<string>>>;
}

/**
 * Resolve a signature's properties once, so the quadratic coverage pass below
 * compares prepared sets instead of rebuilding them for every pair.
 * O(r * p) for r rules of p properties.
 *
 * @param signature - Signature as read from compiled CSS.
 * @returns The same rules with physical properties, for each direction.
 */
function resolveSides(signature: MergeSignature): ResolvedSignature {
    return {
        important: signature.important,
        customOnly: signature.rules.every(rule =>
            rule.properties.every(name => name.startsWith('--')),
        ),
        sides: DIRECTIONS.map(
            direction =>
                new Map(
                    signature.rules.map(rule => [
                        rule.context,
                        new Set(rule.properties.map(name => horizontalProperty(name, direction))),
                    ]),
                ),
        ),
    };
}

/**
 * Whether every rule/property written earlier is also written later, whichever
 * way the text runs.
 * @param later - Candidate signature that may replace the earlier one.
 * @param earlier - Existing candidate signature.
 * @returns True only for complete context-preserving coverage in both directions.
 */
function signatureCovers(later: ResolvedSignature, earlier: ResolvedSignature): boolean {
    if (later.important !== earlier.important) return false;
    // A class that sets nothing but custom properties is a modifier another
    // utility reads (`space-x-reverse` sets `--tw-space-x-reverse`), written to
    // sit beside it. The utility it modifies resets the variable as a default,
    // so by property sets it covers the modifier, and dropping the modifier
    // loses what the author wrote it for. Another modifier of the same
    // variables still replaces it: `shadow-red-500 shadow-blue-500`.
    if (earlier.customOnly && !later.customOnly) return false;
    return DIRECTIONS.every((_, direction) => {
        const laterRules = later.sides[direction] as ReadonlyMap<string, ReadonlySet<string>>;
        for (const [context, properties] of earlier.sides[direction] as ReadonlyMap<
            string,
            ReadonlySet<string>
        >) {
            const covering = laterRules.get(context);
            if (covering === undefined) return false;
            for (const property of properties) if (!covering.has(property)) return false;
        }
        return true;
    });
}

/**
 * Build deterministic app-scoped merge data from the project's style model.
 * @param candidates - Class candidates observed in the application.
 * @param signatureOf - Project style-model signature lookup.
 * @param options - How to build it.
 * @param options.prune - False keeps ids no merge can use, for comparing the
 *        pruned table against the full one.
 * @returns Compact class ids and directional signature coverage.
 */
export function createMergeSignatureTable(
    candidates: readonly string[],
    signatureOf: (candidate: string) => MergeSignature | null,
    options: { prune?: boolean } = {},
): MergeSignatureTable {
    const byCandidate: Record<string, number> = Object.create(null);
    const signatures: MergeSignature[] = [];
    const signatureIds = new Map<string, number>();
    const sorted = [...new Set(candidates)].sort(compareStrings);
    for (const candidate of sorted) {
        const signature = signatureOf(candidate);
        if (signature === null) continue;
        const serialized = JSON.stringify(signature);
        let id = signatureIds.get(serialized);
        if (id === undefined) {
            id = signatures.length;
            signatureIds.set(serialized, id);
            signatures.push(signature);
        }
        byCandidate[candidate] = id;
    }
    const resolved = signatures.map(resolveSides);
    const coverage = resolved.map(later =>
        resolved.flatMap((earlier, id) => (signatureCovers(later, earlier) ? [id] : [])),
    );
    return options.prune === false ? [byCandidate, coverage] : prune(byCandidate, coverage);
}

/**
 * Leave out every id no merge can use, and number the rest densely.
 *
 * An id held by one class, covering only itself and covered by no other, merges
 * exactly as a class with no entry does: both drop an exact repeat and nothing
 * else. With a census as wide as Tailwind's own scan that is most classes, so
 * shipping them only costs bytes. O(i + e) for i ids and e coverage pairs.
 *
 * @param byCandidate - Class → id.
 * @param coverage - Id → the ids it covers.
 * @returns The same merges, from a smaller table.
 */
function prune(
    byCandidate: Record<string, number>,
    coverage: readonly (readonly number[])[],
): MergeSignatureTable {
    const holders = new Array<number>(coverage.length).fill(0);
    for (const id of Object.values(byCandidate)) holders[id] = (holders[id] as number) + 1;
    const usable = new Array<boolean>(coverage.length).fill(false);
    coverage.forEach((row, id) => {
        for (const covered of row) {
            if (covered !== id) {
                usable[id] = true;
                usable[covered] = true;
            }
        }
    });
    const renumbered = new Map<number, number>();
    coverage.forEach((_, id) => {
        if (usable[id] || (holders[id] as number) > 1) renumbered.set(id, renumbered.size);
    });
    const kept: Record<string, number> = Object.create(null);
    for (const [candidate, id] of Object.entries(byCandidate)) {
        const next = renumbered.get(id);
        if (next !== undefined) kept[candidate] = next;
    }
    // A kept id covers only kept ids: whatever it covers besides itself was
    // marked usable above.
    const rows = [...renumbered.keys()].map(id =>
        (coverage[id] as readonly number[]).map(covered => renumbered.get(covered) as number),
    );
    return [kept, rows];
}

/**
 * Expand one property through the generated CSS shorthand relation.
 *
 * @param property - CSS declaration property.
 * @returns Leaf properties, or the original property when it is not a shorthand.
 */
function expandCssProperty(property: string): readonly string[] {
    return LONGHANDS.get(property) ?? [property];
}

/**
 * Locale-independent string ordering for deterministic artifacts.
 *
 * @param left - Left string.
 * @param right - Right string.
 * @returns Negative or positive in UTF-16 code-unit order; callers sort unique sets.
 */
function compareStrings(left: string, right: string): number {
    return left < right ? -1 : 1;
}

/**
 * Propose one positive candidate anchor and count every named reference.
 * The caller only uses the proposal when the entire declaration path has one
 * reference. Repeated names stay literal, including across ancestor rules.
 * `:is`/`:where` can wrap that anchor (Tailwind's space/divide utilities).
 * One tree walk and one ancestor walk; at most one replacement per selector.
 *
 * @param selector - Selector Tailwind emitted.
 * @param candidate - Candidate class name, already unescaped by the parser.
 * @returns Proposed selector and reference count, or null when none occurs.
 */
function normalizeSelector(
    selector: string,
    candidate: string,
): { value: string; references: number } | null {
    let references = 0;
    const normalized = selectorParser(selectors => {
        selectors.walkClasses(node => {
            if (node.value !== candidate) return;
            references++;
            if (references > 1) return;
            for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
                if (
                    parent.type === 'pseudo' &&
                    parent.value !== ':is' &&
                    parent.value !== ':where'
                ) {
                    return;
                }
            }
            node.replaceWith(selectorParser.nesting({ value: '&' }));
        });
    }).processSync(selector);
    return references === 0 ? null : { value: normalized, references };
}

/**
 * Preserve the complete ancestor path of a candidate declaration.
 * O(d * s) per declaration, where d is nesting depth and s selector length.
 * JSON tuples keep delimiters inside selectors separate from path boundaries.
 *
 * @param declaration - Emitted declaration.
 * @param candidate - Unescaped candidate class spelling.
 * @returns Encoded context, or null for declarations outside the candidate.
 */
function declarationContext(declaration: Declaration, candidate: string): string | null {
    const path: unknown[] = [];
    let references = 0;
    let anchorIndex = 0;
    let anchorSelector = '';
    let parent: Node | undefined = declaration.parent;
    while (parent !== undefined) {
        if (parent.type === 'rule') {
            const rule = parent as Rule;
            const selector = normalizeSelector(rule.selector, candidate);
            if (selector !== null) {
                references += selector.references;
                anchorIndex = path.length;
                anchorSelector = selector.value;
            }
            path.push(['selector', rule.selector]);
        }
        if (parent.type === 'atrule') {
            const atRule = parent as AtRule;
            if (atRule.name === 'property' || atRule.name.endsWith('keyframes')) return null;
            path.push(['at-rule', atRule.name, atRule.params]);
        }
        parent = parent.parent;
    }
    if (references === 0) return null;
    // Normalizing even one of several references could alias `.a .a` with
    // `.b .a`; removing `a` from the descendant then breaks both selectors.
    if (references === 1) path[anchorIndex] = ['selector', anchorSelector];
    path.reverse();
    return JSON.stringify([path, Boolean(declaration.important)]);
}

/**
 * Derive a deterministic merge signature from one candidate's emitted CSS.
 *
 * @param candidate - Candidate class name.
 * @param css - CSS Tailwind emitted, or null when it emits nothing.
 * @returns Signature, or null when no declaration belongs to the candidate.
 */
export function mergeSignatureFromCss(
    candidate: string,
    css: string | null,
): MergeSignature | null {
    if (css === null) return null;
    const propertiesByContext = new Map<string, Set<string>>();
    let important = false;

    try {
        postcss.parse(css).walkDecls(declaration => {
            const context = declarationContext(declaration, candidate);
            if (context === null) return;
            const properties = propertiesByContext.get(context) ?? new Set<string>();
            for (const property of expandCssProperty(declaration.prop)) properties.add(property);
            propertiesByContext.set(context, properties);
            if (declaration.important) important = true;
        });
    } catch {
        // CSS Tailwind emits that postcss or its selector parser cannot read,
        // `group-[/x]:p-4` among them. No signature is the answer the merge
        // gives whenever it cannot prove: both classes stay.
        return null;
    }

    if (propertiesByContext.size === 0) return null;
    const rules = [...propertiesByContext].map(([context, properties]) => ({
        context,
        properties: [...properties].sort(compareStrings),
    }));
    rules.sort((left, right) => compareStrings(left.context, right.context));
    return {
        rules,
        important,
    };
}

/** Each signature's resolved sides, kept as long as the signature is. */
const resolvedSignatures = new WeakMap<MergeSignature, ResolvedSignature>();

/**
 * Whether merging one list, in order, would remove a class from it.
 *
 * A class is removed when a later one covers it, its own signature included,
 * so this answers the question `_szcn` and the engine's merge answer, without
 * building a table. The object rule asks it for every list of a file before
 * it pays for a second engine pass. `n` classes: `O(n²)` coverage checks,
 * each over the earlier class's properties; lists are one object's keys.
 *
 * @param classes - One list a merge would read, in order.
 * @param signatureOf - The style model's signature lookup.
 * @returns True when a later class covers an earlier one.
 */
export function mergeRemovesFrom(
    classes: readonly string[],
    signatureOf: (candidate: string) => MergeSignature | null,
): boolean {
    const earlier: ResolvedSignature[] = [];
    for (const className of classes) {
        const signature = signatureOf(className);
        if (signature === null) continue;
        let later = resolvedSignatures.get(signature);
        if (later === undefined) {
            later = resolveSides(signature);
            resolvedSignatures.set(signature, later);
        }
        const resolved = later;
        if (earlier.some(previous => signatureCovers(resolved, previous))) return true;
        earlier.push(resolved);
    }
    return false;
}

/**
 * {@link mergeRemovesFrom}, read from a settled table instead of the model.
 *
 * For `n` classes and longest row `r`, each earlier-class check can scan the
 * entire row: `O(n² · (1 + r))` worst-case time and `O(n)` auxiliary space.
 *
 * @param signatures - Class name to signature id.
 * @param coverage - For each id, the ids it covers.
 * @param classes - One list a merge would read, in order.
 * @returns True when a later class has an earlier one's signature or covers it.
 */
export function tableRemovesFrom(
    signatures: Readonly<Record<string, number>>,
    coverage: ReadonlyArray<readonly number[]>,
    classes: readonly string[],
): boolean {
    const earlier: number[] = [];
    for (const className of classes) {
        // A number, never an inherited `constructor` or `toString`.
        const id: unknown = signatures[className];
        if (typeof id !== 'number') continue;
        const row = coverage[id] ?? [];
        if (earlier.some(previous => previous === id || row.includes(previous))) return true;
        earlier.push(id);
    }
    return false;
}
