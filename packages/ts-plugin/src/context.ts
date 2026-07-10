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
            const name = parent.parent.name;
            if (!tsMod.isIdentifier(name) || !SZ_JSX_ATTRS.has(name.text)) return null;
            // In `sz` every chain name lives inside the style object; in `szs`
            // the outermost name is the user-defined slot name and is exempt.
            if (name.text === 'sz') return resolveChain(chain);
            if (!nested) return null;
            const opening = parent.parent.parent.parent;
            if (!tsMod.isJsxOpeningElement(opening) && !tsMod.isJsxSelfClosingElement(opening)) {
                return null;
            }
            if (/^[a-z]/.test(opening.tagName.getText())) return null;
            return resolveChain(chain.slice(0, -1));
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
            const name = propertyName(tsMod, parent);
            if (!name) return null;
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
                return null;
            }
            const callName = csszyxCallName(tsMod, sourceFile, parent, getChecker(), shouldStop);
            // Names INSIDE a style object may only nest under variant-ish keys —
            // with the one exception of a COLOR property owning its `{ color,
            // op }` value object. The structural szv names (base /
            // variants.axis.option / …sz) are schema, not style keys.
            if (callName === 'szr') return resolveChain(path);
            if (callName === 'szv') {
                const styleChain = szvStyleChain(path.reverse());
                if (styleChain === null) return null;
                return resolveChain([...styleChain].reverse());
            }
            return null;
        }
        return null;
    }
    return null;
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
    if (!object) return null;
    const resolution =
        jsxAnchor(tsMod, object) ?? callAnchor(tsMod, sourceFile, object, getChecker, shouldStop);
    if (resolution === null) return null;
    const { form } = resolution;

    /** Look up a structured-form member; a non-member key inside a form object
     * is not assistable.
     * @param name - Property name at the cursor's slot.
     * @returns The member, undefined for plain style objects, or null to bail.
     */
    const memberFor = (name: string): ObjectFormMember | null | undefined => {
        if (form === null) return undefined;
        return form.members.find(candidate => candidate.name === name) ?? null;
    };

    const text = sourceFile.getFullText();
    if (valueProperty?.parent === object) {
        const name = propertyName(tsMod, valueProperty);
        if (!name) return null;
        const member = memberFor(name);
        if (member === null) return null;
        return {
            kind: 'value',
            property: name,
            quoted: tsMod.isStringLiteralLike(valueProperty.initializer),
            replacementSpan: replacementSpan(text, position, true),
            member,
        };
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
        if (!name || !/[A-Z_$]/i.test(name[0] ?? '')) return null;
        const member = memberFor(name);
        if (member === null) return null;
        return {
            kind: 'value',
            property: name,
            quoted: false,
            replacementSpan: replacementSpan(text, position, true),
            member,
        };
    }
    if (text[scan] === '{' || text[scan] === ',') {
        return {
            kind: 'key',
            replacementSpan: replacementSpan(text, position, false),
            siblings: siblingKeys(tsMod, object, position),
            form: form ?? undefined,
        };
    }
    return null;
}
