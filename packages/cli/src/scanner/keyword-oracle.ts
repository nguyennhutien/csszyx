/**
 * Ask a project's own Tailwind the three questions the sibling-keyword rule has.
 *
 * All three depend on the project, not on Tailwind's defaults: a project's
 * `@theme` adds token names, and a `@utility` block can change what a class
 * name sets. Answering from a table would be answering a different project's
 * question.
 *
 * Narrow on purpose. The rule stays testable without compiling Tailwind, and a
 * change to Tailwind's API lands here rather than in the rule's logic.
 *
 * @module
 */
import type { KeywordOracle, ThemeNamespace } from './sibling-keyword.js';

/** The part of Tailwind's design system this adapter reads. */
export interface KeywordDesignSystem {
    theme: { entries(): Iterable<readonly [string, unknown]> };
    parseCandidate(candidate: string): Iterable<{ kind: string; root: string }>;
    candidatesToCss(candidates: readonly string[]): Array<string | null>;
}

/** The CSS variable prefix each namespace's tokens are declared under. */
const NAMESPACE_PREFIX: Readonly<Record<ThemeNamespace, string>> = {
    colors: '--color-',
    textSizes: '--text-',
    fontFamilies: '--font-',
    fontWeights: '--font-weight-',
};

/** A declaration's property name, skipping custom properties. */
const DECLARED_PROPERTY = /(?:^|[;{])\s*([a-z-]+)\s*:/g;

/**
 * Adapt a design system to the rule's oracle.
 *
 * @param design - The project's compiled design system.
 * @returns An oracle answering from that project.
 */
export function keywordOracleFrom(design: KeywordDesignSystem): KeywordOracle {
    const names = new Map<ThemeNamespace, Set<string>>();

    return {
        themeNames(namespace) {
            const cached = names.get(namespace);
            if (cached) return cached;
            const prefix = NAMESPACE_PREFIX[namespace];
            const resolved = new Set<string>();
            for (const [key] of design.theme.entries()) {
                if (!key.startsWith(prefix)) continue;
                const name = key.slice(prefix.length);
                // `--color-` with nothing after it names no token, and a
                // `--font-weight-*` key reached through the `--font-` prefix
                // belongs to the other namespace.
                if (name === '' || name.startsWith('-')) continue;
                if (namespace === 'fontFamilies' && key.startsWith(NAMESPACE_PREFIX.fontWeights)) {
                    continue;
                }
                resolved.add(name);
            }
            names.set(namespace, resolved);
            return resolved;
        },

        isStaticUtility(className) {
            // Tailwind returns EVERY reading of a name. A static reading of the
            // WHOLE name is what makes it a built-in keyword utility rather
            // than a prefix plus a value.
            for (const reading of design.parseCandidate(className)) {
                if (reading.kind === 'static' && reading.root === className) return true;
            }
            return false;
        },

        propertiesOf(className) {
            const rule = design.candidatesToCss([className])[0];
            if (rule == null) return null;
            const properties = new Set<string>();
            for (const [, property] of rule.matchAll(DECLARED_PROPERTY)) {
                // A `--tw-*` variable is a step on the way to a property, not a
                // property; counting it would make unrelated classes look alike.
                if (!property.startsWith('--')) properties.add(property);
            }
            return properties;
        },
    };
}
