/**
 * Generate the class-token → box-role map consumed by `@csszyx/runtime`'s
 * `splitBox` / `classify` / `has` / `pick` / `omit`.
 *
 * The runtime needs to route an emitted className string to a nested element by
 * CSS box-model role (outer = border-outward, inner = border-inward). The set of
 * class prefixes and value-keyed tokens is owned by the compiler
 * (`PROPERTY_MAP`, `REMOVED_BOOLEAN_SUGAR`, `BOOLEAN_SHORTHANDS`), so this map is
 * GENERATED from those tables — the same anti-drift discipline as
 * `gen:rust-tables` / `gen:key-tests`. A hand-maintained copy would silently rot
 * the moment the compiler gains a prop.
 *
 * The box-ROLE assignment itself is a new classification (the compiler's
 * `PROPERTY_CATEGORY_MAP` is value-TYPE — `p` and `m` are both SPACING but
 * padding is inner and margin is outer), so the source of truth for the role
 * lives here in `BOX_ROLE_RULES`. `--check` asserts every `PROPERTY_MAP` key is
 * classified, so a new compiler prop fails CI until it is given a role.
 *
 * Usage:
 *   node --import tsx/esm scripts/gen-box-role-map.mjs           # write
 *   node --import tsx/esm scripts/gen-box-role-map.mjs --check   # CI: fail if stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    BOOLEAN_SHORTHANDS,
    PROPERTY_MAP,
    REMOVED_BOOLEAN_SUGAR,
    transform,
} from '../packages/compiler/src/transform-core.js';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const outPath = join(repoRoot, 'packages/runtime/src/box-role-map.generated.ts');

/**
 * Source of truth for the box-model role of every sz prop. Each rule lists the
 * EXACT sz prop keys it owns; the generator asserts the union equals
 * `PROPERTY_MAP`'s keys (no silent gaps, no key in two rules). Contested calls
 * (sizing→outer, display→inner, bg→outer, overflow→inner, visibility→outer) are
 * the deliberate defaults — every one is overridable at `splitBox` call time.
 *
 * OUTER = border-outward (margin, position, the border ring itself, and effects
 * that transform/composite the whole element). INNER = border-inward (padding,
 * the content the element lays out and paints inside its border).
 */
const BOX_ROLE_RULES = [
    // ── OUTER ────────────────────────────────────────────────────────────
    {
        role: 'outer',
        category: 'margin',
        keys: ['m', 'mt', 'mr', 'mb', 'ml', 'mx', 'my', 'ms', 'me', 'mbs', 'mbe'],
    },
    {
        role: 'outer',
        category: 'position',
        keys: [
            'z',
            'position',
            'inset',
            'insetX',
            'insetY',
            'top',
            'right',
            'bottom',
            'left',
            'start',
            'end',
            'insetS',
            'insetE',
            'insetBs',
            'insetBe',
            'float',
            'clear',
            'isolation',
        ],
    },
    {
        role: 'outer',
        category: 'border',
        keys: [
            'border',
            'borderColor',
            'borderStyle',
            'borderT',
            'borderTColor',
            'borderR',
            'borderRColor',
            'borderB',
            'borderBColor',
            'borderL',
            'borderLColor',
            'borderX',
            'borderXColor',
            'borderY',
            'borderYColor',
            'borderS',
            'borderE',
            'borderBs',
            'borderBe',
            'borderCollapse',
            'borderSpacing',
            'borderSpacingX',
            'borderSpacingY',
        ],
    },
    {
        role: 'outer',
        category: 'rounded',
        keys: [
            'rounded',
            'roundedT',
            'roundedR',
            'roundedB',
            'roundedL',
            'roundedTl',
            'roundedTr',
            'roundedBl',
            'roundedBr',
            'roundedS',
            'roundedE',
            'roundedSs',
            'roundedSe',
            'roundedEs',
            'roundedEe',
        ],
    },
    {
        role: 'outer',
        category: 'outline',
        keys: ['outline', 'outlineColor', 'outlineOffset', 'outlineStyle'],
    },
    // inset-ring / inset-shadow are painted inside the border, but on the border
    // box of the ELEMENT THAT DECLARES THEM — they are that element's own
    // painting, not something its children lay out inside. Same side as the ring
    // and shadow they mirror.
    {
        role: 'outer',
        category: 'ring',
        keys: ['ring', 'ringColor', 'ringOffset', 'ringOffsetColor', 'insetRing', 'insetRingColor'],
    },
    {
        role: 'outer',
        category: 'shadow',
        keys: ['shadow', 'shadowColor', 'insetShadow', 'insetShadowColor'],
    },
    // sizing → OUTER (contested): width/height constrain the frame the parent gives.
    {
        role: 'outer',
        category: 'sizing',
        keys: [
            'w',
            'minW',
            'maxW',
            'h',
            'minH',
            'maxH',
            'size',
            'blockSize',
            'minBlockSize',
            'maxBlockSize',
            'inlineSize',
            'minInlineSize',
            'maxInlineSize',
            'aspect',
            'box',
        ],
    },
    {
        role: 'outer',
        category: 'fragmentation',
        keys: ['breakAfter', 'breakBefore', 'breakInside', 'boxDecoration'],
    },
    // bg → OUTER (contested): the frame's stable background, matches the report.
    {
        role: 'outer',
        category: 'bg',
        keys: [
            'bg',
            'bgAttach',
            'bgClip',
            'bgImg',
            'bgOrigin',
            'bgPos',
            'bgRepeat',
            'bgSize',
            'bgBlend',
        ],
    },
    { role: 'outer', category: 'gradient', keys: ['from', 'via', 'to'] },
    // visibility → OUTER (contested): toggles the whole element, not its content.
    { role: 'outer', category: 'visibility', keys: ['visibility'] },
    { role: 'outer', category: 'opacity', keys: ['opacity'] },
    { role: 'outer', category: 'blend', keys: ['mixBlend'] },
    {
        role: 'outer',
        category: 'filter',
        keys: [
            'filter',
            'blur',
            'brightness',
            'contrast',
            'dropShadow',
            'dropShadowColor',
            'grayscale',
            'hueRotate',
            'invert',
            'saturate',
            'sepia',
        ],
    },
    {
        role: 'outer',
        category: 'backdrop',
        keys: [
            'backdropFilter',
            'backdropBlur',
            'backdropBrightness',
            'backdropContrast',
            'backdropGrayscale',
            'backdropHueRotate',
            'backdropInvert',
            'backdropOpacity',
            'backdropSaturate',
            'backdropSepia',
        ],
    },
    {
        role: 'outer',
        category: 'transform',
        keys: [
            'scale',
            'scaleX',
            'scaleY',
            'scaleZ',
            'rotate',
            'rotateX',
            'rotateY',
            'rotateZ',
            'translate',
            'translateX',
            'translateY',
            'translateZ',
            'skewX',
            'skewY',
            'origin',
            'backface',
            'transform',
            'zoom',
        ],
    },
    {
        role: 'outer',
        category: 'transition',
        keys: [
            'transition',
            'transitionBehavior',
            'duration',
            'ease',
            'delay',
            'animate',
            'animationDelay',
        ],
    },
    {
        role: 'outer',
        category: 'mask',
        keys: [
            'mask',
            'maskSize',
            'maskPos',
            'maskRepeat',
            'maskLinear',
            'maskRadial',
            'maskConic',
            'maskClip',
            'maskOrigin',
        ],
    },
    { role: 'outer', category: 'color-scheme', keys: ['scheme', 'forcedColorAdjust'] },

    // ── INNER ────────────────────────────────────────────────────────────
    {
        role: 'inner',
        category: 'padding',
        keys: ['p', 'pt', 'pr', 'pb', 'pl', 'px', 'py', 'ps', 'pe', 'pbs', 'pbe'],
    },
    { role: 'inner', category: 'space', keys: ['spaceX', 'spaceY'] },
    // `divide-*` draws a border BETWEEN a container's children — on a frame with
    // one child it paints nothing at all (measured: 0 px). It is a container
    // property, like `space-*` beside it.
    {
        role: 'inner',
        category: 'divide',
        keys: ['divideX', 'divideY', 'divideColor', 'divideStyle'],
    },
    // These three establish the 3D rendering context the CHILDREN are laid out
    // in; the rest of `transform` moves the box itself and stays outer.
    {
        role: 'inner',
        category: 'transform',
        keys: ['perspective', 'perspectiveOrigin', 'transformStyle'],
    },
    { role: 'inner', category: 'columns', keys: ['columns'] },
    { role: 'inner', category: 'object', keys: ['objectFit', 'objectPos'] },
    // overflow → INNER (contested): clips the content the element lays out.
    { role: 'inner', category: 'overflow', keys: ['overflow', 'overflowX', 'overflowY'] },
    { role: 'inner', category: 'overscroll', keys: ['overscroll', 'overscrollX', 'overscrollY'] },
    // display → INNER (contested): governs how the element's children flow.
    { role: 'inner', category: 'display', keys: ['display'] },
    {
        role: 'inner',
        category: 'text',
        keys: [
            'color',
            'text',
            'weight',
            'fontFamily',
            'fontStretch',
            'fontStyle',
            'fontSmoothing',
            'fontFeatures',
            'textAlign',
            'decoration',
            'decorationColor',
            'decorationStyle',
            'decorationThickness',
            'underlineOffset',
            'textTransform',
            'textOverflow',
            'textWrap',
            'wrap',
            'indent',
            'whitespace',
            'break',
            'hyphens',
            'content',
            'leading',
            'tracking',
            'lineClamp',
            'tabSize',
            'textShadow',
            'textShadowColor',
        ],
    },
    { role: 'inner', category: 'list', keys: ['list', 'listPos', 'listImg'] },
    // Flex and grid split at the border line like everything else: the
    // CONTAINER properties (direction, wrap, item alignment, gap, the grid
    // template) act on the contents and are inner; the ITEM properties
    // (grow, order, self, span, …) describe how this box sits among its
    // siblings in the parent's container — its relationship to its
    // neighbours — and are outer. Same category on both sides, so a
    // category selector (`{ inner: ['flex'] }`) still reaches all of them.
    { role: 'inner', category: 'flex', keys: ['flexDir', 'flexWrap'] },
    {
        role: 'inner',
        category: 'alignment',
        keys: ['items', 'justify', 'justifyItems', 'placeContent', 'placeItems'],
    },
    { role: 'inner', category: 'gap', keys: ['gap', 'gapX', 'gapY'] },
    {
        role: 'inner',
        category: 'grid',
        keys: ['gridCols', 'gridRows', 'gridFlow', 'autoCols', 'autoRows'],
    },
    // ── OUTER (item side of flex and grid) ────────────────────────────────
    { role: 'outer', category: 'flex', keys: ['basis', 'flex', 'grow', 'shrink', 'order'] },
    { role: 'outer', category: 'alignment', keys: ['self', 'justifySelf', 'placeSelf'] },
    {
        role: 'outer',
        category: 'grid',
        keys: ['col', 'colSpan', 'colStart', 'colEnd', 'row', 'rowSpan', 'rowStart', 'rowEnd'],
    },
    { role: 'inner', category: 'svg', keys: ['fill', 'stroke', 'strokeWidth'] },
    { role: 'inner', category: 'table', keys: ['tableLayout', 'caption'] },
    { role: 'inner', category: 'accent', keys: ['caret', 'accent'] },
    // What the box lets the user DO with it — the pointer meets the frame
    // first, and a selection or a will-change hint applies to the whole
    // element, not to the content it lays out.
    {
        role: 'outer',
        category: 'interaction',
        keys: ['cursor', 'pointerEvents', 'select', 'willChange'],
    },
    // These three change how the box renders its own control affordance.
    {
        role: 'inner',
        category: 'interaction',
        keys: ['fieldSizing', 'resize', 'appearance'],
    },
    {
        role: 'inner',
        category: 'scroll',
        keys: [
            'scroll',
            'scrollP',
            'scrollPt',
            'scrollPr',
            'scrollPb',
            'scrollPl',
            'scrollPs',
            'scrollPe',
            'scrollPx',
            'scrollPy',
            'scrollPbs',
            'scrollPbe',
            'scrollbar',
            'scrollbarThumb',
            'scrollbarTrack',
            'scrollbarGutter',
        ],
    },
    // `snap-type` makes THIS box a snap container for its children; `snap-align`
    // and `snap-stop` say how this box snaps inside its ANCESTOR's container,
    // the way `m-*` is measured against the parent.
    { role: 'inner', category: 'snap', keys: ['snapType'] },
    { role: 'outer', category: 'snap', keys: ['snapAlign', 'snapStop'] },
    // Scroll margin is the box's own outset in its ancestor's scrollport;
    // scroll padding insets the scrollport this box establishes.
    {
        role: 'outer',
        category: 'scroll',
        keys: [
            'scrollM',
            'scrollMt',
            'scrollMr',
            'scrollMb',
            'scrollMl',
            'scrollMs',
            'scrollMe',
            'scrollMx',
            'scrollMy',
            'scrollMbs',
            'scrollMbe',
        ],
    },
    // vertical-align positions this box within its parent's line box.
    { role: 'outer', category: 'text', keys: ['align'] },
    { role: 'inner', category: 'touch', keys: ['touch'] },
];

/**
 * Role for boolean shorthands that are NOT `PROPERTY_MAP` keys (so they have no
 * prefix entry) but emit a standalone token. The shorthands that ARE property
 * keys (grow, shrink, blur, ring, outline, backdrop filters, divide/space
 * reverse) are already covered by their prefix rule above.
 */
const BOOLEAN_ROLE = {
    truncate: { role: 'inner', category: 'text' },
    textEllipsis: { role: 'inner', category: 'text' },
    textClip: { role: 'inner', category: 'text' },
    container: { role: 'outer', category: 'sizing' },
    prose: { role: 'inner', category: 'text' },
    proseInvert: { role: 'inner', category: 'text' },
    srOnly: { role: 'outer', category: 'visibility' },
    notSrOnly: { role: 'outer', category: 'visibility' },
    ordinal: { role: 'inner', category: 'text' },
    slashedZero: { role: 'inner', category: 'text' },
    liningNums: { role: 'inner', category: 'text' },
    oldstyleNums: { role: 'inner', category: 'text' },
    proportionalNums: { role: 'inner', category: 'text' },
    tabularNums: { role: 'inner', category: 'text' },
    diagonalFractions: { role: 'inner', category: 'text' },
    stackedFractions: { role: 'inner', category: 'text' },
    divideXReverse: { role: 'inner', category: 'divide' },
    divideYReverse: { role: 'inner', category: 'divide' },
    spaceXReverse: { role: 'inner', category: 'space' },
    spaceYReverse: { role: 'inner', category: 'space' },
};

/** Role for the value-keyed sugar groups, keyed by their canonical property. */
const VALUE_KEYED_ROLE = {
    display: { role: 'inner', category: 'display' },
    position: { role: 'outer', category: 'position' },
    visibility: { role: 'outer', category: 'visibility' },
    isolation: { role: 'outer', category: 'position' },
    textTransform: { role: 'inner', category: 'text' },
    fontStyle: { role: 'inner', category: 'text' },
    decoration: { role: 'inner', category: 'text' },
    fontSmoothing: { role: 'inner', category: 'text' },
};

function buildPropertyKeyRoles() {
    const keyRole = new Map();
    for (const rule of BOX_ROLE_RULES) {
        for (const key of rule.keys) {
            if (keyRole.has(key)) {
                throw new Error(`[gen-box-role-map] sz key "${key}" is in two rules`);
            }
            keyRole.set(key, { role: rule.role, category: rule.category });
        }
    }
    const propertyKeys = Object.keys(PROPERTY_MAP);
    const missing = propertyKeys.filter(k => !keyRole.has(k));
    if (missing.length > 0) {
        throw new Error(
            `[gen-box-role-map] ${missing.length} PROPERTY_MAP key(s) have no box role — add them to BOX_ROLE_RULES: ${missing.join(', ')}`,
        );
    }
    // Keys lowered by a dedicated object branch have no PROPERTY_MAP prefix but
    // are still valid sz keys that splitBoxSz has to route, so they are allowed
    // here by name. Anything else not in PROPERTY_MAP is a stale rule.
    const OBJECT_ONLY_KEYS = new Set(['maskLinear', 'maskRadial', 'maskConic']);
    const extra = [...keyRole.keys()].filter(k => !(k in PROPERTY_MAP) && !OBJECT_ONLY_KEYS.has(k));
    if (extra.length > 0) {
        throw new Error(
            `[gen-box-role-map] BOX_ROLE_RULES has key(s) not in PROPERTY_MAP (stale): ${extra.join(', ')}`,
        );
    }
    return { keyRole, propertyKeys };
}

/** The five `overflow` values, spelled the same for all three axes. */
const OVERFLOW_VALUES = ['auto', 'hidden', 'clip', 'visible', 'scroll'];

/**
 * `hidden` and `clip` describe how the box is painted and clipped by its OWN
 * frame; `auto`, `scroll` and `visible` ask the box to become a scroll
 * container for its children. One property name, two sides of the border.
 */
const OVERFLOW_ROLES = { hidden: 'outer', clip: 'outer' };

/**
 * Keys whose closed value set is resolved into exact tokens rather than left to
 * a prefix. Two reasons a key is listed here, and a key can have both:
 *
 * 1. It shares a class prefix with a key on the OTHER side of the border
 *    (`flex-col` is inner, `flex-1` is outer). Each listed value emits an exact
 *    token, matched before any prefix, so the prefix can carry the other key's
 *    role. A value outside the list falls through to the prefix, which is where
 *    a class the compiler does not know belongs anyway.
 * 2. `roles` gives some values a different role from the key's own — the role
 *    depends on the VALUE, not just the property (`overflow`).
 */
const TOKEN_RESOLVED_VALUES = {
    flexDir: { values: ['row', 'row-reverse', 'col', 'col-reverse'] },
    flexWrap: { values: ['wrap', 'wrap-reverse', 'nowrap'] },
    snapAlign: { values: ['start', 'end', 'center', 'align-none'] },
    snapStop: { values: ['normal', 'always'] },
    transformStyle: { values: ['3d', 'flat'] },
    overflow: { values: OVERFLOW_VALUES, roles: OVERFLOW_ROLES },
    overflowX: { values: OVERFLOW_VALUES, roles: OVERFLOW_ROLES },
    overflowY: { values: OVERFLOW_VALUES, roles: OVERFLOW_ROLES },
};

/**
 * Properties that are declared on BOTH nodes rather than routed to one.
 *
 * A transition is inert on its own: it says how a property animates WHEN it
 * changes, and the state that changes it (`hover:`, a data attribute) can sit
 * on either node. Routing the transition to one node and the change to the
 * other leaves the change instant — the token is present, the animation never
 * runs, and nothing says why.
 *
 * `animate-*` is deliberately NOT here: an animation runs the moment it lands,
 * so declaring it twice would run it twice, once per node.
 */
const DECLARED_ON_BOTH = new Set(['transition', 'transitionBehavior', 'duration', 'ease', 'delay']);

/**
 * Mark the both-node properties on the prefix and key tables.
 *
 * @param prefixes Prefix → role, mutated in place.
 * @param keyRoles sz key → role, mutated in place.
 */
function markDeclaredOnBoth(prefixes, keyRoles) {
    const marked = new Set();
    for (const key of DECLARED_ON_BOTH) {
        const entry = keyRoles.get(key);
        if (entry === undefined) {
            throw new Error(
                `[gen-box-role-map] "${key}" is in DECLARED_ON_BOTH but is not an sz key`,
            );
        }
        keyRoles.set(key, { ...entry, both: true });
        const prefix = PROPERTY_MAP[key];
        const prior = prefixes.get(prefix);
        if (prior !== undefined) {
            prefixes.set(prefix, { ...prior, both: true });
            marked.add(prefix);
        }
    }
    // A key that merely SHARES one of those prefixes would be cloned too, which
    // for an animation would run it on both nodes. Fail instead.
    for (const [key, prefix] of Object.entries(PROPERTY_MAP)) {
        if (marked.has(prefix) && !DECLARED_ON_BOTH.has(key)) {
            throw new Error(
                `[gen-box-role-map] "${key}" shares the both-node prefix "${prefix}" but is not in DECLARED_ON_BOTH`,
            );
        }
    }
}

/**
 * Utilities Tailwind SERVES that csszyx never EMITS.
 *
 * Every other table in this file is projected from `PROPERTY_MAP`, so it
 * describes csszyx's output. `classify` reads the opposite direction — the
 * className string an application wrote — and those two vocabularies are not
 * the same set. Measured against the pinned corpora in `scripts/corpus/` and
 * confirmed served by `tailwindcss@4.3.3`:
 *
 * - `placeholder-<color>`: csszyx models the same CSS as a variant
 *   (`placeholder:text-gray`), so no key emits the utility spelling.
 * - `start-*` / `end-*`: the pre-v4.2 spelling of `inset-s-*` / `inset-e-*`.
 *   Deprecated upstream, still served, still in code written before v4.2.
 *
 * These are ALIASES and GAPS, not a licence to grow a second vocabulary: an
 * entry belongs here only when Tailwind serves the class and csszyx's own
 * output cannot produce it. The assertion below fails if one ever collides
 * with a prefix csszyx does emit, so a future compiler prop cannot be
 * silently shadowed by a hand-written row.
 */
const TAILWIND_ONLY_PREFIXES = [
    { role: 'outer', category: 'position', prefixes: ['start', 'end'] },
    { role: 'inner', category: 'placeholder', prefixes: ['placeholder'] },
];

/**
 * `group` and `peer` emit no CSS, so no table built from CSS properties can
 * hold them — but they are the anchor every `group-hover:` / `peer-checked:`
 * descendant resolves against, which makes the node they land on a
 * CORRECTNESS question rather than a classification one.
 *
 * Both pin to OUTER, and the reason is structural rather than a default:
 * `splitBox`'s outer node is the ancestor of its inner node, and a dependent
 * utility can route to either side (`group-hover:bg-red` is bg → outer;
 * `group-hover:p-4` is padding → inner). Only the outer node is an ancestor of
 * both, so only the outer node keeps every dependent resolving. A `fallback`
 * of `'inner'` must not move them — which is why they are a table entry and
 * not an unclassified token.
 */
const SCOPE_MARKERS = { role: 'outer', category: 'scope', tokens: ['group', 'peer'] };

/**
 * Add the Tailwind-only prefixes and scope markers, refusing any that csszyx
 * already owns.
 *
 * @param prefixes - Prefix map built from `PROPERTY_MAP`, mutated in place.
 * @param tokens - Exact-token map built from `PROPERTY_MAP`, mutated in place.
 */
function addTailwindOnly(prefixes, tokens) {
    for (const { role, category, prefixes: names } of TAILWIND_ONLY_PREFIXES) {
        for (const name of names) {
            if (prefixes.has(name)) {
                throw new Error(
                    `[gen-box-role-map] "${name}" is listed as Tailwind-only but csszyx emits it; drop the row`,
                );
            }
            prefixes.set(name, { role, category });
        }
    }
    for (const token of SCOPE_MARKERS.tokens) {
        if (tokens.has(token) || prefixes.has(token)) {
            throw new Error(
                `[gen-box-role-map] scope marker "${token}" collides with an emitted utility; reconcile`,
            );
        }
        tokens.set(token, { role: SCOPE_MARKERS.role, category: SCOPE_MARKERS.category });
    }
}

function buildPrefixes(keyRole, propertyKeys) {
    const prefixes = new Map();
    const resolvedByValue = [];
    for (const key of propertyKeys) {
        if (key in TOKEN_RESOLVED_VALUES) {
            resolvedByValue.push(key);
            continue;
        }
        const prefix = PROPERTY_MAP[key];
        const role = keyRole.get(key);
        const prior = prefixes.get(prefix);
        if (prior && prior.role !== role.role) {
            throw new Error(
                `[gen-box-role-map] prefix "${prefix}" gets conflicting roles (${prior.role} vs ${role.role}); reconcile the rules`,
            );
        }
        if (!prior) prefixes.set(prefix, role);
    }
    // A value-resolved key still needs its prefix whenever nothing else claims
    // it: an arbitrary value (`overflow-[overlay]`) has no exact token, and
    // dropping the prefix would leave it — and the string selector `'overflow'`
    // — unclassified. Only a CONTESTED prefix is left to the other key, which is
    // the reason the key is resolved by value in the first place.
    const claimedHere = new Map();
    for (const key of resolvedByValue) {
        const prefix = PROPERTY_MAP[key];
        const role = keyRole.get(key);
        const mine = claimedHere.get(prefix);
        if (mine !== undefined) {
            if (mine !== role.role) {
                throw new Error(
                    `[gen-box-role-map] value-resolved prefix "${prefix}" gets conflicting roles (${mine} vs ${role.role}); reconcile the rules`,
                );
            }
            continue;
        }
        if (prefixes.has(prefix)) continue;
        prefixes.set(prefix, role);
        claimedHere.set(prefix, role.role);
    }
    return prefixes;
}

function addToken(tokens, token, role) {
    const prior = tokens.get(token);
    if (prior && prior.role !== role.role) {
        throw new Error(
            `[gen-box-role-map] token "${token}" gets conflicting roles (${prior.role} vs ${role.role})`,
        );
    }
    tokens.set(token, role);
}

function buildExactTokens(keyRole) {
    const tokens = new Map();
    for (const [key, { values, roles }] of Object.entries(TOKEN_RESOLVED_VALUES)) {
        const base = keyRole.get(key);
        const prefix = PROPERTY_MAP[key];
        for (const value of values) {
            const token = transform({ [key]: value }).className.trim();
            if (!token || token.includes(' ')) {
                throw new Error(
                    `[gen-box-role-map] "${key}: '${value}'" did not emit one token (got "${token}")`,
                );
            }
            if (token !== prefix && !token.startsWith(`${prefix}-`)) {
                throw new Error(
                    `[gen-box-role-map] "${key}: '${value}'" emitted "${token}", which is not under its prefix "${prefix}"`,
                );
            }
            // The suffix, not the whole class: an object selector asks
            // `{ overflow: 'hidden' }`, the same shape a prefixed token answers.
            addToken(tokens, token, {
                role: roles?.[value] ?? base.role,
                category: base.category,
                prefix,
                value: token === prefix ? '' : token.slice(prefix.length + 1),
            });
        }
    }
    for (const { key, value } of Object.values(REMOVED_BOOLEAN_SUGAR)) {
        const role = VALUE_KEYED_ROLE[key];
        if (!role) {
            throw new Error(
                `[gen-box-role-map] value-keyed property "${key}" has no role in VALUE_KEYED_ROLE`,
            );
        }
        const token = transform({ [key]: value }).className.trim();
        if (token) addToken(tokens, token, role);
    }
    // boolean shorthands that are not property keys emit a standalone token too.
    for (const shorthand of BOOLEAN_SHORTHANDS) {
        if (shorthand in PROPERTY_MAP) continue;
        const role = BOOLEAN_ROLE[shorthand];
        if (!role) {
            throw new Error(
                `[gen-box-role-map] boolean shorthand "${shorthand}" has no role in BOOLEAN_ROLE`,
            );
        }
        const token = transform({ [shorthand]: true }).className.trim();
        if (token) addToken(tokens, token, role);
    }
    return tokens;
}

function buildCompleteKeyRoles(keyRole) {
    const keyRoles = new Map(keyRole);
    for (const shorthand of BOOLEAN_SHORTHANDS) {
        if (shorthand in PROPERTY_MAP) continue;
        keyRoles.set(shorthand, BOOLEAN_ROLE[shorthand]);
    }
    // An sz key whose role depends on its value carries the exceptions, so
    // `splitBoxSz` routes `{ overflow: 'hidden' }` the way `splitBox` routes the
    // class it compiles to. Only the values that DIFFER from the key's own role
    // are listed; everything else takes `role` above.
    for (const [key, { roles }] of Object.entries(TOKEN_RESOLVED_VALUES)) {
        if (!roles) continue;
        const base = keyRoles.get(key);
        const byValue = Object.entries(roles).filter(([, role]) => role !== base.role);
        if (byValue.length > 0) keyRoles.set(key, { ...base, byValue });
    }
    return keyRoles;
}

/**
 * A boolean shorthand that is the reverse/variant flag of a property key must
 * sit on the same side as the property it modifies — `divide-x-reverse` only
 * means anything next to `divide-x`. Nothing enforced that before, so moving
 * `divideX` inner would have left its reverse flag on the frame.
 *
 * @param keyRole Property-key roles, before the shorthands are folded in.
 */
function assertBooleanFlagsFollowTheirProperty(keyRole) {
    for (const [shorthand, role] of Object.entries(BOOLEAN_ROLE)) {
        const owner = /^(?<base>[a-z]+[A-Za-z]*?)(?:Reverse)$/.exec(shorthand)?.groups?.base;
        const ownerRole = owner === undefined ? undefined : keyRole.get(owner);
        if (ownerRole === undefined) continue;
        if (ownerRole.role !== role.role || ownerRole.category !== role.category) {
            throw new Error(
                `[gen-box-role-map] boolean flag "${shorthand}" is ${role.role}/${role.category} but its property "${owner}" is ${ownerRole.role}/${ownerRole.category}; they must match`,
            );
        }
    }
}

export function buildRoleMaps() {
    const { keyRole, propertyKeys } = buildPropertyKeyRoles();
    assertBooleanFlagsFollowTheirProperty(keyRole);
    const prefixes = buildPrefixes(keyRole, propertyKeys);
    const tokens = buildExactTokens(keyRole);
    const keyRoles = buildCompleteKeyRoles(keyRole);
    markDeclaredOnBoth(prefixes, keyRoles);
    addTailwindOnly(prefixes, tokens);
    return { prefixes, tokens, keyRoles };
}

function render({ prefixes, tokens, keyRoles }) {
    // Longest-prefix-match must win, so emit prefixes sorted by length desc
    // (ties alphabetical) — the runtime can then take the first match.
    const prefixEntries = [...prefixes.entries()].sort(
        (a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]),
    );
    const tokenEntries = [...tokens.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const keyEntries = [...keyRoles.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const markerEntries = [...SCOPE_MARKERS.tokens]
        .sort()
        .map(t => `    ${JSON.stringify(t)},`)
        .join('\n');
    const entry = ([k, v]) => {
        const fields = [
            `role: ${JSON.stringify(v.role)}`,
            `category: ${JSON.stringify(v.category)}`,
        ];
        if (v.prefix !== undefined) fields.push(`prefix: ${JSON.stringify(v.prefix)}`);
        if (v.value !== undefined) fields.push(`value: ${JSON.stringify(v.value)}`);
        if (v.both !== undefined) fields.push(`both: ${JSON.stringify(v.both)}`);
        if (v.byValue !== undefined) {
            const pairs = v.byValue.map(
                ([value, role]) => `[${JSON.stringify(value)}, ${JSON.stringify(role)}]`,
            );
            fields.push(`byValue: new Map([${pairs.join(', ')}])`);
        }
        return `    [${JSON.stringify(k)}, { ${fields.join(', ')} }],`;
    };
    return `// GENERATED by scripts/gen-box-role-map.mjs — DO NOT EDIT.
// Run \`pnpm gen:box-role\` to regenerate from the compiler's PROPERTY_MAP /
// REMOVED_BOOLEAN_SUGAR / BOOLEAN_SHORTHANDS. The box-model role of each prop is
// defined in that script's BOX_ROLE_RULES.

/** Which side of the CSS box-model border a property acts on. */
export type BoxRole = 'outer' | 'inner';

/** Box-model classification of a single utility: its role and semantic category. */
export interface BoxRoleEntry {
    /** Which side of the CSS box-model border the property acts on. */
    readonly role: BoxRole;
    /** Semantic group (margin, padding, border, overflow, text, …). */
    readonly category: string;
    /**
     * The class prefix this exact token is one closed value of, when it has one
     * (\`overflow-hidden\` → \`overflow\`). Absent on value-keyed sugar, whose
     * class name IS the value (\`block\`, \`italic\`).
     */
    readonly prefix?: string;
    /** The value after \`prefix\`, for matching \`{ category: value }\` selectors. */
    readonly value?: string;
    /**
     * sz keys only: values whose role differs from \`role\` above, because the
     * property means different things per value (\`overflow: 'hidden'\` clips the
     * frame; \`overflow: 'auto'\` scrolls the content).
     */
    readonly byValue?: ReadonlyMap<string, BoxRole>;
    /**
     * Declared on BOTH nodes instead of routed to one. A transition is inert
     * until a property changes, and the state that changes it can sit on either
     * node, so splitting it apart would leave the change instant.
     */
    readonly both?: boolean;
}

/**
 * Exact emitted tokens whose class name carries no value suffix to prefix-match
 * (display/position/decoration sugar, font-variant flags). Matched before
 * prefixes.
 */
export const BOX_ROLE_TOKENS: ReadonlyMap<string, BoxRoleEntry> = new Map([
${tokenEntries.map(entry).join('\n')}
]);

/**
 * Emitted class prefixes, ordered longest-first so the runtime can take the
 * first \`startsWith\` match (e.g. \`inset-ring\` wins over \`inset\`).
 */
export const BOX_ROLE_PREFIXES: ReadonlyArray<readonly [string, BoxRoleEntry]> = [
${prefixEntries.map(entry).join('\n')}
];

/**
 * Markers that accept a \`/<name>\` suffix (\`group/item\`, \`peer/email\`). The name
 * picks WHICH ancestor a \`group-hover/item:\` variant reads; it never changes
 * what the marker itself does, so the named form classifies as the bare one.
 * A slash means something else entirely everywhere else — \`bg-red-500/50\` is an
 * opacity modifier — so the runtime consults this set rather than splitting on
 * \`/\` in general.
 */
export const BOX_ROLE_SCOPE_MARKERS: ReadonlySet<string> = new Set([
${markerEntries}
]);

/**
 * sz prop key → box-model role, for partitioning an sz OBJECT (\`splitBoxSz\`)
 * rather than a className string. Projected from the same \`BOX_ROLE_RULES\`
 * source of truth as the class maps above, so an sz key routes to the same side
 * its emitted class does.
 */
export const BOX_ROLE_BY_KEY: ReadonlyMap<string, BoxRoleEntry> = new Map([
${keyEntries.map(entry).join('\n')}
]);
`;
}

function main() {
    const built = buildRoleMaps();
    const output = render(built);
    if (process.argv.includes('--check')) {
        let current = '';
        try {
            current = readFileSync(outPath, 'utf8');
        } catch {
            /* missing */
        }
        if (current !== output) {
            console.error(
                '[gen-box-role-map] box-role-map.generated.ts is stale. Run pnpm gen:box-role and commit.',
            );
            process.exitCode = 1;
            return;
        }
        console.log('[gen-box-role-map] up to date.');
        return;
    }

    writeFileSync(outPath, output);
    console.log(
        `[gen-box-role-map] wrote ${built.prefixes.size} prefixes + ${built.tokens.size} value-keyed tokens + ${built.keyRoles.size} sz keys.`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
