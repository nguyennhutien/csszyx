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
import {
    type EcmaScriptModule,
    type ExportExportName,
    type ExportImportName,
    type ParserOptions,
    parseSync,
    rawTransferSupported,
} from 'oxc-parser';

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
    const names = exportClauseNames(specifier);
    if (names === null) return null;
    // Absent from module scope means the name is imported, declared in a block,
    // or not declared here at all. Each of those has its value somewhere this
    // extractor has not read, so there is nothing to answer with.
    const scoped = scope.get(names.local);
    if (scoped === undefined) return null;
    const entry = readCrossModuleDeclarator(scoped.declarator, scoped.isConst);
    return entry === null ? null : { ...entry, exportName: names.exported };
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
        program = parseProgram(filename, source);
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
    // A string export name is legal but is not a name any importer of a token
    // module writes, and recording one would key the registry by a value the
    // consumer never asks for.
    if (shaped.local?.type !== 'Identifier' || shaped.exported?.type !== 'Identifier') return null;
    const local = shaped.local.name;
    const exported = shaped.exported.name;
    /* v8 ignore next -- narrowing only: an oxc Identifier always carries a name. */
    if (local === undefined || exported === undefined) return null;
    return { local, exported };
}

/**
 * Whether the text holds an `export {` clause - the one shape a forward can
 * take, with or without `from`.
 *
 * The gate before the parse. Its predecessor admitted any module containing
 * both the words `export` and `from`, which is nearly every TypeScript module
 * (an import supplies the `from`), so a build over 18 000 files spent 8.9 s
 * parsing modules that declared every value they exported. A clause is what
 * the parse can find: `export function`, `export const`, `export default`
 * declare their value here, and `export *` names nothing.
 *
 * Whitespace and comments may sit between the keyword and the brace, so a
 * plain substring search is not enough; the scan skips both. A false positive
 * (the text inside a string or comment) only costs a parse; the scan never
 * refuses a real clause.
 *
 * @param source - Module source text.
 * @returns True when an `export` keyword is followed by `{`.
 */
function hasExportClause(source: string): boolean {
    let cursor = source.indexOf('export');
    while (cursor !== -1) {
        const position = skipTrivia(source, cursor + 'export'.length);
        if (source[position] === '{') return true;
        // Resume past what was scanned, so a comment is never read twice.
        cursor = source.indexOf('export', Math.max(position, cursor + 1));
    }
    return false;
}

/**
 * Skip whitespace and comments.
 *
 * @param source - Module source text.
 * @param start - Where to start.
 * @returns The first offset at or after `start` holding neither.
 */
function skipTrivia(source: string, start: number): number {
    let position = start;
    for (;;) {
        while (position < source.length && /\s/.test(source[position] as string)) position++;
        if (source.startsWith('/*', position)) {
            const close = source.indexOf('*/', position + 2);
            position = close === -1 ? source.length : close + 2;
            continue;
        }
        if (source.startsWith('//', position)) {
            const newline = source.indexOf('\n', position + 2);
            position = newline === -1 ? source.length : newline + 1;
            continue;
        }
        return position;
    }
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
    if (!hasExportClause(source)) return [];
    let module: EcmaScriptModule;
    try {
        // The module record, not the AST: oxc computes it while parsing and
        // hands it over without materialising the tree, and it already links
        // `import { X } from './y'; export { X }` to `./y` the way the two-
        // statement walk here used to.
        module = parseSync(filename, source, { lang: 'tsx' }).module;
    } catch {
        /* v8 ignore next -- oxc reports syntax errors in-band; only native/parser failures throw. */
        return [];
    }
    const defaultImports = defaultImportBindings(module);
    const forwards: CrossModuleForward[] = [];
    for (const statement of module.staticExports) {
        for (const entry of statement.entries) {
            // A type-only export carries nothing at runtime; an entry with no
            // module request is a value this module declares, which the value
            // extractor owns.
            if (entry.isType || entry.moduleRequest === null) continue;
            const specifier = entry.moduleRequest.value;
            const exportName = recordedName(entry.exportName);
            const importedName = recordedName(entry.importName);
            if (exportName === null || importedName === null) continue;
            forwards.push({
                exportName,
                // The record spells a re-exported default import by its LOCAL
                // name; the provider exports it as `default`, and that is the
                // name a resolver must look up.
                importedName: defaultImports.has(bindingKey(specifier, importedName))
                    ? DEFAULT_IMPORT_NAME
                    : importedName,
                specifier,
            });
        }
    }
    return forwards;
}

/**
 * The local names bound by default imports, keyed with their provider.
 *
 * @param module - The module record.
 * @returns Keys for every `import X from './p'` binding.
 */
function defaultImportBindings(module: EcmaScriptModule): Set<string> {
    const keys = new Set<string>();
    for (const statement of module.staticImports) {
        for (const entry of statement.entries) {
            if (entry.importName.kind === 'Default' && !entry.isType) {
                keys.add(bindingKey(statement.moduleRequest.value, entry.localName.value));
            }
        }
    }
    return keys;
}

/**
 * One key for a binding and the module it came from.
 *
 * @param specifier - Provider specifier as written.
 * @param local - Local binding name.
 * @returns The key.
 */
function bindingKey(specifier: string, local: string): string {
    return `${specifier}\0${local}`;
}

/**
 * The identifier a module-record name stands for, or null when a forward
 * cannot carry it.
 *
 * A namespace (`All`, `AllButDefault`) names no single binding, and a
 * string-literal name is legal syntax that no importer of a token module
 * writes, so recording one would key the registry by a value the consumer
 * never asks for.
 *
 * @param name - An import or export name from the module record.
 * @returns The name a forward records, or null.
 */
function recordedName(name: ExportExportName | ExportImportName): string | null {
    // `default` arrives as a `Name` entry spelled "default", so only the
    // namespace kinds (`All`, `AllButDefault`) and `None` are refused here.
    if (name.kind !== 'Name') return null;
    const value = name.name;
    /* v8 ignore next -- narrowing only: a `Name` entry always carries its name. */
    if (value === null) return null;
    return IDENTIFIER_NAME.test(value) ? value : null;
}

/** An ECMAScript identifier, which is what a string-literal export name is not. */
const IDENTIFIER_NAME = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*$/u;

/**
 * Whether the parser can hand the AST over as a buffer on this host.
 *
 * Decided once. The probe is read defensively because the binding that loads
 * in a webcontainer is a different module that need not export it, and a
 * missing probe must mean "use the JSON form", not a TypeError in the walk.
 */
const RAW_TRANSFER_SUPPORTED: boolean =
    typeof rawTransferSupported === 'function' && rawTransferSupported();

/**
 * Parser options asking for the raw transfer. The flag is read by oxc-parser
 * 0.140 at runtime but absent from its typings, hence the widened type.
 */
const RAW_TRANSFER_OPTIONS: ParserOptions & { experimentalRawTransfer: boolean } = {
    lang: 'tsx',
    experimentalRawTransfer: true,
};

/**
 * Parse one module and return its program, through the raw transfer when the
 * host has it and the JSON form otherwise.
 *
 * The raw transfer costs a quarter of the JSON form (54 against 215
 * microseconds per file, measured on the vui corpus) and yields the same tree
 * for every shape this extractor reads. It is still an experimental flag: a
 * parse that throws under it is retried through the JSON form before the
 * caller hears anything, so a host the probe misjudged costs a slow parse,
 * not a broken build.
 *
 * @param filename - Module filename, for parser dialect detection.
 * @param source - Module source text.
 * @returns The program, whose body the extractors walk.
 */
function parseProgram(filename: string, source: string): { body: OxcNode[] } {
    if (RAW_TRANSFER_SUPPORTED) {
        try {
            return parseSync(filename, source, RAW_TRANSFER_OPTIONS).program as unknown as {
                body: OxcNode[];
            };
        } catch {
            // Fall through to the form every host has.
        }
    }
    return parseSync(filename, source, { lang: 'tsx' }).program as unknown as { body: OxcNode[] };
}
