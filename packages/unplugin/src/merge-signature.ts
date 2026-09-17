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
 * @returns Compact class ids and directional signature coverage.
 */
export function createMergeSignatureTable(
    candidates: readonly string[],
    signatureOf: (candidate: string) => MergeSignature | null,
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
    return [byCandidate, coverage];
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
 * Normalize the candidate class in a selector to `&`.
 *
 * @param selector - Selector Tailwind emitted.
 * @param candidate - Candidate class name, already unescaped by the parser.
 * @returns Normalized selector, or null when the selector does not target the candidate.
 */
function normalizeSelector(selector: string, candidate: string): string | null {
    let matched = false;
    const normalized = selectorParser(selectors => {
        selectors.walkClasses(node => {
            if (node.value !== candidate) return;
            matched = true;
            node.replaceWith(selectorParser.nesting({ value: '&' }));
        });
    }).processSync(selector);
    return matched ? normalized : null;
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
    let matched = false;
    let parent: Node | undefined = declaration.parent;
    while (parent !== undefined) {
        if (parent.type === 'rule') {
            const rule = parent as Rule;
            const selector = normalizeSelector(rule.selector, candidate);
            if (selector !== null) matched = true;
            path.push(['selector', selector ?? rule.selector]);
        }
        if (parent.type === 'atrule') {
            const atRule = parent as AtRule;
            if (atRule.name === 'property' || atRule.name.endsWith('keyframes')) return null;
            path.push(['at-rule', atRule.name, atRule.params]);
        }
        parent = parent.parent;
    }
    return matched ? JSON.stringify([path.reverse(), Boolean(declaration.important)]) : null;
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

    postcss.parse(css).walkDecls(declaration => {
        const context = declarationContext(declaration, candidate);
        if (context === null) return;
        const properties = propertiesByContext.get(context) ?? new Set<string>();
        for (const property of expandCssProperty(declaration.prop)) properties.add(property);
        propertiesByContext.set(context, properties);
        if (declaration.important) important = true;
    });

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
