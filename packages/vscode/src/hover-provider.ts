/**
 * HoverProvider — shows the generated Tailwind class string for a sz prop.
 *
 * When the cursor hovers inside a sz expression (JSX or HTML attr form), we:
 *   1. Extract the object text that contains the cursor (brace-balanced)
 *   2. Evaluate it safely with `new Function()` (read-only display)
 *   3. Call `transform()` from @csszyx/compiler
 *   4. Display the resulting className + any inline style attributes
 *
 * Falls back silently if the expression cannot be evaluated (dynamic values,
 * syntax errors, etc.) — hover simply doesn't appear.
 */

import { type SzObject, transform } from '@csszyx/compiler/browser';
import * as vscode from 'vscode';

import { extractSzObjectAt } from './parser.js';
import { getSzContext } from './sz-context.js';

/** Max object text length we attempt to eval. Guards against pathological inputs. */
const MAX_OBJ_LEN = 1000;

/**
 * Extract the sz object text around the cursor, or null if the cursor is
 * not inside any sz expression within the scan window.
 * @param document - The document being edited
 * @param position - The current cursor position
 * @returns Raw JS object text, or null if not found.
 */
function extractSzObjectText(
    document: vscode.TextDocument,
    position: vscode.Position,
): string | null {
    const startLine = Math.max(0, position.line - 3);
    const endLine = Math.min(document.lineCount - 1, position.line + 8);
    const windowStart = new vscode.Position(startLine, 0);
    const windowEnd = new vscode.Position(endLine, document.lineAt(endLine).text.length);
    const text = document.getText(new vscode.Range(windowStart, windowEnd));

    const cursorOffset = document.offsetAt(position) - document.offsetAt(windowStart);
    const obj = extractSzObjectAt(text, cursorOffset);
    if (!obj) {
        return null;
    }
    return obj.length <= MAX_OBJ_LEN ? obj : null;
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
        const ctx = getSzContext(document, position);
        if (ctx.type === 'none') {
            return undefined;
        }

        const objText = extractSzObjectText(document, position);
        if (!objText) {
            return undefined;
        }

        const szObj = evalObject(objText);
        if (!szObj) {
            return undefined;
        }

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
