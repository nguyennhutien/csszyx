/**
 * The closed-enum keys: each key's values and the class each one emits, the
 * fixed part a value outside the table keeps, and the values that moved to a
 * key of their own.
 *
 * The browser lowering (`transform-core.ts`) and the diagnostic renderer both
 * read these, and `pnpm gen:rust-tables` renders them for the engine. They sit
 * in a leaf module of their own so a process that renders the engine's
 * diagnostics (`@csszyx/compiler/engine`, `/internal`) loads the tables and not
 * the lowering around them.
 *
 * @module closed-enum-tables
 */

/**
 * Keys whose value set is closed, mapped value → the utility it emits.
 *
 * These four spell their value as the BARE Tailwind utility (`flex`,
 * `absolute`, `invisible`), which is what made an unrecognised value dangerous
 * rather than merely dead: `{ display: 'bogus' }` used to emit the class
 * `bogus`, a single unprefixed word of exactly the shape a project's own
 * component CSS is made of, so the typo could match a rule that was never meant
 * for it. CSS closes all four value sets, so the typo is decidable here and the
 * class is dropped instead — the same answer `textTransform` and `fontStyle`
 * already give.
 *
 * Source of truth for the members: `docs/specs/snippets/layout.md`. The engine
 * reads a generated copy of this table, so both artifacts refuse the same
 * values.
 */
/** @internal Read by the diagnostic renderer; not a stable shape. */
export const CLOSED_ENUM_CLASSES: Readonly<Record<string, Readonly<Record<string, string>>>> =
    /* @__PURE__ */ Object.freeze({
        display: {
            block: 'block',
            'inline-block': 'inline-block',
            inline: 'inline',
            flex: 'flex',
            'inline-flex': 'inline-flex',
            grid: 'grid',
            'inline-grid': 'inline-grid',
            contents: 'contents',
            table: 'table',
            'inline-table': 'inline-table',
            'table-caption': 'table-caption',
            'table-cell': 'table-cell',
            'table-column': 'table-column',
            'table-column-group': 'table-column-group',
            'table-footer-group': 'table-footer-group',
            'table-header-group': 'table-header-group',
            'table-row-group': 'table-row-group',
            'table-row': 'table-row',
            'flow-root': 'flow-root',
            'list-item': 'list-item',
            none: 'hidden',
        },
        position: {
            static: 'static',
            fixed: 'fixed',
            absolute: 'absolute',
            relative: 'relative',
            sticky: 'sticky',
        },
        visibility: {
            visible: 'visible',
            hidden: 'invisible',
            collapse: 'collapse',
        },
        isolation: {
            isolate: 'isolate',
            auto: 'isolation-auto',
        },
        // font-variant-numeric, one key per group of `normal | [ <figure> ||
        // <spacing> || <fraction> || ordinal || slashed-zero ]`. Each group is one
        // Tailwind variable, so two keywords of a group override and different
        // groups combine. Source of truth: `docs/specs/snippets/typography.md`.
        nums: { normal: 'normal-nums' },
        numFigure: { lining: 'lining-nums', oldstyle: 'oldstyle-nums' },
        numSpacing: { proportional: 'proportional-nums', tabular: 'tabular-nums' },
        numFraction: { diagonal: 'diagonal-fractions', stacked: 'stacked-fractions' },
        // touch-action: `auto | none | [ pan-x… || pan-y… || pinch-zoom ] |
        // manipulation`. `touch` holds the keywords that stand alone. Source of
        // truth: `docs/specs/snippets/interactivity.md`.
        touch: { auto: 'touch-auto', none: 'touch-none', manipulation: 'touch-manipulation' },
        touchPanX: { x: 'touch-pan-x', left: 'touch-pan-left', right: 'touch-pan-right' },
        touchPanY: { y: 'touch-pan-y', up: 'touch-pan-up', down: 'touch-pan-down' },
        // contain: `none | strict | content | [ size|inline-size || layout || style
        // || paint ]`. Source of truth: `docs/specs/snippets/layout.md`.
        contain: { none: 'contain-none', strict: 'contain-strict', content: 'contain-content' },
        containSize: { size: 'contain-size', 'inline-size': 'contain-inline-size' },
    });

/**
 * What a closed-enum key wraps around a value outside its table.
 *
 * `display`/`position`/`visibility` spell their value as the bare utility, so
 * a typo goes out verbatim. The other keys' utilities carry a fixed part, and
 * keeping it on a typo keeps the class clear of a project's own CSS names:
 * `numSpacing: 'tabulr'` ships `tabulr-nums`, not `tabulr`. The engine reads a
 * generated copy, so both artifacts emit the same class.
 */
const CLOSED_ENUM_AFFIXES: Record<string, Record<'prefix' | 'suffix', string>> = {
    isolation: { prefix: 'isolation-', suffix: '' },
    nums: { prefix: '', suffix: '-nums' },
    numFigure: { prefix: '', suffix: '-nums' },
    numSpacing: { prefix: '', suffix: '-nums' },
    numFraction: { prefix: '', suffix: '-fractions' },
    touch: { prefix: 'touch-', suffix: '' },
    touchPanX: { prefix: 'touch-pan-', suffix: '' },
    touchPanY: { prefix: 'touch-pan-', suffix: '' },
    contain: { prefix: 'contain-', suffix: '' },
    containSize: { prefix: 'contain-', suffix: '' },
};

/**
 * Values a closed key took until a group got its own key, keyed
 * `<key>:<value>`, with the key and value that replaced them.
 *
 * A moved value emits no class and names its replacement, as a removed key
 * does. A replacement value of `'true'` is the boolean flag. The engine reads
 * a generated copy (`closed_enum_value_move`), and `csszyx migrate` rewrites
 * with it.
 * @internal Used by csszyx's own packages; not a stable API.
 */
export const CLOSED_ENUM_VALUE_MOVES: Readonly<
    Record<string, Readonly<Record<'key' | 'value', string>>>
> = /* @__PURE__ */ Object.freeze({
    'touch:pan-x': { key: 'touchPanX', value: 'x' },
    'touch:pan-left': { key: 'touchPanX', value: 'left' },
    'touch:pan-right': { key: 'touchPanX', value: 'right' },
    'touch:pan-y': { key: 'touchPanY', value: 'y' },
    'touch:pan-up': { key: 'touchPanY', value: 'up' },
    'touch:pan-down': { key: 'touchPanY', value: 'down' },
    'touch:pinch-zoom': { key: 'touchPinchZoom', value: 'true' },
});

/**
 * The class a closed-enum key emits for a value outside its table.
 *
 * The value keeps its key's fixed part (`CLOSED_ENUM_AFFIXES`), or goes out
 * verbatim on the keys whose value IS the class. The class is emitted on
 * purpose: it is what makes the typo findable in the DOM when no diagnostic
 * reaches it.
 * @param key - The closed-enum key.
 * @param value - The value outside its set, without the important modifier.
 * @returns The bare utility, before any variant prefix.
 * @internal Read by the diagnostic renderer too.
 */
export function bareClosedEnumClass(key: string, value: string): string {
    const affix = CLOSED_ENUM_AFFIXES[key];
    return oneClass(affix ? `${affix.prefix}${value}${affix.suffix}` : value);
}

/** One character of Unicode White_Space, the set the engine splits on. */
const WHITE_SPACE = /\p{White_Space}/u;

/** A run of Unicode White_Space. */
const WHITE_SPACE_RUN = /\p{White_Space}+/u;

/**
 * A class with whitespace in it, as one class: its runs of whitespace become
 * `_`, as Tailwind reads them, and a run at either end goes. Every lowered
 * class goes through it, and so does the class a diagnostic names, so the two
 * never differ.
 *
 * Whitespace is Unicode White_Space, as `split_whitespace` in `lower.rs`
 * reads it: JavaScript's `\s` also takes a BOM (U+FEFF) and leaves out a NEL
 * (U+0085), so the two lanes wrote different classes for either. Linear in
 * the class's length.
 *
 * @param className - The class as lowered.
 * @returns The class as emitted.
 */
export function oneClass(className: string): string {
    if (!WHITE_SPACE.test(className)) return className;
    return className
        .split(WHITE_SPACE_RUN)
        .filter(part => part !== '')
        .join('_');
}

/**
 * The value without the White_Space at either end, as `str::trim` in the
 * engine reads it; `String.prototype.trim` reads `\s`. Every White_Space code
 * point is in the BMP, so one UTF-16 unit is one character here. Linear in
 * the value's length, with no regex to backtrack.
 *
 * @param value - The value as written.
 * @returns The value trimmed.
 */
export function trimWhiteSpace(value: string): string {
    let start = 0;
    let end = value.length;
    while (start < end && WHITE_SPACE.test(value[start] as string)) start++;
    while (end > start && WHITE_SPACE.test(value[end - 1] as string)) end--;
    return value.slice(start, end);
}

/** Every White_Space character, for {@link withoutWhiteSpace}. */
const WHITE_SPACE_ALL = /\p{White_Space}/gu;

/**
 * The text with every White_Space character dropped, as the engine filters
 * `char::is_whitespace` out of an arbitrary variant.
 *
 * @param text - The text as written.
 * @returns The text without whitespace.
 */
export function withoutWhiteSpace(text: string): string {
    return text.replace(WHITE_SPACE_ALL, '');
}
