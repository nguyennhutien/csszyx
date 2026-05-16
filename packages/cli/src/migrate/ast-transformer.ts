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
import _traverse from '@babel/traverse';
import * as t from '@babel/types';

import {
    handleClsxCall,
    handleLogicalAnd,
    handleTemplateLiteral,
    handleTernary,
    isClsxLikeName,
} from './dynamic-patterns.js';
import { generateSzExpression, generateSzHtmlValue } from './sz-codegen.js';
import { type CsszyxTodoMap, classNameToSzObject } from './variant-parser.js';

// ESM/CJS interop for @babel/traverse
const traverse = (
    typeof _traverse === 'function'
        ? _traverse
        : (_traverse as unknown as { default: typeof _traverse }).default
) as typeof _traverse;

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
        classesUnrecognized: string[];
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
    let classNamesTransformed = 0;
    let classNamesSkipped = 0;
    const classesUnrecognized: string[] = [];
    const replacements: Replacement[] = [];

    // Track clsx-like imports for unused import detection
    const clsxImportNames = new Set<string>();
    let clsxUsedOutsideClassName = false;
    const clsxCallsitesMigrated = new Set<number>(); // node start positions

    // Track CVA imports — cva() is a variant utility incompatible with sz.
    // We warn the user to migrate to szv() instead of silently skipping.
    let hasCvaImport = false;

    // ── Step 1: Parse ────────────────────────────────────────────────────
    let ast;
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
            stats: { classNamesTransformed: 0, classNamesSkipped: 0, classesUnrecognized: [] },
            potentiallyUnusedImports: [],
        };
    }

    // ── Step 2: Traverse AST ─────────────────────────────────────────────
    traverse(ast, {
        // Track clsx-like and CVA imports
        ImportDeclaration(path) {
            const src = path.node.source.value;
            // Common clsx/cn packages
            const clsxPackages = ['clsx', 'clsx/lite', 'classnames', 'tailwind-merge'];
            const isClsxPkg = clsxPackages.some(p => src === p || src.startsWith(`${p}/`));

            // CVA (class-variance-authority or the 'cva' package) — cannot auto-migrate;
            // caller should use szv() from @csszyx/runtime for type-safe variants.
            const cvaPkgs = ['cva', 'class-variance-authority'];
            if (cvaPkgs.some(p => src === p || src.startsWith(`${p}/`))) {
                hasCvaImport = true;
            }

            for (const spec of path.node.specifiers) {
                const localName = spec.local.name;
                if (isClsxPkg || isClsxLikeName(localName)) {
                    clsxImportNames.add(localName);
                }
            }
        },

        // Track clsx usage outside className
        CallExpression(path) {
            if (t.isIdentifier(path.node.callee) && clsxImportNames.has(path.node.callee.name)) {
                // Check if this call is inside a className JSXAttribute
                const inClassName = path.findParent(
                    p =>
                        t.isJSXAttribute(p.node) &&
                        t.isJSXIdentifier(p.node.name) &&
                        p.node.name.name === 'className',
                );
                if (!inClassName) {
                    clsxUsedOutsideClassName = true;
                }
            }
        },

        // Main transformation: className → sz
        JSXAttribute(path) {
            // Only process className attributes
            const attrName = path.node.name;
            if (!t.isJSXIdentifier(attrName) || attrName.name !== 'className') {
                return;
            }

            // Skip className on custom (capitalized) components — they accept className
            // as a prop to pass down; we cannot replace it with sz on the call site.
            // e.g. <MyComponent className="..." /> — skip silently.
            const parent = path.parent;
            if (t.isJSXOpeningElement(parent)) {
                const elementName = parent.name;
                const isCapitalized =
                    (t.isJSXIdentifier(elementName) && /^[A-Z]/.test(elementName.name)) ||
                    t.isJSXMemberExpression(elementName);
                if (isCapitalized) {
                    classNamesSkipped++;
                    return;
                }
            }

            // Skip if sibling sz attribute already exists
            if (t.isJSXOpeningElement(parent)) {
                const hasSz = parent.attributes.some(
                    attr =>
                        t.isJSXAttribute(attr) &&
                        t.isJSXIdentifier(attr.name) &&
                        attr.name.name === 'sz',
                );
                if (hasSz) {
                    classNamesSkipped++;
                    return;
                }
            }

            const value = path.node.value;
            const attrStart = path.node.start;
            const attrEnd = path.node.end;
            if (
                attrStart === null ||
                attrStart === undefined ||
                attrEnd === null ||
                attrEnd === undefined
            ) {
                return;
            }

            // ─── CASE 1: StringLiteral — className="..." ──────────────
            if (t.isStringLiteral(value)) {
                const result = processStaticString(value.value, options.customMap);
                if (result) {
                    replacements.push({ start: attrStart, end: attrEnd, text: result.replacement });
                    classNamesTransformed++;
                    classesUnrecognized.push(...result.unrecognized);
                    injectTodoComment(result.unrecognized, path.parent, options, replacements);
                } else {
                    classNamesSkipped++;
                }
                return;
            }

            // ─── CASE 2: JSXExpressionContainer — className={...} ─────
            if (t.isJSXExpressionContainer(value)) {
                const expr = value.expression;

                // 2a: String literal in braces — className={'...'}
                if (t.isStringLiteral(expr)) {
                    const result = processStaticString(expr.value, options.customMap);
                    if (result) {
                        replacements.push({
                            start: attrStart,
                            end: attrEnd,
                            text: result.replacement,
                        });
                        classNamesTransformed++;
                        classesUnrecognized.push(...result.unrecognized);
                        injectTodoComment(result.unrecognized, path.parent, options, replacements);
                    } else {
                        classNamesSkipped++;
                    }
                    return;
                }

                // 2b: Template literal — className={`...`}
                if (t.isTemplateLiteral(expr)) {
                    const result = handleTemplateLiteral(expr, source, t, options.customMap);
                    if (result.migrated) {
                        replacements.push({
                            start: attrStart,
                            end: attrEnd,
                            text: result.replacement,
                        });
                        classNamesTransformed += result.converted;
                        classesUnrecognized.push(...result.unrecognized);
                    } else {
                        classNamesSkipped++;
                        warnings.push(...result.warnings.map(w => `[${filePath}] ${w}`));
                    }
                    injectTodoComment(result.unrecognized, path.parent, options, replacements);
                    return;
                }

                // 2c: Call expression — className={clsx(...)} / cn(...)
                if (
                    t.isCallExpression(expr) &&
                    t.isIdentifier(expr.callee) &&
                    isClsxLikeName(expr.callee.name)
                ) {
                    const result = handleClsxCall(expr, source, t, options.customMap);
                    if (result.migrated) {
                        replacements.push({
                            start: attrStart,
                            end: attrEnd,
                            text: result.replacement,
                        });
                        classNamesTransformed += result.converted;
                        classesUnrecognized.push(...result.unrecognized);
                        if (expr.start !== null && expr.start !== undefined) {
                            clsxCallsitesMigrated.add(expr.start);
                        }
                    } else {
                        classNamesSkipped++;
                        warnings.push(...result.warnings.map(w => `[${filePath}] ${w}`));
                    }
                    injectTodoComment(result.unrecognized, path.parent, options, replacements);
                    return;
                }

                // 2d: Conditional expression — className={cond ? 'a' : 'b'}
                if (t.isConditionalExpression(expr)) {
                    const result = handleTernary(expr, source, t, options.customMap);
                    if (result.migrated) {
                        replacements.push({
                            start: attrStart,
                            end: attrEnd,
                            text: result.replacement,
                        });
                        classNamesTransformed += result.converted;
                        classesUnrecognized.push(...result.unrecognized);
                    } else {
                        classNamesSkipped++;
                        warnings.push(...result.warnings.map(w => `[${filePath}] ${w}`));
                    }
                    injectTodoComment(result.unrecognized, path.parent, options, replacements);
                    return;
                }

                // 2e: Logical expression — className={cond && 'classes'}
                if (t.isLogicalExpression(expr) && expr.operator === '&&') {
                    const result = handleLogicalAnd(expr, source, t, options.customMap);
                    if (result.migrated) {
                        replacements.push({
                            start: attrStart,
                            end: attrEnd,
                            text: result.replacement,
                        });
                        classNamesTransformed += result.converted;
                        classesUnrecognized.push(...result.unrecognized);
                    } else {
                        classNamesSkipped++;
                        warnings.push(...result.warnings.map(w => `[${filePath}] ${w}`));
                    }
                    injectTodoComment(result.unrecognized, path.parent, options, replacements);
                    return;
                }

                // 2f: Unhandled expression → skip silently
                classNamesSkipped++;
                return;
            }

            // JSXExpressionContainer with JSXEmptyExpression, or null → skip
            classNamesSkipped++;
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
        stats: { classNamesTransformed, classNamesSkipped, classesUnrecognized },
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
        stats: { classNamesTransformed, classNamesSkipped, classesUnrecognized },
        potentiallyUnusedImports: [],
    };
}
