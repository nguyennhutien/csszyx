import { parseSync } from 'oxc-parser';

import { sortStrings } from './sort.js';

/** Kind of out-of-band global custom-property usage. */
export type GlobalVarUsageKind =
    | 'style-set-property'
    | 'style-get-property'
    | 'style-remove-property'
    | 'jsx-style-key'
    | 'class-string-var-reference';

/** Source location for one out-of-band usage. */
export interface GlobalVarUsageLocation {
    /** Source file path. */
    filePath: string;
    /** 1-based source line. */
    line: number;
    /** 1-based source column. */
    column: number;
}

/** One out-of-band global custom-property usage diagnostic. */
export interface GlobalVarUsageDiagnostic {
    /** Usage kind. */
    kind: GlobalVarUsageKind;
    /** Custom-property name including leading `--`. */
    name: string;
    /** Source location. */
    location: GlobalVarUsageLocation;
    /** Human-readable message. */
    message: string;
}

/** Options for JS/JSX global variable usage scanning. */
export interface ScanGlobalVarUsagesOptions {
    /** Candidate tokens to report. Undefined reports every concrete token. */
    tokens?: Iterable<string>;
}

/** Minimum oxc AST node surface used by the scanner. */
interface OxcNode {
    /** Node discriminator. */
    type: string;
    /** Start offset. */
    start: number;
    /** End offset. */
    end: number;
    /** Additional oxc fields. */
    [key: string]: unknown;
}

const CSS_VAR_REFERENCE_RE = /var\(\s*(--[\w-]+)/g;

/**
 * Scans JS/TS/JSX/TSX source for global custom-property usages csszyx does not
 * currently rewrite.
 *
 * @param source Source text.
 * @param filename Source filename.
 * @param options Scanner options.
 * @returns Out-of-band usage diagnostics.
 */
export function scanGlobalVarUsages(
    source: string,
    filename = 'file.tsx',
    options: ScanGlobalVarUsagesOptions = {},
): GlobalVarUsageDiagnostic[] {
    if (!source.includes('--') && !source.includes('var(')) {
        return [];
    }

    const parsed = parseSync(filename, source);
    if (parsed.errors.length > 0) {
        throw new Error(
            `oxc-parser errors in ${filename}: ${parsed.errors.map(error => error.message).join('; ')}`,
        );
    }

    const tokenFilter = options.tokens ? new Set(options.tokens) : null;
    const constantStrings = collectStringConstants(parsed.program as unknown as OxcNode);
    const diagnostics: GlobalVarUsageDiagnostic[] = [];

    walk(parsed.program, (node, ancestors) => {
        if (node.type === 'CallExpression') {
            collectStyleMethodDiagnostic(
                node,
                source,
                filename,
                constantStrings,
                tokenFilter,
                diagnostics,
            );
            return;
        }
        if (node.type !== 'JSXAttribute') {
            return;
        }

        const attrName = jsxAttributeName(node);
        if (attrName === 'style') {
            collectJsxStyleDiagnostics(
                node,
                source,
                filename,
                constantStrings,
                tokenFilter,
                diagnostics,
            );
            return;
        }
        if (attrName === 'className') {
            collectClassNameDiagnostics(node, source, filename, tokenFilter, diagnostics);
            return;
        }

        if (attrName === 'sz' && ancestors.some(parent => parent.type === 'JSXAttribute')) {
            return;
        }
    });

    return diagnostics;
}

/**
 * Collects module/function-scope const string bindings.
 *
 * @param root AST root.
 * @returns Identifier-to-string map.
 */
function collectStringConstants(root: OxcNode): Map<string, string> {
    const constants = new Map<string, string>();
    walk(root, node => {
        if (node.type !== 'VariableDeclarator') {
            return;
        }
        const id = (node as unknown as { id?: OxcNode }).id;
        const init = (node as unknown as { init?: OxcNode | null }).init;
        if (id?.type !== 'Identifier' || !init) {
            return;
        }
        const name = (id as unknown as { name?: unknown }).name;
        const value = literalStringValue(init);
        if (typeof name === 'string' && value !== null) {
            constants.set(name, value);
        }
    });
    return constants;
}

/**
 * Collects diagnostics for element.style custom-property methods.
 *
 * @param node Call expression node.
 * @param source Source text.
 * @param filename Source filename.
 * @param constants Static string constants.
 * @param tokenFilter Optional candidate token filter.
 * @param diagnostics Mutable diagnostics output.
 */
function collectStyleMethodDiagnostic(
    node: OxcNode,
    source: string,
    filename: string,
    constants: ReadonlyMap<string, string>,
    tokenFilter: ReadonlySet<string> | null,
    diagnostics: GlobalVarUsageDiagnostic[],
): void {
    const method = memberMethodName((node as unknown as { callee?: OxcNode }).callee);
    if (!method || !['setProperty', 'getPropertyValue', 'removeProperty'].includes(method)) {
        return;
    }

    const firstArg = (node as unknown as { arguments?: OxcNode[] }).arguments?.[0];
    const name = firstArg ? resolveString(firstArg, constants) : null;
    if (!name?.startsWith('--') || !shouldReportToken(name, tokenFilter)) {
        return;
    }

    let kind: GlobalVarUsageDiagnostic['kind'] = 'style-remove-property';
    if (method === 'setProperty') kind = 'style-set-property';
    if (method === 'getPropertyValue') kind = 'style-get-property';
    diagnostics.push(createDiagnostic(kind, name, node, source, filename));
}

/**
 * Collects diagnostics for raw JSX style object custom-property keys.
 *
 * @param attr JSX style attribute node.
 * @param source Source text.
 * @param filename Source filename.
 * @param constants Static string constants.
 * @param tokenFilter Optional candidate token filter.
 * @param diagnostics Mutable diagnostics output.
 */
function collectJsxStyleDiagnostics(
    attr: OxcNode,
    source: string,
    filename: string,
    constants: ReadonlyMap<string, string>,
    tokenFilter: ReadonlySet<string> | null,
    diagnostics: GlobalVarUsageDiagnostic[],
): void {
    const expression = jsxExpression(attr);
    if (expression?.type !== 'ObjectExpression') {
        return;
    }

    for (const prop of (expression as unknown as { properties?: OxcNode[] }).properties ?? []) {
        if (prop.type !== 'Property') {
            continue;
        }
        const name = propertyKeyString(prop, constants);
        if (name?.startsWith('--') && shouldReportToken(name, tokenFilter)) {
            diagnostics.push(createDiagnostic('jsx-style-key', name, prop, source, filename));
        }
    }
}

/**
 * Collects diagnostics for className strings containing var(--token).
 *
 * @param attr JSX className attribute node.
 * @param source Source text.
 * @param filename Source filename.
 * @param tokenFilter Optional candidate token filter.
 * @param diagnostics Mutable diagnostics output.
 */
function collectClassNameDiagnostics(
    attr: OxcNode,
    source: string,
    filename: string,
    tokenFilter: ReadonlySet<string> | null,
    diagnostics: GlobalVarUsageDiagnostic[],
): void {
    for (const value of jsxAttributeStringValues(attr)) {
        for (const name of extractVarReferences(value)) {
            if (shouldReportToken(name, tokenFilter)) {
                diagnostics.push(
                    createDiagnostic('class-string-var-reference', name, attr, source, filename),
                );
            }
        }
    }
}

/**
 * Gets a JSX attribute name.
 *
 * @param attr JSX attribute node.
 * @returns Attribute name, or null.
 */
function jsxAttributeName(attr: OxcNode): string | null {
    const name = (attr as unknown as { name?: { type?: string; name?: string } }).name;
    return name?.type === 'JSXIdentifier' ? (name.name ?? null) : null;
}

/**
 * Gets the expression inside a JSX expression container attribute value.
 *
 * @param attr JSX attribute node.
 * @returns Contained expression, or null.
 */
function jsxExpression(attr: OxcNode): OxcNode | null {
    const value = (attr as unknown as { value?: OxcNode | null }).value;
    if (value?.type !== 'JSXExpressionContainer') {
        return null;
    }
    return (value as unknown as { expression?: OxcNode | null }).expression ?? null;
}

/**
 * Extracts static string values from a JSX attribute.
 *
 * @param attr JSX attribute node.
 * @returns Static string values.
 */
function jsxAttributeStringValues(attr: OxcNode): string[] {
    const value = (attr as unknown as { value?: OxcNode | null }).value;
    if (!value) {
        return [];
    }
    const direct = literalStringValue(value);
    if (direct !== null) {
        return [direct];
    }
    const expression = jsxExpression(attr);
    if (!expression) {
        return [];
    }
    const exprValue = literalStringValue(expression);
    if (exprValue !== null) {
        return [exprValue];
    }
    if (expression.type === 'TemplateLiteral') {
        return templateStaticParts(expression);
    }
    return [];
}

/**
 * Resolves a string literal or static const identifier.
 *
 * @param node AST node.
 * @param constants Static string constants.
 * @returns Resolved string, or null.
 */
function resolveString(node: OxcNode, constants: ReadonlyMap<string, string>): string | null {
    const literal = literalStringValue(node);
    if (literal !== null) {
        return literal;
    }
    if (node.type === 'Identifier') {
        const name = (node as unknown as { name?: unknown }).name;
        return typeof name === 'string' ? (constants.get(name) ?? null) : null;
    }
    return null;
}

/**
 * Reads a literal string value from oxc literal-like nodes.
 *
 * @param node AST node.
 * @returns String literal value, or null.
 */
function literalStringValue(node: OxcNode): string | null {
    if (node.type !== 'Literal') {
        return null;
    }
    const value = (node as unknown as { value?: unknown }).value;
    return typeof value === 'string' ? value : null;
}

/**
 * Gets an object property key as a string.
 *
 * @param property Object property node.
 * @param constants Static string constants.
 * @returns Property key string, or null.
 */
function propertyKeyString(
    property: OxcNode,
    constants: ReadonlyMap<string, string>,
): string | null {
    const key = (property as unknown as { key?: OxcNode; computed?: boolean }).key;
    const computed = (property as unknown as { computed?: boolean }).computed === true;
    if (!key) {
        return null;
    }
    if (computed) {
        return resolveString(key, constants);
    }
    if (key.type === 'Identifier') {
        const name = (key as unknown as { name?: unknown }).name;
        return typeof name === 'string' ? name : null;
    }
    return literalStringValue(key);
}

/**
 * Reads a member expression property name.
 *
 * @param callee Call callee node.
 * @returns Method name, or null.
 */
function memberMethodName(callee: OxcNode | undefined): string | null {
    if (callee?.type !== 'MemberExpression') {
        return null;
    }
    const property = (callee as unknown as { property?: OxcNode; computed?: boolean }).property;
    if (!property) {
        return null;
    }
    if (property.type === 'Identifier') {
        const name = (property as unknown as { name?: unknown }).name;
        return typeof name === 'string' ? name : null;
    }
    return literalStringValue(property);
}

/**
 * Extracts static string chunks from a template literal.
 *
 * @param node Template literal node.
 * @returns Static template chunks.
 */
function templateStaticParts(node: OxcNode): string[] {
    const quasis = (node as unknown as { quasis?: OxcNode[] }).quasis ?? [];
    const parts: string[] = [];
    for (const quasi of quasis) {
        const value = (quasi as unknown as { value?: { cooked?: unknown; raw?: unknown } }).value;
        const cooked = value?.cooked;
        const raw = value?.raw;
        if (typeof cooked === 'string') {
            parts.push(cooked);
        } else if (typeof raw === 'string') {
            parts.push(raw);
        }
    }
    return parts;
}

/**
 * Extracts CSS var() references from a string.
 *
 * @param value String value.
 * @returns Unique custom-property names.
 */
function extractVarReferences(value: string): string[] {
    const refs = new Set<string>();
    for (const match of value.matchAll(CSS_VAR_REFERENCE_RE)) {
        refs.add(match[1]);
    }
    return sortStrings(refs);
}

/**
 * Checks whether a token should be reported.
 *
 * @param name Custom-property name.
 * @param tokenFilter Optional candidate token filter.
 * @returns true when the token should be reported.
 */
function shouldReportToken(name: string, tokenFilter: ReadonlySet<string> | null): boolean {
    return tokenFilter === null || tokenFilter.has(name);
}

/**
 * Creates a usage diagnostic.
 *
 * @param kind Usage kind.
 * @param name Custom-property name.
 * @param node AST node.
 * @param source Source text.
 * @param filename Source filename.
 * @returns Usage diagnostic.
 */
function createDiagnostic(
    kind: GlobalVarUsageKind,
    name: string,
    node: OxcNode,
    source: string,
    filename: string,
): GlobalVarUsageDiagnostic {
    return {
        kind,
        name,
        location: offsetToLocation(source, node.start, filename),
        message: `${name} is used outside csszyx-owned global variable alias rewrites (${kind}).`,
    };
}

/**
 * Converts a source offset to a 1-based line and column location.
 *
 * @param source Source text.
 * @param offset Source offset.
 * @param filename Source filename.
 * @returns Source location.
 */
function offsetToLocation(
    source: string,
    offset: number,
    filename: string,
): GlobalVarUsageLocation {
    let line = 1;
    let column = 1;
    for (let index = 0; index < offset; index++) {
        if (source.charCodeAt(index) === 10) {
            line++;
            column = 1;
        } else {
            column++;
        }
    }
    return { filePath: filename, line, column };
}

/**
 * Walks an oxc AST with parent ancestors.
 *
 * @param node Candidate AST node.
 * @param visit Visitor callback.
 * @param ancestors Parent chain.
 */
function walk(
    node: unknown,
    visit: (node: OxcNode, ancestors: OxcNode[]) => void,
    ancestors: OxcNode[] = [],
): void {
    if (!isOxcNode(node)) {
        return;
    }
    visit(node, ancestors);
    ancestors.push(node);
    for (const key of Object.keys(node)) {
        if (isAstMetadataKey(key)) {
            continue;
        }
        const child = (node as Record<string, unknown>)[key];
        if (Array.isArray(child)) {
            for (const item of child) {
                walk(item, visit, ancestors);
            }
        } else if (child && typeof child === 'object') {
            walk(child, visit, ancestors);
        }
    }
    ancestors.pop();
}

/**
 * Checks whether a value is an oxc AST node.
 *
 * @param value Candidate value.
 * @returns true when value has an AST node shape.
 */
function isOxcNode(value: unknown): value is OxcNode {
    return Boolean(
        value && typeof value === 'object' && typeof (value as OxcNode).type === 'string',
    );
}

/**
 * Filters non-structural AST fields during generic traversal.
 *
 * @param key Object key.
 * @returns true when the field should not be traversed.
 */
function isAstMetadataKey(key: string): boolean {
    return key === 'loc' || key === 'range' || key === 'start' || key === 'end' || key === 'type';
}
