import { BOOLEAN_SHORTHANDS, PROPERTY_MAP } from '@csszyx/tooling-metadata';
import type ts from 'typescript/lib/tsserverlibrary';

const SZ_JSX_ATTRS = new Set(['sz', 'szs']);
const CSSZYX_MODULES = new Set(['csszyx', '@csszyx/runtime']);
const MAX_ANCESTOR_DEPTH = 64;

/** Utility property keys. Their values are strings/numbers, never objects, so a
 * nested object under one of them (`borderColor: { … }`) is not sz syntax and
 * must get no suggestions. Variant keys and unknown (arbitrary/custom-variant)
 * keys are absent from this set — classification stays syntax-first and gives
 * unknown parents the benefit of the doubt. PROPERTY_MAP and KNOWN_VARIANTS are
 * disjoint, so a variant name can never be blocked by this set. */
const PROPERTY_KEYS = new Set<string>([...Object.keys(PROPERTY_MAP), ...BOOLEAN_SHORTHANDS]);

/** Check that no key owning a nested object along the chain is a utility property.
 * @param names - Intermediate property-name chain to validate.
 * @returns Whether every name may legally own a nested style object.
 */
function chainAllowsNesting(names: readonly string[]): boolean {
    for (const name of names) {
        if (PROPERTY_KEYS.has(name)) return false;
    }
    return true;
}

/** Proven cursor context and syntax-safe replacement range. */
export type SzContext =
    | { readonly kind: 'key'; readonly replacementSpan: ts.TextSpan }
    | {
          readonly kind: 'value';
          readonly property: string;
          readonly quoted: boolean;
          readonly replacementSpan: ts.TextSpan;
      };

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
): 'szv' | 'szr' | undefined {
    if (tsMod.isPropertyAccessExpression(call.expression)) {
        const receiver = checker.getSymbolAtLocation(call.expression.expression);
        if (receiver) {
            for (const declaration of (receiver.declarations ?? []).slice(0, 64)) {
                if (shouldStop()) return undefined;
                if (!tsMod.isNamespaceImport(declaration)) continue;
                let current: ts.Node | undefined = declaration;
                while (current && !tsMod.isImportDeclaration(current)) current = current.parent;
                if (
                    current &&
                    tsMod.isStringLiteral(current.moduleSpecifier) &&
                    CSSZYX_MODULES.has(current.moduleSpecifier.text)
                ) {
                    const name = call.expression.name.text;
                    return name === 'szv' || name === 'szr' ? name : undefined;
                }
            }
            return undefined;
        }
    }
    const calledName = tsMod.isPropertyAccessExpression(call.expression)
        ? call.expression.name
        : call.expression;
    const symbol = checker.getSymbolAtLocation(calledName);
    if (symbol) {
        for (const declaration of (symbol.declarations ?? []).slice(0, 64)) {
            if (shouldStop()) return undefined;
            let current: ts.Node | undefined = declaration;
            while (current && !tsMod.isImportDeclaration(current)) current = current.parent;
            if (
                current &&
                tsMod.isStringLiteral(current.moduleSpecifier) &&
                CSSZYX_MODULES.has(current.moduleSpecifier.text)
            ) {
                if (tsMod.isIdentifier(call.expression)) {
                    const imported = tsMod.isImportSpecifier(declaration)
                        ? (declaration.propertyName?.text ?? declaration.name.text)
                        : undefined;
                    return imported === 'szv' || imported === 'szr' ? imported : undefined;
                }
                const name = calledName.getText(sourceFile);
                return name === 'szv' || name === 'szr' ? name : undefined;
            }
        }
        // A resolved local symbol is authoritative: never fall back to spelling.
        return undefined;
    }

    // Degraded-checker fallback for incomplete imports while the user is typing.
    const named = new Map<string, string>();
    const namespaces = new Set<string>();
    let statementCount = 0;
    for (const statement of sourceFile.statements) {
        if (statementCount >= 2_048 || shouldStop()) return undefined;
        statementCount += 1;
        if (
            !tsMod.isImportDeclaration(statement) ||
            !tsMod.isStringLiteral(statement.moduleSpecifier)
        )
            continue;
        if (!CSSZYX_MODULES.has(statement.moduleSpecifier.text)) continue;
        const clause = statement.importClause;
        if (!clause?.namedBindings) continue;
        if (tsMod.isNamespaceImport(clause.namedBindings))
            namespaces.add(clause.namedBindings.name.text);
        else {
            for (const specifier of clause.namedBindings.elements.slice(0, 256)) {
                if (shouldStop()) return undefined;
                named.set(specifier.name.text, specifier.propertyName?.text ?? specifier.name.text);
            }
        }
    }
    const expression = call.expression;
    if (tsMod.isIdentifier(expression)) {
        const imported = named.get(expression.text);
        return imported === 'szv' || imported === 'szr' ? imported : undefined;
    }
    if (
        tsMod.isPropertyAccessExpression(expression) &&
        tsMod.isIdentifier(expression.expression) &&
        namespaces.has(expression.expression.text) &&
        (expression.name.text === 'szv' || expression.name.text === 'szr')
    ) {
        return expression.name.text;
    }
    return undefined;
}

/** Check JSX sz and slot-level szs ancestry.
 * @param tsMod - TypeScript instance injected by the host.
 * @param object - Candidate object literal.
 * @returns Whether the object is a CSS-bearing JSX surface.
 */
function jsxAnchor(tsMod: typeof ts, object: ts.ObjectLiteralExpression): boolean {
    // Inner-to-outer property names between the candidate object and the
    // attribute, so nesting under a utility property (`borderColor: { | }`)
    // can be rejected instead of suggesting keys inside invalid structure.
    const chain: string[] = [];
    let node: ts.Node = object;
    let nested = false;
    for (let depth = 0; node.parent && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
        const parent = node.parent;
        if (tsMod.isJsxExpression(parent) && tsMod.isJsxAttribute(parent.parent)) {
            const name = parent.parent.name;
            if (!tsMod.isIdentifier(name) || !SZ_JSX_ATTRS.has(name.text)) return false;
            // In `sz` every chain name lives inside the style object; in `szs`
            // the outermost name is the user-defined slot name and is exempt.
            if (name.text === 'sz') return chainAllowsNesting(chain);
            if (!nested) return false;
            const opening = parent.parent.parent.parent;
            if (!tsMod.isJsxOpeningElement(opening) && !tsMod.isJsxSelfClosingElement(opening)) {
                return false;
            }
            if (/^[a-z]/.test(opening.tagName.getText())) return false;
            return chainAllowsNesting(chain.slice(0, -1));
        }
        if (
            tsMod.isObjectLiteralExpression(parent) ||
            tsMod.isPropertyAssignment(parent) ||
            tsMod.isArrayLiteralExpression(parent)
        ) {
            if (tsMod.isPropertyAssignment(parent)) {
                nested = true;
                const name = propertyName(tsMod, parent);
                // Computed names cannot be validated; stay permissive.
                if (name !== undefined) chain.push(name);
            }
            if (tsMod.isArrayLiteralExpression(parent)) {
                nested = true;
            }
            node = parent;
            continue;
        }
        if (tsMod.isParenthesizedExpression(parent) || tsMod.isConditionalExpression(parent)) {
            node = parent;
            continue;
        }
        break;
    }
    return false;
}

/** Check schema-aware szv/szr ancestry.
 * @param tsMod - TypeScript instance injected by the host.
 * @param sourceFile - Source containing the candidate.
 * @param object - Candidate object literal.
 * @param getChecker - Lazy current-program type checker factory.
 * @param shouldStop - Cooperative deadline and cancellation check.
 * @returns Whether the object is a CSS-bearing call surface.
 */
function callAnchor(
    tsMod: typeof ts,
    sourceFile: ts.SourceFile,
    object: ts.ObjectLiteralExpression,
    getChecker: () => ts.TypeChecker,
    shouldStop: () => boolean,
): boolean {
    const path: string[] = [];
    let node: ts.Node = object;
    for (let depth = 0; node.parent && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
        if (shouldStop()) return false;
        const parent = node.parent;
        if (tsMod.isPropertyAssignment(parent)) {
            const name = propertyName(tsMod, parent);
            if (!name) return false;
            path.push(name);
            node = parent;
            continue;
        }
        if (tsMod.isObjectLiteralExpression(parent)) {
            node = parent;
            continue;
        }
        if (tsMod.isArrayLiteralExpression(parent)) {
            node = parent;
            continue;
        }
        if (
            tsMod.isParenthesizedExpression(parent) ||
            tsMod.isAsExpression(parent) ||
            tsMod.isSatisfiesExpression(parent) ||
            tsMod.isConditionalExpression(parent)
        ) {
            node = parent;
            continue;
        }
        if (tsMod.isCallExpression(parent) && parent.arguments[0] === node) {
            if (
                tsMod.isPropertyAccessExpression(parent.expression) &&
                parent.expression.name.text !== 'szv' &&
                parent.expression.name.text !== 'szr'
            ) {
                return false;
            }
            const callName = csszyxCallName(tsMod, sourceFile, parent, getChecker(), shouldStop);
            // Names INSIDE a style object may only nest under variant-ish keys,
            // never under a utility property (`p: { | }` is not sz syntax); the
            // structural szv names (base / variants.axis.option / …sz) and slot
            // names are schema, not style keys, and are exempt.
            if (callName === 'szr') return chainAllowsNesting(path);
            if (callName === 'szv') {
                const rootToLeaf = path.reverse();
                if (rootToLeaf[0] === 'base') return chainAllowsNesting(rootToLeaf.slice(1));
                if (rootToLeaf[0] === 'variants' && rootToLeaf.length >= 3) {
                    return chainAllowsNesting(rootToLeaf.slice(3));
                }
                if (rootToLeaf[0] === 'compoundVariants') {
                    const szIndex = rootToLeaf.indexOf('sz');
                    return szIndex >= 0 && chainAllowsNesting(rootToLeaf.slice(szIndex + 1));
                }
                return false;
            }
            return false;
        }
        return false;
    }
    return false;
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
    let object: ts.ObjectLiteralExpression | undefined;
    let valueProperty: ts.PropertyAssignment | undefined;
    for (
        let current: ts.Node | undefined = token, depth = 0;
        current && depth < MAX_ANCESTOR_DEPTH;
        current = current.parent, depth += 1
    ) {
        if (shouldStop()) return null;
        if (
            tsMod.isPropertyAssignment(current) &&
            position >= current.initializer.getFullStart() &&
            position <= current.initializer.getEnd()
        ) {
            valueProperty = current;
        }
        if (tsMod.isObjectLiteralExpression(current)) {
            object = current;
            break;
        }
    }
    if (
        !object ||
        (!jsxAnchor(tsMod, object) &&
            !callAnchor(tsMod, sourceFile, object, getChecker, shouldStop))
    )
        return null;

    const text = sourceFile.getFullText();
    if (valueProperty?.parent === object) {
        const name = propertyName(tsMod, valueProperty);
        return name
            ? {
                  kind: 'value',
                  property: name,
                  quoted: tsMod.isStringLiteralLike(valueProperty.initializer),
                  replacementSpan: replacementSpan(text, position, true),
              }
            : null;
    }
    const objectStart = object.getStart(sourceFile);
    // Classify by what precedes the TYPED PREFIX, not the last typed character:
    // `bg: re|` must read the `:` behind `re` and stay a value slot, and a key
    // slot must sit right after `{` or `,`. Anything else is an unproven cursor.
    let prefixStart = position;
    for (
        let count = 0;
        prefixStart > objectStart && count < 256 && /[\w$-]/.test(text[prefixStart - 1] ?? '');
        count += 1
    ) {
        prefixStart -= 1;
    }
    if (prefixStart > objectStart && /[\w$-]/.test(text[prefixStart - 1] ?? '')) return null;
    let scan = prefixStart - 1;
    let whitespaceCount = 0;
    while (scan > objectStart && whitespaceCount < 256 && /\s/.test(text[scan] ?? '')) {
        scan -= 1;
        whitespaceCount += 1;
    }
    if (whitespaceCount === 256) return null;
    if (text[scan] === ':') {
        let nameEnd = scan;
        let nameWhitespace = 0;
        while (
            nameEnd > objectStart &&
            nameWhitespace < 256 &&
            /\s/.test(text[nameEnd - 1] ?? '')
        ) {
            nameEnd -= 1;
            nameWhitespace += 1;
        }
        if (nameWhitespace === 256) return null;
        let nameStart = nameEnd;
        for (
            let count = 0;
            nameStart > objectStart && count < 256 && /[\w$]/.test(text[nameStart - 1] ?? '');
            count += 1
        ) {
            nameStart -= 1;
        }
        const name = text.slice(nameStart, nameEnd);
        return name && /[A-Z_$]/i.test(name[0] ?? '')
            ? {
                  kind: 'value',
                  property: name,
                  quoted: false,
                  replacementSpan: replacementSpan(text, position, true),
              }
            : null;
    }
    if (text[scan] === '{' || text[scan] === ',') {
        return { kind: 'key', replacementSpan: replacementSpan(text, position, false) };
    }
    return null;
}
