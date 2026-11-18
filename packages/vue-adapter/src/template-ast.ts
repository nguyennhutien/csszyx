/**
 * Find the `sz` attributes of a Vue SFC with Vue's own parser.
 *
 * `vue/compiler-sfc` reads the file the way the Vue build will: the root
 * `<template>` only, its elements and their attributes, past comments, text,
 * interpolations and custom blocks. An attribute is read where Vue sees one
 * and nowhere else, so `sz=` in page text or under `v-pre` stays text.
 *
 * @module template-ast
 */

import {
    type SzBrowserDiagnostic,
    TEMPLATE_LANG_UNSUPPORTED,
    TEMPLATE_UNPARSABLE,
} from '@csszyx/compiler/report';
import {
    placeTemplateDiagnostic,
    requirePeer,
    type TemplateClassReading,
    type TemplateSzAttribute,
    type TemplateSzDiagnostic,
} from '@csszyx/compiler/template';

import { decodeCharacterReferences } from './character-references.js';

/** A position in the parsed file. */
interface Position {
    offset: number;
}

/** A source range in the parsed file. */
interface SourceLocation {
    start: Position;
    end: Position;
}

/** A static attribute (`type` 6) or a directive (`type` 7). */
interface AttributeOrDirective {
    type: number;
    name: string;
    loc: SourceLocation;
    /** A static attribute's value, quotes included in its `loc`; `content` decoded. */
    value?: { loc: SourceLocation; content: string };
    /** A directive's argument, `sz` in `:sz`. */
    arg?: { type: number; content: string; isStatic: boolean };
    /** A directive's expression; its `loc` excludes the quotes. */
    exp?: { loc: SourceLocation; content: string };
}

/** A node of the template AST. */
interface TemplateNode {
    type: number;
    loc: SourceLocation;
    props?: AttributeOrDirective[];
    children?: TemplateNode[];
    /** Where an element's content starts: just past its start tag. */
    innerLoc?: SourceLocation;
}

/** The part of `vue/compiler-sfc` the adapter calls. */
interface VueCompilerSfc {
    parse(
        source: string,
        options: {
            filename?: string;
            sourceMap: false;
            templateParseOptions: { prefixIdentifiers: false };
        },
    ): {
        descriptor: {
            template: {
                lang?: string;
                loc: SourceLocation;
                ast?: TemplateNode;
            } | null;
        };
        errors: Array<Error & { loc?: SourceLocation }>;
    };
}

const ELEMENT = 1;
const ATTRIBUTE = 6;
const DIRECTIVE = 7;

/** Why a file was not read: an error to place at an offset. */
export interface ReadFailure {
    /** UTF-16 offset in the file. */
    offset: number;
    /**
     * The error, placed in a file.
     *
     * @param at - Where to place it.
     * @param at.file - The file the diagnostic names.
     * @param at.filename - The file's name as the template compiler saw it.
     * @param at.offset - The UTF-16 offset in the file.
     * @returns The diagnostic.
     */
    place(at: { file: string; filename?: string; offset: number }): TemplateSzDiagnostic;
}

/**
 * A failure in the registry's words.
 *
 * @param offset - Where it is.
 * @param diagnostic - The registry entry.
 * @param args - Its args.
 * @returns The failure.
 */
function failure<Args extends object>(
    offset: number,
    diagnostic: SzBrowserDiagnostic<Args>,
    args: NoInfer<Args>,
): ReadFailure {
    return {
        offset,
        place: at => placeTemplateDiagnostic({ ...at, severity: 'error', diagnostic, args }),
    };
}

/** What {@link readSzAttributes} found in a file. */
export interface SzAttributeReading {
    /** The `sz` attributes, in file order. */
    attributes: TemplateSzAttribute[];
    /** Why the file was not read; null when it was. */
    failure: ReadFailure | null;
    /** The root template's content range, when the file has one. */
    template: { start: number; end: number } | null;
}

/**
 * Read the `sz` attributes of a Vue SFC.
 *
 * @param source - The SFC.
 * @param filename - Its name, for messages.
 * @returns The attributes, or the errors that stopped the read.
 */
export function readSzAttributes(source: string, filename?: string): SzAttributeReading {
    const { descriptor, errors } = parseSfc(source, filename);
    const template = descriptor.template;
    const bounds = template && { start: template.loc.start.offset, end: template.loc.end.offset };
    const fail = (failed: ReadFailure): SzAttributeReading => ({
        attributes: [],
        failure: failed,
        template: bounds,
    });
    if (errors.length > 0) {
        const [first] = errors;
        return fail(
            failure(first.loc?.start.offset ?? 0, TEMPLATE_UNPARSABLE, {
                form: 'vue',
                message: first.message,
            }),
        );
    }
    if (template === null) return { attributes: [], failure: null, template: null };
    if (template.lang !== undefined && template.lang !== 'html') {
        return fail(
            failure(
                source.lastIndexOf('<template', template.loc.start.offset),
                TEMPLATE_LANG_UNSUPPORTED,
                { lang: template.lang },
            ),
        );
    }
    return { attributes: collect(source, template.ast), failure: null, template: bounds };
}

/**
 * Parse an SFC with the project's `vue/compiler-sfc`. Expressions are left as
 * text: the engine reads an `sz` one with its own positions, and parsed by
 * Vue as well, a slip in one `sz` value failed the whole file.
 *
 * @param source - The SFC.
 * @param filename - Its name, for messages.
 * @returns Vue's descriptor and errors.
 */
function parseSfc(source: string, filename?: string): ReturnType<VueCompilerSfc['parse']> {
    const sfc = requirePeer<VueCompilerSfc>({
        from: import.meta.url,
        request: 'vue/compiler-sfc',
        requiredBy: '@csszyx/vue-adapter',
        install: 'vue@3.5',
    });
    return sfc.parse(source, {
        filename,
        sourceMap: false,
        templateParseOptions: { prefixIdentifiers: false },
    });
}

/**
 * The class names an SFC's template puts in the DOM, as Vue reads it: the
 * words of every static `class` (decoded, as Vue gives it), and the text of
 * every `:class` / `v-bind:class` expression for a JavaScript reader, since
 * Vue leaves expressions as text here.
 *
 * Cost: one `compiler-sfc` parse (about 0.01 ms a file) and one walk.
 *
 * @param source - The SFC.
 * @returns The names and expressions, or null when Vue cannot parse it or
 *   its template is in another language.
 * @internal Used by csszyx's own packages; not a stable API.
 */
export function templateClassNames(source: string): TemplateClassReading | null {
    const { descriptor, errors } = parseSfc(source);
    const template = descriptor.template;
    if (errors.length > 0) return null;
    if (template === null) return { names: [], expressions: [] };
    if (template.lang !== undefined && template.lang !== 'html') return null;
    const names = new Set<string>();
    const expressions: string[] = [];
    const pending = [...(template.ast?.children ?? [])];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
        if (node.type !== ELEMENT) continue;
        // An element always has both lists; only text and comments lack them.
        const element = node as Required<TemplateNode>;
        for (const prop of element.props) readClassProp(prop, names, expressions);
        pending.push(...element.children);
    }
    return { names: [...names], expressions };
}

/**
 * Add what one prop of an element puts in its class list: a static
 * `class`'s words, or a `:class` binding's expression, as written.
 *
 * @param prop - One prop.
 * @param names - The static words read so far.
 * @param expressions - The binding expressions read so far.
 */
function readClassProp(
    prop: AttributeOrDirective,
    names: Set<string>,
    expressions: string[],
): void {
    if (prop.type === ATTRIBUTE && prop.name === 'class' && prop.value) {
        for (const word of prop.value.content.split(/[\t\n\f\r ]+/)) {
            if (word !== '') names.add(word);
        }
        return;
    }
    const bound = prop.type === DIRECTIVE && prop.name === 'bind' && prop.arg?.isStatic === true;
    if (bound && prop.arg?.content === 'class' && prop.exp) expressions.push(prop.exp.content);
}

/**
 * Collect the `sz` attributes of a template, in file order. The walk keeps
 * its own stack, so no depth of nesting exhausts the call stack. A `v-pre`
 * element is text to Vue, and so is everything in it.
 *
 * @param source - The SFC.
 * @param root - The template's root node.
 * @returns The attributes.
 */
function collect(source: string, root: TemplateNode | undefined): TemplateSzAttribute[] {
    const found: TemplateSzAttribute[] = [];
    const pending = [...(root?.children ?? [])].reverse();
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
        if (node.type !== ELEMENT || hasVPre(source, node)) continue;
        // An element always has both lists; only text and comments lack them.
        const element = node as Required<TemplateNode>;
        found.push(...elementSzAttributes(source, element.props));
        for (let index = element.children.length - 1; index >= 0; index -= 1) {
            pending.push(element.children[index]);
        }
    }
    return found;
}

/**
 * An element's `sz` attributes, each joined to the element's static `class`.
 *
 * @param source - The SFC.
 * @param props - The element's props.
 * @returns The attributes.
 */
function elementSzAttributes(source: string, props: AttributeOrDirective[]): TemplateSzAttribute[] {
    const classProp = props.find(
        prop => prop.type === ATTRIBUTE && prop.name === 'class' && prop.value,
    );
    const classValue = classProp?.value && innerRange(source, classProp.value.loc);
    const found: TemplateSzAttribute[] = [];
    for (const prop of props) {
        const attribute = szAttribute(source, prop);
        if (attribute) found.push(classValue ? { ...attribute, classValue } : attribute);
    }
    return found;
}

/**
 * The `sz` attribute a prop is, when it is one: a bound `:sz` or `v-bind:sz`,
 * or a static `sz` written as an object or an array. Any other static `sz`
 * string is a component's own prop.
 *
 * @param source - The SFC.
 * @param prop - One prop of an element.
 * @returns The attribute, or null.
 */
function szAttribute(source: string, prop: AttributeOrDirective): TemplateSzAttribute | null {
    let range: { start: number; end: number };
    if (prop.type === ATTRIBUTE && prop.name === 'sz' && prop.value) {
        range = innerRange(source, prop.value.loc);
        if (!/^\s*[{[]/.test(source.slice(range.start, range.end))) return null;
    } else if (
        prop.type === DIRECTIVE &&
        prop.name === 'bind' &&
        prop.arg?.isStatic === true &&
        prop.arg.content === 'sz' &&
        prop.exp
    ) {
        range = { start: prop.exp.loc.start.offset, end: prop.exp.loc.end.offset };
    } else {
        return null;
    }
    const decoded = decodeCharacterReferences(source.slice(range.start, range.end), range.start);
    return {
        start: prop.loc.start.offset,
        end: prop.loc.end.offset,
        value: { ...decoded, start: range.start },
    };
}

/**
 * A value's range without its quotes.
 *
 * @param source - The SFC.
 * @param loc - The value's location, quotes included when it has them.
 * @returns The range of what is between them.
 */
function innerRange(
    source: string,
    loc: SourceLocation,
): { start: number; end: number; quoted: boolean } {
    const quote = source.charAt(loc.start.offset);
    const quoted = quote === '"' || quote === "'";
    return {
        start: loc.start.offset + (quoted ? 1 : 0),
        end: loc.end.offset - (quoted ? 1 : 0),
        quoted,
    };
}

/**
 * Whether an element carries `v-pre`. Vue's parser drops the directive from
 * the element's props, so its start tag is read, quoted values blanked out.
 *
 * @param source - The SFC.
 * @param node - An element.
 * @returns Whether its start tag holds a `v-pre` attribute.
 */
function hasVPre(source: string, node: TemplateNode): boolean {
    const tagEnd = node.innerLoc?.start.offset ?? node.loc.end.offset;
    const tag = source.slice(node.loc.start.offset, tagEnd).replace(/"[^"]*"|'[^']*'/g, '""');
    return /\sv-pre(?=[\s/>=]|$)/.test(tag);
}
