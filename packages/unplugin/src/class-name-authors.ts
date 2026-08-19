/**
 * Class names a project's own stylesheets give more than one author.
 *
 * Tailwind v4 treats a class name as a namespace several sources contribute
 * to, and MERGES rather than refuses when two of them land on the same name.
 * Measured against the pinned version, every pairing is silent — including two
 * `@utility` blocks with one name, which emit both declarations into a single
 * rule, and a `@utility` on a name a `--color-*` token already generates.
 *
 * Scope is deliberately what nothing else covers. A theme token that shadows a
 * BUILT-IN keyword is already reported by the runtime's szcn classifier, which
 * owns that keyword list and is gated against Tailwind by
 * `scripts/check-szcn-collision-blocklist.mjs`. Repeating the check here would
 * mean a second copy of that list with no gate of its own, so this reads only
 * what the runtime cannot see: the `@utility` blocks, which never reach it.
 *
 * The report lands at the declaration. A declaration is one line somebody can
 * change; the uses are many and mostly innocent, including the `sz` props
 * csszyx itself lowers onto the contaminated class.
 */

/** One class name whose meaning more than one declaration decides. */
export interface ClassNameAuthorConflict {
    /** The claimed class name. */
    name: string;
    /** What the name collides with. */
    reason: 'declared twice' | 'a theme token already generates it';
}

/** What the stylesheet scanners read out of a project. */
export interface DeclaredNames {
    /** `--color-*` token names. */
    themeColors: readonly string[];
    /** Class names claimed by a static `@utility` block. */
    utilityStatics: readonly string[];
}

/**
 * The class prefixes a `--color-*` token feeds.
 *
 * Only used to ask whether a utility's name is one a token already generates,
 * so it needs the prefixes and not the keyword list the runtime guards.
 */
const COLOR_CLASS_PREFIXES: readonly string[] = [
    'text',
    'bg',
    'border',
    'decoration',
    'shadow',
    'outline',
    'ring',
    'fill',
    'stroke',
    'divide',
    'accent',
    'caret',
    'from',
    'via',
    'to',
    'inset-shadow',
    'inset-ring',
    'placeholder',
];

/**
 * Find the class names this project gives a second author.
 *
 * @param declared - The names the project's stylesheets declare.
 * @returns One entry per conflicting name, empty when the project has none.
 */
export function findClassNameAuthorConflicts(declared: DeclaredNames): ClassNameAuthorConflict[] {
    const generatedByTheme = new Set(
        declared.themeColors.flatMap(name =>
            COLOR_CLASS_PREFIXES.map(prefix => `${prefix}-${name}`),
        ),
    );

    const conflicts: ClassNameAuthorConflict[] = [];
    const seen = new Set<string>();
    for (const cls of declared.utilityStatics) {
        const declaredTwice = seen.has(cls);
        seen.add(cls);
        if (conflicts.some(existing => existing.name === cls)) continue;
        if (declaredTwice) {
            conflicts.push({ name: cls, reason: 'declared twice' });
            continue;
        }
        if (generatedByTheme.has(cls)) {
            conflicts.push({ name: cls, reason: 'a theme token already generates it' });
        }
    }
    return conflicts;
}
