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

/** One way Tailwind can read a class name. */
interface CandidateReading {
    kind: string;
    root: string;
    value?: { kind: string; value: string } | null;
}

/** The part of Tailwind's design system this reads. */
export interface CollisionDesignSystem {
    getClassList(): Iterable<string | readonly [string, unknown]>;
    parseCandidate(candidate: string): Iterable<CandidateReading>;
}

/**
 * Add one member to the set stored under `key`, creating it on first use.
 *
 * @param map - Index being built.
 * @param key - Key whose set receives the member.
 * @param member - Value to record.
 */
function addToSet<K>(map: Map<K, Set<string>>, key: K, member: string): void {
    const existing = map.get(key);
    if (existing) {
        existing.add(member);
        return;
    }
    map.set(key, new Set([member]));
}

/**
 * Record what one reading of a class name says about the two indexes.
 *
 * @param reading - One reading Tailwind offers for the class.
 * @param isStatic - Whether the same class also reads as a whole static utility.
 * @param probeOwner - Probe token name to the namespace that injected it.
 * @param prefixes - Namespace to the class roots it feeds.
 * @param ambiguous - Class root to the names read both ways under it.
 */
function indexReading(
    reading: CandidateReading,
    isStatic: boolean,
    probeOwner: ReadonlyMap<string, ThemeNamespace>,
    prefixes: Map<ThemeNamespace, Set<string>>,
    ambiguous: Map<string, Set<string>>,
): void {
    if (reading.kind !== 'functional' || reading.value?.kind !== 'named') return;
    const value = reading.value.value;
    const owner = probeOwner.get(value);
    if (owner) addToSet(prefixes, owner, reading.root);
    // Only a name read BOTH ways is a collision; a functional-only reading is
    // an ordinary token slot.
    if (isStatic) addToSet(ambiguous, reading.root, value);
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
            indexReading(reading, isStatic, probeOwner, prefixes, ambiguous);
        }
    }

    const empty: ReadonlySet<string> = new Set();
    return {
        prefixesFor: namespace => prefixes.get(namespace) ?? empty,
        ambiguousNames: prefix => ambiguous.get(prefix) ?? empty,
    };
}
