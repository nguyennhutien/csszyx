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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BOOLEAN_SHORTHANDS,
    PROPERTY_MAP,
    REMOVED_BOOLEAN_SUGAR,
} from '../packages/compiler/src/transform-core.js';
import { transform } from '../packages/compiler/src/transform.js';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const outPath = join(
    repoRoot,
    'packages/runtime/src/box-role-map.generated.ts',
);

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
    { role: 'outer', category: 'margin', keys: ['m', 'mt', 'mr', 'mb', 'ml', 'mx', 'my', 'ms', 'me', 'mbs', 'mbe'] },
    { role: 'outer', category: 'position', keys: ['z', 'position', 'inset', 'insetX', 'insetY', 'top', 'right', 'bottom', 'left', 'start', 'end', 'insetS', 'insetE', 'insetBs', 'insetBe', 'float', 'clear', 'isolation'] },
    { role: 'outer', category: 'border', keys: ['border', 'borderColor', 'borderStyle', 'borderT', 'borderTColor', 'borderR', 'borderRColor', 'borderB', 'borderBColor', 'borderL', 'borderLColor', 'borderX', 'borderXColor', 'borderY', 'borderYColor', 'borderS', 'borderE', 'borderBs', 'borderBe', 'borderCollapse', 'borderSpacing', 'borderSpacingX', 'borderSpacingY'] },
    { role: 'outer', category: 'rounded', keys: ['rounded', 'roundedT', 'roundedR', 'roundedB', 'roundedL', 'roundedTl', 'roundedTr', 'roundedBl', 'roundedBr', 'roundedS', 'roundedE', 'roundedSs', 'roundedSe', 'roundedEs', 'roundedEe'] },
    { role: 'outer', category: 'divide', keys: ['divideX', 'divideY', 'divideColor', 'divideStyle'] },
    { role: 'outer', category: 'outline', keys: ['outline', 'outlineColor', 'outlineOffset', 'outlineStyle'] },
    { role: 'outer', category: 'ring', keys: ['ring', 'ringColor', 'ringOffset', 'ringOffsetColor'] },
    { role: 'outer', category: 'shadow', keys: ['shadow', 'shadowColor'] },
    // sizing → OUTER (contested): width/height constrain the frame the parent gives.
    { role: 'outer', category: 'sizing', keys: ['w', 'minW', 'maxW', 'h', 'minH', 'maxH', 'size', 'blockSize', 'minBlockSize', 'maxBlockSize', 'inlineSize', 'minInlineSize', 'maxInlineSize', 'aspect', 'box'] },
    { role: 'outer', category: 'fragmentation', keys: ['breakAfter', 'breakBefore', 'breakInside', 'boxDecoration'] },
    // bg → OUTER (contested): the frame's stable background, matches the report.
    { role: 'outer', category: 'bg', keys: ['bg', 'bgAttach', 'bgClip', 'bgImg', 'bgOrigin', 'bgPos', 'bgRepeat', 'bgSize', 'bgBlend'] },
    { role: 'outer', category: 'gradient', keys: ['from', 'via', 'to'] },
    // visibility → OUTER (contested): toggles the whole element, not its content.
    { role: 'outer', category: 'visibility', keys: ['visibility'] },
    { role: 'outer', category: 'opacity', keys: ['opacity'] },
    { role: 'outer', category: 'blend', keys: ['mixBlend'] },
    { role: 'outer', category: 'filter', keys: ['filter', 'blur', 'brightness', 'contrast', 'dropShadow', 'dropShadowColor', 'grayscale', 'hueRotate', 'invert', 'saturate', 'sepia'] },
    { role: 'outer', category: 'backdrop', keys: ['backdropFilter', 'backdropBlur', 'backdropBrightness', 'backdropContrast', 'backdropGrayscale', 'backdropHueRotate', 'backdropInvert', 'backdropOpacity', 'backdropSaturate', 'backdropSepia'] },
    { role: 'outer', category: 'transform', keys: ['scale', 'scaleX', 'scaleY', 'scaleZ', 'rotate', 'rotateX', 'rotateY', 'rotateZ', 'translate', 'translateX', 'translateY', 'translateZ', 'skewX', 'skewY', 'origin', 'backface', 'perspective', 'perspectiveOrigin', 'transformStyle', 'transform', 'zoom'] },
    { role: 'outer', category: 'transition', keys: ['transition', 'transitionBehavior', 'duration', 'ease', 'delay', 'animate', 'animationDelay'] },
    { role: 'outer', category: 'mask', keys: ['mask', 'maskSize', 'maskPos', 'maskRepeat', 'maskShape', 'maskClip', 'maskOrigin', 'maskFrom', 'maskVia', 'maskTo'] },
    { role: 'outer', category: 'color-scheme', keys: ['scheme', 'forcedColorAdjust'] },

    // ── INNER ────────────────────────────────────────────────────────────
    { role: 'inner', category: 'padding', keys: ['p', 'pt', 'pr', 'pb', 'pl', 'px', 'py', 'ps', 'pe', 'pbs', 'pbe'] },
    { role: 'inner', category: 'space', keys: ['spaceX', 'spaceY'] },
    // inset-ring / inset-shadow are painted INSIDE the border, unlike ring/shadow.
    { role: 'inner', category: 'ring', keys: ['insetRing', 'insetRingColor'] },
    { role: 'inner', category: 'shadow', keys: ['insetShadow', 'insetShadowColor'] },
    { role: 'inner', category: 'columns', keys: ['columns'] },
    { role: 'inner', category: 'object', keys: ['objectFit', 'objectPos'] },
    // overflow → INNER (contested): clips the content the element lays out.
    { role: 'inner', category: 'overflow', keys: ['overflow', 'overflowX', 'overflowY'] },
    { role: 'inner', category: 'overscroll', keys: ['overscroll', 'overscrollX', 'overscrollY'] },
    // display → INNER (contested): governs how the element's children flow.
    { role: 'inner', category: 'display', keys: ['display'] },
    { role: 'inner', category: 'text', keys: ['color', 'text', 'fontWeight', 'weight', 'fontFamily', 'fontStretch', 'fontStyle', 'fontSmoothing', 'fontFeatures', 'textAlign', 'decoration', 'decorationColor', 'decorationStyle', 'decorationThickness', 'underlineOffset', 'textTransform', 'textOverflow', 'textWrap', 'wrap', 'indent', 'align', 'whitespace', 'break', 'hyphens', 'content', 'leading', 'tracking', 'lineClamp', 'tabSize', 'textShadow', 'textShadowColor'] },
    { role: 'inner', category: 'list', keys: ['list', 'listPos', 'listImg'] },
    { role: 'inner', category: 'flex', keys: ['basis', 'flex', 'flexDir', 'flexWrap', 'grow', 'shrink', 'order'] },
    { role: 'inner', category: 'alignment', keys: ['items', 'self', 'justify', 'justifyItems', 'justifySelf', 'placeContent', 'placeItems', 'placeSelf'] },
    { role: 'inner', category: 'gap', keys: ['gap', 'gapX', 'gapY'] },
    { role: 'inner', category: 'grid', keys: ['gridCols', 'gridRows', 'col', 'colSpan', 'colStart', 'colEnd', 'row', 'rowSpan', 'rowStart', 'rowEnd', 'gridFlow', 'autoCols', 'autoRows'] },
    { role: 'inner', category: 'svg', keys: ['fill', 'stroke', 'strokeWidth'] },
    { role: 'inner', category: 'table', keys: ['tableLayout', 'caption'] },
    { role: 'inner', category: 'accent', keys: ['caret', 'accent'] },
    { role: 'inner', category: 'interaction', keys: ['cursor', 'pointerEvents', 'fieldSizing', 'resize', 'select', 'willChange', 'appearance'] },
    { role: 'inner', category: 'scroll', keys: ['scroll', 'scrollM', 'scrollMt', 'scrollMr', 'scrollMb', 'scrollMl', 'scrollMs', 'scrollMe', 'scrollMx', 'scrollMy', 'scrollMbs', 'scrollMbe', 'scrollP', 'scrollPt', 'scrollPr', 'scrollPb', 'scrollPl', 'scrollPs', 'scrollPe', 'scrollPx', 'scrollPy', 'scrollPbs', 'scrollPbe', 'scrollbar', 'scrollbarThumb', 'scrollbarTrack', 'scrollbarGutter'] },
    { role: 'inner', category: 'snap', keys: ['snapAlign', 'snapStop', 'snapType'] },
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
    divideXReverse: { role: 'outer', category: 'divide' },
    divideYReverse: { role: 'outer', category: 'divide' },
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

function build() {
    // 1. sz key → { role, category }, with coverage + duplicate gates.
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
    const missing = propertyKeys.filter((k) => !keyRole.has(k));
    if (missing.length > 0) {
        throw new Error(
            `[gen-box-role-map] ${missing.length} PROPERTY_MAP key(s) have no box role — add them to BOX_ROLE_RULES: ${missing.join(', ')}`,
        );
    }
    const extra = [...keyRole.keys()].filter((k) => !(k in PROPERTY_MAP));
    if (extra.length > 0) {
        throw new Error(
            `[gen-box-role-map] BOX_ROLE_RULES has key(s) not in PROPERTY_MAP (stale): ${extra.join(', ')}`,
        );
    }

    // 2. emitted class prefix → { role, category }, detecting role conflicts.
    const prefixes = new Map();
    for (const key of propertyKeys) {
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

    // 3. value-keyed exact tokens (display/position/decoration/... sugar) — emit
    //    the REAL token by compiling the canonical { key: value } so we never
    //    guess the kebab form (e.g. decoration:none → "no-underline").
    const tokens = new Map();
    const addToken = (token, role) => {
        const prior = tokens.get(token);
        if (prior && prior.role !== role.role) {
            throw new Error(
                `[gen-box-role-map] token "${token}" gets conflicting roles (${prior.role} vs ${role.role})`,
            );
        }
        tokens.set(token, role);
    };
    for (const { key, value } of Object.values(REMOVED_BOOLEAN_SUGAR)) {
        const role = VALUE_KEYED_ROLE[key];
        if (!role) {
            throw new Error(
                `[gen-box-role-map] value-keyed property "${key}" has no role in VALUE_KEYED_ROLE`,
            );
        }
        const token = transform({ [key]: value }).className.trim();
        if (token) addToken(token, role);
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
        if (token) addToken(token, role);
    }

    return { prefixes, tokens };
}

function render({ prefixes, tokens }) {
    // Longest-prefix-match must win, so emit prefixes sorted by length desc
    // (ties alphabetical) — the runtime can then take the first match.
    const prefixEntries = [...prefixes.entries()].sort(
        (a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]),
    );
    const tokenEntries = [...tokens.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
    );
    const entry = ([k, v]) =>
        `    [${JSON.stringify(k)}, { role: ${JSON.stringify(v.role)}, category: ${JSON.stringify(v.category)} }],`;
    return `// GENERATED by scripts/gen-box-role-map.mjs — DO NOT EDIT.
// Run \`pnpm gen:box-role\` to regenerate from the compiler's PROPERTY_MAP /
// REMOVED_BOOLEAN_SUGAR / BOOLEAN_SHORTHANDS. The box-model role of each prop is
// defined in that script's BOX_ROLE_RULES.

export type BoxRole = 'outer' | 'inner';

export interface BoxRoleEntry {
    /** Which side of the CSS box-model border the property acts on. */
    readonly role: BoxRole;
    /** Semantic group (margin, padding, border, overflow, text, …). */
    readonly category: string;
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
`;
}

const json = render(build());
const check = process.argv.includes('--check');

if (check) {
    let current = '';
    try {
        current = readFileSync(outPath, 'utf8');
    } catch {
        /* missing */
    }
    if (current !== json) {
        console.error(
            '[gen-box-role-map] box-role-map.generated.ts is stale. Run pnpm gen:box-role and commit.',
        );
        process.exit(1);
    }
    console.log('[gen-box-role-map] up to date.');
    process.exit(0);
}

writeFileSync(outPath, json);
console.log(
    `[gen-box-role-map] wrote ${build().prefixes.size} prefixes + ${build().tokens.size} value-keyed tokens.`,
);
