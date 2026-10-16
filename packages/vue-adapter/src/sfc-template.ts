/**
 * Find the root `<template>` block of a Vue SFC.
 *
 * The root template ends at the `</template>` that closes it. Templates nest
 * (`<template v-if>`, `<template #slot>`), and a `</template>` inside a comment,
 * an attribute value or an `{{ }}` interpolation closes nothing. Outside the
 * root template every top-level block (`<script>`, `<style>`, a custom block) is
 * raw text up to its own end tag, so a template tag written inside one is not
 * the root. Tags, comments and quoted values are read by the markup reader the
 * Svelte adapter shares, in `@csszyx/compiler`.
 *
 * One forward pass over a lower-cased copy: every search starts at or after
 * the index the previous one reached, and a search that fails ends the scan,
 * so the cost is linear in the source length whatever the input.
 *
 * @module sfc-template
 */

import {
    type ClosedMarkup,
    isOpeningTag,
    markupResume,
    rawTextEnd,
    readMarkup,
} from '@csszyx/compiler/internal';

/** The root template's content, as offsets into the source. */
export interface TemplateBounds {
    /** Offset just past the root `<template ...>`. */
    start: number;
    /** Offset of its `</template>`. */
    end: number;
}

/**
 * How what was read changes the template nesting depth.
 *
 * @param markup - What `readMarkup` read.
 * @returns 1 for an opening `<template>`, -1 for a `</template>`, else 0.
 */
function templateDepthChange(markup: ClosedMarkup): number {
    if (typeof markup !== 'object' || !('name' in markup) || markup.name !== 'template') return 0;
    if (markup.closing) return -1;
    return markup.selfClosing ? 0 : 1;
}

/**
 * The next index at or after `from` where `needle` starts, reusing an earlier
 * answer that still lies ahead.
 *
 * @param source - Lower-cased source.
 * @param needle - Text to find.
 * @param from - Where the scan stands.
 * @param known - The last answer for this needle; -1 once none was left.
 * @returns The index, or -1.
 */
function nextAt(source: string, needle: string, from: number, known: number): number {
    return known === -1 || known >= from ? known : source.indexOf(needle, from);
}

/**
 * Where the root template's content ends: the `<` of the `</template>` that
 * closes it.
 *
 * @param source - Lower-cased source.
 * @param start - Offset just past the root `<template ...>`.
 * @returns The offset, or -1 when the root template never closes.
 */
function rootTemplateEnd(source: string, start: number): number {
    let depth = 1;
    let tag = source.indexOf('<', start);
    let interpolation = source.indexOf('{{', start);
    while (tag !== -1) {
        if (interpolation !== -1 && interpolation < tag) {
            const close = source.indexOf('}}', interpolation + 2);
            // An interpolation that never closes is text, and so is every
            // later `{{`.
            interpolation = close === -1 ? -1 : source.indexOf('{{', close + 2);
            tag = close === -1 ? tag : nextAt(source, '<', close + 2, tag);
            continue;
        }
        const markup = readMarkup(source, tag);
        if (markup === 'unclosed') return -1;
        depth += templateDepthChange(markup);
        if (depth === 0) return tag;
        const index = markupResume(markup, tag);
        tag = source.indexOf('<', index);
        interpolation = nextAt(source, '{{', index, interpolation);
    }
    return -1;
}

/**
 * The root template's bounds from just past its start tag.
 *
 * @param source - Lower-cased source.
 * @param start - Offset just past the root `<template ...>`.
 * @returns The bounds, or null when it never closes.
 */
function rootTemplate(source: string, start: number): TemplateBounds | null {
    const end = rootTemplateEnd(source, start);
    return end === -1 ? null : { start, end };
}

/**
 * Find the root `<template>` of a Vue SFC.
 *
 * @param source - The SFC source.
 * @returns The content's offsets, or null when there is no root template or it
 *   never closes.
 */
export function findRootTemplate(source: string): TemplateBounds | null {
    const lowered = source.toLowerCase();
    let tag = lowered.indexOf('<');
    while (tag !== -1) {
        const markup = readMarkup(lowered, tag);
        if (markup === 'unclosed') return null;
        if (isOpeningTag(markup) && markup.name === 'template')
            return rootTemplate(lowered, markup.end);
        // Any other top-level block is raw text up to its own end tag.
        const next = isOpeningTag(markup)
            ? rawTextEnd(lowered, markup.name, markup.end)
            : markupResume(markup, tag);
        if (next === -1) return null;
        tag = lowered.indexOf('<', next);
    }
    return null;
}
