/**
 * Ask a project's own Tailwind which class names its theme namespaces claim.
 *
 * Two facts are needed, and both are derived rather than listed. Which class
 * roots a namespace feeds is found by injecting a uniquely named PROBE token
 * per namespace and seeing which roots come back carrying it — measured on
 * tailwindcss 4.3.3, that is 51 roots for colours, one each for text sizes and
 * fonts. A hand-written table would be a fourth copy of the same mapping in
 * this repository, and would go stale the day Tailwind adds a utility.
 *
 * The probes must have DIFFERENT names. With one shared name the namespaces
 * compete for a root: `text-<probe>` resolves as a colour and `font-<probe>` as
 * a family, and the other two namespaces come back empty.
 *
 * Which names are ambiguous under a root is Tailwind's own answer too — a name
 * it reads BOTH as a whole static utility and as root-plus-value is exactly the
 * collision, the same derivation `scripts/check-szcn-collision-blocklist.mjs`
 * uses to keep the runtime blocklist honest.
 *
 * @module
 */
import type { ThemeNamespace } from './sibling-keyword.js';
import type { CollisionOracle } from './theme-collision.js';

/** The part of Tailwind's design system this reads. */
export interface CollisionDesignSystem {
    getClassList(): Iterable<string | readonly [string, unknown]>;
    parseCandidate(
        candidate: string,
    ): Iterable<{ kind: string; root: string; value?: { kind: string; value: string } | null }>;
}

/**
 * Probe token names, one per namespace.
 *
 * Deliberately unlikely to exist in a real theme: a project that declared one
 * of these would see its own token treated as the probe.
 */
export const PROBE_TOKENS: Readonly<Record<ThemeNamespace, string>> = {
    colors: 'czxprobecolor',
    textSizes: 'czxprobetext',
    fontFamilies: 'czxprobefamily',
    fontWeights: 'czxprobeweight',
};

/** The `@theme` block to append to a project's CSS before compiling. */
export const PROBE_THEME = `@theme {
  --color-${PROBE_TOKENS.colors}: #ff0000;
  --text-${PROBE_TOKENS.textSizes}: 1rem;
  --font-${PROBE_TOKENS.fontFamilies}: serif;
  --font-weight-${PROBE_TOKENS.fontWeights}: 555;
}
`;

/**
 * Build a collision oracle from a design system compiled WITH the probes.
 *
 * @param design - Design system built from the project CSS plus `PROBE_THEME`.
 * @returns An oracle answering from that project.
 */
export function collisionOracleFrom(design: CollisionDesignSystem): CollisionOracle {
    const prefixes = new Map<ThemeNamespace, Set<string>>();
    const ambiguous = new Map<string, Set<string>>();
    const probeOwner = new Map<string, ThemeNamespace>(
        Object.entries(PROBE_TOKENS).map(([namespace, probe]) => [
            probe,
            namespace as ThemeNamespace,
        ]),
    );

    for (const entry of design.getClassList()) {
        const cls = Array.isArray(entry) ? entry[0] : (entry as string);
        const readings = [...design.parseCandidate(cls)];
        const isStatic = readings.some(
            reading => reading.kind === 'static' && reading.root === cls,
        );
        for (const reading of readings) {
            if (reading.kind !== 'functional' || reading.value?.kind !== 'named') continue;
            const value = reading.value.value;
            const owner = probeOwner.get(value);
            if (owner) {
                if (!prefixes.has(owner)) prefixes.set(owner, new Set());
                prefixes.get(owner)?.add(reading.root);
            }
            // Only a name read BOTH ways is a collision; a functional-only
            // reading is an ordinary token slot.
            if (!isStatic) continue;
            if (!ambiguous.has(reading.root)) ambiguous.set(reading.root, new Set());
            ambiguous.get(reading.root)?.add(value);
        }
    }

    const empty: ReadonlySet<string> = new Set();
    return {
        prefixesFor: namespace => prefixes.get(namespace) ?? empty,
        ambiguousNames: prefix => ambiguous.get(prefix) ?? empty,
    };
}
