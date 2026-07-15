/**
 * Dynamic Pattern Handlers for Migration CLI Phase 2.
 *
 * Handles dynamic className expressions:
 * - clsx/cn/cx/twMerge/classNames calls
 * - Ternary (conditional) expressions
 * - Logical AND expressions
 * - Template literals
 *
 * Each handler returns a PatternResult with the replacement string
 * or signals that migration is not possible for this pattern.
 *
 * Safety policy: if ANY part of a dynamic expression cannot be fully
 * migrated, the ENTIRE expression is skipped + warning emitted.
 * This prevents partial migrations that could break runtime behavior.
 */

import type * as BabelTypes from '@babel/types';

import { generateSzExpression, generateSzObjectLiteral } from './sz-codegen.js';
import { type CsszyxTodoMap, classNameToSzObject } from './variant-parser.js';

// ============================================================================
// TYPES
// ============================================================================

/** Result from a dynamic pattern handler. */
export interface PatternResult {
    /** Full replacement string (e.g., "sz={{ p: 4 }}") — empty if not migrated. */
    replacement: string;
    /** Classes that couldn't be recognized by the class parser. */
    unrecognized: string[];
    /** Human-readable warnings about partial/failed migration. */
    warnings: string[];
    /** Number of className expressions successfully converted. */
    converted: number;
    /** Whether migration actually happened. */
    migrated: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Function names recognized as className composition utilities. */
export const CLSX_LIKE_NAMES = new Set(['clsx', 'cn', 'cx', 'twMerge', 'classNames', 'classnames']);

/**
 * Checks if a name is a recognized className composition utility.
 * @param name - The function name to check.
 * @returns True if the name is clsx-like.
 */
export function isClsxLikeName(name: string): boolean {
    return CLSX_LIKE_NAMES.has(name);
}

// ============================================================================
// HANDLER 1: clsx / cn / twMerge CALLS
// ============================================================================

/**
 * Migrates className={clsx('px-4', isActive && 'bg-blue-500')} → sz={[...]}.
 *
 * Supports these argument types:
 * - StringLiteral: clsx('px-4 py-2')
 * - LogicalExpression (&&) with string right: clsx(isActive && 'bg-blue-500')
 * - ConditionalExpression with string branches: clsx(x ? 'a' : 'b')
 *
 * If ANY argument cannot be fully handled → skips entire call.
 *
 * @param node - The CallExpression AST node
 * @param source - The original source string (for extracting expression text)
 * @param t - Babel types module (passed to avoid import issues)
 * @param customMap - Optional parsed migration-resolution map.
 * @returns PatternResult with replacement string
 */
export function handleClsxCall(
    node: BabelTypes.CallExpression,
    source: string,
    t: typeof BabelTypes,
    customMap?: CsszyxTodoMap,
): PatternResult {
    const warnings: string[] = [];
    const allUnrecognized: string[] = [];
    const elements: string[] = [];
    let converted = 0;

    for (const arg of node.arguments) {
        const result = convertClsxArgument(arg, source, t, customMap);
        if (!result) {
            warnings.push(cannotMigrateClsxArgument(arg, source, t));
            return skip(allUnrecognized, warnings);
        }
        elements.push(result.exprStr);
        allUnrecognized.push(...result.unrecognized);
        converted++;
    }

    if (elements.length === 0) {
        return skip(allUnrecognized, warnings);
    }

    // Single pure object element → simple object syntax
    if (elements.length === 1 && !elements[0].includes('&&') && !elements[0].includes('?')) {
        return {
            replacement: `sz={${elements[0]}}`,
            unrecognized: allUnrecognized,
            warnings,
            converted,
            migrated: true,
        };
    }

    // Multiple elements → array syntax
    return {
        replacement: `sz={[${elements.join(', ')}]}`,
        unrecognized: allUnrecognized,
        warnings,
        converted,
        migrated: true,
    };
}

/**
 * Convert one supported clsx argument to its sz expression.
 * @param arg - Call argument to classify.
 * @param source - Original source text.
 * @param t - Babel type guards.
 * @param customMap - Optional custom migration map.
 * @returns Converted expression metadata, or null when unsupported.
 */
function convertClsxArgument(
    arg: BabelTypes.CallExpression['arguments'][number],
    source: string,
    t: typeof BabelTypes,
    customMap?: CsszyxTodoMap,
): { exprStr: string; unrecognized: string[] } | null {
    if (t.isStringLiteral(arg)) {
        const result = migrateString(arg.value, customMap);
        return result ? { exprStr: result.objectStr, unrecognized: result.unrecognized } : null;
    }
    if (t.isLogicalExpression(arg) && arg.operator === '&&') {
        return handleLogicalAndInner(arg, source, t, customMap);
    }
    return t.isConditionalExpression(arg) ? handleTernaryInner(arg, source, t, customMap) : null;
}

/**
 * Explain why one unsupported clsx argument could not be migrated.
 * @param arg - Unsupported call argument.
 * @param source - Original source text.
 * @param t - Babel type guards.
 * @returns Diagnostic message for the unsupported shape.
 */
function cannotMigrateClsxArgument(
    arg: BabelTypes.CallExpression['arguments'][number],
    source: string,
    t: typeof BabelTypes,
): string {
    const argSrc = safeSlice(source, arg.start, arg.end);
    if (t.isSpreadElement(arg)) return `Cannot migrate spread argument: ${argSrc}`;
    if (t.isLogicalExpression(arg)) return `Cannot migrate logical expression: ${argSrc}`;
    if (t.isConditionalExpression(arg)) return `Cannot migrate ternary: ${argSrc}`;
    return `Cannot migrate argument: ${argSrc}`;
}

// ============================================================================
// HANDLER 2: TERNARY (ConditionalExpression)
// ============================================================================

/**
 * Migrates className={cond ? 'classes-a' : 'classes-b'} → sz={cond ? {...} : {...}}.
 *
 * Both branches must be string literals for migration to succeed.
 *
 * @param node - The ConditionalExpression AST node
 * @param source - The original source string
 * @param t - Babel types module
 * @param customMap - Optional parsed migration-resolution map.
 * @returns PatternResult with replacement string
 */
export function handleTernary(
    node: BabelTypes.ConditionalExpression,
    source: string,
    t: typeof BabelTypes,
    customMap?: CsszyxTodoMap,
): PatternResult {
    const result = handleTernaryInner(node, source, t, customMap);
    if (!result) {
        return {
            replacement: '',
            unrecognized: [],
            warnings: ['Ternary branches must be string literals'],
            converted: 0,
            migrated: false,
        };
    }

    return {
        replacement: `sz={${result.exprStr}}`,
        unrecognized: result.unrecognized,
        warnings: [],
        converted: 1,
        migrated: true,
    };
}

// ============================================================================
// HANDLER 3: LOGICAL AND (&&)
// ============================================================================

/**
 * Migrates className={isActive && 'bg-blue-500'} → sz={isActive && {...}}.
 *
 * Right side must be a string literal.
 *
 * @param node - The LogicalExpression AST node
 * @param source - The original source string
 * @param t - Babel types module
 * @param customMap - Optional parsed migration-resolution map.
 * @returns PatternResult with replacement string
 */
export function handleLogicalAnd(
    node: BabelTypes.LogicalExpression,
    source: string,
    t: typeof BabelTypes,
    customMap?: CsszyxTodoMap,
): PatternResult {
    if (node.operator !== '&&') {
        return {
            replacement: '',
            unrecognized: [],
            warnings: [`Unsupported logical operator: ${node.operator}`],
            converted: 0,
            migrated: false,
        };
    }

    const result = handleLogicalAndInner(node, source, t, customMap);
    if (!result) {
        return {
            replacement: '',
            unrecognized: [],
            warnings: ['Right side of && must be a string literal'],
            converted: 0,
            migrated: false,
        };
    }

    return {
        replacement: `sz={${result.exprStr}}`,
        unrecognized: result.unrecognized,
        warnings: [],
        converted: 1,
        migrated: true,
    };
}

// ============================================================================
// HANDLER 4: TEMPLATE LITERAL
// ============================================================================

/**
 * Migrates className={`px-4 ${cond ? 'bg-blue' : 'bg-red'}`} → sz={[...]}.
 *
 * Strategy:
 * - Static text parts (quasis) → merge into one base sz object
 * - Expressions that are string literals → migrate directly
 * - Expressions that are ternaries with string branches → migrate
 * - Expressions that are logical AND with string right → migrate
 * - If ANY expression cannot be handled → skip entire template literal
 *
 * @param node - The TemplateLiteral AST node
 * @param source - The original source string
 * @param t - Babel types module
 * @param customMap - Optional parsed migration-resolution map.
 * @returns PatternResult with replacement string
 */
export function handleTemplateLiteral(
    node: BabelTypes.TemplateLiteral,
    source: string,
    t: typeof BabelTypes,
    customMap?: CsszyxTodoMap,
): PatternResult {
    const warnings: string[] = [];
    const allUnrecognized: string[] = [];

    // Step 1: Extract and merge all static text from quasis
    const staticText = node.quasis.map(q => q.value.cooked ?? q.value.raw).join(' ');
    const trimmedStatic = staticText.replace(/\s+/g, ' ').trim();

    const state: TemplateMigrationState = {
        baseObject: {},
        dynamicElements: [],
        unrecognized: allUnrecognized,
        converted: 0,
    };
    if (trimmedStatic) {
        const { szObject, unrecognized } = classNameToSzObject(trimmedStatic, customMap);
        state.baseObject = szObject;
        allUnrecognized.push(...unrecognized);
    }

    for (const expr of node.expressions) {
        const warning = migrateTemplateExpression(expr, source, t, customMap, state);
        if (warning) {
            warnings.push(warning);
            return skip(allUnrecognized, warnings);
        }
    }

    // Step 3: Build the output
    const hasBase = Object.keys(state.baseObject).length > 0;
    const hasDynamic = state.dynamicElements.length > 0;

    if (!hasBase && !hasDynamic) {
        return skip(allUnrecognized, warnings);
    }

    // Static only → simple object
    if (hasBase && !hasDynamic) {
        return {
            replacement: `sz=${generateSzExpression(state.baseObject)}`,
            unrecognized: allUnrecognized,
            warnings,
            converted: state.converted + 1,
            migrated: true,
        };
    }

    // Build array: [base, ...dynamics]
    const parts: string[] = [];
    if (hasBase) {
        parts.push(generateSzObjectLiteral(state.baseObject));
    }
    parts.push(...state.dynamicElements);

    return {
        replacement: `sz={[${parts.join(', ')}]}`,
        unrecognized: allUnrecognized,
        warnings,
        converted: state.converted + (hasBase ? 1 : 0),
        migrated: true,
    };
}

/** Mutable output accumulated while migrating template expressions. */
interface TemplateMigrationState {
    baseObject: Record<string, unknown>;
    dynamicElements: string[];
    unrecognized: string[];
    converted: number;
}

/**
 * Migrate one template expression into static or dynamic output.
 * @param expression - Template expression to migrate.
 * @param source - Original source text.
 * @param t - Babel type guards.
 * @param customMap - Optional custom migration map.
 * @param state - Mutable template migration output.
 * @returns Warning message when migration must stop, otherwise null.
 */
function migrateTemplateExpression(
    expression: BabelTypes.Expression | BabelTypes.TSType,
    source: string,
    t: typeof BabelTypes,
    customMap: CsszyxTodoMap | undefined,
    state: TemplateMigrationState,
): string | null {
    if (!isExpression(expression, t)) {
        const node = expression as BabelTypes.Node;
        return `Cannot migrate template expression: ${safeSlice(source, node.start, node.end)}`;
    }
    if (t.isStringLiteral(expression)) {
        const result = migrateString(expression.value, customMap);
        if (!result) return null;
        const { szObject } = classNameToSzObject(expression.value, customMap);
        state.baseObject = { ...state.baseObject, ...szObject };
        state.unrecognized.push(...result.unrecognized);
        state.converted++;
        return null;
    }
    let result: ReturnType<typeof handleTernaryInner> = null;
    if (t.isConditionalExpression(expression)) {
        result = handleTernaryInner(expression, source, t, customMap);
    } else if (t.isLogicalExpression(expression) && expression.operator === '&&') {
        result = handleLogicalAndInner(expression, source, t, customMap);
    }
    if (!result) {
        let kind = 'template expression';
        if (t.isConditionalExpression(expression)) kind = 'template ternary';
        else if (t.isLogicalExpression(expression)) kind = 'template logical expr';
        return `Cannot migrate ${kind}: ${safeSlice(source, expression.start, expression.end)}`;
    }
    state.dynamicElements.push(result.exprStr);
    state.unrecognized.push(...result.unrecognized);
    state.converted++;
    return null;
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/** Inner result for composable sub-expression handling. */
interface InnerResult {
    exprStr: string;
    unrecognized: string[];
}

/**
 * Handles the inner logic for a ternary expression.
 * Returns null if the expression cannot be migrated.
 * @param node - The ConditionalExpression AST node.
 * @param source - The original source string.
 * @param t - Babel types module.
 * @param customMap - Optional parsed migration-resolution map.
 * @returns InnerResult or null if migration is not possible.
 */
function handleTernaryInner(
    node: BabelTypes.ConditionalExpression,
    source: string,
    t: typeof BabelTypes,
    customMap?: CsszyxTodoMap,
): InnerResult | null {
    // Both branches must be string literals
    if (!t.isStringLiteral(node.consequent) || !t.isStringLiteral(node.alternate)) {
        return null;
    }

    const condSource = safeSlice(source, node.test.start, node.test.end);
    const conValue = node.consequent.value.trim();
    const altValue = node.alternate.value.trim();

    // Handle empty alternate: cond ? 'classes' : ''
    if (altValue === '') {
        if (!conValue) {
            return null;
        } // both empty → nothing to do
        const conResult = migrateString(conValue, customMap);
        if (!conResult || conResult.unrecognized.length > 0) {
            return null;
        }
        return {
            exprStr: `${condSource} && ${conResult.objectStr}`,
            unrecognized: [],
        };
    }

    // Handle empty consequent: cond ? '' : 'classes'
    if (conValue === '') {
        const altResult = migrateString(altValue, customMap);
        if (!altResult || altResult.unrecognized.length > 0) {
            return null;
        }
        return {
            exprStr: `!${wrapCondition(condSource)} && ${altResult.objectStr}`,
            unrecognized: [],
        };
    }

    // Both branches have content — migrate both
    const conResult = migrateString(conValue, customMap);
    const altResult = migrateString(altValue, customMap);

    if (!conResult || !altResult) {
        return null;
    }

    const unrecognized = [...conResult.unrecognized, ...altResult.unrecognized];
    if (unrecognized.length > 0) {
        return null;
    }

    return {
        exprStr: `${condSource} ? ${conResult.objectStr} : ${altResult.objectStr}`,
        unrecognized: [],
    };
}

/**
 * Handles the inner logic for a logical AND expression.
 * Returns null if the expression cannot be migrated.
 * @param node - The LogicalExpression AST node.
 * @param source - The original source string.
 * @param t - Babel types module.
 * @param customMap - Optional parsed migration-resolution map.
 * @returns InnerResult or null if migration is not possible.
 */
function handleLogicalAndInner(
    node: BabelTypes.LogicalExpression,
    source: string,
    t: typeof BabelTypes,
    customMap?: CsszyxTodoMap,
): InnerResult | null {
    // Right side must be a string literal
    if (!t.isStringLiteral(node.right)) {
        return null;
    }

    const result = migrateString(node.right.value, customMap);
    if (!result || result.unrecognized.length > 0) {
        return null;
    }

    const condSource = safeSlice(source, node.left.start, node.left.end);

    return {
        exprStr: `${condSource} && ${result.objectStr}`,
        unrecognized: [],
    };
}

/**
 * Migrates a static className string to an sz object literal.
 * Returns null if zero classes were recognized.
 * @param className - The Tailwind class string to migrate.
 * @param customMap - Optional parsed migration-resolution map.
 * @returns Object literal string and unrecognized classes, or null.
 */
function migrateString(
    className: string,
    customMap?: CsszyxTodoMap,
): { objectStr: string; unrecognized: string[] } | null {
    const trimmed = className.trim();
    if (!trimmed) {
        return null;
    }

    const { szObject, unrecognized } = classNameToSzObject(trimmed, customMap);
    if (Object.keys(szObject).length === 0) {
        return null;
    }

    return {
        objectStr: generateSzObjectLiteral(szObject),
        unrecognized,
    };
}

/**
 * Creates a "skip" PatternResult (migration not possible).
 * @param unrecognized - Array of unrecognized class names.
 * @param warnings - Array of diagnostic warning strings.
 * @returns A PatternResult with migrated=false.
 */
function skip(unrecognized: string[], warnings: string[]): PatternResult {
    return {
        replacement: '',
        unrecognized,
        warnings,
        converted: 0,
        migrated: false,
    };
}

/**
 * Safely slices source string using nullable positions.
 * @param source - The full source string.
 * @param start - Start position (nullable).
 * @param end - End position (nullable).
 * @returns The sliced string, or '<unknown>' if positions are null.
 */
function safeSlice(
    source: string,
    start: number | null | undefined,
    end: number | null | undefined,
): string {
    if (start === null || start === undefined || end === null || end === undefined) {
        return '<unknown>';
    }
    return source.slice(start, end);
}

/**
 * Wraps a condition string in parens if it contains spaces (compound expr).
 * @param cond - The condition expression source string.
 * @returns The condition, wrapped in parentheses if needed.
 */
function wrapCondition(cond: string): string {
    if (cond.includes(' ') || cond.includes('||') || cond.includes('&&')) {
        return `(${cond})`;
    }
    return cond;
}

/**
 * Type guard: checks if a node is a Babel Expression (not TSType or other).
 * @param node - The AST node to check.
 * @param t - Babel types module.
 * @returns True if node is a Babel Expression.
 */
function isExpression(node: unknown, t: typeof BabelTypes): node is BabelTypes.Expression {
    return t.isExpression(node as BabelTypes.Node);
}
