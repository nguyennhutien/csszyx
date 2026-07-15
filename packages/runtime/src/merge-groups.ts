/**
 * Value-set-aware conflict groups for the ambiguous utility prefixes.
 *
 * `szcn` merges by utility prefix, but eight prefixes span MORE than one CSS
 * property (`text-sm` is font-size, `text-red-500` is color), so they used to
 * be excluded from dedup entirely — a consumer's `text-sm` override after a
 * `text-base` default kept BOTH classes and the stylesheet order, not the
 * className order, picked the winner. This module classifies a token's VALUE
 * into a property group (closed keyword sets + shape validators), so same-group
 * tokens dedupe last-wins while different properties keep co-existing.
 *
 * Fail-safe contract (inherited from szcn): classification may only ever err
 * toward `null` = keep-both. A value that matches no group — or matches more
 * than one — is never merged away.
 *
 * Custom `@theme` tokens: the build plugin auto-registers theme token names via
 * `registerSzcnGroups` (see `virtual:csszyx/theme-groups`); apps can call it
 * directly for hand-written CSS classes. Registration is guarded: a name that
 * collides with a static value keyword of an affected prefix (e.g. a color
 * token named `cover` — `bg-cover` is background-size) or that is registered in
 * two conflicting categories is dropped with a dev warning, falling back to
 * keep-both rather than guessing. The ambiguity drop is remembered across
 * registration batches, so a later batch re-registering only one side cannot
 * resurrect the name into a single category.
 *
 * @module
 */

/** Tailwind palette shades — `{name}-{shade}` is the standard color shape. */
const PALETTE_SHADES = new Set([
    '50',
    '100',
    '200',
    '300',
    '400',
    '500',
    '600',
    '700',
    '800',
    '900',
    '950',
]);

/** Named colors that never take a shade suffix. */
const NAMED_COLORS = new Set(['white', 'black', 'transparent', 'current', 'inherit']);

const TEXT_SIZES = new Set([
    'xs',
    'sm',
    'base',
    'lg',
    'xl',
    '2xl',
    '3xl',
    '4xl',
    '5xl',
    '6xl',
    '7xl',
    '8xl',
    '9xl',
]);
const TEXT_ALIGNS = new Set(['left', 'center', 'right', 'justify', 'start', 'end']);
const TEXT_WRAPS = new Set(['wrap', 'nowrap', 'balance', 'pretty']);
const TEXT_OVERFLOWS = new Set(['clip', 'ellipsis']);

const FONT_FAMILIES = new Set(['sans', 'serif', 'mono']);
const FONT_WEIGHTS = new Set([
    'thin',
    'extralight',
    'light',
    'normal',
    'medium',
    'semibold',
    'bold',
    'extrabold',
    'black',
]);

const BG_POSITIONS = new Set([
    'top',
    'bottom',
    'left',
    'right',
    'center',
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
    'left-top',
    'left-bottom',
    'right-top',
    'right-bottom',
]);
const BG_SIZES = new Set(['auto', 'cover', 'contain']);
const BG_REPEATS = new Set([
    'repeat',
    'no-repeat',
    'repeat-x',
    'repeat-y',
    'repeat-round',
    'repeat-space',
]);
const BG_ATTACHMENTS = new Set(['fixed', 'local', 'scroll']);

const BORDER_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'hidden', 'none']);
const FLEX_DIRECTIONS = new Set(['row', 'row-reverse', 'col', 'col-reverse']);
const FLEX_WRAPS = new Set(['wrap', 'wrap-reverse', 'nowrap']);
const FLEX_SHORTHANDS = new Set(['auto', 'initial', 'none']);

/** Directional first segments — v1 keeps directional border/divide keep-both. */
const DIRECTIONAL_SEGMENTS = new Set(['t', 'r', 'b', 'l', 'x', 'y', 's', 'e']);

/**
 * Registered custom token names per THEME category. Populated by
 * `registerSzcnGroups` (usually via the build plugin's theme scan).
 */
const customTokens = {
    colors: new Set<string>(),
    textSizes: new Set<string>(),
    fontFamilies: new Set<string>(),
    fontWeights: new Set<string>(),
};

/** A pair of categories whose token names collide on one utility prefix. */
interface AmbiguityPair {
    /** Names dropped from both categories — the ambiguity is permanent. */
    dropped: Set<string>;
    /** Builds the keep-both warning for a name in this pair. */
    message: (name: string) => string;
}

/**
 * Cross-category ambiguity memory. A name dropped from both categories of a
 * pair must STAY unclassifiable regardless of registration order: the theme
 * still defines both meanings, so a later batch re-registering only one side
 * (split manual calls, or an HMR re-execution replaying a partial batch) must
 * not silently resurrect the name in a single category and start merging
 * classes the other meaning still owns.
 */
const AMBIGUITY_PAIRS: { colorTextSize: AmbiguityPair; fontFamilyWeight: AmbiguityPair } = {
    colorTextSize: {
        dropped: new Set<string>(),
        message: name =>
            `theme token "${name}" is defined as BOTH a color and a text size — ` +
            `szcn cannot classify \`text-${name}\` and will keep-both instead of merging.`,
    },
    fontFamilyWeight: {
        dropped: new Set<string>(),
        message: name =>
            `theme token "${name}" is defined as BOTH a font family and a font weight — ` +
            `szcn cannot classify \`font-${name}\` and will keep-both instead of merging.`,
    },
};

/** The ambiguity pair each category participates in. */
const AMBIGUITY_PAIR_BY_CATEGORY: Record<keyof typeof customTokens, AmbiguityPair> = {
    colors: AMBIGUITY_PAIRS.colorTextSize,
    textSizes: AMBIGUITY_PAIRS.colorTextSize,
    fontFamilies: AMBIGUITY_PAIRS.fontFamilyWeight,
    fontWeights: AMBIGUITY_PAIRS.fontFamilyWeight,
};

/** Custom token categories accepted by {@link registerSzcnGroups}. */
export interface SzcnThemeGroups {
    /** Color token names (`brand` → `text-brand`, `bg-brand`, `border-brand`, …). */
    colors?: readonly string[];
    /** Font-size token names (`huge` → `text-huge`). */
    textSizes?: readonly string[];
    /** Font-family token names (`display` → `font-display`). */
    fontFamilies?: readonly string[];
    /** Font-weight token names (`chunky` → `font-chunky`). */
    fontWeights?: readonly string[];
}

/**
 * Static value keywords per category that a custom token name must NOT shadow.
 * A color token named `cover` would classify `bg-cover` (background-size!) as a
 * color and merge it wrongly — the exact "delete a different property" bug this
 * module exists to prevent. Colliding names are rejected, keeping keep-both.
 */
const COLLISION_BLOCKLIST: Record<keyof typeof customTokens, ReadonlySet<string>> = {
    colors: new Set([
        ...NAMED_COLORS,
        ...TEXT_SIZES,
        ...TEXT_ALIGNS,
        ...TEXT_WRAPS,
        ...TEXT_OVERFLOWS,
        ...BG_POSITIONS,
        ...BG_SIZES,
        ...BG_REPEATS,
        ...BG_ATTACHMENTS,
        ...BORDER_STYLES,
    ]),
    textSizes: new Set([...TEXT_ALIGNS, ...TEXT_WRAPS, ...TEXT_OVERFLOWS, ...NAMED_COLORS]),
    fontFamilies: new Set(FONT_WEIGHTS),
    fontWeights: new Set(FONT_FAMILIES),
};

/**
 * One-time dev warning helper (mirrors the runtime's devWarn conventions
 * without importing the variants module).
 *
 * @param message - The warning text.
 */
function warnOnce(message: string): void {
    if (process.env.NODE_ENV !== 'production' && !_warned.has(message)) {
        _warned.add(message);
        console.warn(`[csszyx] ${message}`);
    }
}
const _warned = new Set<string>();

/**
 * Register custom theme token names so szcn can dedupe classes built from them
 * (`text-brand` + `text-accent` → last wins). Idempotent and additive; called
 * automatically by the build plugin from the app's `@theme` blocks, or manually
 * for hand-written CSS utilities.
 *
 * Guard rails (both fall back to keep-both, never a wrong merge):
 * - a name colliding with a static utility keyword of an affected prefix is
 *   rejected (e.g. a color named `cover`);
 * - a name registered in two conflicting categories (e.g. both a color and a
 *   text size — `text-huge` would be unclassifiable) is removed from both,
 *   and STAYS removed: later batches re-registering only one side are
 *   rejected too, so registration order can never resurrect an ambiguous
 *   name into a single category.
 *
 * @param groups - Custom token names per theme category.
 */
export function registerSzcnGroups(groups: SzcnThemeGroups): void {
    // Classification only changes when a set gains or loses a name. Bumping
    // the generation on a no-op re-registration (idempotent boot code, an HMR
    // re-execution of the generated registration module, or a misplaced call
    // inside a component) would needlessly flush szcn's merge memo.
    let changed = false;
    const entries: ReadonlyArray<[keyof typeof customTokens, readonly string[] | undefined]> = [
        ['colors', groups.colors],
        ['textSizes', groups.textSizes],
        ['fontFamilies', groups.fontFamilies],
        ['fontWeights', groups.fontWeights],
    ];
    for (const [category, names] of entries) {
        if (registerThemeCategory(category, names)) changed = true;
    }
    // Cross-category ambiguity: `--color-huge` + `--text-huge` makes `text-huge`
    // mean two different properties. Drop from both — keep-both over guessing.
    if (dropAmbiguousThemeTokens('colors', 'textSizes', AMBIGUITY_PAIRS.colorTextSize))
        changed = true;
    if (dropAmbiguousThemeTokens('fontFamilies', 'fontWeights', AMBIGUITY_PAIRS.fontFamilyWeight))
        changed = true;
    if (changed) {
        _generation++;
    }
}

/**
 * Register one theme category, rejecting collisions and prior ambiguities.
 * @param category - Theme token category.
 * @param names - Candidate token names.
 * @returns Whether the registry changed.
 */
function registerThemeCategory(
    category: keyof typeof customTokens,
    names: readonly string[] | undefined,
): boolean {
    let changed = false;
    for (const name of names ?? []) {
        if (!name || typeof name !== 'string') continue;
        if (COLLISION_BLOCKLIST[category].has(name)) {
            warnOnce(
                `theme token "${name}" shadows a built-in ${category === 'colors' ? 'utility keyword' : 'value'} — ` +
                    'szcn will not group classes built from it (they keep the safe keep-both behaviour). ' +
                    'Rename the token to enable precise merging.',
            );
            continue;
        }
        const pair = AMBIGUITY_PAIR_BY_CATEGORY[category];
        if (pair.dropped.has(name)) {
            warnOnce(pair.message(name));
            continue;
        }
        if (!customTokens[category].has(name)) {
            customTokens[category].add(name);
            changed = true;
        }
    }
    return changed;
}

/**
 * Drop names registered into two categories that share class syntax.
 * @param first - First conflicting category.
 * @param second - Second conflicting category.
 * @param pair - Ambiguity state shared by the categories.
 * @returns Whether any token was dropped.
 */
function dropAmbiguousThemeTokens(
    first: keyof typeof customTokens,
    second: keyof typeof customTokens,
    pair: (typeof AMBIGUITY_PAIRS)[keyof typeof AMBIGUITY_PAIRS],
): boolean {
    let changed = false;
    for (const name of customTokens[first]) {
        if (!customTokens[second].has(name)) continue;
        customTokens[first].delete(name);
        customTokens[second].delete(name);
        pair.dropped.add(name);
        warnOnce(pair.message(name));
        changed = true;
    }
    return changed;
}

/**
 * Monotonic generation counter — bumped whenever the registered token sets
 * change, so szcn's memo can invalidate cached merges that were classified
 * under the old groups.
 */
let _generation = 0;

/**
 * Current registration generation (see {@link registerSzcnGroups}).
 *
 * @returns The generation counter value.
 */
export function getSzcnGroupsGeneration(): number {
    return _generation;
}

/** Reset the custom registry — test-only. */
export function _resetSzcnGroups(): void {
    for (const set of Object.values(customTokens)) {
        set.clear();
    }
    AMBIGUITY_PAIRS.colorTextSize.dropped.clear();
    AMBIGUITY_PAIRS.fontFamilyWeight.dropped.clear();
    _warned.clear();
    _generation++;
}

/**
 * Whether a value names a color: standard palette shape (`red-500`), named
 * color, registered custom color token, or a color-typed arbitrary value.
 * A trailing opacity modifier (`/35`) is stripped first.
 *
 * @param rawValue - The value part of the class (after the utility prefix).
 * @returns True when the value is confidently a color.
 */
function isColorValue(rawValue: string): boolean {
    const value = rawValue.replace(/\/[\w.[\]%]+$/, '');
    if (NAMED_COLORS.has(value) || customTokens.colors.has(value)) {
        return true;
    }
    const shadeAt = value.lastIndexOf('-');
    if (shadeAt > 0 && PALETTE_SHADES.has(value.slice(shadeAt + 1))) {
        return true;
    }
    return /^\[(?:#|rgb|hsl|oklch|oklab|lab|lch|color\()/.test(value);
}

/**
 * Whether an arbitrary value looks like a length/number (never a color).
 *
 * @param value - The value part including brackets.
 * @returns True for `[13px]`, `[2.5rem]`, `[calc(...)]`-style values.
 */
function isLengthArbitrary(value: string): boolean {
    return /^\[(?:-?[\d.]|calc\(|clamp\(|min\(|max\(|length:)/.test(value);
}

/**
 * Classify the value of an ambiguous-prefix token into a property group.
 *
 * @param prefix - The ambiguous utility prefix (`text`, `font`, `bg`, …).
 * @param value - Everything after `${prefix}-` (empty string for the bare prefix).
 * @returns A group id unique per (prefix, property), or `null` to keep-both.
 */
export function classifyAmbiguousValue(prefix: string, value: string): string | null {
    switch (prefix) {
        case 'text':
            return classifyTextValue(value);
        case 'font':
            return classifyFontValue(value);
        case 'bg':
            return classifyBackgroundValue(value);
        case 'border':
        case 'divide':
        case 'ring':
        case 'outline':
            return classifyBorderValue(prefix, value);
        case 'flex':
            return classifyFlexValue(value);
        default:
            return null;
    }
}

/**
 * Classifies an ambiguous `text-*` value.
 * @param value - The value after the utility prefix.
 * @returns The text property group, or `null` when uncertain.
 */
function classifyTextValue(value: string): string | null {
    const sizeValue = value.replace(/\/[\w.[\]]+$/, '');
    if (TEXT_SIZES.has(sizeValue) || customTokens.textSizes.has(sizeValue)) {
        return 'text:size';
    }
    if (isLengthArbitrary(sizeValue)) {
        return 'text:size';
    }
    if (TEXT_ALIGNS.has(value)) {
        return 'text:align';
    }
    if (TEXT_WRAPS.has(value)) {
        return 'text:wrap';
    }
    if (TEXT_OVERFLOWS.has(value)) {
        return 'text:overflow';
    }
    return isColorValue(value) ? 'text:color' : null;
}

/**
 * Classifies an ambiguous `font-*` value.
 * @param value - The value after the utility prefix.
 * @returns The font property group, or `null` when uncertain.
 */
function classifyFontValue(value: string): string | null {
    if (FONT_FAMILIES.has(value) || customTokens.fontFamilies.has(value)) {
        return 'font:family';
    }
    if (FONT_WEIGHTS.has(value) || customTokens.fontWeights.has(value) || /^\[\d+\]$/.test(value)) {
        return 'font:weight';
    }
    return null;
}

/**
 * Classifies an ambiguous `bg-*` value.
 * @param value - The value after the utility prefix.
 * @returns The background property group, or `null` when uncertain.
 */
function classifyBackgroundValue(value: string): string | null {
    if (isColorValue(value)) return 'bg:color';
    if (BG_POSITIONS.has(value) || value.startsWith('position-')) return 'bg:position';
    if (BG_SIZES.has(value) || value.startsWith('size-')) return 'bg:size';
    if (BG_REPEATS.has(value)) return 'bg:repeat';
    if (BG_ATTACHMENTS.has(value)) return 'bg:attachment';
    if (value.startsWith('clip-')) return 'bg:clip';
    if (value.startsWith('origin-')) return 'bg:origin';
    return isBackgroundImage(value) ? 'bg:image' : null;
}

/**
 * Tests whether a background value selects an image or gradient utility.
 * @param value - The value after the `bg-` prefix.
 * @returns Whether the value belongs to the background-image group.
 */
function isBackgroundImage(value: string): boolean {
    return (
        value === 'none' ||
        value.startsWith('gradient-to-') ||
        value.startsWith('linear-') ||
        value === 'radial' ||
        value.startsWith('radial-') ||
        value.startsWith('conic-') ||
        value === 'conic' ||
        /^\[url\(/.test(value) ||
        /^\[image:/.test(value)
    );
}

/**
 * Classifies an ambiguous border-like utility value.
 * @param prefix - The border-like utility prefix.
 * @param value - The value after the utility prefix.
 * @returns The border property group, or `null` when uncertain.
 */
function classifyBorderValue(prefix: string, value: string): string | null {
    const firstSegment = value.split('-', 1)[0] ?? '';
    if (DIRECTIONAL_SEGMENTS.has(firstSegment)) return null;
    if (isColorValue(value)) return `${prefix}:color`;
    if (value === '' || /^\d+$/.test(value) || isLengthArbitrary(value)) {
        return `${prefix}:width`;
    }
    return BORDER_STYLES.has(value) ? `${prefix}:style` : null;
}

/**
 * Classifies an ambiguous `flex-*` value.
 * @param value - The value after the utility prefix.
 * @returns The flex property group, or `null` when uncertain.
 */
function classifyFlexValue(value: string): string | null {
    if (FLEX_DIRECTIONS.has(value)) return 'flex:direction';
    if (FLEX_WRAPS.has(value)) return 'flex:wrap';
    if (FLEX_SHORTHANDS.has(value) || /^\d+$/.test(value) || isLengthArbitrary(value)) {
        return 'flex:shorthand';
    }
    return null;
}
