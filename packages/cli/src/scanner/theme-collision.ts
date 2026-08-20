/**
 * Theme tokens named after a built-in utility keyword.
 *
 * Declaring `--color-balance` does not add a colour class. `text-balance` is
 * already a static utility, so Tailwind MERGES the two readings: measured on
 * tailwindcss 4.3.3, the class ends up carrying `text-wrap: balance` AND
 * `color: var(--color-balance)`. It then competes on `color` with every other
 * colour class.
 *
 * szcn cannot tell the two apart, so it refuses to group and keeps both
 * classes. Stylesheet order decides from there — not the argument order szcn
 * promises. Measured: with `--color-balance` declared,
 * `szcn('text-red-500', 'text-balance')` renders RED, because `.text-red-500`
 * is emitted after `.text-balance`. The author gets the opposite colour.
 *
 * That is a correctness break rather than a missed optimisation, which is why
 * this fails the command rather than reporting and passing. `--allow-token`
 * exists for the project that wants it anyway: the exemption is then a line in
 * a diff someone reviews, instead of a check nobody runs.
 *
 * Reported at the DECLARATION. That is one line somebody can change; the use
 * sites are many and innocent, including the sz props csszyx itself lowers on
 * to the contaminated class.
 *
 * @module
 */
import { sortStrings } from '@csszyx/compiler';

import type { ThemeNamespace } from './sibling-keyword.js';

/** One theme token as the project declared it. */
export interface DeclaredToken {
    /** Namespace the token belongs to. */
    namespace: ThemeNamespace;
    /** Token name, without the `--color-` style prefix. */
    name: string;
    /** Project-relative stylesheet that declares it. */
    file: string;
    /** 1-based line of the declaration. */
    line: number;
}

/** A declared token whose name a built-in utility already claims. */
export interface ThemeCollisionFinding extends DeclaredToken {
    /** Every class this token changes the meaning of, sorted. */
    classes: string[];
}

/** What the project's design system is asked about a token name. */
export interface CollisionOracle {
    /**
     * The class roots a namespace's tokens generate classes under.
     *
     * @param namespace - The namespace to map.
     * @returns The roots, empty when the namespace feeds none.
     */
    prefixesFor(namespace: ThemeNamespace): ReadonlySet<string>;
    /**
     * Names Tailwind reads BOTH as a whole static utility and as this root
     * plus a value.
     *
     * @param prefix - The class root.
     * @returns The ambiguous names under it.
     */
    ambiguousNames(prefix: string): ReadonlySet<string>;
}

/**
 * Find declared tokens whose names a built-in utility already claims.
 *
 * @param declared - Tokens the project's stylesheets declare.
 * @param oracle - The project's design system.
 * @param allow - Token names the project accepted deliberately.
 * @returns One finding per colliding declaration, in the given order.
 */
export function findThemeCollisions(
    declared: readonly DeclaredToken[],
    oracle: CollisionOracle,
    allow: readonly string[],
): ThemeCollisionFinding[] {
    const accepted = new Set(allow);
    const findings: ThemeCollisionFinding[] = [];
    for (const token of declared) {
        if (accepted.has(token.name)) continue;
        const classes: string[] = [];
        for (const prefix of oracle.prefixesFor(token.namespace)) {
            if (oracle.ambiguousNames(prefix).has(token.name))
                classes.push(`${prefix}-${token.name}`);
        }
        if (classes.length === 0) continue;
        // Sorted so the report is stable across runs: the prefix set comes
        // from a design-system walk whose order is not part of its contract.
        findings.push({ ...token, classes: sortStrings(classes) });
    }
    return findings;
}
