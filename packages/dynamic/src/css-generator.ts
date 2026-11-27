/**
 * CSS Rule Generator for @csszyx/dynamic.
 *
 * Takes a Tailwind class name (e.g. "p-4", "hover:bg-blue-500", "sm:flex")
 * and generates the CSS rule string ready to inject into a CSSStyleSheet.
 *
 * Uses Tailwind v4 CSS custom property conventions:
 * - Spacing: calc(var(--spacing) * N)
 * - Colors:  var(--color-{name}-{shade})
 * - Text sizes: var(--text-{size})
 * - Border radii: var(--radius-{size})
 *
 * Returns empty string for unknown classes — graceful no-op, not a crash.
 */

import {
    inferDataType,
    isShadowValue,
    modifierOp,
    SHADOW_SIZE_KEYWORDS,
    slashOpacitySplit,
} from '@csszyx/compiler/color-modifier';
import { DYNAMIC_UNSAFE_ARBITRARY, DYNAMIC_UNSUPPORTED, szReport } from '@csszyx/compiler/report';
import { classify } from '@csszyx/runtime/split';
import { isUtilityArbitrarySafe, isUtilityStructureSafe } from './css-sanitize.js';

/**
 * A table's own entry for text a class carries. An index or `in` reads
 * `Object.prototype` too: `leading-constructor` wrote the text of the `Object`
 * function as a `line-height`.
 *
 * @param table - The table.
 * @param name - The text.
 * @returns Its own entry, or undefined.
 */
function own<T>(table: Readonly<Record<string, T>>, name: string): T | undefined {
    return Object.hasOwn(table, name) ? table[name] : undefined;
}

/** Warn once (in dev) when an arbitrary value is dropped for being unsafe. */
let warnedUnsafeArbitrary = false;

/** The forms of `dynamic-unsupported` already reported this session. */
const warnedUnsupported = new Set<string>();

/**
 * Forget which `dynamic-unsupported` forms were reported. Tests only.
 *
 * @internal
 */
export function __resetUnsupportedWarningsForTests(): void {
    warnedUnsupported.clear();
}

/**
 * Say once per form, in development, that a class writes no rule because
 * `dynamic()` cannot write it correctly.
 *
 * @param className - The class as given.
 * @param variant - The variant with no selector, or undefined for a `css:`
 *   declaration.
 */
function warnUnsupported(className: string, variant: string | undefined): void {
    const form = variant === undefined ? 'css-property' : 'variant';
    if (process.env.NODE_ENV !== 'production' && !warnedUnsupported.has(form)) {
        warnedUnsupported.add(form);
        szReport({
            diagnostic: DYNAMIC_UNSUPPORTED,
            args: variant === undefined ? { form, className } : { form, className, variant },
        });
    }
}
/**
 * Warn once (in dev) that an arbitrary value was dropped for being unsafe.
 *
 * @param utility - the utility whose arbitrary value was dropped.
 */
function warnUnsafeArbitrary(utility: string): void {
    // Written out so the app's bundler folds it. Probing `typeof process` and
    // `process.env?.` first kept it from folding: the warning shipped in every
    // production bundle and printed there, in a browser that has no `process`.
    if (process.env.NODE_ENV !== 'production' && !warnedUnsafeArbitrary) {
        warnedUnsafeArbitrary = true;
        szReport({ diagnostic: DYNAMIC_UNSAFE_ARBITRARY, args: { utility } });
    }
}

/**
 * An arbitrary value as Tailwind decodes it: each `_` is a space, except
 * inside `url()`, which is kept as written, and in the variable name a
 * `var()` or `theme()` starts with (`var(--my_color)`). Tailwind reads a call
 * name with the text before it (`1px_+_var(`), so a name ending in `_var`
 * counts. A backslash never reaches here: the sanitizer drops a value that
 * holds one, so `\_` needs no reading. Tailwind also spaces a math
 * function's operators (`calc(100%-2rem)`), which this does not do yet.
 *
 * Cost: one pass, O(n) in the value's length, holding one frame per open call;
 * the input is the text inside a class's brackets, which the sanitizer has
 * already bounded. Read by `dynamic()` only: the lowering writes values and
 * never decodes them.
 *
 * @param value - The text inside the brackets.
 * @returns The CSS value.
 * @internal Exported for its tests.
 */
export function decodeArbitraryValue(value: string): string {
    if (!value.includes('(')) return value.replaceAll('_', ' ');
    const state: DecodeState = { out: '', token: '', keepFirst: [], urlDepth: 0 };
    for (const char of value) readDecodedChar(state, char);
    flushDecodedWord(state);
    return state.out;
}

/**
 * The characters Tailwind's value parser ends a word at, so a call after one
 * is still named by the text after it (`1px/var(--a_b)`).
 */
const WORD_END = /[),/:=<> ]/;

/** Where {@link decodeArbitraryValue} is in its one pass. */
interface DecodeState {
    /** The value decoded so far. */
    out: string;
    /** The word being read, written at the next `(`, `)` or `,`. */
    token: string;
    /** Per open call: whether its first word keeps its `_` (`var`, `theme`). */
    keepFirst: boolean[];
    /** The depth inside a `url()`, whose text is kept as written; 0 outside. */
    urlDepth: number;
}

/**
 * @param state - The pass.
 * @param char - The next character of the value.
 */
function readDecodedChar(state: DecodeState, char: string): void {
    if (state.urlDepth > 0) {
        state.out += char;
        state.urlDepth += Number(char === '(') - Number(char === ')');
    } else if (char === '(') {
        openDecodedCall(state);
    } else if (WORD_END.test(char)) {
        flushDecodedWord(state);
        state.out += char;
        if (char === ')') state.keepFirst.pop();
    } else {
        state.token += char;
    }
}

/**
 * Write the word before a `(` as the call's name. Tailwind reads the name
 * with the text before it, so a name ending in `_url` or `_var` counts, and a
 * `var()` whose first part is a call keeps no `_` of it.
 *
 * @param state - The pass, at a `(`.
 */
function openDecodedCall(state: DecodeState): void {
    const name = state.token;
    state.out += `${name.replaceAll('_', ' ')}(`;
    state.token = '';
    if (state.keepFirst.length > 0) state.keepFirst[state.keepFirst.length - 1] = false;
    if (/(?:^|_)url$/.test(name)) state.urlDepth = 1;
    else state.keepFirst.push(/(?:^|_)(?:var|theme)$/.test(name));
}

/**
 * Write the word read so far, its `_` kept when it is a `var()`'s first.
 *
 * @param state - The pass.
 */
function flushDecodedWord(state: DecodeState): void {
    const keep = state.keepFirst.at(-1) === true;
    state.out += keep ? state.token : state.token.replaceAll('_', ' ');
    if (keep && state.token) state.keepFirst[state.keepFirst.length - 1] = false;
    state.token = '';
}

/**
 * The value inside `[…]` or `(…)`, as Tailwind writes it: the type hint that
 * tells Tailwind what the value is (`[length:10px]`, `(color:--c)`) dropped,
 * the rest decoded ({@link decodeArbitraryValue}), and a variable wrapped in
 * `var()`. A parenthesis holds a variable and nothing else: `(--a:b)` names
 * none, and Tailwind writes no rule for it, so neither does this.
 *
 * @param value - The bracket or parenthesis form, delimiters included.
 * @returns The CSS value, or `''` when there is none.
 */
function delimitedValue(value: string): string {
    const hint = typeHint(value);
    const body = value.slice(hint === undefined ? 1 : hint.length + 2, -1);
    if (!value.startsWith('(')) return decodeArbitraryValue(body);
    return body.startsWith('--') ? decodeArbitraryValue(`var(${body})`) : '';
}

/**
 * The type hint a `[…]` or `(…)` value starts with: `length` in
 * `[length:10px]`, `color` in `(color:--c)`.
 *
 * @param value - The value, delimiters included; only a delimited one is
 *   passed.
 * @returns The hint, or undefined when it has none.
 */
function typeHint(value: string): string | undefined {
    return /^.([a-z-]+):/.exec(value)?.[1];
}

/**
 * How a prefix several properties share reads a `[…]` or `(…)` value: a hint
 * names its type (`bg-(image:--x)`), and otherwise Tailwind infers one, trying
 * the types in the order given ({@link inferDataType}). The type picks the
 * property; `~` is the colour, which the colour resolver writes, and a value
 * of no type, a `var()` among them, is the colour too, or the property listed
 * for `*`. Each entry is `property:type,…`; an empty property is one
 * `dynamic()` writes no rule for, and every border side reads `border`'s.
 * Read from Tailwind 4.3.3's utilities, one per prefix.
 */
const SHARED_PREFIX_TYPES: Readonly<Record<string, string>> = {
    bg: 'background-image:image ~:color background-position:percentage,position background-size:bg-size,length,size background-image:url',
    text: '~:color font-size:length,percentage,absolute-size,relative-size,size',
    border: '~:color border-width:line-width,length',
    outline: '~:color outline-width:length,number,percentage',
    decoration: '~:color text-decoration-thickness:length,percentage',
    stroke: '~:color stroke-width:number,length,percentage',
    ring: '~:color :length',
    'inset-ring': '~:color :length',
    'ring-offset': '~:color --tw-ring-offset-width:length',
    from: '~:color --tw-gradient-from-position:length,percentage',
    via: '~:color --tw-gradient-via-position:length,percentage',
    to: '~:color --tw-gradient-to-position:length,percentage',
    font: 'font-weight:*,number font-family:generic-name,family-name',
    rotate: 'rotate:*,angle :vector',
};

/**
 * The property a shared prefix writes for a `[…]` or `(…)` value.
 *
 * @param prefix - The prefix, from {@link prefixOf}.
 * @param value - The value, delimiters included.
 * @returns The property, `''` for one with no rule here, or undefined for the
 *   colour, which the colour resolver writes.
 */
function sharedPrefixProperty(prefix: string, value: string): string | undefined {
    const row = sharedPrefixRow(borderSide(prefix) === undefined ? prefix : 'border');
    if (row === undefined) return undefined;
    const type = typeHint(value) ?? inferDataType(delimitedValue(value), row.types);
    const property = row.property.get(type ?? '*') ?? row.property.get('*');
    return property === '~' ? undefined : property;
}

/** A {@link SHARED_PREFIX_TYPES} entry read: its types in order, and each one's property. */
interface SharedPrefixRow {
    readonly types: readonly string[];
    readonly property: ReadonlyMap<string, string>;
}

/** Each entry, read the first time a class asks for it. */
const sharedPrefixRows = new Map<string, SharedPrefixRow>();

/**
 * @param prefix - A key of {@link SHARED_PREFIX_TYPES}.
 * @returns Its entry read, or undefined for a prefix with none.
 */
function sharedPrefixRow(prefix: string): SharedPrefixRow | undefined {
    const text = own(SHARED_PREFIX_TYPES, prefix);
    if (text === undefined) return undefined;
    let row = sharedPrefixRows.get(prefix);
    if (row === undefined) {
        const property = new Map<string, string>();
        for (const entry of text.split(' ')) {
            const [name, types] = entry.split(':') as [string, string];
            for (const type of types.split(',')) property.set(type, name);
        }
        row = { types: [...property.keys()], property };
        sharedPrefixRows.set(prefix, row);
    }
    return row;
}

/**
 * @param prefix - A prefix.
 * @returns The width property of the border side it names (`border-t`), or
 *   undefined for any other prefix.
 */
function borderSide(prefix: string): string | undefined {
    return prefix.startsWith('border-') ? own(BORDER_SIDES, prefix.slice(7)) : undefined;
}

/**
 * @param value - A class's value.
 * @returns Whether it is a whole `[…]` or `(…)`.
 */
function delimited(value: string): boolean {
    return (
        (value.startsWith('[') && value.endsWith(']')) ||
        (value.startsWith('(') && value.endsWith(')'))
    );
}

/**
 * One declaration, or none when either half is empty: a property `dynamic()`
 * has no rule for, or a value with no CSS (`(--a:b)`).
 *
 * @param property - The property.
 * @param value - The CSS value.
 * @returns The declaration, or `''`.
 */
function declare(property: string, value: string): string {
    return property && value && `${property}: ${value}`;
}

/**
 * The declaration a `[…]` or `(…)` value writes on a prefix one property owns.
 *
 * @param property - The property.
 * @param value - The class's value.
 * @returns The declaration, `''` for a value with no CSS, or null when the
 *   value is not delimited.
 */
function arbitraryDeclaration(property: string, value: string): string | null {
    return delimited(value) ? declare(property, delimitedValue(value)) : null;
}

// ── Variant metadata ──────────────────────────────────────────────────────────

/** Breakpoint tiers (min-width values, Tailwind v4 defaults). */
export const BREAKPOINTS: Record<string, string> = {
    sm: '40rem',
    md: '48rem',
    lg: '64rem',
    xl: '80rem',
    '2xl': '96rem',
    'max-sm': '40rem',
    'max-md': '48rem',
    'max-lg': '64rem',
    'max-xl': '80rem',
    'max-2xl': '96rem',
};

/** Pseudo-class suffixes for common state variants. */
const PSEUDO_CLASS_MAP: Record<string, string> = {
    hover: ':hover',
    focus: ':focus',
    'focus-visible': ':focus-visible',
    'focus-within': ':focus-within',
    active: ':active',
    visited: ':visited',
    disabled: ':disabled',
    checked: ':checked',
    required: ':required',
    optional: ':optional',
    valid: ':valid',
    invalid: ':invalid',
    placeholder: '::placeholder',
    before: '::before',
    after: '::after',
    first: ':first-child',
    last: ':last-child',
    odd: ':nth-child(odd)',
    even: ':nth-child(even)',
    empty: ':empty',
    open: '[open]',
};

// ── Spacing utilities ─────────────────────────────────────────────────────────

/**
 * Maps Tailwind spacing utility prefix → CSS logical/physical properties (Tailwind v4).
 * Tailwind v4 uses logical properties (padding-inline, margin-block, etc.).
 *
 * @internal Exported so a test can ask Tailwind about every prefix here.
 */
export const SPACING_PROPS: Readonly<Record<string, readonly string[]>> = {
    // Padding
    p: ['padding'],
    pt: ['padding-top'],
    pr: ['padding-right'],
    pb: ['padding-bottom'],
    pl: ['padding-left'],
    px: ['padding-inline'],
    py: ['padding-block'],
    ps: ['padding-inline-start'],
    pe: ['padding-inline-end'],
    pbs: ['padding-block-start'],
    pbe: ['padding-block-end'],
    // Margin
    m: ['margin'],
    mt: ['margin-top'],
    mr: ['margin-right'],
    mb: ['margin-bottom'],
    ml: ['margin-left'],
    mx: ['margin-inline'],
    my: ['margin-block'],
    ms: ['margin-inline-start'],
    me: ['margin-inline-end'],
    mbs: ['margin-block-start'],
    mbe: ['margin-block-end'],
    // Gap
    gap: ['gap'],
    'gap-x': ['column-gap'],
    'gap-y': ['row-gap'],
    // Sizing
    w: ['width'],
    h: ['height'],
    'min-w': ['min-width'],
    'max-w': ['max-width'],
    'min-h': ['min-height'],
    'max-h': ['max-height'],
    size: ['width', 'height'],
    // Position
    top: ['top'],
    right: ['right'],
    bottom: ['bottom'],
    left: ['left'],
    inset: ['inset'],
    'inset-x': ['inset-inline'],
    'inset-y': ['inset-block'],
    // `start`/`end` are what the lowering writes (served on every v4);
    // `inset-s`/`inset-e` are Tailwind 4.2+'s names for the same CSS.
    start: ['inset-inline-start'],
    end: ['inset-inline-end'],
    'inset-s': ['inset-inline-start'],
    'inset-e': ['inset-inline-end'],
    // Flex
    basis: ['flex-basis'],
    // Typography
    indent: ['text-indent'],
    'outline-offset': ['outline-offset'],
    'underline-offset': ['text-underline-offset'],
    // Scroll
    'scroll-m': ['scroll-margin'],
    'scroll-mt': ['scroll-margin-top'],
    'scroll-mr': ['scroll-margin-right'],
    'scroll-mb': ['scroll-margin-bottom'],
    'scroll-ml': ['scroll-margin-left'],
    'scroll-mx': ['scroll-margin-inline'],
    'scroll-my': ['scroll-margin-block'],
    'scroll-ms': ['scroll-margin-inline-start'],
    'scroll-me': ['scroll-margin-inline-end'],
    'scroll-p': ['scroll-padding'],
    'scroll-pt': ['scroll-padding-top'],
    'scroll-pr': ['scroll-padding-right'],
    'scroll-pb': ['scroll-padding-bottom'],
    'scroll-pl': ['scroll-padding-left'],
    'scroll-px': ['scroll-padding-inline'],
    'scroll-py': ['scroll-padding-block'],
    'scroll-ps': ['scroll-padding-inline-start'],
    'scroll-pe': ['scroll-padding-inline-end'],
    // Border spacing (CSS custom properties in Tailwind v4)
    'border-spacing-x': ['--tw-border-spacing-x'],
    'border-spacing-y': ['--tw-border-spacing-y'],
    // Ring offset (CSS custom property)
    'ring-offset': ['--tw-ring-offset-width'],
};

/** CSS keyword values for size properties (non-numeric). */
const SIZE_KEYWORDS: Record<string, string> = {
    auto: 'auto',
    full: '100%',
    screen: '100vw', // width context; height context uses 100vh — see below
    svw: '100svw',
    dvw: '100dvw',
    lvw: '100lvw',
    svh: '100svh',
    dvh: '100dvh',
    lvh: '100lvh',
    fit: 'fit-content',
    min: 'min-content',
    max: 'max-content',
    none: 'none',
    px: '1px',
    '0': '0',
    xs: 'var(--container-xs)',
    sm: 'var(--container-sm)',
    md: 'var(--container-md)',
    lg: 'var(--container-lg)',
    xl: 'var(--container-xl)',
    '2xl': 'var(--container-2xl)',
    '3xl': 'var(--container-3xl)',
    '4xl': 'var(--container-4xl)',
    '5xl': 'var(--container-5xl)',
    '6xl': 'var(--container-6xl)',
    '7xl': 'var(--container-7xl)',
    prose: 'var(--container-prose)',
};
const HEIGHT_SIZE_PROPERTIES = new Set(['height', 'min-height', 'max-height']);

/**
 * Resolve a finite fraction token to a percentage.
 *
 * @param value Candidate fraction token.
 * @returns Percentage string or null when invalid.
 */
function resolveFraction(value: string): string | null {
    const slash = value.indexOf('/');
    if (slash === -1) {
        return null;
    }
    const numerator = Number.parseFloat(value.slice(0, slash));
    const denominator = Number.parseFloat(value.slice(slash + 1));
    if (Number.isNaN(numerator) || Number.isNaN(denominator) || denominator === 0) {
        return null;
    }
    const percentage = (numerator / denominator) * 100;
    return `${Number.parseFloat(percentage.toFixed(6))}%`;
}

/**
 * Resolve keyword, screen, arbitrary, and CSS-variable spacing tokens.
 * @param value - Tailwind spacing token.
 * @param property - Optional CSS property used to select the screen axis.
 * @returns Resolved CSS value, or null for numeric/fraction fallbacks.
 */
function resolveNamedSpacingValue(value: string, property?: string): string | null {
    if (value === '0') return '0';
    if (value === 'px') return '1px';
    if (value === 'screen') {
        return property && HEIGHT_SIZE_PROPERTIES.has(property) ? '100vh' : '100vw';
    }
    const keyword = own(SIZE_KEYWORDS, value);
    if (keyword !== undefined) return keyword;
    if (
        (value.startsWith('[') && value.endsWith(']')) ||
        (value.startsWith('(') && value.endsWith(')'))
    ) {
        return delimitedValue(value);
    }
    return null;
}

/**
 * Resolves a Tailwind spacing/size value to a CSS value string.
 * Handles: 0, px, auto, full, numeric, fraction, arbitrary.
 *
 * @param v - Tailwind spacing value token (e.g. "4", "px", "auto", "[13px]")
 * @param prop - CSS property name, used to disambiguate "screen" (100vh vs 100vw)
 * @returns CSS value string (e.g. "calc(var(--spacing) * 4)", "1px", "auto")
 */
function resolveSpacingValue(v: string, prop?: string): string {
    const namedValue = resolveNamedSpacingValue(v, prop);
    if (namedValue !== null) return namedValue;

    // Fraction: 1/2 → 50%
    const fraction = resolveFraction(v);
    if (fraction !== null) {
        return fraction;
    }

    // Negative numeric: -4 → calc(var(--spacing) * -4)
    if (v.startsWith('-') && !Number.isNaN(Number.parseFloat(v.slice(1)))) {
        return `calc(var(--spacing) * ${v})`;
    }

    // Numeric: 4 → calc(var(--spacing) * 4)
    if (!Number.isNaN(Number.parseFloat(v))) {
        return `calc(var(--spacing) * ${v})`;
    }

    // A name the theme here does not hold (`p-red-500`): no value, as
    // Tailwind writes no rule.
    return '';
}

// ── Color utilities ───────────────────────────────────────────────────────────

/**
 * Maps Tailwind color utility prefix → CSS property.
 *
 * @internal Exported so a test can ask Tailwind about every prefix here.
 */
export const COLOR_PROPS: Readonly<Record<string, string>> = {
    bg: 'background-color',
    text: 'color',
    border: 'border-color',
    'border-t': 'border-top-color',
    'border-r': 'border-right-color',
    'border-b': 'border-bottom-color',
    'border-l': 'border-left-color',
    'border-x': 'border-inline-color',
    'border-y': 'border-block-color',
    'border-s': 'border-inline-start-color',
    'border-e': 'border-inline-end-color',
    divide: 'border-color',
    outline: 'outline-color',
    fill: 'fill',
    stroke: 'stroke',
    from: '--tw-gradient-from',
    via: '--tw-gradient-via',
    to: '--tw-gradient-to',
    decoration: 'text-decoration-color',
    accent: 'accent-color',
    caret: 'caret-color',
    shadow: '--tw-shadow-color',
    'inset-shadow': '--tw-inset-shadow-color',
    'inset-ring': '--tw-inset-ring-color',
    ring: '--tw-ring-color',
    'ring-offset': '--tw-ring-offset-color',
    'drop-shadow': '--tw-drop-shadow-color',
    'text-shadow': '--tw-text-shadow-color',
};

/** The colour prefixes whose utility can also be the shadow itself. */
const SHADOW_PREFIXES: ReadonlySet<string> = new Set([
    'shadow',
    'inset-shadow',
    'drop-shadow',
    'text-shadow',
]);

/** Colors that don't use CSS custom properties in Tailwind v4. */
const DIRECT_COLOR_KEYWORDS = new Set([
    'white',
    'black',
    'transparent',
    'inherit',
    'current',
    'currentColor',
]);

/**
 * The percentage an opacity modifier names, as Tailwind reads it: the `op`
 * the modifier names (`modifierOp`, shared with the lowering), a number as a
 * percent and `--o` as its variable. `undefined` for a modifier no opacity
 * reads, such as `[2]`, which Tailwind writes as 200%, past what
 * `color-mix()` takes.
 *
 * @param opacity - The modifier after the slash.
 * @returns The percentage, or the variable that holds it.
 */
function opacityPercent(opacity: string): string | undefined {
    const op = modifierOp(opacity);
    if (typeof op === 'number') return `${op}%`;
    return op?.startsWith('--') ? `var(${op})` : op;
}

/**
 * Resolves a Tailwind color value to a CSS value string.
 * Handles: named scales (blue-500), keywords, arbitrary, opacity modifiers.
 *
 * @param v - Tailwind color value token (e.g. "blue-500", "white", "[#ff6b35]", "blue-500/50")
 * @returns CSS value string (e.g. "var(--color-blue-500)", "white", "color-mix(...)")
 */
function resolveColorValue(v: string): string {
    // Opacity modifier: blue-500/50 → color-mix(...), read before the
    // bracket and variable forms so `[#f00]/[0.3]` and `(--c)/(--o)` split.
    // The colour before the slash is any colour this resolves. A modifier no
    // opacity reads leaves the colour alone.
    const split = slashOpacitySplit(v);
    if (split !== undefined) {
        const colorVar = resolveColorValue(split[0]);
        const opacityPct = opacityPercent(split[1]);
        return opacityPct === undefined || colorVar === ''
            ? colorVar
            : `color-mix(in oklab, ${colorVar} ${opacityPct}, transparent)`;
    }

    if (DIRECT_COLOR_KEYWORDS.has(v)) {
        if (v === 'current') {
            return 'currentColor';
        }
        return v;
    }

    // Arbitrary: [#ff6b35], [color:var(--my)]; a variable: (--my-color),
    // (color:--my-color).
    if ((v.startsWith('[') && v.endsWith(']')) || (v.startsWith('(') && v.endsWith(')'))) {
        return delimitedValue(v);
    }

    return `var(--color-${v})`;
}

// ── Text size utilities ───────────────────────────────────────────────────────

/** Named Tailwind v4 text sizes → CSS var. */
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

// ── Keyword class lookup ──────────────────────────────────────────────────────

/**
 * Static keyword classes with known CSS output.
 * Only covers classes commonly needed at runtime (form renderers, layout).
 * Build-time classes are always in the manifest → never reach the generator.
 */
const KEYWORD_RULES: Record<string, string> = {
    // Display
    flex: 'display: flex',
    'inline-flex': 'display: inline-flex',
    block: 'display: block',
    'inline-block': 'display: inline-block',
    inline: 'display: inline',
    grid: 'display: grid',
    'inline-grid': 'display: inline-grid',
    hidden: 'display: none',
    contents: 'display: contents',
    'flow-root': 'display: flow-root',
    table: 'display: table',
    'table-row': 'display: table-row',
    'table-cell': 'display: table-cell',
    'list-item': 'display: list-item',
    // Position
    static: 'position: static',
    fixed: 'position: fixed',
    absolute: 'position: absolute',
    relative: 'position: relative',
    sticky: 'position: sticky',
    // Visibility
    visible: 'visibility: visible',
    invisible: 'visibility: hidden',
    collapse: 'visibility: collapse',
    // Overflow
    'overflow-auto': 'overflow: auto',
    'overflow-hidden': 'overflow: hidden',
    'overflow-visible': 'overflow: visible',
    'overflow-scroll': 'overflow: scroll',
    'overflow-clip': 'overflow: clip',
    'overflow-x-auto': 'overflow-x: auto',
    'overflow-x-hidden': 'overflow-x: hidden',
    'overflow-y-auto': 'overflow-y: auto',
    'overflow-y-hidden': 'overflow-y: hidden',
    'overflow-y-scroll': 'overflow-y: scroll',
    'overflow-x-scroll': 'overflow-x: scroll',
    // Flex direction
    'flex-row': 'flex-direction: row',
    'flex-col': 'flex-direction: column',
    'flex-row-reverse': 'flex-direction: row-reverse',
    'flex-col-reverse': 'flex-direction: column-reverse',
    // Flex wrap
    'flex-wrap': 'flex-wrap: wrap',
    'flex-nowrap': 'flex-wrap: nowrap',
    'flex-wrap-reverse': 'flex-wrap: wrap-reverse',
    // Flex sizing
    'flex-1': 'flex: 1 1 0%',
    'flex-auto': 'flex: 1 1 auto',
    'flex-none': 'flex: none',
    // Align
    'items-start': 'align-items: flex-start',
    'items-center': 'align-items: center',
    'items-end': 'align-items: flex-end',
    'items-stretch': 'align-items: stretch',
    'items-baseline': 'align-items: baseline',
    'self-start': 'align-self: flex-start',
    'self-center': 'align-self: center',
    'self-end': 'align-self: flex-end',
    'self-stretch': 'align-self: stretch',
    'self-auto': 'align-self: auto',
    // Justify
    'justify-start': 'justify-content: flex-start',
    'justify-center': 'justify-content: center',
    'justify-end': 'justify-content: flex-end',
    'justify-between': 'justify-content: space-between',
    'justify-around': 'justify-content: space-around',
    'justify-evenly': 'justify-content: space-evenly',
    'justify-stretch': 'justify-content: stretch',
    'justify-items-start': 'justify-items: start',
    'justify-items-center': 'justify-items: center',
    'justify-items-end': 'justify-items: end',
    'justify-items-stretch': 'justify-items: stretch',
    // Place
    'place-content-center': 'place-content: center',
    'place-content-start': 'place-content: start',
    'place-content-end': 'place-content: end',
    'place-content-between': 'place-content: space-between',
    'place-content-around': 'place-content: space-around',
    'place-content-evenly': 'place-content: space-evenly',
    'place-items-center': 'place-items: center',
    'place-items-start': 'place-items: start',
    'place-items-end': 'place-items: end',
    'place-items-stretch': 'place-items: stretch',
    // Width / Height special
    'w-auto': 'width: auto',
    'w-full': 'width: 100%',
    'w-screen': 'width: 100vw',
    'w-svw': 'width: 100svw',
    'w-dvw': 'width: 100dvw',
    'w-min': 'width: min-content',
    'w-max': 'width: max-content',
    'w-fit': 'width: fit-content',
    'h-auto': 'height: auto',
    'h-full': 'height: 100%',
    'h-screen': 'height: 100vh',
    'h-svh': 'height: 100svh',
    'h-dvh': 'height: 100dvh',
    'h-min': 'height: min-content',
    'h-max': 'height: max-content',
    'h-fit': 'height: fit-content',
    'min-h-0': 'min-height: 0',
    'min-h-full': 'min-height: 100%',
    'min-h-screen': 'min-height: 100vh',
    'max-h-full': 'max-height: 100%',
    'max-h-screen': 'max-height: 100vh',
    'max-h-none': 'max-height: none',
    'min-w-0': 'min-width: 0',
    'min-w-full': 'min-width: 100%',
    'max-w-full': 'max-width: 100%',
    'max-w-none': 'max-width: none',
    'max-w-screen': 'max-width: 100vw',
    // Font weight keywords
    'font-thin': 'font-weight: 100',
    'font-extralight': 'font-weight: 200',
    'font-light': 'font-weight: 300',
    'font-normal': 'font-weight: 400',
    'font-medium': 'font-weight: 500',
    'font-semibold': 'font-weight: 600',
    'font-bold': 'font-weight: 700',
    'font-extrabold': 'font-weight: 800',
    'font-black': 'font-weight: 900',
    // Font style
    italic: 'font-style: italic',
    'not-italic': 'font-style: normal',
    // Text align
    'text-left': 'text-align: left',
    'text-center': 'text-align: center',
    'text-right': 'text-align: right',
    'text-justify': 'text-align: justify',
    'text-start': 'text-align: start',
    'text-end': 'text-align: end',
    // Text transform
    uppercase: 'text-transform: uppercase',
    lowercase: 'text-transform: lowercase',
    capitalize: 'text-transform: capitalize',
    'normal-case': 'text-transform: none',
    // Text decoration
    underline: 'text-decoration-line: underline',
    overline: 'text-decoration-line: overline',
    'line-through': 'text-decoration-line: line-through',
    'no-underline': 'text-decoration-line: none',
    // Text wrap
    'text-wrap': 'text-wrap: wrap',
    'text-nowrap': 'text-wrap: nowrap',
    'text-balance': 'text-wrap: balance',
    'text-pretty': 'text-wrap: pretty',
    // Whitespace
    'whitespace-normal': 'white-space: normal',
    'whitespace-nowrap': 'white-space: nowrap',
    'whitespace-pre': 'white-space: pre',
    'whitespace-pre-line': 'white-space: pre-line',
    'whitespace-pre-wrap': 'white-space: pre-wrap',
    'whitespace-break-spaces': 'white-space: break-spaces',
    // Border style
    'border-solid': 'border-style: solid',
    'border-dashed': 'border-style: dashed',
    'border-dotted': 'border-style: dotted',
    'border-double': 'border-style: double',
    'border-none': 'border-style: none',
    // Rounded special values
    'rounded-none': 'border-radius: 0',
    'rounded-full': 'border-radius: calc(infinity * 1px)',
    // Cursor
    'cursor-auto': 'cursor: auto',
    'cursor-default': 'cursor: default',
    'cursor-pointer': 'cursor: pointer',
    'cursor-wait': 'cursor: wait',
    'cursor-text': 'cursor: text',
    'cursor-move': 'cursor: move',
    'cursor-not-allowed': 'cursor: not-allowed',
    'cursor-crosshair': 'cursor: crosshair',
    'cursor-grab': 'cursor: grab',
    'cursor-grabbing': 'cursor: grabbing',
    // Pointer events
    'pointer-events-none': 'pointer-events: none',
    'pointer-events-auto': 'pointer-events: auto',
    // User select
    'select-none': 'user-select: none',
    'select-text': 'user-select: text',
    'select-all': 'user-select: all',
    'select-auto': 'user-select: auto',
    // Object fit
    'object-contain': 'object-fit: contain',
    'object-cover': 'object-fit: cover',
    'object-fill': 'object-fit: fill',
    'object-none': 'object-fit: none',
    'object-scale-down': 'object-fit: scale-down',
    // Truncate
    truncate: 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap',
    'text-ellipsis': 'text-overflow: ellipsis',
    'text-clip': 'text-overflow: clip',
    // Grow / shrink
    grow: 'flex-grow: 1',
    'grow-0': 'flex-grow: 0',
    shrink: 'flex-shrink: 1',
    'shrink-0': 'flex-shrink: 0',
    // Appearance
    'appearance-none': 'appearance: none',
    'appearance-auto': 'appearance: auto',
    // Isolate
    isolate: 'isolation: isolate',
    'isolation-auto': 'isolation: auto',
    // List style
    'list-none': 'list-style-type: none',
    'list-disc': 'list-style-type: disc',
    'list-decimal': 'list-style-type: decimal',
    // Box sizing
    'box-border': 'box-sizing: border-box',
    'box-content': 'box-sizing: content-box',
    // Float
    'float-left': 'float: left',
    'float-right': 'float: right',
    'float-none': 'float: none',
    'float-start': 'float: inline-start',
    'float-end': 'float: inline-end',
    'clear-left': 'clear: left',
    'clear-right': 'clear: right',
    'clear-both': 'clear: both',
    'clear-none': 'clear: none',
    // SR only
    'sr-only':
        'position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border-width: 0',
    'not-sr-only':
        'position: static; width: auto; height: auto; padding: 0; margin: 0; overflow: visible; clip: auto; white-space: normal',
};

// ── Border radius utilities ───────────────────────────────────────────────────

const RADIUS_SIZES = new Set(['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl']);

// ── CSS escaping ──────────────────────────────────────────────────────────────

/**
 * Escapes a Tailwind class name for use as a CSS selector.
 * @param cls - Tailwind class name to escape
 * @returns escaped CSS selector string safe to use in a rule
 */
function escapeCSSSelector(cls: string): string {
    // Escape: : / [ ] . # @ ( ) % + ~ = | ^ $ * ,
    return cls.replace(/[^\w-]/g, c => `\\${c}`);
}

// ── Variant parsing ───────────────────────────────────────────────────────────

const MIN_BREAKPOINTS = new Set(['sm', 'md', 'lg', 'xl', '2xl']);
const MAX_BREAKPOINTS = new Set(['max-sm', 'max-md', 'max-lg', 'max-xl', 'max-2xl']);
const CONTAINER_MIN = new Set(['@sm', '@md', '@lg', '@xl', '@2xl']);
const CONTAINER_MAX = new Set(['@max-sm', '@max-md', '@max-lg', '@max-xl', '@max-2xl']);
const RESPONSIVE_TIERS = new Set([
    ...MIN_BREAKPOINTS,
    ...MAX_BREAKPOINTS,
    ...CONTAINER_MIN,
    ...CONTAINER_MAX,
]);

/**
 *
 */
export type Tier =
    | 'base'
    | 'sm'
    | 'md'
    | 'lg'
    | 'xl'
    | '2xl'
    | 'max-2xl'
    | 'max-xl'
    | 'max-lg'
    | 'max-md'
    | 'max-sm'
    | '@sm'
    | '@md'
    | '@lg'
    | '@xl'
    | '@2xl'
    | '@max-2xl'
    | '@max-xl'
    | '@max-lg'
    | '@max-md'
    | '@max-sm';

/**
 *
 */
export interface ParsedVariants {
    tier: Tier;
    /** Pseudo-class suffix to append to selector (e.g. ":hover"). */
    pseudoSuffix: string;
    /** For dark: variant — selector prefix (e.g. ".dark "). */
    selectorPrefix: string;
    /** The base utility class name (e.g. "p-4", "bg-blue-500"). */
    utility: string;
    /**
     * The first variant with no selector here (`group-hover`), if any. The
     * class then writes no rule: applying the utility without its variant
     * styled the wrong state, and let a runtime value put any utility after a
     * `:` (`w-'a';position:fixed`).
     */
    unknownVariant?: string;
}

/**
 * Split a class at each `:` outside brackets and parentheses: the `:` in
 * `bg-[url(https://x.example/a.png)]` or `bg-(--a:b)` is part of the value, not a
 * variant separator. One pass over `n` characters.
 *
 * @param cls - The class.
 * @returns Its variants, then the utility.
 */
function splitVariants(cls: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    let quote: string | null = null;
    for (let i = 0; i < cls.length; i++) {
        const char = cls[i];
        // An escaped character and a quoted string are text, never a bracket or
        // a separator, as CSS reads them.
        if (char === '\\') i++;
        else if (quote !== null) {
            if (char === quote) quote = null;
        } else if (char === '"' || char === "'") quote = char;
        else if (char === '[' || char === '(') depth++;
        else if ((char === ']' || char === ')') && depth > 0) depth--;
        else if (char === ':' && depth === 0) {
            parts.push(cls.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(cls.slice(start));
    return parts;
}

/**
 * Parses variant prefixes from a Tailwind class name.
 * Handles stacked variants: sm:hover:bg-blue-600 → tier=sm, pseudo=:hover, utility=bg-blue-600
 *
 * Tailwind stacking convention: breakpoint FIRST, then state variant.
 * e.g. sm:hover: → @media(min-width: 40rem) { :hover { ... } }
 *
 * @param cls - full Tailwind class name including variant prefixes (e.g. "sm:hover:bg-blue-600")
 * @returns parsed variant metadata including tier, pseudoSuffix, selectorPrefix, and utility
 */
export function parseVariants(cls: string): ParsedVariants {
    const parts = splitVariants(cls);
    let tier: Tier = 'base';
    let pseudoSuffix = '';
    let selectorPrefix = '';
    let utilityIdx = 0;
    let unknownVariant: string | undefined;

    for (let i = 0; i < parts.length - 1; i++) {
        const variant = parts[i];
        utilityIdx = i + 1;

        if (RESPONSIVE_TIERS.has(variant)) {
            tier = variant as Tier;
        } else if (variant === 'dark' || variant === 'light') {
            selectorPrefix = `.${variant} `;
        } else if (own(PSEUDO_CLASS_MAP, variant) !== undefined) {
            pseudoSuffix += own(PSEUDO_CLASS_MAP, variant);
        } else {
            unknownVariant ??= variant;
        }
    }

    const utility = parts.slice(utilityIdx).join(':');
    return unknownVariant === undefined
        ? { tier, pseudoSuffix, selectorPrefix, utility }
        : { tier, pseudoSuffix, selectorPrefix, utility, unknownVariant };
}

/** A plain number: `4`, `2.5`. */
const NUMBER_TEXT = /^\d+(?:\.\d+)?$/;

/** One stage in the ordered utility-to-declaration pipeline. */
type DeclarationResolver = (utility: string) => string | null;

const BORDER_SIDES: Record<string, string> = {
    t: 'border-top-width',
    r: 'border-right-width',
    b: 'border-bottom-width',
    l: 'border-left-width',
    x: 'border-inline-width',
    y: 'border-block-width',
    s: 'border-inline-start-width',
    e: 'border-inline-end-width',
};

const ROUNDED_DIRECTIONS: Record<string, string> = {
    t: 'border-top-left-radius: var(--radius); border-top-right-radius: var(--radius)',
    r: 'border-top-right-radius: var(--radius); border-bottom-right-radius: var(--radius)',
    b: 'border-bottom-left-radius: var(--radius); border-bottom-right-radius: var(--radius)',
    l: 'border-top-left-radius: var(--radius); border-bottom-left-radius: var(--radius)',
    tl: 'border-top-left-radius: var(--radius)',
    tr: 'border-top-right-radius: var(--radius)',
    bl: 'border-bottom-left-radius: var(--radius)',
    br: 'border-bottom-right-radius: var(--radius)',
};

const DECLARATION_RESOLVERS: readonly DeclarationResolver[] = [
    resolveSharedPrefixDeclaration,
    resolveOpacityDeclaration,
    resolveZIndexDeclaration,
    resolveBorderDeclaration,
    resolveRadiusDeclaration,
    resolveTextDeclaration,
    resolveLeadingDeclaration,
    resolveTrackingDeclaration,
    resolveFontDeclaration,
    resolveShadowDeclaration,
    resolveOutlineDeclaration,
    resolveRingDeclaration,
    resolveFlexOrderDeclaration,
    resolveGridDeclaration,
    resolveTransformDeclaration,
    resolveTransitionDeclaration,
    resolveColorDeclaration,
    resolveSpacingDeclaration,
    resolveArbitraryPropertyDeclaration,
];

/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns -- Internal resolvers share the DeclarationResolver contract. */

/**
 * Resolves an opacity utility.
 * @param utility
 */
function resolveOpacityDeclaration(utility: string): string | null {
    if (!utility.startsWith('opacity-')) return null;
    const value = utility.slice(8);
    const arbitrary = arbitraryDeclaration('opacity', value);
    if (arbitrary !== null) return arbitrary;
    // A number is a percentage, as Tailwind writes it (`opacity-50` is 50%).
    return NUMBER_TEXT.test(value) ? `opacity: ${value}%` : null;
}

/**
 * Resolves a z-index utility.
 * @param utility
 */
function resolveZIndexDeclaration(utility: string): string | null {
    if (!utility.startsWith('z-')) return null;
    const value = utility.slice(2);
    if (value === 'auto') return 'z-index: auto';
    const arbitrary = arbitraryDeclaration('z-index', value);
    if (arbitrary !== null) return arbitrary;
    return Number.isNaN(Number.parseInt(value, 10)) ? null : `z-index: ${value}`;
}

/**
 * Resolves border width utilities.
 * @param utility
 */
function resolveBorderDeclaration(utility: string): string | null {
    if (utility === 'border') return 'border-width: 1px';
    if (/^border-[trblxyse]$/.test(utility)) {
        const property = BORDER_SIDES[utility.slice(7)];
        return `${property}: 1px`;
    }
    if (/^border-\d+$/.test(utility)) return `border-width: ${utility.slice(7)}px`;
    const sideWidth = /^border-([trblxse])-(\d+)$/.exec(utility);
    if (!sideWidth) return null;
    const property = BORDER_SIDES[sideWidth[1]];
    return `${property}: ${sideWidth[2]}px`;
}

/**
 * Resolves border radius utilities.
 * @param utility
 */
function resolveRadiusDeclaration(utility: string): string | null {
    if (utility === 'rounded') return 'border-radius: var(--radius)';
    if (!utility.startsWith('rounded-')) return null;
    const value = utility.slice(8);
    // rounded-none/full are resolved by KEYWORD_RULES before this resolver.
    if (RADIUS_SIZES.has(value)) return `border-radius: var(--radius-${value})`;
    const direction = own(ROUNDED_DIRECTIONS, value);
    if (direction !== undefined) return direction;
    const directional = /^([trblse]+)-(.+)$/.exec(value);
    if (directional && own(ROUNDED_DIRECTIONS, directional[1]) !== undefined) {
        const size = resolveRadiusValue(directional[2]);
        return size && ROUNDED_DIRECTIONS[directional[1]].replaceAll('var(--radius)', () => size);
    }
    return arbitraryDeclaration('border-radius', value);
}

/**
 * Resolves a directional radius size.
 * @param size
 */
function resolveRadiusValue(size: string): string {
    if (delimited(size)) return delimitedValue(size);
    if (RADIUS_SIZES.has(size)) return `var(--radius-${size})`;
    if (size === 'full') return 'calc(infinity * 1px)';
    // A size the theme does not name: no value, as Tailwind writes no rule.
    return size === 'none' ? '0' : '';
}

/**
 * Resolves text-size utilities.
 * @param utility
 */
function resolveTextDeclaration(utility: string): string | null {
    if (!utility.startsWith('text-') || utility.startsWith('text-opacity')) return null;
    const value = utility.slice(5);
    if (TEXT_SIZES.has(value)) {
        return `font-size: var(--text-${value}); line-height: var(--tw-leading, var(--text-${value}--line-height))`;
    }
    // A bracket is the shared prefixes' (`resolveSharedPrefixDeclaration`),
    // or the colour resolver's when it is a colour.
    return null;
}

/**
 * Resolves line-height utilities.
 * @param utility
 */
function resolveLeadingDeclaration(utility: string): string | null {
    if (!utility.startsWith('leading-')) return null;
    const value = utility.slice(8);
    const named: Record<string, string> = {
        none: '1',
        tight: '1.25',
        snug: '1.375',
        normal: '1.5',
        relaxed: '1.625',
        loose: '2',
    };
    if (own(named, value) !== undefined) return `line-height: ${named[value]}`;
    const arbitrary = arbitraryDeclaration('line-height', value);
    if (arbitrary !== null) return arbitrary;
    return Number.isNaN(Number.parseFloat(value))
        ? null
        : `line-height: calc(var(--spacing) * ${value})`;
}

/**
 * Resolves letter-spacing utilities.
 * @param utility
 */
function resolveTrackingDeclaration(utility: string): string | null {
    if (!utility.startsWith('tracking-')) return null;
    const value = utility.slice(9);
    const named: Record<string, string> = {
        tighter: 'var(--tracking-tighter)',
        tight: 'var(--tracking-tight)',
        normal: 'var(--tracking-normal)',
        wide: 'var(--tracking-wide)',
        wider: 'var(--tracking-wider)',
        widest: 'var(--tracking-widest)',
    };
    if (own(named, value) !== undefined) return `letter-spacing: ${named[value]}`;
    return arbitraryDeclaration('letter-spacing', value);
}

/**
 * Resolves font-family utilities.
 * @param utility
 */
function resolveFontDeclaration(utility: string): string | null {
    if (!utility.startsWith('font-') || own(KEYWORD_RULES, utility)) return null;
    const value = utility.slice(5);
    const families: Record<string, string> = {
        sans: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
        serif: 'var(--font-serif, ui-serif, Georgia, serif)',
        mono: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
    };
    return own(families, value) === undefined ? null : `font-family: ${families[value]}`;
}

/**
 * Resolves shadow utilities.
 * @param utility
 */
function resolveShadowDeclaration(utility: string): string | null {
    if (utility === 'shadow') return 'box-shadow: var(--shadow)';
    if (!utility.startsWith('shadow-')) return null;
    const value = utility.slice(7);
    // A bracket Tailwind reads as a colour (`shadow-[#f00]`) is the colour
    // resolver's: it sets the shadow's colour, not the shadow.
    if (value.startsWith('[') && value.endsWith(']')) {
        return isShadowValue(value) ? `box-shadow: ${delimitedValue(value)}` : null;
    }
    if (!SHADOW_SIZE_KEYWORDS.has(value)) return null;
    return value === 'none' ? 'box-shadow: none' : `box-shadow: var(--shadow-${value})`;
}

/**
 * Resolves outline utilities.
 * @param utility
 */
function resolveOutlineDeclaration(utility: string): string | null {
    if (utility === 'outline-none') return 'outline: 2px solid transparent; outline-offset: 2px';
    if (!utility.startsWith('outline-')) return null;
    const value = utility.slice(8);
    return /^\d+$/.test(value) ? `outline-width: ${value}px` : null;
}

/**
 * Resolves ring utilities.
 * @param utility
 */
function resolveRingDeclaration(utility: string): string | null {
    if (utility === 'ring') return '--tw-ring-shadow: 0 0 0 3px var(--tw-ring-color, #3b82f680)';
    if (!utility.startsWith('ring-')) return null;
    const value = utility.slice(5);
    return /^\d+$/.test(value)
        ? `--tw-ring-shadow: 0 0 0 ${value}px var(--tw-ring-color, #3b82f680)`
        : null;
}

/**
 * Resolves flex sizing, order, and columns.
 * @param utility
 */
function resolveFlexOrderDeclaration(utility: string): string | null {
    if (utility.startsWith('grow-')) return `flex-grow: ${utility.slice(5)}`;
    if (utility.startsWith('shrink-')) return `flex-shrink: ${utility.slice(7)}`;
    if (utility.startsWith('order-')) {
        const value = utility.slice(6);
        if (value === 'first') return 'order: -9999';
        if (value === 'last') return 'order: 9999';
        return value === 'none' ? 'order: 0' : `order: ${value}`;
    }
    if (!utility.startsWith('columns-')) return null;
    const value = utility.slice(8);
    const arbitrary = arbitraryDeclaration('columns', value);
    if (arbitrary !== null) return arbitrary;
    return Number.isNaN(Number.parseInt(value, 10))
        ? `columns: var(--container-${value})`
        : `columns: ${value}`;
}

/**
 * Resolves grid template and span utilities.
 * @param utility
 */
function resolveGridDeclaration(utility: string): string | null {
    if (utility.startsWith('grid-cols-')) return resolveGridTemplate(utility.slice(10), 'columns');
    if (utility.startsWith('grid-rows-')) return resolveGridTemplate(utility.slice(10), 'rows');
    if (utility.startsWith('col-span-')) return resolveGridSpan(utility.slice(9), 'column');
    if (utility.startsWith('row-span-')) return resolveGridSpan(utility.slice(9), 'row');
    return null;
}

/**
 * Resolves a grid template value.
 * @param value
 * @param axis
 */
function resolveGridTemplate(value: string, axis: 'columns' | 'rows'): string | null {
    if (value === 'none' || value === 'subgrid') return `grid-template-${axis}: ${value}`;
    const arbitrary = arbitraryDeclaration(`grid-template-${axis}`, value);
    if (arbitrary !== null) return arbitrary;
    return /^\d+$/.test(value) ? `grid-template-${axis}: repeat(${value}, minmax(0, 1fr))` : null;
}

/**
 * Resolves a grid span value.
 * @param value
 * @param axis
 */
function resolveGridSpan(value: string, axis: 'column' | 'row'): string {
    return value === 'full'
        ? `grid-${axis}: 1 / -1`
        : `grid-${axis}: span ${value} / span ${value}`;
}

/**
 * Resolves scale, rotate, and translate utilities.
 * @param utility
 */
function resolveTransformDeclaration(utility: string): string | null {
    if (utility.startsWith('scale-x-'))
        return `--tw-scale-x: ${Number.parseFloat(utility.slice(8)) / 100}; scale: var(--tw-scale-x) var(--tw-scale-y, 1)`;
    if (utility.startsWith('scale-y-'))
        return `--tw-scale-y: ${Number.parseFloat(utility.slice(8)) / 100}; scale: var(--tw-scale-x, 1) var(--tw-scale-y)`;
    if (utility.startsWith('scale-')) return `scale: ${Number.parseFloat(utility.slice(6)) / 100}`;
    if (utility.startsWith('rotate-')) {
        const value = utility.slice(7);
        return NUMBER_TEXT.test(value)
            ? `rotate: ${value}deg`
            : arbitraryDeclaration('rotate', value);
    }
    if (utility.startsWith('translate-x-')) {
        const x = resolveSpacingValue(utility.slice(12), 'width');
        return x && `translate: ${x} var(--tw-translate-y, 0)`;
    }
    if (utility.startsWith('translate-y-')) {
        const y = resolveSpacingValue(utility.slice(12), 'height');
        return y && `translate: var(--tw-translate-x, 0) ${y}`;
    }
    return null;
}

/**
 * Resolves transition utilities.
 * @param utility
 */
function resolveTransitionDeclaration(utility: string): string | null {
    if (utility === 'transition')
        return 'transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter; transition-timing-function: var(--tw-ease, ease); transition-duration: var(--tw-duration, 150ms)';
    if (utility === 'transition-all')
        return 'transition-property: all; transition-timing-function: var(--tw-ease, ease); transition-duration: var(--tw-duration, 150ms)';
    if (utility === 'transition-none') return 'transition-property: none';
    if (utility.startsWith('duration-'))
        return resolveTimedTransition(utility.slice(9), 'duration');
    if (utility.startsWith('delay-')) return resolveTimedTransition(utility.slice(6), 'delay');
    if (!utility.startsWith('ease-')) return null;
    const value = utility.slice(5);
    const eases: Record<string, string> = {
        linear: 'linear',
        in: 'cubic-bezier(0.4, 0, 1, 1)',
        out: 'cubic-bezier(0, 0, 0.2, 1)',
        'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
    };
    const timingFunction = own(eases, value) ?? `var(--ease-${value})`;
    return `transition-timing-function: ${timingFunction}`;
}

/**
 * Resolves a transition time.
 * @param value
 * @param kind
 */
function resolveTimedTransition(value: string, kind: 'duration' | 'delay'): string | null {
    return NUMBER_TEXT.test(value)
        ? `transition-${kind}: ${value}ms`
        : arbitraryDeclaration(`transition-${kind}`, value);
}

/**
 * Whether the shared classifier reads this token as the given property group.
 *
 * The class toolkit already decides what a value MEANS, from the same tables
 * `szcn` merges by: `bg-cover` is a size, `bg-red-500` a colour, `text-[#123]`
 * a colour, `text-[14px]` a size. Asking it here is what keeps the dynamic lane
 * from inventing a second answer — and a second answer is exactly how
 * `bg-cover` became `background-color: var(--color-cover)`.
 *
 * An unclassified token gets the benefit of the doubt, so a prefix the toolkit
 * has no opinion about keeps whatever the resolvers made of it.
 *
 * @param utility - The base utility, without variants.
 * @param group - The property group to test for.
 * @returns Whether the classifier disagrees with that group.
 */
function classifiedAsOther(utility: string, group: string): boolean {
    const property = classify(utility)?.property;
    return property !== undefined && property !== group;
}

/**
 * Resolves color utilities.
 * @param utility
 */
function resolveColorDeclaration(utility: string): string | null {
    const prefix = prefixOf(utility);
    if (prefix === undefined || own(COLOR_PROPS, prefix) === undefined) return null;
    const value = utility.slice(prefix.length + 1);
    return value ? colorDeclaration(utility, prefix, value) : null;
}

/**
 * The declaration of one colour utility under its prefix.
 * @param utility
 * @param prefix
 * @param value
 */
function colorDeclaration(utility: string, prefix: string, value: string): string | null {
    // A shadow's size, with an opacity or not (`shadow-sm/50`,
    // `inset-shadow-xs`), is the shadow, not its colour: Tailwind rewrites the
    // colours inside the theme's shadow at build time, which a rule here
    // cannot do from a variable, so it writes none (`dynamic.mdx`).
    if (SHADOW_PREFIXES.has(prefix) && isShadowValue(slashOpacitySplit(value)?.[0] ?? value)) {
        return '';
    }
    const color = slashOpacitySplit(value)?.[0] ?? value;
    // Digits name no colour (`bg-2`); Tailwind writes no rule.
    if (/^\d+$/.test(color)) return null;
    if (delimited(color)) {
        // A bracket another property of the prefix reads (`bg-[12px]/50`,
        // `bg-(image:--x)/50`) is not the colour, whatever its slash says.
        if (sharedPrefixProperty(prefix, color) !== undefined) return '';
    } else if (classifiedAsOther(utility, 'color')) {
        // A prefix in this table is not enough: `bg-cover` and `bg-center`
        // live under one, and neither is a colour.
        return null;
    }
    return declare(COLOR_PROPS[prefix] as string, resolveColorValue(value));
}

/**
 * Resolves spacing utilities, including leading-dash negatives.
 * @param utility
 */
function resolveSpacingDeclaration(utility: string): string | null {
    const negative = utility.startsWith('-');
    const base = negative ? utility.slice(1) : utility;
    const prefix = prefixOf(base);
    const properties = prefix === undefined ? undefined : own(SPACING_PROPS, prefix);
    if (prefix === undefined || properties === undefined) return null;
    const value = base.slice(prefix.length + 1);
    const sign = negative ? '-' : '';
    // An offset's number is pixels, not the spacing scale (`outline-offset-2`).
    const resolved =
        PIXEL_SCALE_PREFIXES.has(prefix) && /^\d+$/.test(value)
            ? `${sign}${value}px`
            : resolveSpacingValue(`${sign}${value}`, properties[0]);
    return resolved ? properties.map(property => `${property}: ${resolved}`).join('; ') : null;
}

/** The spacing prefixes whose bare number is pixels. */
const PIXEL_SCALE_PREFIXES: ReadonlySet<string> = new Set([
    'outline-offset',
    'underline-offset',
    'ring-offset',
]);

/** Every prefix of the tables, longest first, once {@link prefixOf} asks. */
let knownPrefixes: readonly string[] | undefined;

/**
 * The longest prefix of any table a utility starts with: `outline-offset-2`
 * is `outline-offset`'s and `inset-ring-2` is `inset-ring`'s, never the
 * shorter `outline`'s or `inset`'s, whichever resolver asks first.
 *
 * Cost: O(p) prefix tests for the `p` prefixes of the tables, sorted once.
 *
 * @param utility - The utility, without a leading `-`.
 * @returns The prefix, or undefined.
 */
function prefixOf(utility: string): string | undefined {
    knownPrefixes ??= [
        ...new Set([
            ...Object.keys(COLOR_PROPS),
            ...Object.keys(SPACING_PROPS),
            ...Object.keys(SHARED_PREFIX_TYPES),
        ]),
    ].sort((a, b) => b.length - a.length);
    return knownPrefixes.find(prefix => utility.startsWith(`${prefix}-`));
}

/**
 * Resolves a `[…]` or `(…)` value on a prefix several properties share, to
 * the property its type picks (`text-[12px]` the size, `bg-[12px]` the
 * position, `font-[Inter]` the family). A colour is the colour resolver's.
 * @param utility
 */
function resolveSharedPrefixDeclaration(utility: string): string | null {
    const prefix = prefixOf(utility);
    const value = prefix === undefined ? '' : utility.slice(prefix.length + 1);
    if (prefix === undefined || !delimited(value)) return null;
    const property = sharedPrefixProperty(prefix, value);
    if (property === undefined) return null;
    return declare(borderSide(prefix) ?? property, delimitedValue(value));
}

/**
 * Resolves an arbitrary property utility.
 * @param utility
 */
function resolveArbitraryPropertyDeclaration(utility: string): string | null {
    if (!utility.startsWith('[') || !utility.endsWith(']') || !utility.includes(':')) return null;
    // The property is written as given; only its value is decoded.
    const inner = utility.slice(1, -1);
    const colon = inner.indexOf(':');
    return `${inner.slice(0, colon)}: ${decodeArbitraryValue(inner.slice(colon + 1))}`;
}

/* eslint-enable jsdoc/require-param-description, jsdoc/require-returns */

// ── Main generator ────────────────────────────────────────────────────────────

/**
 * Generates a CSS rule body (without selector) for a utility class.
 * Returns empty string for unknown/unsupported classes.
 *
 * @param utility - the base Tailwind utility (e.g. "p-4", "bg-blue-500", "flex")
 * @returns CSS declarations string (e.g. "padding: calc(var(--spacing) * 4)")
 */
export function generateDeclarations(utility: string): string {
    // ── 0. Security: reject any arbitrary [...] segment that could inject a
    // second declaration into this rule. Only attacker-controllable arbitrary
    // values hit this; csszyx-generated numeric/keyword utilities always pass.
    // Fail safe (emit nothing) rather than throw — a per-render throw is itself
    // a DoS.
    if (!isUtilityArbitrarySafe(utility)) {
        warnUnsafeArbitrary(utility);
        return '';
    }

    // ── 1. Keyword lookup (fastest path) ───────────────────────────────────
    const keywordRule = own(KEYWORD_RULES, utility);
    if (keywordRule !== undefined) {
        return keywordRule;
    }
    for (const resolver of DECLARATION_RESOLVERS) {
        const declaration = resolver(utility);
        if (declaration !== null) return declaration;
    }
    return '';
}

/**
 * Generates a complete CSS rule string for a Tailwind class name.
 *
 * @param className - full Tailwind class (e.g. "hover:bg-blue-500", "sm:p-4", "p-4")
 * @returns CSS rule string (e.g. ".hover\\:bg-blue-500:hover { background-color: var(--color-blue-500) }")
 *          or empty string for unknown classes
 */
export function generateCSSRule(className: string): string {
    const { utility, pseudoSuffix, selectorPrefix, unknownVariant } = parseVariants(className);
    // A variant with no selector here, or a `css:` declaration (a whole-utility
    // arbitrary property, build-time only): no rule rather than a wrong one.
    if (unknownVariant !== undefined) {
        warnUnsupported(className, unknownVariant);
        return '';
    }
    if (utility.startsWith('[') && utility.endsWith(']') && utility.includes(':')) {
        warnUnsupported(className, undefined);
        return '';
    }
    // Text a runtime value put into the utility reaches the declaration only
    // through a structure that states one value.
    if (!isUtilityStructureSafe(utility)) {
        warnUnsafeArbitrary(utility);
        return '';
    }
    const declarations = generateDeclarations(utility);

    if (!declarations) {
        return '';
    }

    const escapedClass = escapeCSSSelector(className);
    const selector = `${selectorPrefix}.${escapedClass}${pseudoSuffix}`;
    return `${selector} { ${declarations} }`;
}
