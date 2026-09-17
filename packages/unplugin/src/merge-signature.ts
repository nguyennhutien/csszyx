/**
 * Derive merge signatures from CSS emitted by the project's Tailwind.
 *
 * @module
 */

import postcss, { type AtRule, type Declaration, type Node, type Rule } from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { LONGHANDS } from './longhand-table.generated.js';

/** The CSS evidence used to decide whether one class can replace another. */
export interface MergeSignature {
    /** Leaf properties grouped by the selector and at-rule context that writes them. */
    rules: ReadonlyArray<{ context: string; properties: readonly string[] }>;
    /** Whether any emitted declaration carries `!important`. */
    important: boolean;
}

/** Stable placeholder used while normalizing a candidate selector. */
const CANDIDATE_PLACEHOLDER = '__csszyx_candidate__';

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
            node.value = CANDIDATE_PLACEHOLDER;
        });
    }).processSync(selector);
    return matched ? normalized.replaceAll(`.${CANDIDATE_PLACEHOLDER}`, '&') : null;
}

/**
 * Find the selector rule that owns a declaration.
 *
 * @param declaration - Emitted declaration.
 * @returns Nearest rule ancestor, or null for global at-rule declarations.
 */
function ownerRule(declaration: Declaration): Rule | null {
    let parent: Node | undefined = declaration.parent;
    while (parent !== undefined) {
        if (parent.type === 'rule') return parent as Rule;
        parent = parent.parent;
    }
    return null;
}

/**
 * At-rules between a declaration and its candidate rule.
 *
 * @param declaration - Emitted declaration.
 * @returns Outer-to-inner at-rule descriptions.
 */
function declarationAtRules(declaration: Declaration): string[] {
    const rules: string[] = [];
    let parent: Node | undefined = declaration.parent;
    while (parent !== undefined) {
        if (parent.type === 'atrule') {
            const atRule = parent as AtRule;
            const params = atRule.params === '' ? '' : ` ${atRule.params}`;
            rules.push(`@${atRule.name}${params}`);
        }
        parent = parent.parent;
    }
    return rules.reverse();
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
        const owner = ownerRule(declaration);
        if (owner === null) return;
        const selector = normalizeSelector(owner.selector, candidate);
        if (selector === null) return;
        const atRules = declarationAtRules(declaration);
        const context = [...atRules, selector].join('|');
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
