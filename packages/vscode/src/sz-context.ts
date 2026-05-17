/**
 * VS Code wrapper around `parseSzContext` — reads the text window preceding
 * the cursor and defers all parsing logic to the pure helper in `parser.ts`.
 *
 * Supports both JSX (`sz={{ ... }}`) and HTML attribute (`sz="{...}"`,
 * `sz='{...}'`) forms — the underlying parser treats them uniformly.
 */

import * as vscode from 'vscode';

import { parseSzContext, type SzContext } from './parser.js';

export type { ContextType, SzContext } from './parser.js';

/** Max chars to scan backward from cursor. Keeps response time O(1) in practice. */
const SCAN_WINDOW = 2000;

/**
 * Return the sz context at the given cursor position, or NONE if not in sz prop.
 * @param document - The VS Code text document being edited
 * @param position - The current cursor position
 * @returns SzContext describing whether cursor is in a sz prop, and if so at key or value position
 */
export function getSzContext(document: vscode.TextDocument, position: vscode.Position): SzContext {
    const offset = document.offsetAt(position);
    const scanStart = Math.max(0, offset - SCAN_WINDOW);
    const text = document.getText(new vscode.Range(document.positionAt(scanStart), position));
    return parseSzContext(text);
}
