/**
 * Find the `sz` attributes of a Svelte component with Svelte's own parser.
 *
 * `svelte/compiler` reads the markup the way the Svelte build will: elements
 * and their attributes, past comments, `@html` strings, text, `<script>` and
 * `<style>`. An attribute is read where Svelte sees one and nowhere else.
 *
 * @module markup-ast
 */

import {
    SVELTE_VERSION_UNSUPPORTED,
    type SzBrowserDiagnostic,
    TEMPLATE_UNPARSABLE,
} from '@csszyx/compiler/report';
import {
    placeTemplateDiagnostic,
    requirePeer,
    type TemplateClassReading,
    type TemplateSzAttribute,
    type TemplateSzDiagnostic,
} from '@csszyx/compiler/template';

/** A node of Svelte's modern AST; only the fields the adapter reads. */
interface SvelteNode {
    type: string;
    start: number;
    end: number;
    name?: string;
    /** An attribute's value: an expression tag, quoted parts, or `true`. */
    value?: SvelteNode | SvelteNode[] | true;
    /** An expression tag's expression. */
    expression?: { start: number; end: number };
    attributes?: SvelteNode[];
    nodes?: SvelteNode[];
    [key: string]: unknown;
}

/** The error `svelte/compiler` throws for a file it cannot parse. */
interface SvelteCompileError extends Error {
    /** Present on every error Svelte raises about the source. */
    code?: string;
    position: [number, number];
}

/** The part of `svelte/compiler` the adapter calls. */
interface SvelteCompiler {
    VERSION: string;
    parse(source: string, options: { filename?: string; modern: true }): { fragment: SvelteNode };
}

/** What {@link readSzAttributes} found in a component. */
export interface SzAttributeReading {
    /** The `sz` attributes, in file order. */
    attributes: TemplateSzAttribute[];
    /** Why the component was not read, as errors; empty when it was. */
    diagnostics: TemplateSzDiagnostic[];
}

const BYTE_ORDER_MARK = '﻿';

/**
 * Read the `sz` attributes of a Svelte component.
 *
 * @param source - The component.
 * @param filename - Its name, for messages.
 * @returns The attributes, or the error that stopped the read.
 */
export function readSzAttributes(source: string, filename?: string): SzAttributeReading {
    const svelte = svelteCompiler();
    const fail = <Args extends object>(
        offset: number,
        diagnostic: SzBrowserDiagnostic<Args>,
        args: NoInfer<Args>,
    ): SzAttributeReading => ({
        attributes: [],
        diagnostics: [
            placeTemplateDiagnostic({
                file: source,
                filename,
                severity: 'error',
                offset,
                diagnostic,
                args,
            }),
        ],
    });
    if (Number.parseInt(svelte.VERSION, 10) < 5) {
        return fail(0, SVELTE_VERSION_UNSUPPORTED, { version: svelte.VERSION });
    }
    // Svelte drops a leading byte order mark, so its offsets start one later.
    const shift = source.startsWith(BYTE_ORDER_MARK) ? 1 : 0;
    let root: SvelteNode;
    try {
        root = svelte.parse(source.slice(shift), { filename, modern: true }).fragment;
    } catch (error) {
        const failure = error as SvelteCompileError;
        // Only Svelte's own verdict on the file is a diagnostic; anything else,
        // its parser running out of stack say, is not about the markup.
        if (typeof failure.code !== 'string') throw error;
        return fail(failure.position[0] + shift, TEMPLATE_UNPARSABLE, {
            form: unparsableForm(source),
            message: failure.message,
        });
    }
    const reader: Reader = { source, shift, found: [] };
    collect(reader, root);
    return { attributes: reader.found, diagnostics: [] };
}

/**
 * The project's `svelte/compiler`, or the error that says to install it.
 *
 * @returns The compiler.
 */
function svelteCompiler(): SvelteCompiler {
    return requirePeer<SvelteCompiler>({
        from: import.meta.url,
        request: 'svelte/compiler',
        requiredBy: '@csszyx/svelte-adapter',
        install: 'svelte@5',
    });
}

/**
 * The class names a component puts in the DOM, as Svelte reads it: the words
 * of every `class` value's text, each `class:` directive's name, and from a
 * `class={…}` or `class="a {…}"` expression every string and template text
 * in it and the keys of a class object at its top or in an array there,
 * read from the expression tree Svelte parsed, with no lexer of its own.
 * Over-reads (`class={x === 'dark' ? …}` gives `dark`), never under-reads.
 *
 * Cost: one `svelte.parse` (about 0.1 ms a component) and one walk.
 *
 * @param source - The component.
 * @returns The names, or null when Svelte 5 cannot parse it.
 * @internal Used by csszyx's own packages; not a stable API.
 */
export function templateClassNames(source: string): TemplateClassReading | null {
    const svelte = svelteCompiler();
    if (Number.parseInt(svelte.VERSION, 10) < 5) return null;
    let root: SvelteNode;
    try {
        root = svelte.parse(source, { modern: true }).fragment;
    } catch (error) {
        if (typeof (error as SvelteCompileError).code !== 'string') throw error;
        return null;
    }
    const names = new Set<string>();
    forEachAttributeList(root, attributes => {
        for (const attribute of attributes) readClassAttribute(names, attribute);
    });
    return { names: [...names], expressions: [] };
}

/**
 * Add what one attribute of an element puts in its class list: a `class:`
 * directive's name, or a `class` value's text words and expression names.
 *
 * @param names - The set read into.
 * @param attribute - One attribute.
 */
function readClassAttribute(names: Set<string>, attribute: SvelteNode): void {
    if (attribute.type === 'ClassDirective' && attribute.name) names.add(attribute.name);
    if (attribute.type !== 'Attribute' || attribute.name !== 'class') return;
    const value = attribute.value;
    for (const part of Array.isArray(value) ? value : [value]) {
        if (part === true || part === undefined) continue;
        if (part.type === 'Text') addWords(names, String(part.data));
        if (part.type === 'ExpressionTag') {
            const expression = part.expression as unknown as EstreeNode;
            addExpressionStrings(names, expression);
            addClassObjectKeys(names, expression);
        }
    }
}

/** A node of the estree Svelte gives an expression; only what is read. */
interface EstreeNode {
    type: string;
    [key: string]: unknown;
}

/**
 * Add each word of a class list, split on HTML whitespace.
 *
 * @param names - The set read into.
 * @param text - A class list.
 */
function addWords(names: Set<string>, text: string): void {
    for (const word of text.split(/[\t\n\f\r ]+/)) if (word !== '') names.add(word);
}

/**
 * Add the words of every string and template text in an expression. The walk
 * keeps its own stack.
 *
 * @param names - The set read into.
 * @param root - The expression.
 */
function addExpressionStrings(names: Set<string>, root: EstreeNode): void {
    const pending: unknown[] = [root];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
        if (Array.isArray(node)) pending.push(...node);
        else readStringNode(names, node as EstreeNode, pending);
    }
}

/**
 * Add the words of one expression node when it is a string or a template's
 * text, and queue the nodes under it.
 *
 * @param names - The set read into.
 * @param tree - The node.
 * @param pending - The walk's queue.
 */
function readStringNode(names: Set<string>, tree: EstreeNode, pending: unknown[]): void {
    if (tree.type === 'Literal' && typeof tree.value === 'string') addWords(names, tree.value);
    if (tree.type === 'TemplateElement') {
        const text = tree.value as { cooked?: string | null; raw: string };
        addWords(names, text.cooked ?? text.raw);
    }
    for (const [key, child] of Object.entries(tree)) {
        if (key !== 'loc' && key !== 'metadata' && typeof child === 'object' && child !== null) {
            pending.push(child);
        }
    }
}

/**
 * Add the keys of a class object at the top of a class value, or in an array
 * there at any depth: `class={{ active }}`, `class={['a', { b: c }]}`.
 *
 * @param names - The set read into.
 * @param root - The expression.
 */
function addClassObjectKeys(names: Set<string>, root: EstreeNode): void {
    const pending: EstreeNode[] = [root];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
        if (node.type === 'ArrayExpression') {
            pending.push(
                ...(node.elements as (EstreeNode | null)[]).filter(element => element !== null),
            );
        }
        if (node.type === 'ObjectExpression') {
            for (const property of node.properties as EstreeNode[]) addPropertyKey(names, property);
        }
    }
}

/**
 * Add a class object property's key, when it is written out: `active` or
 * `'is-open'`, not `[name]` or a spread.
 *
 * @param names - The set read into.
 * @param property - One member of the object.
 */
function addPropertyKey(names: Set<string>, property: EstreeNode): void {
    if (property.type !== 'Property' || property.computed === true) return;
    const key = property.key as EstreeNode;
    if (key.type === 'Identifier') names.add(String(key.name));
    if (key.type === 'Literal' && typeof key.value === 'string') addWords(names, key.value);
}

/**
 * Why Svelte likely could not parse a component, which picks the advice.
 *
 * @param source - The component.
 * @returns `svelte-quoted` when it quotes an sz object, which Svelte cannot
 *   read; `svelte-preprocess` otherwise.
 */
function unparsableForm(source: string): 'svelte-quoted' | 'svelte-preprocess' {
    // `sz="{ p: 4 }"` was read before Svelte saw the file; Svelte cannot read it.
    return /\bsz\s*=\s*["']\s*\{(?!\{)/.test(source) ? 'svelte-quoted' : 'svelte-preprocess';
}

/** What a walk over one component carries. */
interface Reader {
    /** The component. */
    source: string;
    /** What to add to Svelte's offsets. */
    shift: number;
    /** The `sz` attributes found so far, in file order. */
    found: TemplateSzAttribute[];
}

/**
 * Collect the `sz` attributes of a fragment and every fragment under it, in
 * file order. The walk keeps its own stack, so no depth of nesting exhausts
 * the call stack.
 *
 * @param reader - The walk.
 * @param root - The component's root fragment.
 */
function collect(reader: Reader, root: SvelteNode): void {
    forEachAttributeList(root, attributes => readElement(reader, attributes));
}

/**
 * Visit the attributes of every element of a fragment and of every fragment
 * under it, in file order. The walk keeps its own stack, so no depth of
 * nesting exhausts the call stack.
 *
 * @param root - The component's root fragment.
 * @param visit - Called with each element's attributes, in order.
 */
function forEachAttributeList(root: SvelteNode, visit: (attributes: SvelteNode[]) => void): void {
    const pending: SvelteNode[] = [root];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
        if (node.attributes) visit(node.attributes);
        const next: SvelteNode[] = [...(node.nodes ?? [])];
        for (const value of Object.values(node)) {
            if (isFragment(value)) next.push(value);
        }
        for (let index = next.length - 1; index >= 0; index -= 1) pending.push(next[index]);
    }
}

/**
 * Whether a field of a node is a fragment: an element's children or a block's
 * branch.
 *
 * @param value - A field's value.
 * @returns Whether it is a `Fragment` node.
 */
function isFragment(value: unknown): value is SvelteNode {
    return typeof value === 'object' && value !== null && (value as SvelteNode).type === 'Fragment';
}

/**
 * Collect an element's `sz` attributes. A spread is a wall: an `sz` joins the
 * quoted `class` on its own side of every spread, and nothing else.
 *
 * @param reader - The walk.
 * @param attributes - The element's attributes, in order.
 */
function readElement(reader: Reader, attributes: SvelteNode[]): void {
    let side: SvelteNode[] = [];
    for (const attribute of [...attributes, null]) {
        if (attribute === null || attribute.type === 'SpreadAttribute') {
            readSide(reader, side);
            side = [];
        } else {
            side.push(attribute);
        }
    }
}

/**
 * Collect the `sz` attributes of one side of an element's spreads.
 *
 * @param reader - The walk.
 * @param side - The attributes between two spreads.
 */
function readSide(reader: Reader, side: SvelteNode[]): void {
    const { source, shift } = reader;
    const named = (name: string): SvelteNode[] =>
        side.filter(a => a.type === 'Attribute' && a.name === name);
    const classValue = named('class')
        .map(attribute => classRange(reader, attribute))
        .find(range => range !== null);
    for (const attribute of named('sz')) {
        const expression = expressionOf(attribute.value);
        if (!expression) continue;
        const start = expression.start + shift;
        const read: TemplateSzAttribute = {
            start: attribute.start + shift,
            end: attribute.end + shift,
            value: { source: source.slice(start, expression.end + shift), start },
        };
        reader.found.push(classValue ? { ...read, classValue } : read);
    }
}

/**
 * The expression an `sz` value holds: `sz={…}` or `sz="{…}"`. Text is a
 * component's own prop.
 *
 * @param value - The attribute's value.
 * @returns The expression's range, or null.
 */
function expressionOf(value: SvelteNode['value']): { start: number; end: number } | null {
    const tag = Array.isArray(value) ? soleNode(value) : value;
    if (tag === undefined || tag === true || tag.type !== 'ExpressionTag') return null;
    return tag.expression as { start: number; end: number };
}

/**
 * The one node of a list, when it holds exactly one.
 *
 * @param nodes - The list.
 * @returns Its node, or undefined.
 */
function soleNode(nodes: SvelteNode[]): SvelteNode | undefined {
    return nodes.length === 1 ? nodes[0] : undefined;
}

/**
 * The range of a `class` value's text, quotes excluded; null for
 * `class={…}` or a bare `class`, which a class string cannot join.
 *
 * @param reader - The walk.
 * @param attribute - A `class` attribute.
 * @returns The range, or null.
 */
function classRange(
    reader: Reader,
    attribute: SvelteNode,
): { start: number; end: number; quoted: boolean } | null {
    if (!Array.isArray(attribute.value)) return null;
    const last = attribute.end + reader.shift - 1;
    const quoted = reader.source.charAt(last) === '"' || reader.source.charAt(last) === "'";
    const end = quoted ? last : last + 1;
    // Even `class=""` holds one empty text node.
    return { start: attribute.value[0].start + reader.shift, end, quoted };
}
