/**
 * Find the `sz` attributes of a Svelte component's markup, in one pass.
 *
 * `<script>` and `<style>` blocks are code, not markup: `let sz={ p: 4 }` in a
 * script is an assignment, so a match inside one is stepped over.
 *
 * @module attributes
 */

import {
    braceGroupEnd,
    isOpeningTag,
    markupResume,
    rawTextEnd,
    readMarkup,
    type TemplateSzAttribute,
} from '@csszyx/compiler/internal';

/**
 * Collect every `sz` attribute of the markup, in order.
 *
 * @param content - The component source.
 * @returns The attributes whose value could be read.
 */
export function findSzAttributes(content: string): TemplateSzAttribute[] {
    const found: TemplateSzAttribute[] = [];
    const blocks = codeBlocks(content);
    let block = 0;
    let index = content.indexOf('sz=');
    while (index !== -1) {
        while (block < blocks.length && blocks[block][1] <= index) block += 1;
        const inBlock = block < blocks.length && blocks[block][0] <= index;
        const match =
            inBlock || !isAttributeStart(content, index) ? null : readSzAttribute(content, index);
        if (match) found.push(match);
        let next = match ? match.end : index + 3;
        if (inBlock) next = blocks[block][1];
        index = content.indexOf('sz=', next);
    }
    return found;
}

/**
 * Whether `sz=` at an offset starts an attribute: it follows `<` or space.
 *
 * @param content - The component source.
 * @param index - Offset of `sz=`.
 * @returns Whether it is an attribute name.
 */
function isAttributeStart(content: string, index: number): boolean {
    const before = index === 0 ? '<' : content.charAt(index - 1);
    return (
        before === '<' || before === ' ' || before === '\t' || before === '\n' || before === '\r'
    );
}

/**
 * The `[start, end)` ranges of the `<script>` and `<style>` blocks, in order.
 *
 * Only a real element opens one: the markup is read the way Svelte's parser
 * reads it, so `<script` written in a comment, a quoted attribute value or a
 * `{ }` expression is text. Markup that never closes (a comment, a tag, an
 * expression, a block) makes the last range, which runs to the end of the
 * source: Svelte rejects such a file, and nothing after it is read.
 *
 * One forward pass: each step starts where the previous one ended, so the
 * cost is O(n) in the source length whatever the input.
 *
 * @param content - The component source.
 * @returns The ranges.
 */
function codeBlocks(content: string): Array<[number, number]> {
    const lowered = content.toLowerCase();
    const blocks: Array<[number, number]> = [];
    const markupStart = /[<{]/g;
    for (let match = markupStart.exec(lowered); match; match = markupStart.exec(lowered)) {
        const { to, block } = markupEnd(lowered, match.index);
        if (to === -1) {
            blocks.push([match.index, content.length]);
            break;
        }
        if (block) blocks.push([match.index, to]);
        markupStart.lastIndex = to;
    }
    return blocks;
}

/**
 * Where what starts at a `<` or `{` ends, and whether it is a code block.
 *
 * @param lowered - Lower-cased source.
 * @param at - Index of the `<` or `{`.
 * @returns The index just past it, or -1 when it never closes; and whether it
 *   is a `<script>` or `<style>` block.
 */
function markupEnd(lowered: string, at: number): { to: number; block: boolean } {
    if (lowered.charAt(at) === '{') {
        const close = braceGroupEnd(lowered, at);
        return { to: close === -1 ? -1 : close + 1, block: false };
    }
    const markup = readMarkup(lowered, at, { expressions: true });
    if (markup === 'unclosed') return { to: -1, block: false };
    if (isOpeningTag(markup) && (markup.name === 'script' || markup.name === 'style')) {
        return { to: rawTextEnd(lowered, markup.name, markup.end), block: true };
    }
    return { to: markupResume(markup, at), block: false };
}

/**
 * Reads a quoted or bound value from an `sz=` attribute.
 *
 * A bound `sz={...}` value is read whatever it holds; the template lane then
 * lowers it or reports it as known only at runtime. A quoted value is read when
 * it is an object: `sz="{{ p: 4 }}"` or the shorthand `sz="{ p: 4 }"`. Any
 * other quoted string is some component's own prop and is left alone.
 *
 * @param content Svelte markup source.
 * @param start Offset of the `sz=` token.
 * @returns The attribute, or null when unsupported or malformed.
 */
function readSzAttribute(content: string, start: number): TemplateSzAttribute | null {
    const valueStart = start + 3;
    const opener = content.charAt(valueStart);
    if (opener === '"' || opener === "'") {
        const endQuote = content.indexOf(opener, valueStart + 1);
        if (endQuote === -1) {
            return null;
        }
        let from = valueStart + 1;
        let to = endQuote;
        if (content.startsWith('{{', from) && content.startsWith('}}', to - 2)) {
            from += 1;
            to -= 1;
        }
        if (content.charAt(from) !== '{' || content.charAt(to - 1) !== '}') {
            return null;
        }
        return {
            start,
            end: endQuote + 1,
            value: { source: content.slice(from, to), start: from },
        };
    }

    if (opener !== '{') {
        return null;
    }
    const end = braceGroupEnd(content, valueStart);
    if (end === -1) {
        return null;
    }
    return {
        start,
        end: end + 1,
        value: { source: content.slice(valueStart + 1, end), start: valueStart + 1 },
    };
}
