/**
 * Keys whose Tailwind utility cannot read a CSS custom property.
 *
 * The css-var strategy for a runtime value assumes one thing: that
 * `<prefix>-(--var)` is the same utility as `<prefix>-<literal>`, only with the
 * value deferred. For most of the sz vocabulary that holds. For the keys below
 * it does not, in one of the two ways this module separates.
 *
 * Membership is not a judgement call. `pnpm check:var-hostile-keys` derives it
 * by compiling both forms of every documented key through the pinned Tailwind
 * and comparing which CSS properties each one sets, so a Tailwind version that
 * adds an arbitrary-value form for one of these keys fails the gate until it is
 * taken off the list — rather than leaving csszyx warning about a shape that now
 * works.
 *
 * Build-lane vocabulary: nothing imports this module. It is the source
 * `pnpm gen:rust-tables` renders into the engine's generated tables, which is
 * where `packages/core/src/transform/var_hostile.rs` reads it and explains what
 * the engine does about it. The runtime lowering receives an actual value and
 * produces the keyword utility, so it never needed this list.
 */

/**
 * Keys whose `-(--var)` form resolves to a DIFFERENT CSS property.
 *
 * The damaging half: Tailwind emits a rule, so the element is styled — just not
 * the way the author asked, and often over something that was working.
 * `textAlign` and `color` both lower to `text-*`, and Tailwind v4 reads
 * `text-(--v)` as a COLOUR, so a runtime `textAlign` produced
 * `color: var(…)` holding `"center"` — an invalid value that unset the
 * inherited colour and aligned nothing.
 */
export const VAR_HOSTILE_WRONG_PROPERTY: ReadonlySet<string> = new Set([
    'bgAttach',
    'bgImg',
    'bgRepeat',
    'bgSize',
    'borderCollapse',
    'borderStyle',
    'decoration',
    'decorationStyle',
    'flexDir',
    'flexWrap',
    'fontFamily',
    'listPos',
    'objectFit',
    'outlineStyle',
    'text',
    'textAlign',
    'textTransform',
    'textWrap',
    'transformStyle',
    'transitionBehavior',
]);

/**
 * Keys whose `-(--var)` form matches no Tailwind utility.
 *
 * The silent half: `display-(--v)` matches nothing, so no rule is generated,
 * the element is simply unstyled, and the class is safelist noise.
 */
export const VAR_HOSTILE_NO_VAR_FORM: ReadonlySet<string> = new Set([
    'alignContent',
    'appearance',
    'backface',
    'bgClip',
    'bgOrigin',
    'box',
    'boxDecoration',
    'breakAfter',
    'breakBefore',
    'breakInside',
    'caption',
    'clear',
    'container',
    'display',
    'fieldSizing',
    'float',
    'fontSmoothing',
    'fontStyle',
    'fontVariant',
    'forcedColorAdjust',
    'gridFlow',
    'isolation',
    'items',
    'justify',
    'justifyItems',
    'justifySelf',
    'maskClip',
    'maskComposite',
    'maskConic',
    'maskLinear',
    'maskMode',
    'maskOrigin',
    'maskRepeat',
    'maskType',
    'mixBlend',
    'notSrOnly',
    'ordinal',
    'overflow',
    'overflowX',
    'overflowY',
    'overscroll',
    'overscrollX',
    'overscrollY',
    'placeContent',
    'placeItems',
    'placeSelf',
    'pointerEvents',
    'position',
    'resize',
    'scheme',
    'scroll',
    'scrollbar',
    'scrollbarGutter',
    'select',
    'self',
    'slashedZero',
    'snapAlign',
    'snapStop',
    'snapType',
    'srOnly',
    'tableLayout',
    'textClip',
    'textEllipsis',
    'touch',
    'visibility',
    'whitespace',
]);
