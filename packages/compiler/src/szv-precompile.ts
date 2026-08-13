/**
 * Decision spec for the szv per-key precompile, shared by the TypeScript lanes
 * (the Rust lane hand-mirrors it; the cross-engine suite locks the verdicts).
 *
 * The compiler rewrites `szr(F(selection))` — `F` a file-local
 * `szv(<static config>)` factory — so every variant leaf is lowered to its
 * class string at build time: a fully static selection collapses to a string
 * literal, a dynamic one becomes `__szvPick(TABLE, selection)`. The rewrite is
 * sound only when string concatenation and object merge cannot be told apart,
 * which is exactly when no two co-occurring branches touch the same canonical
 * property path — the overlap detector here is the gatekeeper.
 *
 * Everything in this module is pure and engine-independent; the AST-facing
 * halves (config extraction, call classification, splicing) live per lane.
 *
 * @module szv-precompile
 */

import { KNOWN_VARIANTS, PROPERTY_MAP, transform } from './transform-core.js';

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

/** Primitive selection shape accepted by every szv precompile lane. */
export type StaticSzvSelection = Record<string, string | number | boolean | null>;

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
 * map entry), boolean flag utilities, custom theme variants, junk — could
 * alias another key's target invisibly, so its config bails.
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
    if (!isCanonicalSzKey(key)) return false;
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
 * disqualify (defaults) or stay dynamic (selections) on all three engines.
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
 * AST-independent: both TypeScript lanes call this on the plain object their
 * extractor produced; the Rust lane mirrors it over `StaticSzObject`. Returns
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

/**
 * Compute one build-time pick: what `__szvPick(table, selection)` returns for
 * a fully static selection. Shared so the emitted string literal and the
 * runtime picker can never drift.
 *
 * @param table - The compiled table.
 * @param selection - Static selection (string/number/boolean values), or
 * undefined for a bare `F()` call.
 * @returns The joined className string.
 */
export function computeStaticSzvPick(
    table: SzvPrecompiledTable,
    selection: StaticSzvSelection | undefined,
): string {
    let result = table.base;
    for (const dimension of Object.keys(table.d)) {
        const selected =
            selection !== undefined &&
            // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is ES2022; the toolchain lib is ES2021.
            Object.prototype.hasOwnProperty.call(selection, dimension)
                ? // biome-ignore lint/style/noNonNullAssertion: the own-property check guarantees presence.
                  selection[dimension]!
                : undefined;
        const value = selected ?? table.defaults?.[dimension];
        if (value === null || value === undefined) {
            continue;
        }
        const classes = table.d[dimension][String(value)];
        if (classes) {
            result = result ? `${result} ${classes}` : classes;
        }
    }
    return result;
}

/**
 * Count word-boundary occurrences of an identifier in raw source.
 *
 * Same accounting the szr import rewrite uses, generalized to the factory
 * name: an occurrence not explained by the declaration or a rewritten call
 * fails the proof, and overcounting (comments, strings, non-ASCII neighbours)
 * can only suppress a rewrite.
 *
 * @param source - Original file text.
 * @param word - Identifier to count.
 * @returns Number of standalone occurrences.
 */
export function countWordOccurrences(source: string, word: string): number {
    if (word.length === 0) {
        return 0;
    }
    let count = 0;
    let from = 0;
    while (true) {
        const at = source.indexOf(word, from);
        if (at === -1) {
            return count;
        }
        const before = at === 0 ? '' : source[at - 1];
        const after = at + word.length >= source.length ? '' : source[at + word.length];
        if ((before === '' || !/[\w$]/.test(before)) && (after === '' || !/[\w$]/.test(after))) {
            count += 1;
        }
        from = at + word.length;
    }
}

/** One comment's span in the original source, delimiters included. */
export interface CommentSpan {
    /** Byte offset of the comment's first character. */
    start: number;
    /** Byte offset one past the comment's last character. */
    end: number;
}

/**
 * A source range with offsets that may be absent.
 *
 * Both lanes hand this module raw AST nodes, and Babel types `start`/`end` as
 * nullable because a synthesized node has no source position. Accepting the
 * node as-is keeps the null handling in one tested place instead of at every
 * recording site.
 */
export interface MaybeSpan {
    /** Offset of the range's first character, when known. */
    start?: number | null;
    /** Offset one past the range's last character, when known. */
    end?: number | null;
}

/**
 * Whether a factory call sits inside a source range the sz rewrite replaces.
 *
 * All three engines splice the precompiled pick over the call's own bytes.
 * When those bytes are inside an `sz` attribute — `sz={[{ p: 4 }, szr(f())]}`
 * — the sz rewrite has already replaced that whole range with a generated
 * expression, and neither span-based engine can edit text it has replaced:
 * magic-string throws, string_wizard aborts the process without naming the
 * file, and one oxc path emitted malformed JSX with no error at all. So the
 * call keeps its runtime path, in every engine, and the existing szr fallback
 * diagnostic reports it.
 *
 * A range or call with unknown offsets never matches: an absent position is
 * not evidence of an overlap, and losing the precompile for it would be a
 * silent regression rather than a safety property.
 *
 * @param call - Call node carrying its source offsets.
 * @param rewritten - Ranges the sz rewrite replaces wholesale.
 * @returns True when the call cannot be spliced.
 */
export function callInsideRewrittenSpan(call: MaybeSpan, rewritten: readonly MaybeSpan[]): boolean {
    const { start, end } = call;
    if (typeof start !== 'number' || typeof end !== 'number') return false;
    return rewritten.some(
        range =>
            typeof range.start === 'number' &&
            typeof range.end === 'number' &&
            start >= range.start &&
            end <= range.end,
    );
}

/**
 * Count word-boundary occurrences of an identifier OUTSIDE comments.
 *
 * Comments are erased at runtime, so a doc comment mentioning a factory (or
 * `szr`) must not fail the reference accounting — real design systems document
 * their helpers by name. The comment spans come from the engine's own parser,
 * so nothing is ever mis-classified as a comment; occurrences in strings still
 * count (a string CAN observably leak a name through `eval`/lookup), which
 * keeps the proof conservative. Subtracting per-span slice counts is exact:
 * comment delimiters are non-identifier characters, so no word straddles a
 * span edge.
 *
 * @param source - Original file text.
 * @param word - Identifier to count.
 * @param comments - Comment spans from the engine's parser.
 * @returns Number of standalone occurrences outside comments.
 */
export function countWordOccurrencesOutsideComments(
    source: string,
    word: string,
    comments: readonly CommentSpan[],
): number {
    if (word.length === 0) {
        return 0;
    }
    // One pass over the source, skipping matches that fall inside a comment,
    // rather than a full count minus one re-count per comment: the subtracting
    // form allocated a substring for EVERY comment in the file on every
    // candidate, and this runs once per candidate identifier per file.
    let count = 0;
    let from = 0;
    let commentIndex = 0;
    while (true) {
        const at = source.indexOf(word, from);
        if (at === -1) return count;
        // Comment spans arrive in source order from every parser, so the
        // cursor only ever moves forward across the whole scan.
        commentIndex = advanceCommentCursor(comments, commentIndex, at);
        const enclosing = comments[commentIndex];
        if (commentContainsOffset(enclosing, at)) {
            // Inside a comment — jump to its end rather than re-testing every
            // occurrence within it.
            from = enclosing.end;
            continue;
        }
        if (isStandaloneWordAt(source, word, at)) count += 1;
        from = at + word.length;
    }
}

/**
 * Skip comment spans that finish before the current match.
 *
 * @param comments - Ordered parser comment spans.
 * @param start - Current cursor index.
 * @param offset - Current word-match offset.
 * @returns First comment that may contain or follow the match.
 */
function advanceCommentCursor(
    comments: readonly CommentSpan[],
    start: number,
    offset: number,
): number {
    let index = start;
    while (index < comments.length && comments[index].end <= offset) index += 1;
    return index;
}

/**
 * Whether one optional comment span contains the match offset.
 *
 * @param comment - Current comment cursor value.
 * @param offset - Current word-match offset.
 * @returns True when the match is inside the comment.
 */
function commentContainsOffset(
    comment: CommentSpan | undefined,
    offset: number,
): comment is CommentSpan {
    return comment !== undefined && comment.start <= offset;
}

/**
 * Whether a raw match is bounded like a JavaScript identifier word.
 *
 * @param source - Original source text.
 * @param word - Candidate identifier.
 * @param at - Match offset.
 * @returns True when neither neighbour continues the identifier.
 */
function isStandaloneWordAt(source: string, word: string, at: number): boolean {
    const before = at === 0 ? '' : source[at - 1];
    const after = at + word.length >= source.length ? '' : source[at + word.length];
    return !isIdentifierCharacter(before) && !isIdentifierCharacter(after);
}

/**
 * Empty boundaries and non-word characters terminate an identifier.
 *
 * @param value - One neighbouring character.
 * @returns True when the character can continue an identifier.
 */
function isIdentifierCharacter(value: string): boolean {
    return value !== '' && /[\w$]/.test(value);
}

/**
 * Deterministic source text for the emitted table constant.
 *
 * JSON with double quotes on every engine, so the three lanes cannot drift in
 * content; surrounding formatting may differ per lane as it already does.
 *
 * @param table - The compiled table.
 * @returns An object-literal expression string.
 */
export function serializeSzvTable(table: SzvPrecompiledTable): string {
    const payload: Record<string, unknown> = { base: table.base, d: table.d };
    if (table.defaults && Object.keys(table.defaults).length > 0) {
        payload.defaults = table.defaults;
    }
    return JSON.stringify(payload);
}

/** Prefix of every emitted table constant; reserved, never author-written. */
const SZV_TABLE_PREFIX = '__szvT_';

/**
 * Name of the emitted table constant for one factory.
 *
 * @param factoryName - The factory binding name.
 * @returns The table identifier.
 */
export function szvTableIdentifier(factoryName: string): string {
    return `${SZV_TABLE_PREFIX}${factoryName}`;
}

// ---------------------------------------------------------------------------
// Engine-agnostic halves of the per-lane precompile drivers.
//
// Both TypeScript lanes drive their AST walks through the shared functions
// below, so the DECISION of which files precompile — reserved names, reference
// accounting, pick eligibility, the szr proof plumbing — cannot drift per
// parser. Only AST reading and text splicing stay per lane; a divergence there
// is a mechanics bug, a divergence HERE would make `build.parser` change the
// emitted code.
// ---------------------------------------------------------------------------

/** Names that can never be szv factory bindings for the precompile. */
export const SZV_RESERVED_FACTORY_NAMES: ReadonlySet<string> = new Set([
    'szr',
    'szv',
    'dynamic',
    '__szvPick',
    '__szvPick1',
]);

/** Analysis of one szr argument: shape verdict plus nested factory calls. */
export interface SzrArgumentAnalysisOf<TCall> {
    /** True when every reachable result is a string, falsy, or a factory call. */
    shapeOk: boolean;
    /** Factory-call candidates found anywhere in the expression. */
    factories: TCall[];
}

/**
 * Whole-file accumulator for the szv per-key precompile, generic over the
 * lane's AST vocabulary: `TCall` is the call-expression node, `TNode` the
 * widest node type tracked for replacements, `TCandidate` the lane's factory
 * candidate record.
 */
export interface SzvPrecompileState<TCall, TNode, TCandidate> {
    /** Whether the file can contain an szv factory at all. */
    enabled: boolean;
    /** `typeof X` type-query references by name — erased at runtime, so the
     * reference accounting must not charge them against the factory. */
    typeQueryCounts: Map<string, number>;
    /** Per-szr-call argument analyses, computed once in the apply phase. */
    szrArgumentAnalyses: Map<TCall, SzrArgumentAnalysisOf<TCall>[]>;
    /** Comment spans from the parse, for comment-excluded accounting. */
    commentSpans: CommentSpan[];
    /** Factory calls actually rewritten to strings or picks. */
    replacedCalls: Set<TNode>;
    /** Imported-factory configs by specifier, from the bundler's registry. */
    crossModuleStatics?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    /** Factory candidates by binding name. */
    candidates: Map<string, TCandidate>;
    /** Every direct identifier-callee call, by callee name. */
    identifierCalls: Map<string, TCall[]>;
    /** Source ranges the sz rewrite replaces wholesale — see
     * {@link callInsideRewrittenSpan}. */
    rewrittenSpans: MaybeSpan[];
    /** Whether any rewrite emitted a `__szvPick` call. */
    usedPick: boolean;
    /** Whether any rewrite emitted a `__szvPick1` single-dimension call. */
    usedPick1: boolean;
}

/**
 * Record one direct identifier-callee call for the deferred proofs.
 *
 * @param call - The call node.
 * @param calleeName - Its identifier callee name, or null for any other shape.
 * @param szrCalls - The lane's collected `szr(...)` calls (appended to).
 * @param state - szv precompile accumulator.
 */
export function recordIdentifierCallByName<TCall>(
    call: TCall,
    calleeName: string | null,
    szrCalls: TCall[],
    state: Pick<SzvPrecompileState<TCall, unknown, unknown>, 'enabled' | 'identifierCalls'>,
): void {
    if (calleeName === null) return;
    if (calleeName === 'szr') {
        szrCalls.push(call);
        return;
    }
    if (!state.enabled) return;
    const existing = state.identifierCalls.get(calleeName);
    if (existing) {
        existing.push(call);
    } else {
        state.identifierCalls.set(calleeName, [call]);
    }
}

/**
 * Record one `typeof X` type-query reference by name.
 *
 * Type queries are erased at runtime: `Parameters<typeof factory>[0]` is the
 * idiomatic way to derive a selection type, and it must not fail the
 * factory's reference accounting.
 *
 * @param name - The queried identifier name, or null for any other shape.
 * @param state - szv precompile accumulator.
 */
export function recordSzvTypeQueryByName(
    name: string | null,
    state: Pick<SzvPrecompileState<unknown, unknown, unknown>, 'enabled' | 'typeQueryCounts'>,
): void {
    if (!state.enabled || name === null) return;
    state.typeQueryCounts.set(name, (state.typeQueryCounts.get(name) ?? 0) + 1);
}

/** One import specifier, reduced to the names the registry lookup needs. */
export interface CrossModuleImportSpecifier {
    /** Exported name on the source module, or null for unsupported shapes. */
    importedName: string | null;
    /** Local binding name, or null for unsupported shapes. */
    localName: string | null;
    /** True for a type-only specifier (erased at runtime). */
    typeOnly: boolean;
}

/**
 * Record factory candidates that arrive through imports, resolved by the
 * bundler's cross-module registry.
 *
 * The LOCAL binding name becomes the factory name (aliases welcome — the
 * registry lookup is by exported name), and the whole local machinery —
 * accounting, call classification, table insertion after the import — then
 * runs unchanged.
 *
 * @param sourceValue - The import's source specifier, or null when unreadable.
 * @param typeImport - True for a type-only import declaration.
 * @param specifiers - The clause's specifiers, reduced to names.
 * @param state - szv precompile accumulator.
 * @param makeCandidate - Lane-specific candidate builder (insertion anchor).
 */
export function recordCrossModuleSzvFactoryImports<TCandidate>(
    sourceValue: string | null,
    typeImport: boolean,
    specifiers: readonly CrossModuleImportSpecifier[],
    state: Pick<
        SzvPrecompileState<unknown, unknown, TCandidate>,
        'crossModuleStatics' | 'candidates'
    >,
    makeCandidate: (localName: string, config: unknown) => TCandidate,
): void {
    if (typeImport || sourceValue === null) return;
    const entries = state.crossModuleStatics?.[sourceValue];
    if (entries === undefined) return;
    for (const specifier of specifiers) {
        if (specifier.typeOnly || specifier.importedName === null) continue;
        const config = entries[specifier.importedName];
        if (config === undefined) continue;
        const localName = specifier.localName;
        if (localName === null || SZV_RESERVED_FACTORY_NAMES.has(localName)) continue;
        if (state.candidates.has(localName)) continue;
        state.candidates.set(localName, makeCandidate(localName, config));
    }
}

/**
 * Reference accounting for one factory.
 *
 * The factory name must occur exactly `1 (declaration) + calls + type queries`
 * times outside comments, every call must sit directly in an `szr(...)`
 * argument position with at most one argument, and the table identifier must
 * be free in the file. No call may sit inside a range the sz rewrite replaces.
 *
 * @param factoryName - The factory binding name.
 * @param calls - Every direct call of the factory in the file.
 * @param szrArgumentNodes - Node-identity set of szr argument factory calls.
 * @param source - Original file text.
 * @param commentSpans - Comment spans, for comment-excluded accounting.
 * @param typeQueryCounts - `typeof X` reference counts by name.
 * @param rewrittenSpans - Ranges the sz rewrite replaces wholesale.
 * @returns True when every reference is accounted for.
 */
export function szvFactoryAccountingHolds<
    TCall extends { arguments: { length: number }; start?: number | null; end?: number | null },
>(
    factoryName: string,
    calls: readonly TCall[],
    szrArgumentNodes: ReadonlySet<unknown>,
    source: string,
    commentSpans: readonly CommentSpan[],
    typeQueryCounts: ReadonlyMap<string, number>,
    rewrittenSpans: readonly MaybeSpan[],
): boolean {
    if (calls.length === 0) return false;
    for (const call of calls) {
        if (!szrArgumentNodes.has(call)) return false;
        if (call.arguments.length > 1) return false;
        if (callInsideRewrittenSpan(call, rewrittenSpans)) return false;
    }
    const typeQueries = typeQueryCounts.get(factoryName) ?? 0;
    const occurrences = countWordOccurrencesOutsideComments(source, factoryName, commentSpans);
    if (occurrences !== 1 + calls.length + typeQueries) {
        return false;
    }
    // The table name is a reserved prefix nobody writes by hand, so almost
    // every real file lacks it entirely; one whole-source probe answers for
    // all candidates and skips a second scan per candidate.
    if (!source.includes(SZV_TABLE_PREFIX)) {
        return true;
    }
    const tableOccurrences = countWordOccurrencesOutsideComments(
        source,
        szvTableIdentifier(factoryName),
        commentSpans,
    );
    return tableOccurrences === 0;
}

/**
 * Whether the single-dimension picker may serve a selection naming `key`.
 *
 * A default makes the dimensions the selection OMITS contribute classes, and
 * the single-dimension picker never visits them. `{ __proto__: v }` in a
 * literal sets the PROTOTYPE instead of creating an own property, so the full
 * picker's own-property probe selects nothing — indexing the table by it
 * would not. And own dimensions only, so the runtime never indexes an
 * inherited member (`constructor`, `toString`) and the unknown-variant dev
 * warning keeps running through the full picker.
 *
 * @param table - The factory's compiled table.
 * @param key - The selection's single key, or null for unsupported shapes.
 * @returns True when `__szvPick1` reproduces the full picker for this key.
 */
export function singleDimensionPickAllowed(
    table: SzvPrecompiledTable,
    key: string | null,
): key is string {
    if (table.defaults !== undefined && Object.keys(table.defaults).length > 0) {
        return false;
    }
    if (key === null || key === '__proto__') return false;
    // biome-ignore lint/suspicious/noPrototypeBuiltins: the auto-fix is Object.hasOwn, which is ES2022; this package's lib is ES2021.
    return Object.prototype.hasOwnProperty.call(table.d, key);
}

/**
 * Coerce one selection value under the tri-lane static contract: string,
 * boolean, or safe-integer values only. Everything else — null and undefined
 * included — returns null and takes the dynamic path, where the runtime picker
 * applies the exact JS semantics without three engines re-implementing them.
 *
 * @param value - One statically evaluated selection value.
 * @returns The value when parity-safe, null otherwise.
 */
export function coerceParitySafeSelectionValue(value: unknown): string | number | boolean | null {
    if (typeof value === 'number') {
        return isParitySafeNumber(value) ? value : null;
    }
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    return null;
}

/**
 * Whether one analyzed szr argument is fully proven: the shape held and every
 * factory candidate inside it was rewritten to a string.
 *
 * @param analysis - The argument's analysis.
 * @param replaced - Node-identity set of rewritten factory calls.
 * @returns True for a proven-string argument.
 */
export function szrArgumentProven<TCall>(
    analysis: SzrArgumentAnalysisOf<TCall>,
    replaced: ReadonlySet<unknown>,
): boolean {
    return analysis.shapeOk && analysis.factories.every(factory => replaced.has(factory));
}

/**
 * Emit the deferred szr fallback diagnostics for arguments that stayed
 * unproven after the precompile.
 *
 * @param pendingFallbacks - The lane's pending fallback records.
 * @param szrArgumentAnalyses - Per-call argument analyses.
 * @param replacedCalls - Node-identity set of rewritten factory calls.
 * @param reportFallback - Lane-specific diagnostic sink (position resolution).
 */
export function emitUnprovenSzrFallbacks<TCall, TExpression>(
    pendingFallbacks: readonly { call: TCall; expression: TExpression }[],
    szrArgumentAnalyses: ReadonlyMap<TCall, SzrArgumentAnalysisOf<TCall>[]>,
    replacedCalls: ReadonlySet<unknown>,
    reportFallback: (expression: TExpression) => void,
): void {
    for (const pending of pendingFallbacks) {
        const first = szrArgumentAnalyses.get(pending.call)?.[0];
        if (first !== undefined && szrArgumentProven(first, replacedCalls)) {
            continue;
        }
        reportFallback(pending.expression);
    }
}
