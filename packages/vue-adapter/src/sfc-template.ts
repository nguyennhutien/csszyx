/**
 * Find the root `<template>` block of a Vue SFC.
 *
 * The root template ends at the `</template>` that closes it. Templates nest
 * (`<template v-if>`, `<template #slot>`), and a `</template>` inside a comment,
 * an attribute value or an `{{ }}` interpolation closes nothing. Outside the
 * root template every top-level block (`<script>`, `<style>`, a custom block) is
 * raw text up to its own end tag, so a template tag written inside one is not
 * the root.
 *
 * One forward pass over a lower-cased copy: every search starts at or after
 * the index the previous one reached, and a search that fails ends the scan,
 * so the cost is linear in the source length whatever the input.
 *
 * @module sfc-template
 */

/** One tag read from its `<`. */
interface Tag {
    /** Lower-cased tag name. */
    name: string;
    /** Whether it is an end tag (`</name>`). */
    closing: boolean;
    /** Whether it ends in `/>`. */
    selfClosing: boolean;
    /** Index just past its `>`. */
    end: number;
}

/** What starts at a `<`: a tag, a span to skip, text, or input that never closes. */
type Markup = Tag | { skip: number } | 'text' | 'unclosed';

/** What starts at a `<` when it closes. */
type ClosedMarkup = Exclude<Markup, 'unclosed'>;

/** The root template's content, as offsets into the source. */
export interface TemplateBounds {
    /** Offset just past the root `<template ...>`. */
    start: number;
    /** Offset of its `</template>`. */
    end: number;
}

/**
 * Whether a character is HTML whitespace.
 *
 * @param char - One character.
 * @returns Whether it is a space, tab, line feed, form feed or carriage return.
 */
function isSpace(char: string): boolean {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}

/**
 * Whether a character ends a tag name.
 *
 * @param char - One character; `''` past the end of the source.
 * @returns Whether it is whitespace, `/`, `>` or the end.
 */
function endsTagName(char: string): boolean {
    return char === '' || char === '/' || char === '>' || isSpace(char);
}

/**
 * Where a tag's `>` is, from just past its name. A quoted attribute value is
 * read whole; a quote anywhere else is part of a name or an unquoted value.
 *
 * @param source - Lower-cased source.
 * @param from - Index just past the tag name.
 * @returns The index of the `>`, or -1 when the tag never closes.
 */
function tagEnd(source: string, from: number): number {
    let afterEquals = false;
    let index = from;
    while (index < source.length) {
        const char = source.charAt(index);
        if (char === '>') return index;
        if (char === '=') {
            afterEquals = true;
        } else if (!isSpace(char)) {
            if (afterEquals && (char === '"' || char === "'")) {
                const close = source.indexOf(char, index + 1);
                if (close === -1) return -1;
                index = close;
            }
            afterEquals = false;
        }
        index += 1;
    }
    return -1;
}

/**
 * Read what starts at a `<`.
 *
 * @param source - Lower-cased source.
 * @param at - Index of the `<`.
 * @returns The tag, a span to skip (a comment, `<!…>`, `<?…>`), `'text'` for a
 *   `<` that starts none of them, or `'unclosed'`.
 */
function readMarkup(source: string, at: number): Markup {
    if (source.startsWith('<!--', at)) {
        const close = source.indexOf('-->', at + 4);
        return close === -1 ? 'unclosed' : { skip: close + 3 };
    }
    const next = source.charAt(at + 1);
    if (next === '!' || next === '?') {
        const close = source.indexOf('>', at + 2);
        return close === -1 ? 'unclosed' : { skip: close + 1 };
    }
    const closing = next === '/';
    const nameStart = closing ? at + 2 : at + 1;
    const first = source.charAt(nameStart);
    if (first < 'a' || first > 'z') return 'text';
    let nameEnd = nameStart + 1;
    while (!endsTagName(source.charAt(nameEnd))) nameEnd += 1;
    const close = tagEnd(source, nameEnd);
    if (close === -1) return 'unclosed';
    return {
        name: source.slice(nameStart, nameEnd),
        closing,
        selfClosing: source.charAt(close - 1) === '/',
        end: close + 1,
    };
}

/**
 * Where scanning resumes after what starts at a `<`.
 *
 * @param markup - What {@link readMarkup} read there.
 * @param at - Index of the `<`.
 * @returns The index after it.
 */
function resume(markup: ClosedMarkup, at: number): number {
    if (markup === 'text') return at + 1;
    return 'skip' in markup ? markup.skip : markup.end;
}

/**
 * Whether what was read is a start tag that opens an element.
 *
 * @param markup - What {@link readMarkup} read.
 * @returns Whether it is a tag that is neither an end tag nor self-closing.
 */
function isOpening(markup: ClosedMarkup): markup is Tag {
    return typeof markup === 'object' && 'name' in markup && !markup.closing && !markup.selfClosing;
}

/**
 * How what was read changes the template nesting depth.
 *
 * @param markup - What {@link readMarkup} read.
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
        const index = resume(markup, tag);
        tag = source.indexOf('<', index);
        interpolation = nextAt(source, '{{', index, interpolation);
    }
    return -1;
}

/**
 * Where a raw-text top-level block ends: just past its own end tag.
 *
 * @param source - Lower-cased source.
 * @param name - The block's tag name.
 * @param from - Offset just past its start tag.
 * @returns The offset, or -1 when the block never closes.
 */
function rawTextEnd(source: string, name: string, from: number): number {
    const needle = `</${name}`;
    for (
        let close = source.indexOf(needle, from);
        close !== -1;
        close = source.indexOf(needle, close + 2)
    ) {
        if (!endsTagName(source.charAt(close + needle.length))) continue;
        const end = tagEnd(source, close + needle.length);
        return end === -1 ? -1 : end + 1;
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
        if (isOpening(markup) && markup.name === 'template')
            return rootTemplate(lowered, markup.end);
        // Any other top-level block is raw text up to its own end tag.
        const next = isOpening(markup)
            ? rawTextEnd(lowered, markup.name, markup.end)
            : resume(markup, tag);
        if (next === -1) return null;
        tag = lowered.indexOf('<', next);
    }
    return null;
}
