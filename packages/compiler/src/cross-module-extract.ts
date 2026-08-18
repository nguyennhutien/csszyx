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

/**
 * One export that names a value another module declares.
 *
 * Not a kind of {@link CrossModuleRegistryEntry}: it carries no value, because
 * the value is in a module this parse has not read. A consumer handed one as if
 * it were an entry would compile against nothing. Following it is a separate
 * pass over a registry that has read the provider too.
 */
export interface CrossModuleForward {
    /** The name this module exports, and therefore the one an importer writes. */
    exportName: string;
    /** The name the provider module exports it as; `default` for the default slot. */
    importedName: string;
    /** The provider specifier, exactly as this module spelled it. */
    specifier: string;
}

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
 * The variable declaration a top-level statement carries, exported or not.
 *
 * An export list names bindings this module declared, and it may sit either
 * side of them, so the whole top level has to be indexed before the lists are
 * read. Block-scoped declarations are deliberately not walked: only a
 * module-scope binding can be what `export { X }` refers to.
 *
 * @param statement - One statement from the program body.
 * @returns The declaration, or undefined when the statement declares nothing.
 */
function moduleScopeVariableDeclaration(statement: OxcNode): OxcNode | undefined {
    if (statement.type === 'VariableDeclaration') return statement;
    if (statement.type !== 'ExportNamedDeclaration') return undefined;
    const declaration = (statement as unknown as { declaration?: OxcNode }).declaration;
    return declaration?.type === 'VariableDeclaration' ? declaration : undefined;
}

/** A module-scope declarator kept with the `const` flag its declaration had. */
interface ScopedDeclarator {
    declarator: VariableDeclaratorNode;
    isConst: boolean;
}

/**
 * Index every module-scope declarator by the name it binds.
 *
 * @param body - Program body.
 * @returns Binding name to its declarator.
 */
function moduleScopeDeclarators(body: OxcNode[]): Map<string, ScopedDeclarator> {
    const scope = new Map<string, ScopedDeclarator>();
    for (const statement of body) {
        const declaration = moduleScopeVariableDeclaration(statement);
        if (declaration === undefined) continue;
        const isConst = (declaration as unknown as { kind?: string }).kind === 'const';
        for (const declarator of (declaration as unknown as VariableDeclarationNode).declarations) {
            if (declarator.id?.type !== 'Identifier' || declarator.id.name === undefined) continue;
            scope.set(declarator.id.name, { declarator, isConst });
        }
    }
    return scope;
}

/**
 * Read one `export { local as exported }` clause into a registry entry.
 *
 * The entry is filed under the EXPORTED name, because that is the name an
 * importer writes and therefore the one the registry is looked up by. Filing
 * the local name would put the entry where no consumer can find it.
 *
 * @param specifier - One specifier of a source-less export list.
 * @param scope - Module-scope declarators, by binding name.
 * @returns The entry to record, or null when the clause does not qualify.
 */
function readExportSpecifier(
    specifier: OxcNode,
    scope: ReadonlyMap<string, ScopedDeclarator>,
): CrossModuleRegistryEntry | null {
    const shaped = specifier as unknown as {
        exportKind?: string;
        local?: { type: string; name?: string };
        exported?: { type: string; name?: string };
    };
    if (shaped.exportKind === 'type') return null;
    // A string export name is legal but is not a name any importer of a token
    // module writes, and recording one would key the registry by a value the
    // consumer never asks for.
    if (shaped.local?.type !== 'Identifier' || shaped.exported?.type !== 'Identifier') return null;
    const local = shaped.local.name;
    const exported = shaped.exported.name;
    /* v8 ignore next -- narrowing only: an oxc Identifier always carries a
       name, and the check above already established both nodes are one. */
    if (local === undefined || exported === undefined) return null;
    // Absent from module scope means the name is imported, declared in a block,
    // or not declared here at all. Each of those has its value somewhere this
    // extractor has not read, so there is nothing to answer with.
    const scoped = scope.get(local);
    if (scoped === undefined) return null;
    const entry = readCrossModuleDeclarator(scoped.declarator, scoped.isConst);
    return entry === null ? null : { ...entry, exportName: exported };
}

/** The registry key a default export is filed under. */
const DEFAULT_EXPORT_NAME = 'default';

/**
 * Read `export default <expression>` into a registry entry.
 *
 * The expression is adapted into the declarator shape the one reader takes,
 * rather than given a reader of its own: a second predicate here is how the
 * default slot would end up qualifying values the named forms refuse, or the
 * reverse.
 *
 * `isConst` is passed as true, and that is not a shortcut. `export default`
 * introduces no name to assign to, so the module cannot rebind it after an
 * importer has been compiled against the value — the live-binding hazard that
 * keeps `export let` out does not exist here.
 *
 * @param statement - The `ExportDefaultDeclaration` node.
 * @returns The entry to record, or null when the export does not qualify.
 */
function readDefaultExport(statement: OxcNode): CrossModuleRegistryEntry | null {
    const declaration = (statement as unknown as { declaration?: OxcNode }).declaration;
    /* v8 ignore next -- narrowing only: the caller reaches here solely for an
       ExportDefaultDeclaration, which always carries a declaration. */
    if (declaration === undefined) return null;
    const entry = readCrossModuleDeclarator(
        {
            id: { type: 'Identifier', name: DEFAULT_EXPORT_NAME },
            init: declaration,
        },
        true,
    );
    return entry === null ? null : { ...entry, exportName: DEFAULT_EXPORT_NAME };
}

/**
 * Extract every exported szv factory and static sz object from one module, for
 * the bundler's cross-module registry.
 *
 * Both spellings of an export are read: the declaration form
 * `export const X = …` and the list form `const X = …; export { X }`. They are
 * one declaration and one value with different punctuation, and reading only
 * the first made a style qualify by the author's house style with nothing in
 * the output to say which rule had applied.
 *
 * @param source - Module source text.
 * @param filename - Module filename, for parser dialect detection.
 * @returns The exported values, declaration order preserved.
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
    const scope = moduleScopeDeclarators(program.body);
    return program.body.flatMap(statement => readExportStatement(statement, scope));
}

/**
 * Read every registry entry one top-level statement contributes.
 *
 * Split from the walk above so each export SHAPE is read in one place rather
 * than as another arm of a loop that already carries the parse, the scope and
 * the accumulator.
 *
 * @param statement - One statement from the program body.
 * @param scope - Module-scope declarators, by binding name.
 * @returns The entries this statement contributes, possibly none.
 */
function readExportStatement(
    statement: OxcNode,
    scope: ReadonlyMap<string, ScopedDeclarator>,
): CrossModuleRegistryEntry[] {
    if (statement.type === 'ExportDefaultDeclaration') {
        return asEntries(readDefaultExport(statement));
    }
    if (statement.type !== 'ExportNamedDeclaration') {
        return [];
    }
    const shaped = statement as unknown as {
        exportKind?: string;
        source?: OxcNode | null;
        declaration?: OxcNode;
        specifiers?: OxcNode[];
    };
    // A type-only export carries no runtime value, and `export { X } from
    // './y'` names a binding in the PROVIDER module this extractor has not
    // read — matching that specifier against the local scope would record
    // whatever happened to share the name.
    if (shaped.exportKind === 'type' || shaped.source != null) {
        return [];
    }
    if (shaped.declaration?.type === 'VariableDeclaration') {
        return readExportedDeclaration(shaped.declaration);
    }
    /* v8 ignore next -- narrowing only: oxc always supplies the array, empty
       for `export {}`; the fallback exists so a shape change cannot throw. */
    return (shaped.specifiers ?? []).flatMap(specifier =>
        asEntries(readExportSpecifier(specifier, scope)),
    );
}

/**
 * Read every declarator of an exported variable declaration.
 *
 * @param declaration - The `VariableDeclaration` an export carried.
 * @returns The entries its declarators contribute.
 */
function readExportedDeclaration(declaration: OxcNode): CrossModuleRegistryEntry[] {
    const isConst = (declaration as unknown as { kind?: string }).kind === 'const';
    return (declaration as unknown as VariableDeclarationNode).declarations.flatMap(declarator =>
        asEntries(readCrossModuleDeclarator(declarator, isConst)),
    );
}

/**
 * Lift one optional entry into the list shape the readers compose in.
 *
 * @param entry - A read result, or null when the export did not qualify.
 * @returns A one-element list, or an empty one.
 */
function asEntries(entry: CrossModuleRegistryEntry | null): CrossModuleRegistryEntry[] {
    return entry === null ? [] : [entry];
}

/** The provider name standing for a module's default slot. */
const DEFAULT_IMPORT_NAME = 'default';

/** Where one imported local binding came from. */
interface ImportedBinding {
    /** Provider specifier as written, or undefined for a namespace binding. */
    specifier: string | undefined;
    /** Name in the provider; `default` for a default import. */
    importedName: string;
}

/**
 * Index every module-scope binding introduced by an import.
 *
 * A namespace binding is indexed with no specifier rather than left out: the
 * name IS bound, so omitting it would let a later reader mistake it for a name
 * this module declares. Recorded as unforwardable, it refuses instead.
 *
 * @param body - Program body.
 * @returns Local binding name to where it came from.
 */
function importedBindings(body: OxcNode[]): Map<string, ImportedBinding> {
    const bindings = new Map<string, ImportedBinding>();
    for (const statement of body) {
        if (statement.type !== 'ImportDeclaration') continue;
        const shaped = statement as unknown as {
            importKind?: string;
            source?: { value?: unknown };
            specifiers?: OxcNode[];
        };
        if (shaped.importKind === 'type') continue;
        const specifier = shaped.source?.value;
        if (typeof specifier !== 'string') continue;
        for (const raw of shaped.specifiers ?? []) {
            readImportSpecifier(raw, specifier, bindings);
        }
    }
    return bindings;
}

/**
 * Record one import specifier as a local binding.
 *
 * @param raw - One specifier of an import declaration.
 * @param specifier - Provider specifier as written.
 * @param bindings - Index being built.
 */
function readImportSpecifier(
    raw: OxcNode,
    specifier: string,
    bindings: Map<string, ImportedBinding>,
): void {
    const shaped = raw as unknown as {
        importKind?: string;
        imported?: { type: string; name?: string };
        local?: { type: string; name?: string };
    };
    const local = shaped.local?.name;
    if (shaped.local?.type !== 'Identifier' || local === undefined) return;
    if (raw.type === 'ImportNamespaceSpecifier') {
        bindings.set(local, { specifier: undefined, importedName: local });
        return;
    }
    if (raw.type === 'ImportDefaultSpecifier') {
        bindings.set(local, { specifier, importedName: DEFAULT_IMPORT_NAME });
        return;
    }
    if (raw.type !== 'ImportSpecifier' || shaped.importKind === 'type') return;
    // A string import name is legal syntax but is not a name a token module is
    // written with, and it cannot be spelled by the export list that would
    // forward it either.
    if (shaped.imported?.type !== 'Identifier' || shaped.imported.name === undefined) return;
    bindings.set(local, { specifier, importedName: shaped.imported.name });
}

/**
 * Read the two identifier names one export clause carries.
 *
 * @param specifier - One specifier of an export list.
 * @returns Local and exported names, or null when either is not an identifier.
 */
function exportClauseNames(specifier: OxcNode): { local: string; exported: string } | null {
    const shaped = specifier as unknown as {
        exportKind?: string;
        local?: { type: string; name?: string };
        exported?: { type: string; name?: string };
    };
    if (shaped.exportKind === 'type') return null;
    if (shaped.local?.type !== 'Identifier' || shaped.exported?.type !== 'Identifier') return null;
    const local = shaped.local.name;
    const exported = shaped.exported.name;
    /* v8 ignore next -- narrowing only: an oxc Identifier always carries a name. */
    if (local === undefined || exported === undefined) return null;
    return { local, exported };
}

/**
 * Read the forwards one top-level statement contributes.
 *
 * Two shapes, one meaning. `export { X } from './y'` names the provider on the
 * statement itself. `import { X } from './y'; export { X }` splits the same
 * promise across two statements, and the second one alone says nothing — which
 * is why the import index is built first.
 *
 * @param statement - One statement from the program body.
 * @param declared - Names this module declares at module scope.
 * @param imports - Local bindings introduced by imports.
 * @returns The forwards this statement contributes, possibly none.
 */
function readStatementForwards(
    statement: OxcNode,
    declared: ReadonlySet<string>,
    imports: ReadonlyMap<string, ImportedBinding>,
): CrossModuleForward[] {
    if (statement.type !== 'ExportNamedDeclaration') return [];
    const shaped = statement as unknown as {
        exportKind?: string;
        source?: { value?: unknown } | null;
        declaration?: OxcNode;
        specifiers?: OxcNode[];
    };
    // A declaration form declares the value here, so the value extractor owns
    // it; a type-only export carries nothing at runtime.
    if (shaped.exportKind === 'type' || shaped.declaration != null) return [];
    const from = shaped.source?.value;
    const fromSpecifier = typeof from === 'string' ? from : undefined;
    const forwards: CrossModuleForward[] = [];
    /* v8 ignore next -- narrowing only: oxc always supplies the array. */
    for (const raw of shaped.specifiers ?? []) {
        const names = exportClauseNames(raw);
        if (names === null) continue;
        if (fromSpecifier !== undefined) {
            // On a `from` clause the LOCAL name is the provider's, not this
            // module's — there is no local binding to shadow it.
            forwards.push({
                exportName: names.exported,
                importedName: names.local,
                specifier: fromSpecifier,
            });
            continue;
        }
        // A name this module declares has a readable value, and recording a
        // link as well would give the resolver two answers for one name.
        if (declared.has(names.local)) continue;
        const binding = imports.get(names.local);
        if (binding?.specifier === undefined) continue;
        forwards.push({
            exportName: names.exported,
            importedName: binding.importedName,
            specifier: binding.specifier,
        });
    }
    return forwards;
}

/**
 * Extract every re-exported name in one module, with the module it points at.
 *
 * Separate from {@link extractCrossModuleRegistryEntries} because the answers
 * are different in kind: that one returns values a consumer can compile, this
 * one returns links a later pass must still follow. Merging them would put an
 * entry with no value into the registry, which every consumer would have to
 * learn to refuse.
 *
 * `export *` is deliberately absent. It carries no export name, so it cannot be
 * filed under one — answering it needs the provider's whole export list, which
 * is a different question from following one link.
 *
 * @param source - Module source text.
 * @param filename - Module filename, for parser dialect detection.
 * @returns The forwards, declaration order preserved.
 */
export function extractCrossModuleForwards(source: string, filename: string): CrossModuleForward[] {
    if (!source.includes('export') || !source.includes('from')) return [];
    let program: { body: OxcNode[] };
    try {
        program = parseSync(filename, source, { lang: 'tsx' }).program as unknown as {
            body: OxcNode[];
        };
    } catch {
        /* v8 ignore next -- oxc reports syntax errors in-band; only native/parser failures throw. */
        return [];
    }
    const declared = new Set(moduleScopeDeclarators(program.body).keys());
    const imports = importedBindings(program.body);
    return program.body.flatMap(statement => readStatementForwards(statement, declared, imports));
}
