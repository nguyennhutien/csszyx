/**
 * HoverProvider — shows the generated Tailwind class string for a sz prop.
 *
 * When the cursor hovers over a sz={{ ... }} expression, we:
 *   1. Extract the full object text (brace-balanced, not regex)
 *   2. Evaluate it safely with new Function() (user's own code)
 *   3. Call transform() from @csszyx/compiler
 *   4. Display the resulting className + any inline style attributes
 *
 * Falls back silently if the expression cannot be evaluated (dynamic values,
 * syntax errors, etc.) — hover simply doesn't appear.
 */

import { type SzObject, transform } from '@csszyx/compiler/browser';
import * as vscode from 'vscode';

import { getSzContext } from './sz-context.js';

/** Max object text length we attempt to eval. Guards against pathological inputs. */
const MAX_OBJ_LEN = 1000;

/**
 * Extract the full sz={{ ... }} object text around the given position.
 * Uses brace counting (not regex) to handle nested variant objects.
 * @param document - The document being edited
 * @param position - The current cursor position
 * @returns The raw JS object text (e.g. `{ p: 4, bg: 'blue-500' }`), or null if not found
 */
function extractSzObjectText(
    document: vscode.TextDocument,
    position: vscode.Position,
): string | null {
    // Search up to 10 lines around cursor for sz={{
    const startLine = Math.max(0, position.line - 3);
    const endLine = Math.min(document.lineCount - 1, position.line + 8);
    const text = document.getText(
        new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length),
    );

    const szIdx = text.indexOf('sz={{');
    if (szIdx === -1) {return null;}

    const objStart = szIdx + 4; // position of the outer `{`
    let depth = 0;

    for (let i = objStart; i < text.length; i++) {
        if (text[i] === '{') {depth++;} else if (text[i] === '}') {
            depth--;
            if (depth === 0) {
                const objText = text.slice(objStart, i + 1);
                return objText.length <= MAX_OBJ_LEN ? objText : null;
            }
        }
    }
    return null;
}

/**
 * Safely evaluate a JS object literal string. Returns null on any error.
 * Only used for hover (read-only display) — never written back to disk.
 * @param objText - Raw JS object literal text to evaluate
 * @returns Parsed SzObject or null if evaluation fails
 */
function evalObject(objText: string): SzObject | null {
    try {
        // new Function runs in a fresh scope — no access to local variables

        const result = new Function(`"use strict"; return (${objText})`)();
        if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
            return result as SzObject;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 *
 */
export class SzHoverProvider implements vscode.HoverProvider {
    /**
     * Provide hover content showing the generated Tailwind classes for a sz prop.
     * @param document - The document being hovered
     * @param position - The cursor position at hover time
     * @returns Hover with generated class info, or undefined if not in a sz context
     */
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.Hover | undefined {
        // Only show hover when cursor is inside a sz prop
        const ctx = getSzContext(document, position);
        if (ctx.type === 'none') {return undefined;}

        const objText = extractSzObjectText(document, position);
        if (!objText) {return undefined;}

        const szObj = evalObject(objText);
        if (!szObj) {return undefined;}

        let result: ReturnType<typeof transform>;
        try {
            result = transform(szObj);
        } catch {
            return undefined;
        }

        const md = new vscode.MarkdownString('', true);
        md.isTrusted = true;
        md.appendMarkdown('**CSSzyx** → generated classes:\n\n');
        md.appendCodeblock(result.className || '(empty)', 'plaintext');

        if (Object.keys(result.attributes).length > 0) {
            md.appendMarkdown('\n**Inline styles** (CSS variables):\n\n');
            const styleStr = Object.entries(result.attributes)
                .map(([k, v]) => `${k}: ${v}`)
                .join(';\n');
            md.appendCodeblock(styleStr, 'css');
        }

        return new vscode.Hover(md);
    }
}
