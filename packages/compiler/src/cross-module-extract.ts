/**
 * The cross-module registry extractor: every `export const X = szv(<literal
 * config>)` and `export const X = <literal sz object>` in one module, read
 * with oxc-parser.
 *
 * ONE implementation on purpose: the registry is built once by the bundler and
 * fed to every engine identically, so parity holds by construction — each
 * engine then re-validates and compiles its own table through the same code
 * its local candidates use. Only configs that already pass qualification are
 * recorded, so the registry never carries junk across the boundary.
 *
 * This module is why `oxc-parser` remains a dependency after the oxc
 * TRANSFORM lane was removed: extraction is a single shared implementation,
 * not a parallel engine, so it carries none of the write-it-three-times cost
 * the lane removal existed to kill. Porting it onto the native engine would
 * let the dependency go too — a separate piece of work, not assumed here.
 */
import { parseSync } from 'oxc-parser';

import { qualifyStaticSzvConfig, SZV_RESERVED_FACTORY_NAMES } from './szv-precompile.js';

/** Minimal structural shape of an oxc AST node. */
interface OxcNode {
    type: string;
    start: number;
    end: number;
    [key: string]: unknown;
}

/** oxc shape for an identifier expression or binding. */
interface IdentifierNode extends OxcNode {
    type: 'Identifier';
    name: string;
}

/** oxc shape for a call expression. */
interface CallExpressionNode extends OxcNode {
    type: 'CallExpression';
    callee: OxcNode;
    arguments: OxcNode[];
}

/** Minimal variable-declaration shape for exported statements. */
interface VariableDeclarationNode {
    end: number;
    declarations: VariableDeclaratorNode[];
}

/** Minimal variable-declarator shape shared by local and exported szv scans. */
export interface VariableDeclaratorNode {
    id?: { type: string; name?: string };
    init?: OxcNode | null;
}

/** One syntactically valid `name = szv(config)` declaration. */
export interface OxcSzvFactoryDeclaration {
    name: string;
    config: Record<string, unknown> | null;
}

/**
 * What one recorded export IS, because the two are not interchangeable.
 *
 * `szv-config` is a variant TABLE the consumer compiles and then picks from.
 * `sz-object` is a VALUE the consumer lowers exactly as it would the same
 * literal written locally. Carrying them untagged would leave every reader —
 * including the native decoder — guessing which machinery applies.
 */
export type CrossModuleExportKind = 'szv-config' | 'sz-object';

/** One exported value found by the cross-module registry extractor. */
export interface CrossModuleRegistryEntry {
    /** What the value is, and therefore how a consumer must treat it. */
    kind: CrossModuleExportKind;
    /** The exported binding name. */
    exportName: string;
    /** Statically evaluated payload: an szv config, or the sz object itself. */
    value: Record<string, unknown>;
}

/**
 * Remove TypeScript wrappers around expression initializers.
 *
 * @param node Expression node.
 * @returns Inner runtime expression node.
 */
export function unwrapExpression(node: OxcNode): OxcNode {
    let current = node;
    while (
        current.type === 'TSAsExpression' ||
        current.type === 'TSSatisfiesExpression' ||
        current.type === 'TSNonNullExpression' ||
        current.type === 'ParenthesizedExpression'
    ) {
        const next = (current as unknown as { expression?: OxcNode }).expression;
        if (!next) {
            break;
        }
        current = next;
    }
    return current;
}

/** Sentinel distinguishing "not static" from a legitimate undefined value. */
export const STATIC_EVAL_FAILED: unique symbol = Symbol('static-eval-failed');

/**
 * Evaluate a fully literal object expression to a plain object.
 *
 * Strict on purpose: identifier/string keys only, no spread, no computed
 * keys, values limited to literals, `undefined`, negated numbers, arrays and
 * nested objects of the same. Anything else returns null and disqualifies.
 *
 * @param node - The object expression node.
 * @returns The plain object, or null when any part is not a literal.
 */
export function evaluateStaticObjectOxc(node: OxcNode): Record<string, unknown> | null {
    const result: Record<string, unknown> = {};
    const properties = (node as unknown as { properties: OxcNode[] }).properties;
    for (const property of properties) {
        if (property.type !== 'Property') return null;
        const shaped = property as unknown as {
            computed?: boolean;
            key: { type: string; name?: string; value?: unknown };
            value: OxcNode;
        };
        if (shaped.computed) return null;
        let key: string | null = null;
        if (shaped.key.type === 'Identifier') {
            key = shaped.key.name as string;
        } else if (shaped.key.type === 'Literal' && typeof shaped.key.value === 'string') {
            key = shaped.key.value;
        } else if (shaped.key.type === 'Literal' && typeof shaped.key.value === 'number') {
            // Numeric keys stringify, matching the engine's extractor.
            key = String(shaped.key.value);
        }
        if (key === null) return null;
        const value = evaluateStaticValueOxc(shaped.value);
        if (value === STATIC_EVAL_FAILED) return null;
        result[key] = value;
    }
    return result;
}

/**
 * Evaluate one fully literal value expression.
 *
 * String, number and boolean literals, a negated number, and nested objects
 * of the same. No templates, identifiers or arrays: a broader evaluator here
 * would qualify a config the engine's own candidate path bails on, and the
 * registry would then carry entries its consumer refuses.
 *
 * @param rawNode - The value node.
 * @returns The evaluated value, or the failure sentinel.
 */
export function evaluateStaticValueOxc(rawNode: OxcNode): unknown {
    // TS wrappers unwrap here; the szr ARGUMENT safety check deliberately
    // does not.
    const node = unwrapExpression(rawNode);
    if (node.type === 'Literal') {
        const value = (node as unknown as { value: unknown }).value;
        return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? value
            : STATIC_EVAL_FAILED;
    }
    if (node.type === 'UnaryExpression') {
        const unary = node as unknown as { operator: string; argument: OxcNode };
        if (unary.operator !== '-') return STATIC_EVAL_FAILED;
        const inner = unwrapExpression(unary.argument);
        if (inner.type !== 'Literal') return STATIC_EVAL_FAILED;
        const value = (inner as unknown as { value: unknown }).value;
        return typeof value === 'number' ? -value : STATIC_EVAL_FAILED;
    }
    if (node.type === 'ObjectExpression') {
        return evaluateStaticObjectOxc(node) ?? STATIC_EVAL_FAILED;
    }
    return STATIC_EVAL_FAILED;
}

/**
 * Read the syntax shared by local and exported szv factory declarations.
 *
 * @param declarator - Oxc variable declarator.
 * @returns Factory name/config, or null when the declaration is not `szv`.
 */
export function readSzvFactoryDeclaratorOxc(
    declarator: VariableDeclaratorNode,
): OxcSzvFactoryDeclaration | null {
    if (declarator.id?.type !== 'Identifier' || !declarator.init) return null;
    const name = declarator.id.name;
    if (name === undefined || SZV_RESERVED_FACTORY_NAMES.has(name)) return null;
    const init = unwrapExpression(declarator.init);
    if (init.type !== 'CallExpression') return null;
    const call = init as CallExpressionNode;
    if (call.callee.type !== 'Identifier') return null;
    if ((call.callee as IdentifierNode).name !== 'szv' || call.arguments.length !== 1) return null;
    const argument = unwrapExpression(call.arguments[0] as OxcNode);
    const config = argument.type === 'ObjectExpression' ? evaluateStaticObjectOxc(argument) : null;
    return { name, config };
}

/**
 * Read one exported declarator into a registry entry, or refuse it.
 *
 * An szv factory is tried first: `szv(<config>)` is a call, so it can never
 * also read as a plain object, and the order only fixes which check runs.
 *
 * `const` is required for the plain-object kind. A `let` export is a live
 * binding that the module can rebind after any importer has already been
 * compiled against its first value, and nothing in a per-file transform could
 * see that happen. This is the same answer the local path gives a reassigned
 * binding, one step more conservative because the write would be in another
 * file entirely.
 *
 * @param declarator - One declarator of an exported variable declaration.
 * @param isConst - Whether the declaration was written with `const`.
 * @returns The entry to record, or null when the export does not qualify.
 */
function readCrossModuleDeclarator(
    declarator: VariableDeclaratorNode,
    isConst: boolean,
): CrossModuleRegistryEntry | null {
    const factory = readSzvFactoryDeclaratorOxc(declarator);
    if (factory !== null) {
        if (factory.config == null || qualifyStaticSzvConfig(factory.config) === null) return null;
        return { kind: 'szv-config', exportName: factory.name, value: factory.config };
    }
    if (!isConst || declarator.id?.type !== 'Identifier' || !declarator.init) return null;
    const name = declarator.id.name;
    if (name === undefined || SZV_RESERVED_FACTORY_NAMES.has(name)) return null;
    const init = unwrapExpression(declarator.init);
    if (init.type !== 'ObjectExpression') return null;
    // The SAME evaluation the local literal path runs. A narrower predicate
    // here would mean an object qualifies in one file and not in another, which
    // is the subset-predicate failure this repo has already shipped once.
    const value = evaluateStaticObjectOxc(init);
    return value === null ? null : { kind: 'sz-object', exportName: name, value };
}

/**
 * Extract every `export const X = szv(<literal config>)` from one module, for
 * the bundler's cross-module registry.
 *
 * @param source - Module source text.
 * @param filename - Module filename, for parser dialect detection.
 * @returns The exported factories, declaration order preserved.
 */
export function extractCrossModuleRegistryEntries(
    source: string,
    filename: string,
): CrossModuleRegistryEntry[] {
    if (!source.includes('export')) {
        return [];
    }
    let program: { body: OxcNode[] };
    try {
        program = parseSync(filename, source, { lang: 'tsx' }).program as unknown as {
            body: OxcNode[];
        };
    } catch {
        /* v8 ignore next -- oxc reports syntax errors in-band; only native/parser failures throw. */
        return [];
    }
    const out: CrossModuleRegistryEntry[] = [];
    for (const statement of program.body) {
        if (statement.type !== 'ExportNamedDeclaration') continue;
        const declaration = (statement as unknown as { declaration?: OxcNode }).declaration;
        if (declaration?.type !== 'VariableDeclaration') continue;
        const declarators = (declaration as unknown as VariableDeclarationNode).declarations;
        const isConst = (declaration as unknown as { kind?: string }).kind === 'const';
        for (const declarator of declarators) {
            const entry = readCrossModuleDeclarator(declarator, isConst);
            if (entry !== null) out.push(entry);
        }
    }
    return out;
}
