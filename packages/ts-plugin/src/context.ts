import {
    classifyStyleChain,
    type ObjectFormMember,
    type ObjectValueForm,
    objectValueForm,
    szvStyleChain,
} from '@csszyx/tooling-metadata';
import type ts from 'typescript/lib/tsserverlibrary';

const SZ_JSX_ATTRS = new Set(['sz', 'szs']);
const CSSZYX_MODULES = new Set(['csszyx', '@csszyx/runtime']);
const MAX_ANCESTOR_DEPTH = 64;
/** Sibling-collection cap: past it, exclusion is partial, never a rejection. */
const MAX_SIBLINGS = 256;

/** How an anchored object should be assisted: a plain style object, or a
 * structured object-value form limited to its members. */
interface StyleResolution {
    readonly form: ObjectValueForm | null;
}

/** Proven cursor context and syntax-safe replacement range. */
export type SzContext =
    | {
          readonly kind: 'key';
          readonly replacementSpan: ts.TextSpan;
          /** Keys already assigned in the enclosing object (bounded, may be partial). */
          readonly siblings: readonly string[];
          /** When set, the object accepts ONLY this form's members (e.g. the
           * `{ color, op }` value of a color property). */
          readonly form?: ObjectValueForm;
      }
    | {
          readonly kind: 'value';
          readonly property: string;
          readonly quoted: boolean;
          readonly replacementSpan: ts.TextSpan;
          /** When set, the property is a structured-form member and these are
           * its curated values. */
          readonly member?: ObjectFormMember;
      };

/** Collect the completed sibling keys of an object literal.
 * @param tsMod - TypeScript instance injected by the host.
 * @param object - Enclosing object literal.
 * @param position - Cursor offset; the property whose NAME contains it is the
 * key being typed/edited and must never exclude itself.
 * @returns Statically named keys, capped at MAX_SIBLINGS (partial past the cap).
 */
function siblingKeys(
    tsMod: typeof ts,
    object: ts.ObjectLiteralExpression,
    position: number,
): string[] {
    const names: string[] = [];
    for (const property of object.properties.slice(0, MAX_SIBLINGS)) {
        const nameNode = property.name;
        if (nameNode && position >= nameNode.getStart() && position <= nameNode.getEnd()) {
            continue;
        }
        if (tsMod.isPropertyAssignment(property)) {
            const name = propertyName(tsMod, property);
            if (name !== undefined) names.push(name);
        } else if (tsMod.isShorthandPropertyAssignment(property)) {
            names.push(property.name.text);
        }
        // Spreads and computed names are invisible statically: fail open.
    }
    return names;
}

/** Scan a bounded completion prefix around the cursor.
 * @param text - Source text.
 * @param position - UTF-16 cursor offset.
 * @param allowHyphen - Whether Tailwind-style hyphens are accepted.
 * @returns A replacement span capped to 256 code units in either direction.
 */
function replacementSpan(text: string, position: number, allowHyphen: boolean): ts.TextSpan {
    const isPart = (character: string): boolean =>
        /[\w$]/.test(character) || (allowHyphen && character === '-');
    let start = position;
    let end = position;
    for (let count = 0; start > 0 && count < 256 && isPart(text[start - 1] ?? ''); count += 1)
        start -= 1;
    for (let count = 0; end < text.length && count < 256 && isPart(text[end] ?? ''); count += 1)
        end += 1;
    return { start, length: end - start };
}

/**
 * Isolated compatibility adapter: public typings do not expose this stable scanner helper.
 * @param tsMod - TypeScript instance injected by the host.
 * @param sourceFile - Parsed source file.
 * @param position - UTF-16 cursor offset.
 * @returns The containing token, or undefined when the host lacks the helper.
 */
function tokenAtPosition(
    tsMod: typeof ts,
    sourceFile: ts.SourceFile,
    position: number,
): ts.Node | undefined {
    const compat = tsMod as typeof ts & {
        getTokenAtPosition?: (file: ts.SourceFile, position: number) => ts.Node;
        findPrecedingToken?: (position: number, file: ts.SourceFile) => ts.Node | undefined;
    };
    if (!compat.getTokenAtPosition) {
        // No whole-file fallback: an unsupported host loses csszyx completions but
        // retains the untouched TypeScript service.
        return undefined;
    }
    const token = compat.getTokenAtPosition(sourceFile, Math.max(0, position));
    if (token.kind === tsMod.SyntaxKind.EndOfFileToken) {
        // Unclosed syntax at end of file parks the cursor on the EOF token, whose
        // ancestry skips the recovered object literal the user is typing in.
        return compat.findPrecedingToken?.(position, sourceFile) ?? token;
    }
    return token;
}

/** Read a static property name without evaluating computed syntax.
 * @param tsMod - TypeScript instance injected by the host.
 * @param property - Property assignment to inspect.
 * @returns The static name, or undefined for computed syntax.
 */
function propertyName(tsMod: typeof ts, property: ts.PropertyAssignment): string | undefined {
    const name = property.name;
    if (tsMod.isIdentifier(name) || tsMod.isStringLiteral(name) || tsMod.isNumericLiteral(name)) {
        return name.text;
    }
    return undefined;
}

/** Supported csszyx APIs that accept style-object calls. */
type CsszyxCallName = 'szv' | 'szr';

/** Whether a checker lookup was authoritative and which API it proved. */
interface CallLookup {
    readonly resolved: boolean;
    readonly name?: CsszyxCallName;
}

/** Find the import declaration owning a declaration node.
 * @param tsMod - TypeScript instance injected by the host.
 * @param declaration - Declaration whose ancestry should be inspected.
 * @returns The owning csszyx import, or undefined.
 */
function csszyxImport(
    tsMod: typeof ts,
    declaration: ts.Declaration,
): ts.ImportDeclaration | undefined {
    let current: ts.Node | undefined = declaration;
    while (current && !tsMod.isImportDeclaration(current)) current = current.parent;
    if (!current || !tsMod.isStringLiteral(current.moduleSpecifier)) return undefined;
    return CSSZYX_MODULES.has(current.moduleSpecifier.text) ? current : undefined;
}

/** Normalize a supported API spelling.
 * @param name - Candidate imported or accessed name.
 * @returns A supported csszyx call name, or undefined.
 */
function supportedCallName(name: string | undefined): CsszyxCallName | undefined {
    return name === 'szv' || name === 'szr' ? name : undefined;
}

/** Resolve a property-access receiver when its symbol is authoritative.
 * @param tsMod - TypeScript instance injected by the host.
 * @param call - Candidate property-access call.
 * @param checker - Current program type checker.
 * @param shouldStop - Cooperative deadline and cancellation check.
 * @returns Whether the receiver resolved, plus a proven API name when applicable.
 */
function namespaceCallLookup(
    tsMod: typeof ts,
    call: ts.CallExpression,
    checker: ts.TypeChecker,
    shouldStop: () => boolean,
): CallLookup {
    if (!tsMod.isPropertyAccessExpression(call.expression)) return { resolved: false };
    const receiver = checker.getSymbolAtLocation(call.expression.expression);
    if (!receiver) return { resolved: false };
    for (const declaration of (receiver.declarations ?? []).slice(0, 64)) {
        if (shouldStop()) return { resolved: true };
        if (!tsMod.isNamespaceImport(declaration) || !csszyxImport(tsMod, declaration)) continue;
        return { resolved: true, name: supportedCallName(call.expression.name.text) };
    }
    return { resolved: true };
}

/** Resolve the called symbol through a named csszyx import.
 * @param tsMod - TypeScript instance injected by the host.
 * @param sourceFile - Source containing the call.
 * @param call - Candidate call expression.
 * @param checker - Current program type checker.
 * @param shouldStop - Cooperative deadline and cancellation check.
 * @returns Whether the called symbol resolved, plus its imported API name.
 */
function namedCallLookup(
    tsMod: typeof ts,
    sourceFile: ts.SourceFile,
    call: ts.CallExpression,
    checker: ts.TypeChecker,
    shouldStop: () => boolean,
): CallLookup {
    const calledName = tsMod.isPropertyAccessExpression(call.expression)
        ? call.expression.name
        : call.expression;
    const symbol = checker.getSymbolAtLocation(calledName);
    if (!symbol) return { resolved: false };
    for (const declaration of (symbol.declarations ?? []).slice(0, 64)) {
        if (shouldStop()) return { resolved: true };
        if (!csszyxImport(tsMod, declaration)) continue;
        if (tsMod.isIdentifier(call.expression)) {
            const imported = tsMod.isImportSpecifier(declaration)
                ? (declaration.propertyName?.text ?? declaration.name.text)
                : undefined;
            return { resolved: true, name: supportedCallName(imported) };
        }
        return { resolved: true, name: supportedCallName(calledName.getText(sourceFile)) };
    }
    return { resolved: true };
}

/** Bounded csszyx import spellings used when the checker is incomplete. */
interface FallbackImports {
    readonly named: ReadonlyMap<string, string>;
    readonly namespaces: ReadonlySet<string>;
}

/** Record one csszyx import in the incomplete-code fallback index.
 * @param tsMod - TypeScript instance injected by the host.
 * @param statement - Candidate source statement.
 * @param named - Mutable named-import index.
 * @param namespaces - Mutable namespace-import index.
 * @param shouldStop - Cooperative deadline and cancellation check.
 * @returns False when cancellation interrupts the scan.
 */
function recordFallbackImport(
    tsMod: typeof ts,
    statement: ts.Statement,
    named: Map<string, string>,
    namespaces: Set<string>,
    shouldStop: () => boolean,
): boolean {
    if (!tsMod.isImportDeclaration(statement) || !tsMod.isStringLiteral(statement.moduleSpecifier))
        return true;
    if (!CSSZYX_MODULES.has(statement.moduleSpecifier.text)) return true;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) return true;
    if (tsMod.isNamespaceImport(bindings)) {
        namespaces.add(bindings.name.text);
        return true;
    }
    for (const specifier of bindings.elements.slice(0, 256)) {
        if (shouldStop()) return false;
        named.set(specifier.name.text, specifier.propertyName?.text ?? specifier.name.text);
    }
    return true;
}

/** Collect bounded import spellings for incomplete-code fallback.
 * @param tsMod - TypeScript instance injected by the host.
 * @param sourceFile - Source whose imports should be scanned.
 * @param shouldStop - Cooperative deadline and cancellation check.
 * @returns Import spellings, or undefined when the scan is cancelled.
 */
function fallbackImports(
    tsMod: typeof ts,
    sourceFile: ts.SourceFile,
    shouldStop: () => boolean,
): FallbackImports | undefined {
    const named = new Map<string, string>();
    const namespaces = new Set<string>();
    for (const statement of sourceFile.statements.slice(0, 2_048)) {
        if (shouldStop()) return undefined;
        if (!recordFallbackImport(tsMod, statement, named, namespaces, shouldStop))
            return undefined;
    }
    return { named, namespaces };
}

/** Resolve an unresolved call by bounded import spelling.
 * @param tsMod - TypeScript instance injected by the host.
 * @param call - Candidate call expression.
 * @param imports - Previously collected fallback imports.
 * @returns A supported csszyx API name, or undefined.
 */
function fallbackCallName(
    tsMod: typeof ts,
    call: ts.CallExpression,
    imports: FallbackImports,
): CsszyxCallName | undefined {
    const expression = call.expression;
    if (tsMod.isIdentifier(expression)) {
        return supportedCallName(imports.named.get(expression.text));
    }
    if (!tsMod.isPropertyAccessExpression(expression)) return undefined;
    if (!tsMod.isIdentifier(expression.expression)) return undefined;
    if (!imports.namespaces.has(expression.expression.text)) return undefined;
    return supportedCallName(expression.name.text);
}

/** Resolve a call to a proven csszyx import, with an incomplete-code fallback.
 * @param tsMod - TypeScript instance injected by the host.
 * @param sourceFile - Source containing the call.
 * @param call - Candidate call expression.
 * @param checker - Current program type checker.
 * @param shouldStop - Cooperative deadline and cancellation check.
 * @returns The csszyx API name, or undefined for local/unrelated symbols.
 */
function csszyxCallName(
    tsMod: typeof ts,
    sourceFile: ts.SourceFile,
    call: ts.CallExpression,
    checker: ts.TypeChecker,
    shouldStop: () => boolean,
): CsszyxCallName | undefined {
    const namespace = namespaceCallLookup(tsMod, call, checker, shouldStop);
    if (namespace.resolved) return namespace.name;
    const named = namedCallLookup(tsMod, sourceFile, call, checker, shouldStop);
    if (named.resolved) return named.name;
    const imports = fallbackImports(tsMod, sourceFile, shouldStop);
    return imports ? fallbackCallName(tsMod, call, imports) : undefined;
}

/** Resolve the JSX attribute reached from an object ancestry walk.
 * @param tsMod - TypeScript instance injected by the host.
 * @param attribute - Owning JSX attribute.
 * @param chain - Inner-to-outer property names.
 * @param nested - Whether the candidate is nested below the attribute value.
 * @returns The style resolution, or null for unsupported JSX surfaces.
 */
function jsxAttributeAnchor(
    tsMod: typeof ts,
    attribute: ts.JsxAttribute,
    chain: readonly string[],
    nested: boolean,
): StyleResolution | null {
    const name = attribute.name;
    if (!tsMod.isIdentifier(name) || !SZ_JSX_ATTRS.has(name.text)) return null;
    if (name.text === 'sz') return resolveChain(chain);
    if (!nested) return null;
    const opening = attribute.parent.parent;
    if (!tsMod.isJsxOpeningElement(opening) && !tsMod.isJsxSelfClosingElement(opening)) return null;
    if (/^[a-z]/.test(opening.tagName.getText())) return null;
    return resolveChain(chain.slice(0, -1));
}

/** Append one required static property to a JSX ancestry chain.
 * @param tsMod - TypeScript instance injected by the host.
 * @param property - Property crossed by the ancestry walk.
 * @param chain - Mutable inner-to-outer property chain.
 * @returns Whether the property has a usable static name.
 */
function appendJsxProperty(
    tsMod: typeof ts,
    property: ts.PropertyAssignment,
    chain: string[],
): boolean {
    const name = propertyName(tsMod, property);
    if (name === undefined) return false;
    chain.push(name);
    return true;
}

/** One step of the JSX ancestry walk. */
type AncestryStep = 'ascend' | 'ascend-nested' | 'invalid' | 'stop';

/** Classify how the ancestry walk crosses one parent node.
 * @param tsMod - TypeScript instance injected by the host.
 * @param parent - Parent node the walk is about to cross.
 * @param chain - Mutable inner-to-outer property chain.
 * @returns Whether to ascend (marking nesting), reject, or end the walk.
 */
function classifyJsxAncestryStep(tsMod: typeof ts, parent: ts.Node, chain: string[]): AncestryStep {
    if (tsMod.isPropertyAssignment(parent)) {
        return appendJsxProperty(tsMod, parent, chain) ? 'ascend-nested' : 'invalid';
    }
    if (tsMod.isObjectLiteralExpression(parent)) return 'ascend';
    if (tsMod.isArrayLiteralExpression(parent)) return 'ascend-nested';
    if (tsMod.isParenthesizedExpression(parent) || tsMod.isConditionalExpression(parent)) {
        return 'ascend';
    }
    return 'stop';
}

/** Classify JSX sz and slot-level szs ancestry.
 * @param tsMod - TypeScript instance injected by the host.
 * @param object - Candidate object literal.
 * @returns The style resolution, or null when not an assistable JSX surface.
 */
function jsxAnchor(tsMod: typeof ts, object: ts.ObjectLiteralExpression): StyleResolution | null {
    // Inner-to-outer property names between the candidate object and the
    // attribute: nesting under a utility property is invalid — except a COLOR
    // property owning its `{ color, op }` value object.
    const chain: string[] = [];
    let node: ts.Node = object;
    let nested = false;
    for (let depth = 0; node.parent && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
        const parent = node.parent;
        if (tsMod.isJsxExpression(parent) && tsMod.isJsxAttribute(parent.parent)) {
            return jsxAttributeAnchor(tsMod, parent.parent, chain, nested);
        }
        const step = classifyJsxAncestryStep(tsMod, parent, chain);
        if (step === 'invalid') return null;
        if (step === 'stop') break;
        if (step === 'ascend-nested') nested = true;
        node = parent;
    }
    return null;
}

/** Resolve a chain into an assistable anchor (invalid/opaque = no suggestions).
 * @param chainInnerFirst - Owner-name chain from the cursor's object outward.
 * @returns The resolution, or null when the structure gets no suggestions.
 */
function resolveChain(chainInnerFirst: readonly string[]): StyleResolution | null {
    const kind = classifyStyleChain(chainInnerFirst);
    if (kind === 'style') return { form: null };
    if (kind === 'object-form') return { form: objectValueForm(chainInnerFirst[0] ?? '') };
    return null;
}

/** Resolve a proven szv/szr call reached by the ancestry walk.
 * @param tsMod - TypeScript instance injected by the host.
 * @param sourceFile - Source containing the call.
 * @param call - Owning call expression.
 * @param path - Inner-to-outer object property path.
 * @param getChecker - Lazy current-program type checker factory.
 * @param shouldStop - Cooperative deadline and cancellation check.
 * @returns The style resolution, or null for an unrelated call.
 */
function csszyxCallAnchor(
    tsMod: typeof ts,
    sourceFile: ts.SourceFile,
    call: ts.CallExpression,
    path: readonly string[],
    getChecker: () => ts.TypeChecker,
    shouldStop: () => boolean,
): StyleResolution | null {
    if (tsMod.isPropertyAccessExpression(call.expression)) {
        const accessed = supportedCallName(call.expression.name.text);
        if (!accessed) return null;
    }
    const callName = csszyxCallName(tsMod, sourceFile, call, getChecker(), shouldStop);
    if (callName === 'szr') return resolveChain(path);
    if (callName !== 'szv') return null;
    const outerFirst = [...path];
    outerFirst.reverse();
    const styleChain = szvStyleChain(outerFirst);
    if (styleChain === null) return null;
    const innerFirst = [...styleChain];
    innerFirst.reverse();
    return resolveChain(innerFirst);
}

/** Append one required static property to a call ancestry path.
 * @param tsMod - TypeScript instance injected by the host.
 * @param property - Property crossed by the ancestry walk.
 * @param path - Mutable inner-to-outer path.
 * @returns Whether the property has a usable static name.
 */
function appendCallProperty(
    tsMod: typeof ts,
    property: ts.PropertyAssignment,
    path: string[],
): boolean {
    const name = propertyName(tsMod, property);
    if (!name) return false;
    path.push(name);
    return true;
}

/** Whether a container or expression wrapper preserves call-object ancestry.
 * @param tsMod - TypeScript instance injected by the host.
 * @param node - Candidate wrapper node.
 * @returns True for syntax that does not change the represented object value.
 */
function isCallAnchorContainer(tsMod: typeof ts, node: ts.Node): boolean {
    return (
        tsMod.isObjectLiteralExpression(node) ||
        tsMod.isArrayLiteralExpression(node) ||
        tsMod.isParenthesizedExpression(node) ||
        tsMod.isAsExpression(node) ||
        tsMod.isSatisfiesExpression(node) ||
        tsMod.isConditionalExpression(node)
    );
}

/** Classify schema-aware szv/szr ancestry.
 * @param tsMod - TypeScript instance injected by the host.
 * @param sourceFile - Source containing the candidate.
 * @param object - Candidate object literal.
 * @param getChecker - Lazy current-program type checker factory.
 * @param shouldStop - Cooperative deadline and cancellation check.
 * @returns The style resolution, or null when not an assistable call surface.
 */
function callAnchor(
    tsMod: typeof ts,
    sourceFile: ts.SourceFile,
    object: ts.ObjectLiteralExpression,
    getChecker: () => ts.TypeChecker,
    shouldStop: () => boolean,
): StyleResolution | null {
    const path: string[] = [];
    let node: ts.Node = object;
    for (let depth = 0; node.parent && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
        if (shouldStop()) return null;
        const parent = node.parent;
        if (tsMod.isPropertyAssignment(parent)) {
            if (!appendCallProperty(tsMod, parent, path)) return null;
            node = parent;
            continue;
        }
        if (isCallAnchorContainer(tsMod, parent)) {
            node = parent;
            continue;
        }
        if (tsMod.isCallExpression(parent) && parent.arguments[0] === node) {
            return csszyxCallAnchor(tsMod, sourceFile, parent, path, getChecker, shouldStop);
        }
        return null;
    }
    return null;
}

/** Parsed object and optional value property containing the cursor. */
interface ObjectAtPosition {
    readonly object: ts.ObjectLiteralExpression;
    readonly valueProperty?: ts.PropertyAssignment;
}

/** Find the nearest object literal and value property containing the cursor.
 * @param tsMod - TypeScript instance injected by the host.
 * @param token - Token at the cursor.
 * @param position - UTF-16 cursor offset.
 * @param shouldStop - Cooperative deadline and cancellation check.
 * @returns The bounded object context, or null.
 */
function objectAtPosition(
    tsMod: typeof ts,
    token: ts.Node,
    position: number,
    shouldStop: () => boolean,
): ObjectAtPosition | null {
    let valueProperty: ts.PropertyAssignment | undefined;
    let current: ts.Node | undefined = token;
    for (let depth = 0; current && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
        if (shouldStop()) return null;
        if (
            tsMod.isPropertyAssignment(current) &&
            position >= current.initializer.getFullStart() &&
            position <= current.initializer.getEnd()
        ) {
            valueProperty = current;
        }
        if (tsMod.isObjectLiteralExpression(current)) return { object: current, valueProperty };
        current = current.parent;
    }
    return null;
}

/** Look up a structured-form member.
 * @param form - Structured object form, or null for a plain style object.
 * @param name - Property name at the cursor.
 * @returns The member, undefined for plain objects, or null for a rejected member.
 */
function formMember(
    form: ObjectValueForm | null,
    name: string,
): ObjectFormMember | null | undefined {
    if (form === null) return undefined;
    return form.members.find(candidate => candidate.name === name) ?? null;
}

/** Build a value context for a parsed property assignment.
 * @param tsMod - TypeScript instance injected by the host.
 * @param property - Property containing the cursor.
 * @param form - Resolved structured object form.
 * @param text - Full source text.
 * @param position - UTF-16 cursor offset.
 * @returns A value context, or null when the property is not assistable.
 */
function propertyValueContext(
    tsMod: typeof ts,
    property: ts.PropertyAssignment,
    form: ObjectValueForm | null,
    text: string,
    position: number,
): SzContext | null {
    const name = propertyName(tsMod, property);
    if (!name) return null;
    const member = formMember(form, name);
    if (member === null) return null;
    return {
        kind: 'value',
        property: name,
        quoted: tsMod.isStringLiteralLike(property.initializer),
        replacementSpan: replacementSpan(text, position, true),
        member,
    };
}

/** Find the start of the typed key/value prefix with a hard scan bound.
 * @param text - Full source text.
 * @param position - UTF-16 cursor offset.
 * @param objectStart - Lower scan boundary.
 * @returns Prefix start, or undefined when the prefix exceeds the bound.
 */
function cursorPrefixStart(
    text: string,
    position: number,
    objectStart: number,
): number | undefined {
    let start = position;
    for (
        let count = 0;
        start > objectStart && count < 256 && /[\w$-]/.test(text[start - 1] ?? '');
        count += 1
    ) {
        start -= 1;
    }
    return start > objectStart && /[\w$-]/.test(text[start - 1] ?? '') ? undefined : start;
}

/** Skip bounded whitespace before a cursor prefix.
 * @param text - Full source text.
 * @param prefixStart - Start of the typed prefix.
 * @param objectStart - Lower scan boundary.
 * @returns First non-space offset, or undefined when whitespace exceeds the bound.
 */
function beforeCursorPrefix(
    text: string,
    prefixStart: number,
    objectStart: number,
): number | undefined {
    let scan = prefixStart - 1;
    let count = 0;
    while (scan > objectStart && count < 256 && /\s/.test(text[scan] ?? '')) {
        scan -= 1;
        count += 1;
    }
    return count === 256 ? undefined : scan;
}

/** Read the bounded identifier immediately before a value colon.
 * @param text - Full source text.
 * @param colon - Colon offset.
 * @param objectStart - Lower scan boundary.
 * @returns Candidate property name, or undefined when spacing is unbounded.
 */
function nameBeforeColon(text: string, colon: number, objectStart: number): string | undefined {
    let end = colon;
    let whitespace = 0;
    while (end > objectStart && whitespace < 256 && /\s/.test(text[end - 1] ?? '')) {
        end -= 1;
        whitespace += 1;
    }
    if (whitespace === 256) return undefined;
    let start = end;
    for (
        let count = 0;
        start > objectStart && count < 256 && /[\w$]/.test(text[start - 1] ?? '');
        count += 1
    ) {
        start -= 1;
    }
    return text.slice(start, end);
}

/** Classify an incomplete key or value slot from bounded source text.
 * @param tsMod - TypeScript instance injected by the host.
 * @param sourceFile - Current parsed source.
 * @param object - Proven enclosing object.
 * @param form - Resolved structured object form.
 * @param position - UTF-16 cursor offset.
 * @returns A key/value context, otherwise null.
 */
function incompleteCursorContext(
    tsMod: typeof ts,
    sourceFile: ts.SourceFile,
    object: ts.ObjectLiteralExpression,
    form: ObjectValueForm | null,
    position: number,
): SzContext | null {
    const text = sourceFile.getFullText();
    const objectStart = object.getStart(sourceFile);
    const prefixStart = cursorPrefixStart(text, position, objectStart);
    if (prefixStart === undefined) return null;
    const scan = beforeCursorPrefix(text, prefixStart, objectStart);
    if (scan === undefined) return null;
    if (text[scan] === ':') {
        const name = nameBeforeColon(text, scan, objectStart);
        if (!name || !/[A-Z_$]/i.test(name[0] ?? '')) return null;
        const member = formMember(form, name);
        if (member === null) return null;
        return {
            kind: 'value',
            property: name,
            quoted: false,
            replacementSpan: replacementSpan(text, position, true),
            member,
        };
    }
    if (text[scan] !== '{' && text[scan] !== ',') return null;
    return {
        kind: 'key',
        replacementSpan: replacementSpan(text, position, false),
        siblings: siblingKeys(tsMod, object, position),
        form: form ?? undefined,
    };
}

/** Classify a cursor without recursively traversing the source file.
 * @param tsMod - TypeScript instance injected by the host.
 * @param sourceFile - Current parsed source.
 * @param position - UTF-16 cursor offset.
 * @param getChecker - Lazy current-program type checker factory.
 * @param shouldStop - Cooperative deadline and cancellation check.
 * @returns A proven key/value context, otherwise null.
 */
export function getSzContext(
    tsMod: typeof ts,
    sourceFile: ts.SourceFile,
    position: number,
    getChecker: () => ts.TypeChecker,
    shouldStop: () => boolean = () => false,
): SzContext | null {
    if (sourceFile.isDeclarationFile || position < 0 || position > sourceFile.getFullText().length)
        return null;
    const token = tokenAtPosition(tsMod, sourceFile, position);
    if (!token) return null;
    const cursor = objectAtPosition(tsMod, token, position, shouldStop);
    if (!cursor) return null;
    const { object, valueProperty } = cursor;
    const resolution =
        jsxAnchor(tsMod, object) ?? callAnchor(tsMod, sourceFile, object, getChecker, shouldStop);
    if (resolution === null) return null;
    const { form } = resolution;
    const text = sourceFile.getFullText();
    if (valueProperty?.parent === object) {
        return propertyValueContext(tsMod, valueProperty, form, text, position);
    }
    return incompleteCursorContext(tsMod, sourceFile, object, form, position);
}
