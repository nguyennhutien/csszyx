/**
 * AST Transformer: Replaces className attributes with sz props.
 *
 * Phase 2: Uses Babel AST traversal for JSX/TSX files. Supports:
 * - Static className="..." (string literals)
 * - className={'...'} (string in expression container)
 * - className={clsx(...)} / cn(...) / twMerge(...)
 * - className={cond ? 'a' : 'b'} (ternary)
 * - className={cond && 'a'} (logical AND)
 * - className={`static ${dynamic}`} (template literals)
 *
 * HTML files use regex (Babel doesn't parse HTML).
 *
 * @module
 */

import { parse } from '@babel/parser';
import * as t from '@babel/types';
import { REMOVED_BOOLEAN_SUGAR, SUGGESTION_MAP } from '@csszyx/compiler';
import { disambiguateFont } from './class-parser.js';
import {
    handleClsxCall,
    handleLogicalAnd,
    handleTemplateLiteral,
    handleTernary,
    isClsxLikeName,
    type PatternResult,
} from './dynamic-patterns.js';
import { generateSzExpression, generateSzHtmlValue } from './sz-codegen.js';
import { type CsszyxTodoMap, classNameToSzObject } from './variant-parser.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of source transformation.
 */
export interface TransformResult {
    code: string;
    changed: boolean;
    warnings: string[];
    stats: {
        classNamesTransformed: number;
        classNamesSkipped: number;
        /** className kept on capitalized components (they do not accept sz). */
        classNamesSkippedComponent: number;
        classesUnrecognized: string[];
        /** Legacy sz-prop keys rewritten to their single-way canonical (transitional). */
        szKeysNormalized?: number;
    };
    /** Imports that may be unused after migration (e.g., clsx, cn). */
    potentiallyUnusedImports: string[];
}

// ============================================================================
// REPLACEMENT TRACKING
// ============================================================================

/**
 *
 */
interface Replacement {
    /** Start position in source (inclusive). */
    start: number;
    /** End position in source (exclusive). */
    end: number;
    /** The replacement text. */
    text: string;
}

type VisitNode = t.Node | ReturnType<typeof parse>;

interface AstVisitors {
    ImportDeclaration?: (node: t.ImportDeclaration) => void;
    CallExpression?: (node: t.CallExpression, ancestors: VisitNode[]) => void;
    JSXAttribute?: (node: t.JSXAttribute, parent: VisitNode | null) => void;
}

const VISITOR_KEYS = (t as unknown as { VISITOR_KEYS: Record<string, string[]> }).VISITOR_KEYS;

/**
 * Injects a @sz-todo JSX comment before the opening element
 * when injectTodos is enabled and there are unrecognized classes.
 * @param unrecognized - Array of unrecognized class names.
 * @param parent - The parent Babel AST node (must be JSXOpeningElement).
 * @param options - Transform options.
 * @param options.injectTodos - Whether to inject @sz-todo comments.
 * @param replacements - Replacement queue to append to.
 */
function injectTodoComment(
    unrecognized: string[],
    parent: t.Node | null,
    options: { injectTodos?: boolean },
    replacements: Replacement[],
): void {
    if (!options.injectTodos || unrecognized.length === 0) {
        return;
    }
    if (!t.isJSXOpeningElement(parent) || parent.start === null || parent.start === undefined) {
        return;
    }
    replacements.push({
        start: parent.start,
        end: parent.start,
        text: `\n{/* @sz-todo: ${unrecognized.join(', ')} */}\n`,
    });
}

// Walk only Babel AST child keys, avoiding @babel/traverse NodePath overhead.
function walkAst(node: VisitNode, visitors: AstVisitors, ancestors: VisitNode[] = []): void {
    if (t.isImportDeclaration(node)) {
        visitors.ImportDeclaration?.(node);
    } else if (t.isCallExpression(node)) {
        visitors.CallExpression?.(node, ancestors);
    } else if (t.isJSXAttribute(node)) {
        visitors.JSXAttribute?.(node, ancestors.at(-1) ?? null);
    }

    const keys = VISITOR_KEYS[node.type];
    if (!keys) {
        return;
    }

    ancestors.push(node);
    for (const key of keys) {
        const child = (node as unknown as Record<string, unknown>)[key];
        if (Array.isArray(child)) {
            for (const item of child) {
                if (isAstNode(item)) {
                    walkAst(item, visitors, ancestors);
                }
            }
        } else if (isAstNode(child)) {
            walkAst(child, visitors, ancestors);
        }
    }
    ancestors.pop();
}

function isAstNode(value: unknown): value is VisitNode {
    return Boolean(value && typeof value === 'object' && 'type' in value);
}

function isClassNameJsxAttribute(node: VisitNode): boolean {
    return t.isJSXAttribute(node) && t.isJSXIdentifier(node.name) && node.name.name === 'className';
}

/**
 * A SUGGESTION_MAP target is auto-rewritable only when it is a single bare key
 * name. Prose/multi-target hints (e.g. "fontWeight (for weight) or fontFamily")
 * cannot be applied mechanically — those are left for the build-time dev-warn.
 *
 * @param target - the SUGGESTION_MAP target string to test.
 * @returns true if the target is a single bare key name.
 */
function isCleanCanonicalTarget(target: string): boolean {
    return /^[a-z][a-z0-9]*$/i.test(target);
}

/**
 * TRANSITIONAL: normalizes pre-single-way sz-prop keys for the 0.9.10 → 0.10.0
 * upgrade. Remove at v1 — redundant once consumers have migrated.
 *
 * Rewrites OLD keys inside an `sz={{…}}` object literal to the single canonical
 * form, driven entirely by the compiler's authoritative maps (no local table):
 * removed boolean sugar `{ flex: true }` → `{ display: 'flex' }`
 * (REMOVED_BOOLEAN_SUGAR), and clean key renames `{ padding: 4 }` → `{ p: 4 }`,
 * `{ fontWeight: 'bold' }` → `{ weight: 'bold' }` (single-target SUGGESTION_MAP).
 * Recurses into nested variant objects (`hover:{…}`, `group:{data:{…}}`).
 * Already-canonical and unknown keys are left untouched; non-`true` values of a
 * boolean-sugar key are left as-is (the dev-warn is the backstop).
 *
 * @param obj - the sz object expression.
 * @param replacements - sink for non-overlapping source edits.
 * @returns number of keys rewritten.
 */
function normalizeSzObject(obj: t.ObjectExpression, replacements: Replacement[]): number {
    let count = 0;
    for (const prop of obj.properties) {
        if (!t.isObjectProperty(prop) || prop.computed) continue;
        const keyName = readSzPropertyKey(prop.key);
        if (keyName === null) continue;

        if (normalizeRemovedBooleanSugar(prop, keyName, replacements)) {
            count++;
            continue;
        }
        if (normalizeAmbiguousFontProperty(prop, keyName, replacements)) {
            count++;
            continue;
        }
        if (normalizeCanonicalSzKey(prop, keyName, replacements)) count++;

        // Recurse into nested variant objects (disjoint from the key edit above).
        if (t.isObjectExpression(prop.value)) {
            count += normalizeSzObject(prop.value, replacements);
        }
    }
    return count;
}

/**
 * Reads an identifier or quoted object-property key.
 *
 * @param key - Babel object-property key.
 * @returns Static key name, or null for unsupported shapes.
 */
function readSzPropertyKey(key: t.ObjectProperty['key']): string | null {
    if (t.isIdentifier(key)) return key.name;
    return t.isStringLiteral(key) ? key.value : null;
}

/**
 * Rewrites a removed boolean shorthand to its canonical key/value pair.
 *
 * @param prop - Babel object property.
 * @param keyName - Static property key.
 * @param replacements - Source-edit sink.
 * @returns Whether the whole property was replaced.
 */
function normalizeRemovedBooleanSugar(
    prop: t.ObjectProperty,
    keyName: string,
    replacements: Replacement[],
): boolean {
    const sugar = REMOVED_BOOLEAN_SUGAR[keyName];
    if (
        !sugar ||
        !t.isBooleanLiteral(prop.value) ||
        !prop.value.value ||
        prop.start == null ||
        prop.end == null
    ) {
        return false;
    }
    replacements.push({
        start: prop.start,
        end: prop.end,
        text: `${sugar.key}: '${sugar.value}'`,
    });
    return true;
}

/**
 * Resolves the legacy ambiguous font key from its literal value.
 *
 * @param prop - Babel object property.
 * @param keyName - Static property key.
 * @param replacements - Source-edit sink.
 * @returns Whether the key was replaced.
 */
function normalizeAmbiguousFontProperty(
    prop: t.ObjectProperty,
    keyName: string,
    replacements: Replacement[],
): boolean {
    if (keyName !== 'font' || prop.key.start == null || prop.key.end == null) return false;
    const fontValue = readFontLiteralValue(prop.value);
    const resolved = fontValue === null ? undefined : disambiguateFont(fontValue)?.prop;
    if (!resolved || resolved === 'font') return false;
    pushSzKeyReplacement(prop.key, resolved, replacements);
    return true;
}

/**
 * Reads a string or numeric font value used by the legacy migration.
 *
 * @param value - Babel property value.
 * @returns Font token, or null for dynamic values.
 */
function readFontLiteralValue(value: t.ObjectProperty['value']): string | null {
    if (t.isStringLiteral(value)) return value.value;
    return t.isNumericLiteral(value) ? String(value.value) : null;
}

/**
 * Rewrites a clean single-target suggestion while retaining the value.
 *
 * @param prop - Babel object property.
 * @param keyName - Static property key.
 * @param replacements - Source-edit sink.
 * @returns Whether the key was replaced.
 */
function normalizeCanonicalSzKey(
    prop: t.ObjectProperty,
    keyName: string,
    replacements: Replacement[],
): boolean {
    const suggestion = SUGGESTION_MAP[keyName];
    if (
        !suggestion ||
        !isCleanCanonicalTarget(suggestion) ||
        suggestion === keyName ||
        prop.key.start == null ||
        prop.key.end == null
    ) {
        return false;
    }
    pushSzKeyReplacement(prop.key, suggestion, replacements);
    return true;
}

/**
 * Adds a source edit for an object-property key.
 *
 * @param key - Babel object-property key.
 * @param replacement - Canonical key name.
 * @param replacements - Source-edit sink.
 */
function pushSzKeyReplacement(
    key: t.ObjectProperty['key'],
    replacement: string,
    replacements: Replacement[],
): void {
    replacements.push({
        start: key.start as number,
        end: key.end as number,
        text: t.isStringLiteral(key) ? `'${replacement}'` : replacement,
    });
}

// ============================================================================
// MAIN TRANSFORMER (BABEL AST — JSX/TSX)
// ============================================================================

/**
 * Options for source transformation.
 */
export interface TransformOptions {
    /** If true, injects {/* @sz-todo *\/} comments above nodes with unrecognized classes */
    injectTodos?: boolean;
    /** Map of custom classes to sz objects, used to override unrecognized classes */
    customMap?: CsszyxTodoMap;
    /**
     * If true, ONLY normalize legacy sz-prop keys to their single-way canonical
     * and leave every `className` attribute untouched. The sz-key-only upgrade
     * path for 0.9.10 → 0.10.0.
     *
     * TRANSITIONAL: part of the same legacy-key normalizer; remove at v1.
     */
    keysOnly?: boolean;
}

/** Mutable counters produced by the JSX migration walk. */
interface TransformCounters {
    classNamesTransformed: number;
    classNamesSkipped: number;
    classNamesSkippedComponent: number;
    szKeysNormalized: number;
}

/** Shared state used while migrating className attributes. */
interface JsxMigrationContext {
    source: string;
    filePath: string;
    options: TransformOptions;
    replacements: Replacement[];
    warnings: string[];
    classesUnrecognized: string[];
    clsxCallsitesMigrated: Set<number>;
    counters: TransformCounters;
}

/**
 * Build the unchanged result used by source-scan fast paths.
 *
 * @param source Original source text.
 * @returns A no-change migration result.
 */
function unchangedTransformResult(source: string): TransformResult {
    return {
        code: source,
        changed: false,
        warnings: [],
        stats: {
            classNamesTransformed: 0,
            classNamesSkipped: 0,
            classNamesSkippedComponent: 0,
            classesUnrecognized: [],
        },
        potentiallyUnusedImports: [],
    };
}

/**
 * Return an unchanged result when the source cannot contain a migration target.
 *
 * @param source Original source text.
 * @param keysOnly Whether only legacy sz keys are eligible.
 * @returns A no-change result, or null when parsing is required.
 */
function fastPathResult(source: string, keysOnly: boolean): TransformResult | null {
    const hasSz = source.includes('sz=');
    if (
        (keysOnly && !hasSz) ||
        (!hasSz && !source.includes('className') && !source.includes('cva'))
    ) {
        return unchangedTransformResult(source);
    }
    return null;
}

/** Inclusive/exclusive source range for one JSX attribute. */
interface AttributeRange {
    start: number;
    end: number;
}

/**
 * Migrates one sz or className JSX attribute.
 *
 * @param node - JSX attribute.
 * @param parent - Parent AST node.
 * @param context - Shared migration state.
 */
function handleJsxAttribute(
    node: t.JSXAttribute,
    parent: VisitNode | null,
    context: JsxMigrationContext,
): void {
    if (t.isJSXIdentifier(node.name) && node.name.name === 'sz') {
        normalizeExistingSzAttribute(node, context);
        return;
    }
    if (context.options.keysOnly || !isClassNameAttribute(node)) return;
    if (isCustomComponentAttribute(parent)) {
        context.counters.classNamesSkippedComponent++;
        return;
    }
    if (hasSiblingSzAttribute(parent)) {
        context.counters.classNamesSkipped++;
        return;
    }

    const range = readAttributeRange(node);
    if (!range) return;
    if (t.isStringLiteral(node.value)) {
        applyStaticClassMigration(node.value.value, range, parent, context);
        return;
    }
    if (t.isJSXExpressionContainer(node.value)) {
        migrateClassExpression(node.value.expression, range, parent, context);
        return;
    }
    context.counters.classNamesSkipped++;
}

/**
 * Normalizes legacy keys inside an existing static sz object.
 *
 * @param node - sz JSX attribute.
 * @param context - Shared migration state.
 */
function normalizeExistingSzAttribute(node: t.JSXAttribute, context: JsxMigrationContext): void {
    const value = node.value;
    if (t.isJSXExpressionContainer(value) && t.isObjectExpression(value.expression)) {
        context.counters.szKeysNormalized += normalizeSzObject(
            value.expression,
            context.replacements,
        );
    }
}

/**
 * Returns whether an attribute is a className target.
 *
 * @param node - JSX attribute.
 * @returns Whether the attribute name is className.
 */
function isClassNameAttribute(node: t.JSXAttribute): boolean {
    return t.isJSXIdentifier(node.name) && node.name.name === 'className';
}

/**
 * Returns whether the owning JSX element is a custom component.
 *
 * @param parent - Attribute parent node.
 * @returns Whether className must be retained for component forwarding.
 */
function isCustomComponentAttribute(parent: VisitNode | null): boolean {
    if (!t.isJSXOpeningElement(parent)) return false;
    return (
        (t.isJSXIdentifier(parent.name) && /^[A-Z]/.test(parent.name.name)) ||
        t.isJSXMemberExpression(parent.name)
    );
}

/**
 * Returns whether the owning element already declares sz.
 *
 * @param parent - Attribute parent node.
 * @returns Whether migration would create a duplicate sz attribute.
 */
function hasSiblingSzAttribute(parent: VisitNode | null): boolean {
    if (!t.isJSXOpeningElement(parent)) return false;
    return parent.attributes.some(
        attribute =>
            t.isJSXAttribute(attribute) &&
            t.isJSXIdentifier(attribute.name) &&
            attribute.name.name === 'sz',
    );
}

/**
 * Reads a complete Babel source range.
 *
 * @param node - JSX attribute.
 * @returns Attribute range, or null when parser offsets are absent.
 */
function readAttributeRange(node: t.JSXAttribute): AttributeRange | null {
    return node.start == null || node.end == null ? null : { start: node.start, end: node.end };
}

/**
 * Applies migration for a static class string.
 *
 * @param value - Authored class string.
 * @param range - Attribute source range.
 * @param parent - Attribute parent node.
 * @param context - Shared migration state.
 */
function applyStaticClassMigration(
    value: string,
    range: AttributeRange,
    parent: VisitNode | null,
    context: JsxMigrationContext,
): void {
    const result = processStaticString(value, context.options.customMap);
    if (!result) {
        context.counters.classNamesSkipped++;
        return;
    }
    context.replacements.push({ ...range, text: result.replacement });
    context.counters.classNamesTransformed++;
    context.classesUnrecognized.push(...result.unrecognized);
    injectTodoComment(result.unrecognized, parent, context.options, context.replacements);
}

/**
 * Dispatches a className expression to its supported migration handler.
 *
 * @param expression - JSX expression.
 * @param range - Attribute source range.
 * @param parent - Attribute parent node.
 * @param context - Shared migration state.
 */
function migrateClassExpression(
    expression: t.Expression | t.JSXEmptyExpression,
    range: AttributeRange,
    parent: VisitNode | null,
    context: JsxMigrationContext,
): void {
    if (t.isStringLiteral(expression)) {
        applyStaticClassMigration(expression.value, range, parent, context);
        return;
    }
    const result = createDynamicPatternResult(expression, context);
    if (!result) {
        context.counters.classNamesSkipped++;
        return;
    }
    applyDynamicClassMigration(result.pattern, range, parent, context, result.callsite);
}

/** Dynamic migration result plus an optional migrated callsite. */
interface DynamicPatternMatch {
    pattern: PatternResult;
    callsite?: number;
}

/**
 * Selects the dynamic-pattern handler for a supported expression shape.
 *
 * @param expression - JSX expression.
 * @param context - Shared migration state.
 * @returns Pattern result, or null for an unsupported expression.
 */
function createDynamicPatternResult(
    expression: t.Expression | t.JSXEmptyExpression,
    context: JsxMigrationContext,
): DynamicPatternMatch | null {
    const { source, options } = context;
    if (t.isTemplateLiteral(expression)) {
        return { pattern: handleTemplateLiteral(expression, source, t, options.customMap) };
    }
    if (isClsxCallExpression(expression)) {
        return {
            pattern: handleClsxCall(expression, source, t, options.customMap),
            callsite: expression.start ?? undefined,
        };
    }
    if (t.isConditionalExpression(expression)) {
        return { pattern: handleTernary(expression, source, t, options.customMap) };
    }
    if (t.isLogicalExpression(expression) && expression.operator === '&&') {
        return { pattern: handleLogicalAnd(expression, source, t, options.customMap) };
    }
    return null;
}

/**
 * Returns whether an expression invokes a supported clsx-like helper.
 *
 * @param expression - JSX expression.
 * @returns Whether the expression is a supported call.
 */
function isClsxCallExpression(
    expression: t.Expression | t.JSXEmptyExpression,
): expression is t.CallExpression {
    return (
        t.isCallExpression(expression) &&
        t.isIdentifier(expression.callee) &&
        isClsxLikeName(expression.callee.name)
    );
}

/**
 * Applies a dynamic migration result and preserves skipped-pattern diagnostics.
 *
 * @param result - Dynamic-pattern result.
 * @param range - Attribute source range.
 * @param parent - Attribute parent node.
 * @param context - Shared migration state.
 * @param callsite - Optional clsx callsite offset.
 */
function applyDynamicClassMigration(
    result: PatternResult,
    range: AttributeRange,
    parent: VisitNode | null,
    context: JsxMigrationContext,
    callsite?: number,
): void {
    if (result.migrated) {
        context.replacements.push({ ...range, text: result.replacement });
        context.counters.classNamesTransformed += result.converted;
        if (callsite !== undefined) context.clsxCallsitesMigrated.add(callsite);
    } else {
        context.counters.classNamesSkipped++;
        context.warnings.push(
            ...result.warnings.map(warning => `[${context.filePath}] ${warning}`),
        );
    }
    context.classesUnrecognized.push(...result.unrecognized);
    injectTodoComment(result.unrecognized, parent, context.options, context.replacements);
}

/**
 * Transform a JSX/TSX source file, replacing className with sz props.
 * Uses Babel AST for accurate, context-aware transformation.
 *
 * @param source - Source file content string.
 * @param filePath - Path to the source file (for error messages).
 * @param options - Transformation options.
 * @returns {TransformResult} Transformed code and stats.
 */
export function transformSource(
    source: string,
    filePath: string,
    options: TransformOptions = {},
): TransformResult {
    const warnings: string[] = [];
    const counters: TransformCounters = {
        classNamesTransformed: 0,
        classNamesSkipped: 0,
        classNamesSkippedComponent: 0,
        szKeysNormalized: 0,
    };
    const classesUnrecognized: string[] = [];
    const replacements: Replacement[] = [];

    // Track clsx-like imports for unused import detection
    const clsxImportNames = new Set<string>();
    let clsxUsedOutsideClassName = false;
    const clsxCallsitesMigrated = new Set<number>(); // node start positions

    // Track CVA imports — cva() is a variant utility incompatible with sz.
    // We warn the user to migrate to szv() instead of silently skipping.
    let hasCvaImport = false;

    // ── Fast-path: skip parse when source has nothing to transform ───────
    // Real-world migrations process many files; a single indexOf scan
    // saves the full Babel parse + AST walk cost on every irrelevant file.
    // Must catch both className references (migration target) and cva
    // imports (warning surface) — anything else is invisible to migrate.
    // In keys-only mode only `sz=` matters (className is left untouched).
    const fastPath = fastPathResult(source, options.keysOnly === true);
    if (fastPath) {
        return fastPath;
    }

    // ── Step 1: Parse ────────────────────────────────────────────────────
    let ast: ReturnType<typeof parse>;
    try {
        ast = parse(source, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript', 'decorators-legacy'],
            ranges: true,
        });
    } catch (err) {
        // If parsing fails, skip this file gracefully
        const msg = err instanceof Error ? err.message : String(err);
        return {
            code: source,
            changed: false,
            warnings: [`Parse error in ${filePath}: ${msg}`],
            stats: {
                classNamesTransformed: 0,
                classNamesSkipped: 0,
                classNamesSkippedComponent: 0,
                classesUnrecognized: [],
            },
            potentiallyUnusedImports: [],
        };
    }

    // ── Step 2: Walk AST ─────────────────────────────────────────────────
    walkAst(ast, {
        ImportDeclaration(node) {
            const src = node.source.value;
            // Common clsx/cn packages
            const clsxPackages = ['clsx', 'clsx/lite', 'classnames', 'tailwind-merge'];
            const isClsxPkg = clsxPackages.some(p => src === p || src.startsWith(`${p}/`));

            // CVA (class-variance-authority or the 'cva' package) — cannot auto-migrate;
            // caller should use szv() from @csszyx/runtime for type-safe variants.
            const cvaPkgs = ['cva', 'class-variance-authority'];
            if (cvaPkgs.some(p => src === p || src.startsWith(`${p}/`))) {
                hasCvaImport = true;
            }

            for (const spec of node.specifiers) {
                const localName = spec.local.name;
                if (isClsxPkg || isClsxLikeName(localName)) {
                    clsxImportNames.add(localName);
                }
            }
        },

        CallExpression(node, ancestors) {
            if (t.isIdentifier(node.callee) && clsxImportNames.has(node.callee.name)) {
                const inClassName = ancestors.some(isClassNameJsxAttribute);
                if (!inClassName) {
                    clsxUsedOutsideClassName = true;
                }
            }
        },

        JSXAttribute(node, parent) {
            handleJsxAttribute(node, parent, {
                source,
                filePath,
                options,
                replacements,
                warnings,
                classesUnrecognized,
                clsxCallsitesMigrated,
                counters,
            });
        },
    });

    // ── Step 2b: Emit CVA warning ────────────────────────────────────────────
    if (hasCvaImport) {
        warnings.push(
            `[${filePath}] File uses cva() — consider migrating to szv() from @csszyx/runtime for type-safe variant-based styling.`,
        );
    }

    // ── Step 3: Apply replacements (from end to start to preserve positions) ─
    let output = source;
    const sorted = replacements.sort((a, b) => b.start - a.start);
    for (const r of sorted) {
        output = output.slice(0, r.start) + r.text + output.slice(r.end);
    }

    // ── Step 4: Detect potentially unused imports ────────────────────────
    const potentiallyUnusedImports: string[] = [];
    if (clsxImportNames.size > 0 && !clsxUsedOutsideClassName && replacements.length > 0) {
        // Simple check: see if any clsx-like name still appears as a call in modified output
        for (const name of clsxImportNames) {
            const callPattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
            if (!callPattern.test(output)) {
                potentiallyUnusedImports.push(name);
            }
        }
    }

    return {
        code: output,
        changed: replacements.length > 0,
        warnings,
        stats: {
            classNamesTransformed: counters.classNamesTransformed,
            classNamesSkipped: counters.classNamesSkipped,
            classNamesSkippedComponent: counters.classNamesSkippedComponent,
            classesUnrecognized,
            szKeysNormalized: counters.szKeysNormalized,
        },
        potentiallyUnusedImports,
    };
}

/**
 * Backwards-compatible alias for Phase 1 callers.
 * Uses the same Babel-based transformer internally.
 *
 * @param source - Source file content string.
 * @param filePath - Path to the source file.
 * @returns {TransformResult} Transformed code and stats.
 */
export function transformSourceSimple(source: string, filePath: string): TransformResult {
    return transformSource(source, filePath);
}

// ============================================================================
// STATIC STRING PROCESSOR (shared by Case 1 and 2a)
// ============================================================================

/**
 *
 */
interface StaticResult {
    replacement: string;
    unrecognized: string[];
}

/**
 * Process a static className string into an sz replacement.
 * Returns null if the string has no recognized classes.
 *
 * @param classNameStr - The className string value
 * @param customMap - Optional map of custom classes to sz objects
 * @returns StaticResult or null
 */
function processStaticString(classNameStr: string, customMap?: CsszyxTodoMap): StaticResult | null {
    const trimmed = classNameStr.trim();
    if (!trimmed) {
        return null;
    }

    const { szObject, unrecognized, keepInClassName } = classNameToSzObject(trimmed, customMap);
    if (Object.keys(szObject).length === 0) {
        return null;
    }

    const szExpr = generateSzExpression(szObject);

    // Classes that stay in className: unrecognized (parser didn't know them)
    // + keepInClassName (user explicitly marked "sz:keep" in csszyx-todo.json)
    const remainingClassName = [...keepInClassName, ...unrecognized];

    if (remainingClassName.length > 0) {
        return {
            replacement: `className="${remainingClassName.join(' ')}" sz=${szExpr}`,
            unrecognized,
        };
    }

    return {
        replacement: `sz=${szExpr}`,
        unrecognized: [],
    };
}

// ============================================================================
// HTML TRANSFORMER (regex-based — Babel doesn't parse HTML)
// ============================================================================

/** Options for HTML transformation. */
export interface HtmlTransformOptions {
    /** Wrap sz attribute value in outer { } braces (default: false). */
    braces?: boolean;
    /** Inject FOUC-prevention CSS before </head> (default: true). */
    injectFouc?: boolean;
    /** Inject runtime script before </body>: 'local' | 'cdn' | false (default: false). */
    injectRuntime?: 'local' | 'cdn' | false;
    /** CDN URL for runtime script (used when injectRuntime: 'cdn'). */
    cdnUrl?: string;
    /** Local path for runtime script (used when injectRuntime: 'local'). */
    localPath?: string;
}

const FOUC_CSS = `<style>
  /* csszyx: hide [sz] elements until runtime processes them */
  [sz] { visibility: hidden; }
  body.sz-ready [sz] { visibility: visible; }
</style>`;

/**
 * Transform an HTML source file replacing class="..." with sz="..." attributes.
 * Also optionally injects FOUC-prevention CSS and runtime script.
 * @param source - HTML source file content.
 * @param filePath - Path to the source file.
 * @param options - HTML transform options.
 * @returns {TransformResult} Transformed code and stats.
 */
export function transformHtmlSourceSimple(
    source: string,
    filePath: string,
    options: HtmlTransformOptions = {},
): TransformResult {
    const {
        braces = false,
        injectFouc = true,
        injectRuntime = false,
        cdnUrl = 'https://cdn.csszyx.com/runtime.js',
        localPath = 'csszyx-runtime.js',
    } = options;

    const warnings: string[] = [];
    let classNamesTransformed = 0;
    let classNamesSkipped = 0;
    const classNamesSkippedComponent = 0;
    const classesUnrecognized: string[] = [];
    let changed = false;

    // Match class="..." (double quotes) — standard HTML attribute
    let output = source.replace(/\bclass="([^"]*)"/g, (match, classStr: string) => {
        return processClassAttr(match, classStr, '"');
    });

    // Match class='...' (single quotes)
    output = output.replace(/\bclass='([^']*)'/g, (match, classStr: string) => {
        return processClassAttr(match, classStr, "'");
    });

    // Inject FOUC prevention CSS before </head>
    if (injectFouc && output.includes('</head>') && !output.includes('csszyx: hide [sz]')) {
        output = output.replace('</head>', `${FOUC_CSS}\n</head>`);
        changed = true;
    }

    // Inject runtime script before </body>
    if (injectRuntime && output.includes('</body>')) {
        const scriptSrc = injectRuntime === 'cdn' ? cdnUrl : localPath;
        const scriptTag = `<script src="${scriptSrc}"></script>`;
        if (!output.includes(scriptSrc)) {
            output = output.replace('</body>', `${scriptTag}\n</body>`);
            changed = true;
        }
    }

    /**
     * Process a single class attribute match.
     * @param match - The full regex match string.
     * @param classStr - The class attribute value.
     * @param quote - The quote character used.
     * @returns {string} Replacement string.
     */
    function processClassAttr(match: string, classStr: string, quote: string): string {
        const trimmed = classStr.trim();
        if (!trimmed) {
            classNamesSkipped++;
            return match;
        }

        const { szObject, unrecognized } = classNameToSzObject(trimmed);

        if (Object.keys(szObject).length === 0) {
            classNamesSkipped++;
            classesUnrecognized.push(...unrecognized);
            return match;
        }

        const szVal = generateSzHtmlValue(szObject, braces);
        changed = true;
        classNamesTransformed++;

        if (unrecognized.length > 0) {
            classesUnrecognized.push(...unrecognized);
            // Keep unrecognized classes in class attribute, migrate the rest to sz
            return `class=${quote}${unrecognized.join(' ')}${quote} sz="${szVal}"`;
        }

        return `sz="${szVal}"`;
    }

    return {
        code: output,
        changed,
        warnings,
        stats: {
            classNamesTransformed,
            classNamesSkipped,
            classNamesSkippedComponent,
            classesUnrecognized,
        },
        potentiallyUnusedImports: [],
    };
}
