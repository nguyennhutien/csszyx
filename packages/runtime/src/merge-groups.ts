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
 * Custom `@theme` tokens: the build plugin declares theme token names through
 * `setSzcnGroups` (see `virtual:csszyx/theme-groups`); apps can register their
 * own for hand-written CSS classes. Declarations are kept PER SOURCE so a
 * rebuild can replace its own set — a token deleted from a stylesheet has to
 * stop grouping — without touching what the app registered by hand.
 *
 * Both are guarded, and both guard rails fall back to keep-both rather than
 * guessing: a name that collides with a static value keyword of an affected
 * prefix (e.g. a color token named `cover` — `bg-cover` is background-size) is
 * rejected, and a name declared in two conflicting categories is dropped from
 * both. The effective sets are recomputed from every source on each change, so
 * neither answer depends on the order things were registered in.
 *
 * @module
 */
import { sortStrings } from './sort.js';

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

/**
 * Shadow scale, shared by `shadow-*`, `inset-shadow-*` and `drop-shadow-*`.
 *
 * One set for all three: a keyword only one of them accepts still is not a
 * colour, so classifying it as a size on the others costs nothing — those
 * classes do not exist to collide with.
 */
const SHADOW_SIZES = new Set(['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', 'none']);

/** `text-decoration-style` keywords. */
const DECORATION_STYLES = new Set(['solid', 'double', 'dotted', 'dashed', 'wavy']);

/** Non-numeric `text-decoration-thickness` keywords. */
const DECORATION_THICKNESSES = new Set(['auto', 'from-font']);

/** A gradient stop position: `from-10%`, `via-33.3%`. */
const GRADIENT_STOP_POSITION = /^\d+(?:\.\d+)?%$/;
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

/** Theme categories, in the order reads report them. */
const CATEGORIES = ['colors', 'textSizes', 'fontFamilies', 'fontWeights'] as const;

/** One theme category name. */
type ThemeCategory = (typeof CATEGORIES)[number];

/** Two categories whose token names collide on one utility prefix. */
interface AmbiguityPair {
    first: ThemeCategory;
    second: ThemeCategory;
    /** Builds the keep-both warning for a name in this pair. */
    message: (name: string) => string;
}

/**
 * Category pairs that share class syntax, so one name in both is unreadable.
 *
 * The effective sets are recomputed from every source on each change, so the
 * answer here never depends on the order things were registered in — which is
 * why no name has to be remembered as permanently dropped. A token that stops
 * being declared in one of the two categories simply stops being ambiguous.
 */
const AMBIGUITY_PAIRS: readonly AmbiguityPair[] = [
    {
        first: 'colors',
        second: 'textSizes',
        message: name =>
            `theme token "${name}" is defined as BOTH a color and a text size — ` +
            `szcn cannot classify \`text-${name}\` and will keep-both instead of merging.`,
    },
    {
        first: 'fontFamilies',
        second: 'fontWeights',
        message: name =>
            `theme token "${name}" is defined as BOTH a font family and a font weight — ` +
            `szcn cannot classify \`font-${name}\` and will keep-both instead of merging.`,
    },
];

/**
 * What each source declared, before the guard rails run.
 *
 * Two producers write here — the build's `@theme` scan and an app registering
 * hand-written CSS — and a rebuild must be able to replace ITS OWN set without
 * touching the other's. Keeping the raw declarations per source is what makes
 * that possible; {@link customTokens} stays the flattened result the hot
 * classification path reads, so grouping a class costs the same as before.
 */
const sourceDeclarations = new Map<string, Record<ThemeCategory, Set<string>>>();

/** Source a call is attributed to when it does not name one. */
const DEFAULT_SOURCE = 'app';

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
/**
 * Static keywords Tailwind reads under a colour-carrying prefix.
 *
 * Derived, not judged: `scripts/check-szcn-collision-blocklist.mjs` asks
 * Tailwind's own `parseCandidate` which class names come back with BOTH a
 * static and a functional reading, and a name in that set is one a colour
 * token would shadow. Measured consequence of missing one — with
 * `--color-collapse` declared, `szcn('border-collapse', 'border-red-500')`
 * returned `border-red-500`, deleting a border-collapse the author set.
 */
const BLEND_MODES = new Set([
    'blend-color',
    'blend-color-burn',
    'blend-color-dodge',
    'blend-darken',
    'blend-difference',
    'blend-exclusion',
    'blend-hard-light',
    'blend-hue',
    'blend-lighten',
    'blend-luminosity',
    'blend-multiply',
    'blend-normal',
    'blend-overlay',
    'blend-saturation',
    'blend-screen',
    'blend-soft-light',
]);

const BG_CLIPS = new Set(['clip-border', 'clip-content', 'clip-padding', 'clip-text']);

const BG_ORIGINS = new Set(['origin-border', 'origin-content', 'origin-padding']);

const BORDER_COLLAPSE = new Set(['collapse', 'separate']);

/** Keywords the ring, shadow and divide prefixes spell without a value. */
const RING_SHADOW_DIVIDE_KEYWORDS = new Set([
    'inset',
    'initial',
    'shadow-initial',
    'spacing-px',
    'spacing-x-px',
    'spacing-y-px',
    'x-reverse',
    'y-reverse',
]);

/** `font-stretch-*` keywords, which a font-family or font-weight token shadows. */
const FONT_STRETCHES = new Set([
    'stretch-condensed',
    'stretch-expanded',
    'stretch-extra-condensed',
    'stretch-extra-expanded',
    'stretch-normal',
    'stretch-semi-condensed',
    'stretch-semi-expanded',
    'stretch-ultra-condensed',
    'stretch-ultra-expanded',
]);

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
        ...SHADOW_SIZES,
        ...DECORATION_STYLES,
        ...DECORATION_THICKNESSES,
        ...BLEND_MODES,
        ...BG_CLIPS,
        ...BG_ORIGINS,
        ...BORDER_COLLAPSE,
        ...RING_SHADOW_DIVIDE_KEYWORDS,
    ]),
    textSizes: new Set([
        ...TEXT_ALIGNS,
        ...TEXT_WRAPS,
        ...TEXT_OVERFLOWS,
        ...NAMED_COLORS,
        'shadow-initial',
    ]),
    fontFamilies: new Set([...FONT_WEIGHTS, ...FONT_STRETCHES]),
    fontWeights: new Set([...FONT_FAMILIES, ...FONT_STRETCHES]),
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
 * Add token names to a source's declaration, keeping what it already declared.
 *
 * The default for hand-written CSS utilities: call it once per group of
 * classes, in any order. The build plugin uses {@link setSzcnGroups} instead,
 * because a rebuild has to be able to drop tokens the stylesheet lost.
 *
 * Guard rails (both fall back to keep-both, never a wrong merge):
 * - a name colliding with a static utility keyword of an affected prefix is
 *   rejected (e.g. a color named `cover`);
 * - a name declared in two conflicting categories (e.g. both a color and a
 *   text size — `text-huge` would be unclassifiable) is dropped from both, for
 *   as long as both declarations exist.
 *
 * @param groups - Custom token names per theme category.
 * @param source - Owner these names belong to.
 */
export function registerSzcnGroups(groups: SzcnThemeGroups, source: string = DEFAULT_SOURCE): void {
    writeDeclarations(source, groups, false);
}

/**
 * Replace everything one source declared.
 *
 * This is the operation a re-running build needs: the generated registration
 * carries the COMPLETE scanned set, so replacing is what makes a deleted or
 * renamed `@theme` token stop grouping without restarting the process. Other
 * sources are untouched, so a rebuild cannot wipe an app's own registration.
 *
 * @param groups - The source's complete token set; a category left out is
 * cleared, because the declaration is exactly what is passed.
 * @param source - Owner whose declaration is replaced.
 */
export function setSzcnGroups(groups: SzcnThemeGroups, source: string = DEFAULT_SOURCE): void {
    writeDeclarations(source, groups, true);
}

/**
 * Drop a source's declaration, or every source's.
 *
 * @param source - Owner to forget; omit to clear the whole registry.
 */
export function clearSzcnGroups(source?: string): void {
    if (source === undefined) sourceDeclarations.clear();
    else if (!sourceDeclarations.delete(source)) return;
    recomputeEffectiveTokens();
}

/**
 * Read the token names currently in effect, per category.
 *
 * Reports what survived the guard rails, not what was declared — a name that
 * was rejected or is ambiguous is absent, because that is what classification
 * actually sees. Intended for tests and diagnostics; it copies and sorts, so
 * it is not a hot-path call.
 *
 * @returns Sorted copies of the effective sets.
 */
export function getSzcnGroups(): Record<ThemeCategory, string[]> {
    return {
        colors: sortStrings(customTokens.colors),
        textSizes: sortStrings(customTokens.textSizes),
        fontFamilies: sortStrings(customTokens.fontFamilies),
        fontWeights: sortStrings(customTokens.fontWeights),
    };
}

/**
 * Write one source's declaration and refresh the effective sets.
 *
 * @param source - Owner of the declaration.
 * @param groups - Token names per category.
 * @param replace - Whether to drop what the source declared before.
 */
function writeDeclarations(source: string, groups: SzcnThemeGroups, replace: boolean): void {
    let bucket = sourceDeclarations.get(source);
    if (!bucket) {
        bucket = {
            colors: new Set<string>(),
            textSizes: new Set<string>(),
            fontFamilies: new Set<string>(),
            fontWeights: new Set<string>(),
        };
        sourceDeclarations.set(source, bucket);
    }
    for (const category of CATEGORIES) {
        if (replace) bucket[category].clear();
        for (const name of groups[category] ?? []) {
            if (name && typeof name === 'string') bucket[category].add(name);
        }
    }
    recomputeEffectiveTokens();
}

/**
 * Rebuild the effective sets from every source and apply the guard rails.
 *
 * Recomputing rather than mutating in place is what lets a declaration shrink:
 * an incremental registry can only ever grow, which is why a deleted token used
 * to keep merging until the process restarted.
 */
function recomputeEffectiveTokens(): void {
    const next = collectDeclaredTokens();
    dropAmbiguousTokens(next);
    if (commitEffectiveTokens(next)) _generation++;
}

/** Effective token names per category, mid-recompute. */
type TokensByCategory = Record<ThemeCategory, Set<string>>;

/**
 * Union every source's declarations, minus the tokens that shadow built-ins.
 *
 * @returns The declared tokens, one set per category.
 */
function collectDeclaredTokens(): TokensByCategory {
    const next: TokensByCategory = {
        colors: new Set<string>(),
        textSizes: new Set<string>(),
        fontFamilies: new Set<string>(),
        fontWeights: new Set<string>(),
    };
    for (const bucket of sourceDeclarations.values()) {
        for (const category of CATEGORIES) {
            for (const name of bucket[category]) {
                if (!shadowsBuiltIn(category, name)) next[category].add(name);
            }
        }
    }
    return next;
}

/**
 * Whether a declared token collides with a built-in, reporting it once if so.
 *
 * @param category - Category the token was declared in.
 * @param name - Token name.
 * @returns True when the token must be left out of the effective set.
 */
function shadowsBuiltIn(category: ThemeCategory, name: string): boolean {
    if (!COLLISION_BLOCKLIST[category].has(name)) return false;
    const builtInKind = category === 'colors' ? 'utility keyword' : 'value';
    warnOnce(
        `theme token "${name}" shadows a built-in ${builtInKind} — ` +
            'szcn will not group classes built from it (they keep the safe keep-both behaviour). ' +
            'Rename the token to enable precise merging.',
    );
    return true;
}

/**
 * Remove names a project declared in two categories that cannot be told apart.
 *
 * Dropped from BOTH sides rather than assigned to one: the classifier would
 * otherwise merge classes the author meant to keep, which is the one outcome
 * worse than not grouping them.
 *
 * @param next - Token sets being computed, mutated in place.
 */
function dropAmbiguousTokens(next: TokensByCategory): void {
    for (const pair of AMBIGUITY_PAIRS) {
        for (const name of next[pair.first]) {
            if (!next[pair.second].has(name)) continue;
            next[pair.first].delete(name);
            next[pair.second].delete(name);
            warnOnce(pair.message(name));
        }
    }
}

/**
 * Replace the live sets, reporting whether anything actually moved.
 *
 * Classification only changes when a set gains or loses a name. Bumping the
 * generation on a no-op re-registration (idempotent boot code, or an HMR
 * re-execution of the generated module) would needlessly flush szcn's memo.
 *
 * @param next - The computed token sets.
 * @returns True when at least one category changed.
 */
function commitEffectiveTokens(next: TokensByCategory): boolean {
    let changed = false;
    for (const category of CATEGORIES) {
        const current = customTokens[category];
        const replacement = next[category];
        if (current.size === replacement.size && [...replacement].every(n => current.has(n))) {
            continue;
        }
        current.clear();
        for (const name of replacement) current.add(name);
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
    sourceDeclarations.clear();
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
    // Explicit Tailwind data-type hint: `text-(color:--x)` / `text-[color:var(--x)]`
    // declare the value IS a color, so classify it even though the var name is
    // unknown. (A bare `text-(--x)` stays unclassified — it could be a size.)
    if (value.startsWith('[color:') || value.startsWith('(color:')) {
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
        case 'shadow':
        case 'drop-shadow':
        case 'inset-shadow':
            return classifyShadowValue(prefix, value);
        case 'decoration':
            return classifyDecorationValue(value);
        case 'stroke':
            return classifyStrokeValue(value);
        case 'from':
        case 'via':
        case 'to':
            return classifyGradientStopValue(prefix, value);
        default:
            return null;
    }
}

/**
 * Classifies a shadow-family value as the shadow itself or its colour.
 *
 * `shadow-lg shadow-red-500` is how Tailwind documents setting both, so the
 * two must never share a group.
 *
 * @param prefix - `shadow`, `drop-shadow`, or `inset-shadow`.
 * @param value - The value after the utility prefix.
 * @returns The shadow property group, or `null` when uncertain.
 */
function classifyShadowValue(prefix: string, value: string): string | null {
    if (isColorValue(value)) return `${prefix}:color`;
    // The bare prefix (`shadow`) is the default size, not a colour.
    if (value === '' || SHADOW_SIZES.has(value) || isLengthArbitrary(value)) {
        return `${prefix}:size`;
    }
    return null;
}

/**
 * Classifies a `decoration-*` value across its three properties.
 * @param value - The value after the utility prefix.
 * @returns The decoration property group, or `null` when uncertain.
 */
function classifyDecorationValue(value: string): string | null {
    if (isColorValue(value)) return 'decoration:color';
    if (DECORATION_STYLES.has(value)) return 'decoration:style';
    if (DECORATION_THICKNESSES.has(value) || /^\d+$/.test(value) || isLengthArbitrary(value)) {
        return 'decoration:thickness';
    }
    return null;
}

/**
 * Classifies a `stroke-*` value as paint or width.
 *
 * `stroke-none` stays unclassified: it sets the paint to none, which conflicts
 * with a colour but not with a width, and keep-both is the safe reading.
 *
 * @param value - The value after the utility prefix.
 * @returns The stroke property group, or `null` when uncertain.
 */
function classifyStrokeValue(value: string): string | null {
    if (isColorValue(value)) return 'stroke:color';
    if (/^\d+$/.test(value) || isLengthArbitrary(value)) return 'stroke:width';
    return null;
}

/**
 * Classifies a gradient stop value as its colour or its position.
 * @param prefix - `from`, `via`, or `to`.
 * @param value - The value after the utility prefix.
 * @returns The gradient stop group, or `null` when uncertain.
 */
function classifyGradientStopValue(prefix: string, value: string): string | null {
    if (isColorValue(value)) return `${prefix}:color`;
    if (GRADIENT_STOP_POSITION.test(value) || isLengthArbitrary(value)) {
        return `${prefix}:position`;
    }
    return null;
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
    // Explicit data-type hint: `text-(length:--x)` / `text-[length:var(--x)]`
    // declare a font-size value, mirroring the color hint in isColorValue.
    if (sizeValue.startsWith('[length:') || sizeValue.startsWith('(length:')) {
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
        value.startsWith('[url(') ||
        value.startsWith('[image:')
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
