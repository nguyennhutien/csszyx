/**
 * Find the `sz` attributes of a Svelte component's markup, in one pass.
 *
 * `<script>` and `<style>` blocks are code, not markup: `let sz={ p: 4 }` in a
 * script is an assignment, so a match inside one is stepped over.
 *
 * @module attributes
 */

import type { TemplateSzAttribute } from '@csszyx/compiler';

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
 * A block that never closes runs to the end of the source.
 *
 * @param content - The component source.
 * @returns The ranges.
 */
function codeBlocks(content: string): Array<[number, number]> {
    const lowered = content.toLowerCase();
    const blocks: Array<[number, number]> = [];
    let index = 0;
    for (;;) {
        const script = lowered.indexOf('<script', index);
        const style = lowered.indexOf('<style', index);
        const start = script === -1 || (style !== -1 && style < script) ? style : script;
        if (start === -1) return blocks;
        const name = start === script ? 'script' : 'style';
        const after = lowered.charAt(start + name.length + 1);
        if (after !== '>' && !/\s/.test(after)) {
            index = start + 1;
            continue;
        }
        const close = lowered.indexOf(`</${name}`, start);
        const end = close === -1 ? content.length : close;
        blocks.push([start, end]);
        index = end;
    }
}

/**
 * Reads a quoted or bound value from an `sz=` attribute.
 *
 * A bound `sz={...}` value is any expression. A quoted value is read when it is
 * an object: `sz="{{ p: 4 }}"` or the shorthand `sz="{ p: 4 }"`. Any other
 * quoted string is some component's own prop and is left alone.
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
    const end = findBalancedBraceEnd(content, valueStart);
    if (end === -1) {
        return null;
    }
    return {
        start,
        end: end + 1,
        value: { source: content.slice(valueStart + 1, end), start: valueStart + 1 },
    };
}

/**
 * Finds the closing brace for a JavaScript expression in linear time.
 *
 * @param content Svelte markup source.
 * @param start Offset of the opening expression brace.
 * @returns Closing brace offset, or -1 when unbalanced.
 */
function findBalancedBraceEnd(content: string, start: number): number {
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let index = start; index < content.length; index += 1) {
        const char = content.charAt(index);
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
                quote = '';
            }
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            quote = char;
        } else if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }
    return -1;
}
