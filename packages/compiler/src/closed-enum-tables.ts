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

/**
 * A class with whitespace in it, as one class: its runs of whitespace become
 * `_`, as Tailwind reads them. Every lowered class goes through it, and so
 * does the class a diagnostic names, so the two never differ.
 *
 * @param className - The class as lowered.
 * @returns The class as emitted.
 */
export function oneClass(className: string): string {
    return /\s/.test(className) ? className.trim().split(/\s+/).join('_') : className;
}
