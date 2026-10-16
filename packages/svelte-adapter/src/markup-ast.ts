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
    placeTemplateDiagnostic,
    requirePeer,
    type TemplateSzAttribute,
    type TemplateSzDiagnostic,
} from '@csszyx/compiler/internal';

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
    const svelte = requirePeer<SvelteCompiler>({
        from: import.meta.url,
        request: 'svelte/compiler',
        requiredBy: '@csszyx/svelte-adapter',
        install: 'svelte@5',
    });
    const fail = (offset: number, text: string): SzAttributeReading => ({
        attributes: [],
        diagnostics: [
            placeTemplateDiagnostic({ file: source, filename, severity: 'error', offset, text }),
        ],
    });
    if (Number.parseInt(svelte.VERSION, 10) < 5) {
        return fail(
            0,
            `csszyx reads Svelte 5 markup, and svelte ${svelte.VERSION} resolves\nhelp: install svelte@5`,
        );
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
        return fail(failure.position[0] + shift, unparsable(source, failure.message));
    }
    const reader: Reader = { source, shift, found: [] };
    collect(reader, root);
    return { attributes: reader.found, diagnostics: [] };
}

/**
 * The message for a component Svelte cannot parse.
 *
 * @param source - The component.
 * @param reason - Svelte's message.
 * @returns What went wrong, and what to do.
 */
function unparsable(source: string, reason: string): string {
    const head = `Svelte cannot parse this file, so no sz in it gets a class: ${reason}`;
    // `sz="{ p: 4 }"` was read before Svelte saw the file; Svelte cannot read it.
    if (/\bsz\s*=\s*["']\s*\{(?!\{)/.test(source)) {
        return `${head}\nhelp: write a quoted sz object as an expression, sz={{ p: 4 }}; Svelte does not parse sz="{ p: 4 }"`;
    }
    return `${head}\nhelp: run csszyx after the preprocessors that turn this file into Svelte, such as TypeScript without lang="ts" or pug`;
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
    const pending: SvelteNode[] = [root];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
        if (node.attributes) readElement(reader, node.attributes);
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
