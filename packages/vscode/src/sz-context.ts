/**
 * Detect the cursor's context within a sz={{ ... }} expression.
 *
 * Strategy: scan backward from cursor, find the last `sz={{`, then walk
 * forward counting braces to determine depth and key/value position.
 *
 * Handles: nested variant objects, quoted strings, arbitrary value brackets.
 * Does NOT handle: multi-cursor, template literals as keys.
 */

import * as vscode from 'vscode';

/**
 *
 */
export type ContextType = 'none' | 'key' | 'value' | 'variant-key' | 'variant-value';

/**
 *
 */
export interface SzContext {
    type: ContextType;
    /** The sz key whose value the cursor is completing, if type is 'value'/'variant-value'. */
    currentKey: string | undefined;
    /** Brace depth inside sz={{}}: 1 = top-level, 2 = inside variant object. */
    depth: number;
}

const NONE: SzContext = { type: 'none', currentKey: undefined, depth: 0 };

/** Max chars to scan backward from cursor. Keeps response time O(1) in practice. */
const SCAN_WINDOW = 2000;

/**
 * Return the sz context at the given cursor position, or NONE if not in sz prop.
 * @param document - The VS Code text document being edited
 * @param position - The current cursor position
 * @returns SzContext describing whether cursor is in a sz prop, and if so at key or value position
 */
export function getSzContext(
    document: vscode.TextDocument,
    position: vscode.Position,
): SzContext {
    const offset = document.offsetAt(position);
    const scanStart = Math.max(0, offset - SCAN_WINDOW);
    // Text from scan start up to (but not including) cursor
    const text = document.getText(
        new vscode.Range(document.positionAt(scanStart), position),
    );

    // Quick bail — no sz prop in window
    const lastSzIdx = text.lastIndexOf('sz={{');
    if (lastSzIdx === -1) {return NONE;}

    // Start from the `{{` (skip `sz=`)
    const afterOpen = text.slice(lastSzIdx + 3); // starts at `{`

    // Walk the text counting braces/commas to build context.
    // We track the start of the "current segment" per depth level.
    // A segment starts after: an opening `{`, or a `,`.
    // A colon within the segment separates key from value.
    let depth = 0;
    const segStart: number[] = [0]; // segStart[depth] = char index where current segment started
    let lastColon = -1; // index of last `:` acting as key/value separator at this depth
    let keyAtColon = ''; // the key text before that colon

    for (let i = 0; i < afterOpen.length; i++) {
        const c = afterOpen[i];

        if (c === '{') {
            depth++;
            segStart[depth] = i + 1;
            lastColon = -1;
            keyAtColon = '';
        } else if (c === '}') {
            if (depth === 0) {return NONE;} // cursor was after the closing }}
            segStart.length = depth; // pop
            depth--;
            lastColon = -1;
            keyAtColon = '';
        } else if (c === ',' && depth >= 1) {
            segStart[depth] = i + 1;
            lastColon = -1;
            keyAtColon = '';
        } else if (c === ':' && depth >= 1) {
            // Only treat as key/value separator if not inside a string or bracket
            // We use the already-scanned segment text to decide
            const seg = afterOpen.slice(segStart[depth] ?? 0, i).trim();
            // Rough check: if seg looks like a bare identifier (key), this is a separator
            if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(seg)) {
                lastColon = i;
                keyAtColon = seg;
            }
        } else if ((c === '"' || c === "'") && depth >= 1) {
            // Skip string contents so we ignore colons inside strings
            const q = c;
            i++;
            while (i < afterOpen.length && afterOpen[i] !== q) {
                if (afterOpen[i] === '\\') {i++;} // escape
                i++;
            }
        } else if (c === '[' && depth >= 1) {
            // Skip arbitrary value brackets [...]
            let brackets = 1;
            i++;
            while (i < afterOpen.length && brackets > 0) {
                if (afterOpen[i] === '[') {brackets++;} else if (afterOpen[i] === ']') {brackets--;}
                i++;
            }
            i--; // loop will increment
        }
    }

    if (depth <= 0) {return NONE;}

    // If we saw a colon AFTER the current segment start → value position
    if (lastColon >= (segStart[depth] ?? 0)) {
        return {
            type: depth === 1 ? 'value' : 'variant-value',
            currentKey: keyAtColon || undefined,
            depth,
        };
    }

    // Otherwise → key position
    return {
        type: depth === 1 ? 'key' : 'variant-key',
        currentKey: undefined,
        depth,
    };
}
