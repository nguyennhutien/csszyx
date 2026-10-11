/**
 * Qualification spec for the szv per-key precompile, used by the cross-module
 * registry extractor (`cross-module-extract.ts`) so it records only configs the
 * engine will accept. The engine's own copy is `szv_precompile.rs`; the
 * cross-engine suite locks the verdicts.
 *
 * The compiler rewrites `szr(F(selection))` — `F` a file-local
 * `szv(<static config>)` factory — so every variant leaf is lowered to its
 * class string at build time: a fully static selection collapses to a string
 * literal, a dynamic one becomes `__szvPick(TABLE, selection)`. The rewrite is
 * sound only when string concatenation and object merge cannot be told apart,
 * which is exactly when no two co-occurring branches touch the same canonical
 * property path — the overlap detector here is the gatekeeper.
 *
 * Everything in this module is pure and AST-independent; config extraction,
 * call classification and splicing live in the engine.
 *
 * @module szv-precompile
 */

import {
    BOOLEAN_SHORTHANDS,
    BOOLEAN_TO_CLASS,
    KNOWN_VARIANTS,
    PROPERTY_MAP,
    transform,
} from './transform-core.js';

/** A statically resolved szv config, branches still as sz objects. */
export interface StaticSzvConfig {
    base?: Record<string, unknown>;
    variants?: Record<string, Record<string, Record<string, unknown>>>;
    defaultVariants?: Record<string, string>;
}

/** The compiled per-key table, mirroring the runtime's `SzvCompiledTable`. */
export interface SzvPrecompiledTable {
    base: string;
    d: Record<string, Record<string, string>>;
    defaults?: Record<string, string>;
}

/**
 * Keys the lowering FUSES across key boundaries: `text` and `leading` combine
 * into one `text-lg/7` composite. Cross-branch co-occurrence of any two of
 * these cannot be represented per key, so they share one canonical token and
 * conflict with each other.
 */
const FUSION_CANONICAL: Readonly<Record<string, string>> = {
    text: 'text\u0000leading',
    leading: 'text\u0000leading',
    lineHeight: 'text\u0000leading',
};

/**
 * Special-cased property keys OUTSIDE the property map that are verified
 * fusion-free: each lowers to its own independent class, measured merged vs
 * separate (`alignContent` + `content` emit two classes, `snapType` +
 * `snapStrictness` emit `snap-x snap-mandatory`, …). Keys not probed stay
 * disqualified — unenumerated fusions are exactly the hazard class found only
 * by inspection.
 */
const SPECIAL_ALLOWED_SZ_KEYS: ReadonlySet<string> = new Set([
    'alignContent',
    'snapType',
    'snapAlign',
    'snapStrictness',
]);

/**
 * Canonical name for one sz key: fusion families collapse to a shared token,
 * everything else stands for its own NAME. Deep merge collapses by key name —
 * two distinct keys never collapse however similar their emitted prefixes are
 * (`flexDir` and `flexWrap` both emit `flex-*`, and merging keeps both), so a
 * map-value canon would only manufacture false conflicts.
 *
 * @param key - Raw sz key.
 * @returns The canonical path element.
 */
function canonicalSzKey(key: string): string {
    return FUSION_CANONICAL[key] ?? key;
}

/** Separator that cannot appear inside an sz key. */
const PATH_SEPARATOR = '\u0000';

/**
 * Collect every canonical LEAF path of one branch object.
 *
 * A leaf is any non-object value; the path is the canonicalized key chain from
 * the branch root, so `{ md: { p: 4 } }` yields `md␀p` while `{ p: 4 }` yields
 * `p` — different targets, no conflict.
 *
 * @param branch - One base or variant-leaf sz object.
 * @param prefix - Accumulated path (internal recursion state).
 * @param out - Collected leaf paths.
 */
export function collectCanonicalLeafPaths(
    branch: Record<string, unknown>,
    prefix: string,
    out: string[],
): void {
    for (const key of Object.keys(branch)) {
        const value = branch[key];
        const path =
            prefix === '' ? canonicalSzKey(key) : prefix + PATH_SEPARATOR + canonicalSzKey(key);
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            // A nested object under a PROPERTY key is a fusion unit (the
            // color-opacity form: `bg: { color, op }` lowers to ONE composite
            // class), so the whole subtree folds to the parent path — two
            // branches touching different children of the same property still
            // conflict. Variant keys keep composing per child.
            if (PROPERTY_MAP[key] !== undefined) {
                out.push(path);
            } else {
                collectCanonicalLeafPaths(value as Record<string, unknown>, path, out);
            }
        } else {
            out.push(path);
        }
    }
}

/**
 * Whether two branches conflict under deep merge.
 *
 * Merge overrides when a leaf lands on the same path as another leaf, or when
 * a leaf in one branch sits where the other branch has an OBJECT (a scalar
 * replaces a subtree and vice versa) — i.e. when any leaf path of one equals,
 * prefixes, or is prefixed by a leaf path of the other.
 *
 * @param a - Leaf paths of the first branch.
 * @param b - Leaf paths of the second branch.
 * @returns True when concatenation and merge could disagree.
 */
export function leafPathsConflict(a: readonly string[], b: readonly string[]): boolean {
    for (const pathA of a) {
        for (const pathB of b) {
            if (
                pathA === pathB ||
                pathA.startsWith(pathB + PATH_SEPARATOR) ||
                pathB.startsWith(pathA + PATH_SEPARATOR)
            ) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Whether every key in a branch is canonicalizable.
 *
 * The overlap detector can only trust names it can canonicalize: a key in the
 * property map, or a known variant. Anything else — special-cased properties
 * like `lineHeight` (which lowers to the same target as `leading` WITHOUT a
 * map entry), custom theme variants, junk — could alias another key's target
 * invisibly, so its config bails. Boolean flags are decided by their value in
 * `branchKeyCanonicalizable` rather than here, because the key alone does not
 * settle it: the flag is canonical, a scalar on the same key is not.
 *
 * @param branch - One base or variant-leaf sz object.
 * @returns True when the canonical paths are trustworthy.
 */
function branchKeysCanonicalizable(branch: Record<string, unknown>): boolean {
    return Object.keys(branch).every(key => branchKeyCanonicalizable(key, branch[key]));
}

/**
 * Decide whether one branch member has a trustworthy canonical path.
 *
 * @param key - Member key.
 * @param value - Member value.
 * @returns True when the member can participate in overlap analysis.
 */
function branchKeyCanonicalizable(key: string, value: unknown): boolean {
    if (key === 'css' && isPlainRecord(value)) return cssDeclarationsCanonicalizable(value);
    // A nested object under a PROPERTY key is the fusion form, and
    // `collectCanonicalLeafPaths` folds the whole subtree onto the property's
    // own path — its children never become paths, so they need no canonical
    // names. Descending here would judge the `op` in `bg: { color, op }` as if
    // it sat BESIDE `bg`, which is the one position it cannot hold, and bail a
    // config the path walk had already handled. Any conflict involving a child
    // is still caught, at the parent path the subtree folded into.
    if (PROPERTY_MAP[key] !== undefined && isPlainRecord(value)) return true;
    // A bare `op` fuses into whichever color-bearing key it meets at lowering,
    // and per-key compilation cannot represent that.
    if (key === 'op') return false;
    // A BOOLEAN on a flag utility is that key's canonical spelling: Tailwind has
    // no value form for `sr-only` or `tabular-nums`, so the flag IS how the
    // style is written, and the snippets document it that way. Admitting it
    // needs the same evidence the SPECIAL_ALLOWED_SZ_KEYS entries carry —
    // measured merged vs separate, across every flag paired with every property
    // key and with every other flag, no pair composites the way `text` +
    // `leading` does. So a flag's own name identifies its target, which is all
    // the detector asks of a canonical path.
    //
    // The admission is on the VALUE. A scalar on the same key lowers to
    // `key-value` (`{ srOnly: 'weird' }` → `sr-only-weird`) and falls to the
    // refusal below with everything else that could alias invisibly.
    if (typeof value === 'boolean' && isBooleanFlagKey(key)) return true;
    // An OBJECT value means variant nesting, and variant names are open-ended: a
    // `--breakpoint-*` token from the project's `@theme` (`{ tablet: {…} }`) or
    // an inline attribute variant (`{ 'data-[active]': {…} }`) cannot appear in
    // a table this compiler ships. A variant COMPOSES into the canonical path
    // rather than aliasing one, so the overlap detector keeps working through
    // it. A SCALAR on an unknown key is the opposite — it lowers to `key-value`,
    // which could be another key's target under a name this walk cannot
    // recognise — so that still disqualifies.
    if (!isCanonicalSzKey(key) && !isPlainRecord(value)) return false;
    return !isPlainRecord(value) || branchKeysCanonicalizable(value);
}

/**
 * The css namespace accepts declarations, never another object layer.
 *
 * @param css - Arbitrary-property declarations.
 * @returns True when every child is a scalar declaration.
 */
function cssDeclarationsCanonicalizable(css: Record<string, unknown>): boolean {
    return Object.values(css).every(
        declaration => declaration === null || typeof declaration !== 'object',
    );
}

/**
 * Whether a key's canonical spelling is a boolean flag.
 *
 * Two tables carry them: the ones whose class name differs from the key
 * (`srOnly` → `sr-only`) and the ones whose class IS the kebab-cased key
 * (`truncate`). A key that also takes values (`ring`, `blur`) appears in the
 * property map and is admitted there instead, so this only decides the
 * boolean-only ones.
 *
 * @param key - Candidate sz key.
 * @returns True when a boolean on this key lowers to one fixed class.
 */
function isBooleanFlagKey(key: string): boolean {
    return BOOLEAN_TO_CLASS[key] !== undefined || BOOLEAN_SHORTHANDS.has(key);
}

/**
 * Whether a key belongs to the overlap detector's closed vocabulary.
 *
 * @param key - Candidate sz key.
 * @returns True when the key has known lowering semantics.
 */
function isCanonicalSzKey(key: string): boolean {
    return (
        PROPERTY_MAP[key] !== undefined ||
        KNOWN_VARIANTS.has(key) ||
        SPECIAL_ALLOWED_SZ_KEYS.has(key)
    );
}

/**
 * Whether a config's co-occurring branches are free of canonical overlap.
 *
 * Co-occurring pairs: the base with every leaf, and leaves of DIFFERENT
 * dimensions (one value per dimension, so same-dimension leaves are mutually
 * exclusive). Any conflict — or any key the detector cannot canonicalize —
 * disqualifies the whole config: object semantics must be preserved.
 *
 * @param config - Statically resolved szv config.
 * @returns True when the per-key rewrite preserves semantics.
 */
export function szvConfigFreeOfOverlap(config: StaticSzvConfig): boolean {
    if (!configBranchesCanonicalizable(config)) return false;
    const basePaths: string[] = [];
    if (config.base) collectCanonicalLeafPaths(config.base, '', basePaths);
    const dimensions = Object.keys(config.variants ?? {});
    const leafPathsByDimension = dimensions.map(dimension =>
        collectDimensionLeafPaths(
            (config.variants as Record<string, Record<string, Record<string, unknown>>>)[dimension],
        ),
    );
    if (baseConflictsWithLeaves(basePaths, leafPathsByDimension)) return false;
    return !dimensionsConflict(leafPathsByDimension);
}

/**
 * Validate every base and variant branch before trusting canonical paths.
 *
 * @param config - Static szv config.
 * @returns True when every co-occurring branch can be canonicalized.
 */
function configBranchesCanonicalizable(config: StaticSzvConfig): boolean {
    if (config.base && !branchKeysCanonicalizable(config.base)) return false;
    return Object.values(config.variants ?? {}).every(values =>
        Object.values(values).every(branchKeysCanonicalizable),
    );
}

/**
 * Collect canonical paths for every mutually exclusive value in a dimension.
 *
 * @param values - Dimension value branches.
 * @returns Canonical leaf paths grouped by value.
 */
function collectDimensionLeafPaths(values: Record<string, Record<string, unknown>>): string[][] {
    return Object.values(values).map(branch => {
        const paths: string[] = [];
        collectCanonicalLeafPaths(branch, '', paths);
        return paths;
    });
}

/**
 * Whether the always-present base conflicts with any selectable leaf.
 *
 * @param base - Canonical base paths.
 * @param dimensions - Canonical paths grouped by dimension and value.
 * @returns True when a selectable leaf overrides the base.
 */
function baseConflictsWithLeaves(base: string[], dimensions: string[][][]): boolean {
    return dimensions.some(leaves => leaves.some(leaf => leafPathsConflict(base, leaf)));
}

/**
 * Whether leaves from any two co-occurring dimensions conflict.
 *
 * @param dimensions - Canonical paths grouped by dimension and value.
 * @returns True when two dimensions can override each other.
 */
function dimensionsConflict(dimensions: string[][][]): boolean {
    for (let i = 0; i < dimensions.length; i++) {
        for (let j = i + 1; j < dimensions.length; j++) {
            for (const leafA of dimensions[i]) {
                for (const leafB of dimensions[j]) {
                    if (leafPathsConflict(leafA, leafB)) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

/**
 * Whether a numeric literal stringifies identically in every lane.
 *
 * `String(2)` is `"2"` in JavaScript; a non-integral or unsafe number has
 * float-formatting edge cases the Rust mirror must not re-implement, so those
 * disqualify (defaults) or stay dynamic (selections) on both engine builds.
 *
 * @param value - Numeric literal value.
 * @returns True for a safe-integer value.
 */
export function isParitySafeNumber(value: number): boolean {
    return Number.isSafeInteger(value);
}

/**
 * Validate a statically evaluated szv config and compile its per-key table.
 *
 * AST-independent: the registry extractor calls this on the plain object it
 * produced; the engine mirrors it over `StaticSzObject`. Returns
 * null — never throws — for any shape outside the strict contract: only
 * `base`/`variants`/`defaultVariants` keys, records of records of objects for
 * the variants, string/boolean/safe-integer defaults, and no canonical
 * overlap between co-occurring branches.
 *
 * @param config - Statically evaluated config candidate.
 * @returns The compiled table, or null when the factory does not qualify.
 */
export function qualifyStaticSzvConfig(config: unknown): SzvPrecompiledTable | null {
    if (!isPlainRecord(config)) return null;
    if (!Object.keys(config).every(isSzvConfigKey)) return null;
    const candidate = config as StaticSzvConfig;
    if (candidate.base !== undefined && !isPlainRecord(candidate.base)) return null;
    const variants = qualifyVariantDimensions(candidate.variants);
    if (variants === null) return null;
    const defaults = candidate.defaultVariants;
    const normalizedDefaults = defaults === undefined ? undefined : normalizeSzvDefaults(defaults);
    if (normalizedDefaults === null) return null;
    if (!szvConfigFreeOfOverlap(candidate)) return null;

    return {
        base: candidate.base
            ? transform(candidate.base as Parameters<typeof transform>[0]).className
            : '',
        d: compileSzvDimensions(variants),
        defaults: normalizedDefaults,
    };
}

/**
 * Whether a top-level config key belongs to the strict szv contract.
 *
 * @param key - Candidate config key.
 * @returns True for a supported top-level key.
 */
function isSzvConfigKey(key: string): boolean {
    return key === 'base' || key === 'variants' || key === 'defaultVariants';
}

/**
 * Validate the variants record and narrow every leaf to an sz object.
 *
 * @param value - Candidate variants value.
 * @returns Qualified dimensions, or null for an invalid shape.
 */
function qualifyVariantDimensions(
    value: unknown,
): Record<string, Record<string, Record<string, unknown>>> | null {
    if (value === undefined) return {};
    if (!isPlainRecord(value)) return null;
    for (const values of Object.values(value)) {
        if (!isPlainRecord(values) || !Object.values(values).every(isPlainRecord)) return null;
    }
    return value as Record<string, Record<string, Record<string, unknown>>>;
}

/**
 * Normalize defaults only when their stringification is tri-lane safe.
 *
 * @param value - Candidate defaults value.
 * @returns Stringified defaults, or null for an unsafe scalar.
 */
function normalizeSzvDefaults(value: unknown): Record<string, string> | null {
    if (!isPlainRecord(value)) return null;
    const normalized: Record<string, string> = {};
    for (const [dimension, selected] of Object.entries(value)) {
        if (!isParitySafeSelectionScalar(selected)) return null;
        normalized[dimension] = String(selected);
    }
    return normalized;
}

/**
 * Whether a selection scalar stringifies identically in all engines.
 *
 * @param value - Candidate scalar.
 * @returns True when every engine produces the same key string.
 */
function isParitySafeSelectionScalar(value: unknown): value is string | number | boolean {
    return (
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && isParitySafeNumber(value))
    );
}

/**
 * Lower every qualified dimension/value branch into its class string.
 *
 * @param variants - Qualified variant dimensions.
 * @returns Precompiled class strings grouped by dimension and value.
 */
function compileSzvDimensions(
    variants: Record<string, Record<string, Record<string, unknown>>>,
): Record<string, Record<string, string>> {
    return Object.fromEntries(
        Object.entries(variants).map(([dimension, values]) => [
            dimension,
            Object.fromEntries(
                Object.entries(values).map(([value, branch]) => [
                    value,
                    transform(branch as Parameters<typeof transform>[0]).className,
                ]),
            ),
        ]),
    );
}

/**
 * Narrow to a plain object record.
 *
 * @param value - Candidate value.
 * @returns True for a non-null, non-array object.
 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Names that can never be szv factory bindings for the precompile. */
export const SZV_RESERVED_FACTORY_NAMES: ReadonlySet<string> = new Set([
    'szr',
    'szv',
    'dynamic',
    '__szvPick',
    '__szvPick1',
]);
