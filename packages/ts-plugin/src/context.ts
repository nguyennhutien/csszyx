/**
 * Classifies a cursor position: is it inside a csszyx sz object at a KEY
 * position, where offering sz-key completions helps? Covers the surfaces where
 * the editor's own type-driven completion is weak or absent:
 *   - `sz={{ … }}` / `szs={{ … }}` JSX attribute objects
 *   - `szv({ variants: { dim: { name: { … } } } })` config objects (the loose
 *     `SzObject` index-signature type gives no key completion today)
 *   - nested variant objects (`hover: { … }`, `md: { … }`) inside the above
 *
 * Conservative by construction: anything it is unsure about returns `null`, so
 * the plugin falls back to the untouched base completions and never over-offers.
 */
import type ts from 'typescript/lib/tsserverlibrary';

/** Attribute / call names whose object argument is an sz object. */
const SZ_JSX_ATTRS = new Set(['sz', 'szs']);
const SZ_CALLS = new Set(['szv', 'szr']);

/**
 * Deepest node whose span contains `position`.
 *
 * @param tsMod - TypeScript module.
 * @param sourceFile - the parsed file.
 * @param position - absolute offset.
 * @returns the node, or the source file when nothing narrower matches.
 */
function nodeAtPosition(tsMod: typeof ts, sourceFile: ts.SourceFile, position: number): ts.Node {
    let match: ts.Node = sourceFile;
    const visit = (node: ts.Node): void => {
        if (position >= node.getStart(sourceFile) && position <= node.getEnd()) {
            match = node;
            node.forEachChild(visit);
        }
    };
    sourceFile.forEachChild(visit);
    return match;
}

/**
 * Whether `object` is the object argument of a csszyx sz surface (a `sz=`/`szs=`
 * JSX attribute, or an `szv(...)`/`szr(...)` call), possibly nested inside
 * variant objects within it.
 *
 * @param tsMod - TypeScript module.
 * @param object - the object literal to classify.
 * @returns true when the object belongs to an sz surface.
 */
function isSzObject(tsMod: typeof ts, object: ts.ObjectLiteralExpression): boolean {
    let node: ts.Node = object;
    // Walk outward through enclosing object literals / property assignments /
    // arrays until we reach a JSX attribute or a call that anchors it as sz.
    while (node.parent) {
        const parent = node.parent;

        // sz={{ … }} / szs={{ … }} — object is inside a JsxExpression whose
        // parent is a JsxAttribute with an sz name.
        if (tsMod.isJsxExpression(parent) && parent.parent && tsMod.isJsxAttribute(parent.parent)) {
            const name = parent.parent.name;
            const attr = tsMod.isIdentifier(name) ? name.text : name.getText();
            return SZ_JSX_ATTRS.has(attr);
        }

        // szv({ … }) / szr({ … }) — object is (transitively) the first argument.
        if (tsMod.isCallExpression(parent)) {
            const callee = parent.expression;
            const name = tsMod.isIdentifier(callee) ? callee.text : '';
            if (SZ_CALLS.has(name)) {
                return true;
            }
        }

        // Keep climbing through object literals, property assignments, and
        // arrays (variant tables, sz arrays) — anything else means we left the
        // sz surface.
        if (
            tsMod.isObjectLiteralExpression(parent) ||
            tsMod.isPropertyAssignment(parent) ||
            tsMod.isArrayLiteralExpression(parent)
        ) {
            node = parent;
            continue;
        }
        return false;
    }
    return false;
}

/**
 * Returns `'key'` when the position sits at a key slot of an sz object, else
 * `null`.
 *
 * @param tsMod - TypeScript module.
 * @param sourceFile - the parsed file.
 * @param position - absolute offset.
 * @returns `'key'` or `null`.
 */
export function getSzKeyContext(
    tsMod: typeof ts,
    sourceFile: ts.SourceFile,
    position: number,
): 'key' | null {
    const node = nodeAtPosition(tsMod, sourceFile, position);

    // Find the nearest enclosing object literal.
    let object: ts.ObjectLiteralExpression | undefined;
    for (let cur: ts.Node | undefined = node; cur; cur = cur.parent) {
        if (tsMod.isObjectLiteralExpression(cur)) {
            object = cur;
            break;
        }
        // A value expression (string, number, etc.) that is a property's
        // initializer means we are at a VALUE position, not a key.
        if (tsMod.isPropertyAssignment(cur) && cur.initializer.getStart(sourceFile) <= position) {
            return null;
        }
    }
    if (!object || !isSzObject(tsMod, object)) {
        return null;
    }

    // An empty value slot (`{ bg: | }`) has no initializer node to span-test, so
    // check the text: the nearest non-whitespace character before the cursor is a
    // colon → value position, not a key.
    const text = sourceFile.getFullText();
    let scan = position - 1;
    const objectStart = object.getStart(sourceFile);
    while (scan > objectStart && /\s/.test(text[scan] ?? '')) {
        scan -= 1;
    }
    if (text[scan] === ':') {
        return null;
    }

    // Inside the object: value position when the cursor is within a property's
    // initializer span; key position otherwise.
    for (const prop of object.properties) {
        if (
            tsMod.isPropertyAssignment(prop) &&
            position > prop.initializer.getStart(sourceFile) - 1 &&
            position <= prop.initializer.getEnd()
        ) {
            return null;
        }
    }
    return 'key';
}
