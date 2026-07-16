/**
 * spec-to-tests.ts
 *
 * Parses docs/specs/SPEC_INDEX.md and generates
 * tests/generated/spec-tests.json with test cases for the compiler.
 *
 * Usage: npx ts-node scripts/spec-to-tests.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Interfaces ──────────────────────────────────────────────────────────────

/**
 * Represents a single test case for the compiler.
 */
interface TestCase {
    id: string;
    szInput: Record<string, unknown>;
    expectedClass: string;
    tailwindVersion: '3' | '4';
    category: string;
    subcategory?: string;
}

/**
 * Represents a collection of test cases (a test suite).
 */
interface TestSuite {
    version: string;
    generatedAt: string;
    totalTests: number;
    tests: TestCase[];
}

/**
 * Defines a scale (e.g., spacing, colors) and which utilities use it.
 */
interface ScaleDef {
    values: (string | number)[];
    negative?: boolean;
    usedBy: string[];
}

// ─── Value Scales Reference ──────────────────────────────────────────────────

const SCALES: Record<string, ScaleDef> = {
    spacing: {
        values: [
            0,
            'px',
            0.5,
            1,
            1.5,
            2,
            2.5,
            3,
            3.5,
            4,
            5,
            6,
            7,
            8,
            9,
            10,
            11,
            12,
            14,
            16,
            20,
            24,
            28,
            32,
            36,
            40,
            44,
            48,
            52,
            56,
            60,
            64,
            72,
            80,
            96,
        ],
        negative: true,
        usedBy: [
            'p',
            'px',
            'py',
            'pt',
            'pr',
            'pb',
            'pl',
            'ps',
            'pe',
            'm',
            'mx',
            'my',
            'mt',
            'mr',
            'mb',
            'ml',
            'ms',
            'me',
            'gap',
            'gap-x',
            'gap-y',
            'space-x',
            'space-y',
            'w',
            'h',
            'size',
            'inset',
            'inset-x',
            'inset-y',
            'top',
            'right',
            'bottom',
            'left',
            'start',
            'end',
            'translate-x',
            'translate-y',
            'scroll-m',
            'scroll-mx',
            'scroll-my',
            'scroll-mt',
            'scroll-mr',
            'scroll-mb',
            'scroll-ml',
            'scroll-p',
            'scroll-px',
            'scroll-py',
            'scroll-pt',
            'scroll-pr',
            'scroll-pb',
            'scroll-pl',
            'indent',
            'basis',
            'min-w',
            'max-w',
            'min-h',
            'max-h',
        ],
    },
    fractions: {
        values: [
            '1/2',
            '1/3',
            '2/3',
            '1/4',
            '2/4',
            '3/4',
            '1/5',
            '2/5',
            '3/5',
            '4/5',
            '1/6',
            '2/6',
            '3/6',
            '4/6',
            '5/6',
            '1/12',
            '2/12',
            '3/12',
            '4/12',
            '5/12',
            '6/12',
            '7/12',
            '8/12',
            '9/12',
            '10/12',
            '11/12',
            'full',
        ],
        usedBy: [
            'w',
            'h',
            'basis',
            'translate-x',
            'translate-y',
            'inset',
            'top',
            'right',
            'bottom',
            'left',
            'min-w',
            'max-w',
            'size',
        ],
    },
    opacity: {
        values: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
        usedBy: ['opacity'],
    },
    'z-index': {
        values: [0, 10, 20, 30, 40, 50, 'auto'],
        negative: true,
        usedBy: ['z'],
    },
    'border-width': {
        values: [0, 'DEFAULT', 2, 4, 8],
        usedBy: [
            'border',
            'border-t',
            'border-r',
            'border-b',
            'border-l',
            'border-x',
            'border-y',
            'divide-x',
            'divide-y',
            'ring',
            'ring-offset',
            'outline-offset',
        ],
    },
    'border-radius': {
        values: ['none', 'sm', 'DEFAULT', 'md', 'lg', 'xl', '2xl', '3xl', 'full'],
        usedBy: [
            'rounded',
            'rounded-t',
            'rounded-r',
            'rounded-b',
            'rounded-l',
            'rounded-tl',
            'rounded-tr',
            'rounded-br',
            'rounded-bl',
            'rounded-s',
            'rounded-e',
            'rounded-ss',
            'rounded-se',
            'rounded-es',
            'rounded-ee',
        ],
    },
    'font-size': {
        values: [
            'xs',
            'sm',
            'base',
            'lg',
            'xl',
            '2xl',
            '3xl',
            '4xl',
            '5xl',
            '6xl',
            '7xl',
            '8xl',
            '9xl',
        ],
        usedBy: ['text'],
    },
    'font-weight': {
        values: [
            'thin',
            'extralight',
            'light',
            'normal',
            'medium',
            'semibold',
            'bold',
            'extrabold',
            'black',
        ],
        usedBy: ['font'],
    },
    'line-height': {
        values: ['none', 'tight', 'snug', 'normal', 'relaxed', 'loose', 3, 4, 5, 6, 7, 8, 9, 10],
        usedBy: ['leading'],
    },
    'letter-spacing': {
        values: ['tighter', 'tight', 'normal', 'wide', 'wider', 'widest'],
        usedBy: ['tracking'],
    },
    blur: {
        values: ['none', 'sm', 'DEFAULT', 'md', 'lg', 'xl', '2xl', '3xl'],
        usedBy: ['blur', 'backdrop-blur'],
    },
    shadow: {
        values: ['2xs', 'xs', 'sm', 'DEFAULT', 'md', 'lg', 'xl', '2xl', 'none'],
        usedBy: ['shadow'],
    },
    duration: {
        values: [0, 75, 100, 150, 200, 300, 500, 700, 1000],
        usedBy: ['duration', 'delay'],
    },
    rotate: {
        values: [0, 1, 2, 3, 6, 12, 45, 90, 180],
        negative: true,
        usedBy: ['rotate'],
    },
    scale: {
        values: [0, 50, 75, 90, 95, 100, 105, 110, 125, 150, 200],
        usedBy: ['scale', 'scale-x', 'scale-y'],
    },
    skew: {
        values: [0, 1, 2, 3, 6, 12],
        negative: true,
        usedBy: ['skew-x', 'skew-y'],
    },
    'grid-template': {
        values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 'none', 'subgrid'],
        usedBy: ['grid-cols', 'grid-rows'],
    },
    order: {
        values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 'first', 'last', 'none'],
        negative: true,
        usedBy: ['order'],
    },
    'container-sizes': {
        values: [
            '3xs',
            '2xs',
            'xs',
            'sm',
            'md',
            'lg',
            'xl',
            '2xl',
            '3xl',
            '4xl',
            '5xl',
            '6xl',
            '7xl',
        ],
        usedBy: ['max-w'],
    },
    'filter-percentage': {
        values: [0, 50, 75, 90, 95, 100, 105, 110, 125, 150, 200],
        usedBy: [
            'brightness',
            'contrast',
            'saturate',
            'backdrop-brightness',
            'backdrop-contrast',
            'backdrop-saturate',
        ],
    },
    'filter-boolean': {
        values: [0, 'DEFAULT'],
        usedBy: [
            'grayscale',
            'invert',
            'sepia',
            'backdrop-grayscale',
            'backdrop-invert',
            'backdrop-sepia',
        ],
    },
    'hue-rotate': {
        values: [0, 15, 30, 60, 90, 180],
        negative: true,
        usedBy: ['hue-rotate', 'backdrop-hue-rotate'],
    },
    'line-clamp': {
        values: [1, 2, 3, 4, 5, 6, 'none'],
        usedBy: ['line-clamp'],
    },
    'flex-factor': {
        values: [0, 'DEFAULT'],
        usedBy: ['grow', 'shrink'],
    },
    'ring-width': {
        values: [0, 1, 2, 'DEFAULT', 4, 8],
        usedBy: ['ring'],
    },
    'outline-width': {
        values: [0, 1, 2, 4, 8],
        usedBy: ['outline'],
    },
    'divide-width': {
        values: [0, 'DEFAULT', 2, 4, 8],
        usedBy: ['divide-x', 'divide-y'],
    },
    'col-span': {
        values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        usedBy: ['col-span'],
    },
    'col-start-end': {
        values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
        usedBy: ['col-start', 'col-end', 'row-start', 'row-end'],
    },
    'row-span': {
        values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        usedBy: ['row-span'],
    },
    columns: {
        values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        usedBy: ['columns'],
    },
    'drop-shadow': {
        values: ['sm', 'DEFAULT', 'md', 'lg', 'xl', '2xl', 'none'],
        usedBy: ['drop-shadow'],
    },
    'backdrop-opacity': {
        values: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
        usedBy: ['backdrop-opacity'],
    },
};

// Build reverse lookup: utility prefix -> scale names (multiple possible)
const PREFIX_TO_SCALES: Record<string, string[]> = {};
for (const [scaleName, def] of Object.entries(SCALES)) {
    for (const prefix of def.usedBy) {
        if (!PREFIX_TO_SCALES[prefix]) {
            PREFIX_TO_SCALES[prefix] = [];
        }
        PREFIX_TO_SCALES[prefix].push(scaleName);
    }
}

/**
 * Pick the best scale for a given prefix based on the range endpoint values.
 * e.g., prefix "basis" with value "1" -> spacing, value "1/2" -> fractions
 * @param prefix The utility prefix (e.g., "p", "basis").
 * @param startVal The start value of the range.
 * @param endVal The end value of the range.
 * @returns The name of the scale to use, or null if not found.
 */
function pickScale(prefix: string, startVal: string, endVal: string): string | null {
    const scaleNames = PREFIX_TO_SCALES[prefix];
    if (!scaleNames || scaleNames.length === 0) {
        return null;
    }
    if (scaleNames.length === 1) {
        return scaleNames[0];
    }

    // Heuristic: check if values look like fractions, numbers, or strings
    const isFraction = (v: string): boolean => /^\d+\/\d+$/.test(v);
    const isNumeric = (v: string): boolean => /^-?\d+(\.\d+)?$/.test(v) || v === 'px';

    if (isFraction(startVal) || isFraction(endVal)) {
        // Prefer 'fractions' scale
        return scaleNames.find(s => s === 'fractions') || scaleNames[0];
    }
    if (isNumeric(startVal) || isNumeric(endVal)) {
        // Prefer 'spacing' or numeric scale
        return (
            scaleNames.find(s => s === 'spacing') ||
            scaleNames.find(s => s !== 'fractions') ||
            scaleNames[0]
        );
    }
    // Default: first scale
    return scaleNames[0];
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Logs a message to the console.
 * @param msg The message to log.
 */
function log(msg: string): void {
    console.info(`[spec-to-tests] ${msg}`);
}

/**
 * Logs a warning to the console.
 * @param msg The warning message to log.
 */
function warn(msg: string): void {
    console.warn(`[spec-to-tests] WARNING: ${msg}`);
}

/**
 * Slugifies a string.
 * @param text The text to slugify.
 * @returns The slugified string.
 */
function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Strips markdown from a string.
 * @param text The text to strip markdown from.
 * @returns The stripped string.
 */
function stripMarkdown(text: string): string {
    return text.split('`').join('').split('**').join('').split('*').join('').trim();
}

/**
 * Splits a table row into cells.
 * @param line The table row line.
 * @returns An array of cells.
 */
function splitTableRow(line: string): string[] {
    const trimmed = line.trim();
    let inner = trimmed;
    if (inner.startsWith('|')) {
        inner = inner.slice(1);
    }
    if (inner.endsWith('|')) {
        inner = inner.slice(0, -1);
    }
    return inner.split('|').map(cell => cell.trim());
}

/**
 * Checks if a line is a table separator row.
 * @param line The line to check.
 * @returns True if it's a separator row.
 */
function isSeparatorRow(line: string): boolean {
    return /^\|\s*:?-+/.test(line.trim());
}

/**
 * Checks if a line is a table row.
 * @param line The line to check.
 * @returns True if it's a table row.
 */
function isTableRow(line: string): boolean {
    return line.trim().startsWith('|');
}

// ─── sz Prop Parser ──────────────────────────────────────────────────────────

/**
 * Parses a sz prop from a raw string.
 * @param raw The raw sz prop string.
 * @returns The parsed object or null.
 */
function parseSzProp(raw: string): Record<string, unknown> | null {
    let cleaned = stripMarkdown(raw).trim();

    // Strip trailing " etc." or " etc" that some spec rows have
    cleaned = cleaned.replace(/(?<!\s)\s+etc\.?\s*$/, '');

    // Must start with { and end with }
    if (!cleaned.startsWith('{') || !cleaned.endsWith('}')) {
        return null;
    }

    // Skip literal ellipsis inside objects: { before: { ... } }
    // But allow `...` that is part of CSS values like 'url(...)'
    if (/\{\s*\.\.\.\s*\}/.test(cleaned)) {
        return null;
    }

    // Skip spread syntax: { ...baseProps }
    if (/\{\s*\.\.\./.test(cleaned)) {
        return null;
    }

    // Step 1: Replace double-quoted strings FIRST (they may contain single quotes)
    const strings: string[] = [];
    cleaned = cleaned.replace(/"([^"]*)"/g, (_match, content: string) => {
        strings.push(content);
        return `"__STR_${strings.length - 1}__"`;
    });

    // Step 1b: Replace remaining single-quoted strings with placeholders
    cleaned = cleaned.replace(/'([^']*)'/g, (_match, content: string) => {
        strings.push(content);
        return `"__STR_${strings.length - 1}__"`;
    });

    // Step 2: Quote unquoted object keys
    // Handle keys that are bare identifiers (camelCase, $, _)
    cleaned = cleaned.replace(/([{,]\s*)([a-z_$][\w$]*)\s*:/gi, '$1"$2":');

    // Step 3: Restore string placeholders
    cleaned = cleaned.replace(/"__STR_(\d+)__"/g, (_match, idx: string) => {
        return `"${strings[parseInt(idx, 10)]}"`;
    });

    try {
        return JSON.parse(cleaned);
    } catch {
        return null;
    }
}

// ─── Range Notation Expansion ────────────────────────────────────────────────

/**
 * Extracts the utility prefix from a Tailwind class.
 * e.g., "basis-1" -> "basis", "p-4" -> "p", "grid-cols-1" -> "grid-cols"
 * @param twClass The Tailwind class.
 * @returns The prefix or null if not matched.
 */
function extractPrefix(twClass: string): string | null {
    // Match pattern: prefix-value where value is at the end
    const match = twClass.match(/^(.+?)-[^-]+$/);
    return match ? match[1] : null;
}

/**
 * Maps a sz prop key to its Tailwind utility prefix.
 * e.g., "basis" -> "basis", "gridCols" -> "grid-cols", "p" -> "p"
 * @param key The sz prop key.
 * @returns The Tailwind utility prefix.
 */
function szKeyToPrefix(key: string): string {
    // Convert camelCase to kebab-case
    return key.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/**
 * Result of a range expansion attempt.
 */
interface RangeExpansionResult {
    tests: TestCase[];
    expanded: boolean;
}

/**
 * Tries to expand a range notation in the spec row.
 * @param twCell The content of the Tailwind column.
 * @param szCell The content of the sz prop column.
 * @param category The current category.
 * @param subcategory The current subcategory.
 * @param concept The current concept.
 * @param idCounter The ID counter map.
 * @returns The expansion result.
 */
function tryExpandRange(
    twCell: string,
    szCell: string,
    category: string,
    subcategory: string,
    concept: string,
    idCounter: Map<string, number>,
): RangeExpansionResult {
    // Normalize: treat " ... " (with spaces) the same as "..."
    const twNorm = twCell.replace(/(?<!\s)\s+\.\.\.\s+/g, '...');
    const szNorm = szCell.replace(/(?<!\s)\s+\.\.\.\s+/g, '...');

    // Check if cells contain range notation (...) OUTSIDE of brackets and quotes
    // Range notation: "class-1...class-n" or "{ key: 1 }...{ key: n }"
    // NOT: "mask-[url(...)]" or "{ mask: 'url(...)' }"
    const hasRangeDots = (s: string): boolean => {
        // Remove content inside [...] and (...) and '...' and "..."
        const stripped = s
            .replace(/\[[^[\]]*\]/g, '')
            .replace(/\([^()]*\)/g, '')
            .replace(/'[^']*'/g, '')
            .replace(/"[^"]*"/g, '');
        return stripped.includes('...');
    };

    if (!hasRangeDots(twNorm) || !hasRangeDots(szNorm)) {
        return { tests: [], expanded: false };
    }

    // Extract the utility prefix and start/end values from the Tailwind class
    // e.g., "basis-1...basis-96" -> prefix = "basis", startVal = "1", endVal = "96"
    const twParts = twNorm.split('...');
    const firstTwClass = stripMarkdown(twParts[0].replace(/,\s*$/, '').trim());
    const lastTwClass = stripMarkdown(twParts[twParts.length - 1].replace(/^\s*,/, '').trim());
    const prefix = extractPrefix(firstTwClass);
    if (!prefix) {
        return { tests: [], expanded: false };
    }

    // Extract range endpoint values
    const startVal = firstTwClass.slice(prefix.length + 1); // after "prefix-"
    const endVal = lastTwClass.startsWith(`${prefix}-`) ? lastTwClass.slice(prefix.length + 1) : '';

    // Extract the sz prop key
    // e.g., "{ basis: 1 }...{ basis: 96 }" -> key = "basis"
    const szMatch = szNorm.match(/\{\s*"?([a-z_$][\w$]*)"?\s*:/i);
    if (!szMatch) {
        const szMatch2 = szNorm.match(/\{\s*'([^']+)'\s*:/);
        if (!szMatch2) {
            return { tests: [], expanded: false };
        }
    }
    const szKey = szMatch ? szMatch[1] : '';
    if (!szKey) {
        return { tests: [], expanded: false };
    }

    // Look up scale by prefix, using range values to disambiguate
    const scaleName = pickScale(prefix, startVal, endVal);
    if (!scaleName) {
        // Fallback: try the szKey converted to prefix
        const altPrefix = szKeyToPrefix(szKey);
        const altScale = pickScale(altPrefix, startVal, endVal);
        if (!altScale) {
            warn(`No scale found for prefix "${prefix}" or "${altPrefix}"`);
            return { tests: [], expanded: false };
        }
        return expandFromScale(altScale, prefix, szKey, category, subcategory, concept, idCounter);
    }

    return expandFromScale(scaleName, prefix, szKey, category, subcategory, concept, idCounter);
}

/**
 * Expands test cases from a scale.
 * @param scaleName The name of the scale.
 * @param twPrefix The Tailwind utility prefix.
 * @param szKey The sz prop key.
 * @param category The current category.
 * @param subcategory The current subcategory.
 * @param concept The current concept.
 * @param idCounter The ID counter map.
 * @returns The expansion result.
 */
function expandFromScale(
    scaleName: string,
    twPrefix: string,
    szKey: string,
    category: string,
    subcategory: string,
    concept: string,
    idCounter: Map<string, number>,
): RangeExpansionResult {
    const scale = SCALES[scaleName];
    if (!scale) {
        return { tests: [], expanded: false };
    }

    const tests: TestCase[] = [];

    for (const val of scale.values) {
        const isDefault = val === 'DEFAULT';
        const twClass = isDefault ? twPrefix : `${twPrefix}-${val}`;

        // Determine the szInput value type
        let szValue: unknown;
        if (isDefault) {
            szValue = true;
        } else if (typeof val === 'number') {
            szValue = val;
        } else {
            // Try to parse as number if it looks numeric
            const num = Number(val);
            szValue = Number.isNaN(num) ? val : num;
        }

        const id = generateId(category, subcategory, `${concept}-${val}`, undefined, idCounter);
        tests.push({
            id,
            szInput: { [szKey]: szValue },
            expectedClass: twClass,
            tailwindVersion: '4',
            category,
            subcategory,
        });
    }

    return { tests, expanded: true };
}

// ─── ID Generation ───────────────────────────────────────────────────────────

/**
 * Generates a unique ID for a test case.
 * @param category The category.
 * @param subcategory The subcategory.
 * @param concept The concept.
 * @param colLabel The column label.
 * @param idCounter The ID counter map.
 * @returns The generated ID.
 */
function generateId(
    category: string,
    subcategory: string,
    concept: string,
    colLabel: string | undefined,
    idCounter: Map<string, number>,
): string {
    const parts = [slugify(category)];
    if (subcategory) {
        parts.push(slugify(subcategory));
    }
    if (concept) {
        parts.push(slugify(concept));
    }
    if (colLabel && colLabel !== 'default') {
        parts.push(slugify(colLabel));
    }

    let baseId = parts.filter(Boolean).join('-');
    if (!baseId) {
        baseId = 'unknown';
    }

    const count = idCounter.get(baseId);
    if (count !== undefined) {
        idCounter.set(baseId, count + 1);
        return `${baseId}-${count + 1}`;
    }
    idCounter.set(baseId, 1);
    return baseId;
}

// ─── Column Detection ────────────────────────────────────────────────────────

/**
 * Information about relevant columns in a markdown table.
 */
interface ColumnInfo {
    tailwindIdx: number;
    szIndices: { idx: number; label: string }[];
    conceptIdx: number;
    isUtilityTable: boolean;
}

/**
 * Detects tool columns in a table.
 * @param headerCells The table header cells.
 * @returns The detected column info.
 */
function detectColumns(headerCells: string[]): ColumnInfo {
    let tailwindIdx = -1;
    const szIndices: { idx: number; label: string }[] = [];
    let conceptIdx = 0; // default to first column

    for (let i = 0; i < headerCells.length; i++) {
        const cell = headerCells[i].toLowerCase();

        // Tailwind class column
        if (cell.includes('tailwind') && (cell.includes('class') || cell.includes('output'))) {
            tailwindIdx = i;
        }

        // sz prop column(s)
        if (cell.includes('sz') || cell.includes('`sz`')) {
            const cellLower = cell;
            let label = 'default';
            if (cellLower.includes('canonical')) {
                label = 'canonical';
            } else if (cellLower.includes('alias') || cellLower.includes('short')) {
                label = 'alias';
            } else if (cellLower.includes('boolean') || cellLower.includes('sugar')) {
                label = 'boolean';
            }
            szIndices.push({ idx: i, label });
        }

        // Concept column
        if (cell.includes('concept')) {
            conceptIdx = i;
        }
    }

    const isUtilityTable = tailwindIdx >= 0 && szIndices.length > 0;
    return { tailwindIdx, szIndices, conceptIdx, isUtilityTable };
}

// ─── Comma-Separated List Parsing ────────────────────────────────────────────

/**
 * Detects if a Tailwind cell contains a comma-separated list of classes
 * AND the sz cell also contains matching comma-separated objects.
 * e.g., `text-xs`, `text-sm`, `text-base` / `{ text: 'xs' }`, `{ text: 'sm' }` etc.
 * @param twCell The content of the Tailwind column.
 * @param szCell The content of the sz prop column.
 * @param category The current category.
 * @param subcategory The current subcategory.
 * @param concept The current concept.
 * @param idCounter The ID counter map.
 * @returns An array of test cases or null.
 */
function parseCommaSeparatedRow(
    twCell: string,
    szCell: string,
    category: string,
    subcategory: string,
    concept: string,
    idCounter: Map<string, number>,
): TestCase[] | null {
    // Check for comma-separated Tailwind classes
    const twClasses = twCell
        .split(',')
        .map(c => stripMarkdown(c.trim()))
        .filter(Boolean);
    if (twClasses.length <= 1) {
        return null;
    }

    // Extract all sz objects from the cell
    const szObjects: string[] = [];
    const objPattern = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
    for (const match of szCell.matchAll(objPattern)) {
        szObjects.push(match[0]);
    }

    // If no pairable objects found, try parsing as a single sz input for all classes
    if (szObjects.length === 0) {
        return null;
    }

    const tests: TestCase[] = [];

    const pairCount = Math.min(twClasses.length, szObjects.length);
    for (let i = 0; i < pairCount; i++) {
        const parsed = parseSzProp(szObjects[i]);
        if (parsed && twClasses[i]) {
            const id = generateId(
                category,
                subcategory,
                `${concept}-${i + 1}`,
                undefined,
                idCounter,
            );
            tests.push({
                id,
                szInput: parsed,
                expectedClass: twClasses[i],
                tailwindVersion: '4',
                category,
                subcategory,
            });
        }
    }

    return tests.length > 0 ? tests : null;
}

// ─── Heading Parser ──────────────────────────────────────────────────────────

/** Parsed Markdown heading used by the table state machine. */
interface Heading {
    /** Markdown heading depth. */
    level: number;
    /** Normalized heading text. */
    text: string;
}

/**
 * Parses a markdown heading.
 * @param line The line containing the heading.
 * @returns The level and text of the heading, or null.
 */
function parseHeading(line: string): Heading | null {
    const match = line.match(/^(#{2,4})\s+(\S.*)$/);
    if (!match) {
        return null;
    }
    return {
        level: match[1].length,
        text: stripMarkdown(match[2].trim()),
    };
}

// ─── Sections to skip ────────────────────────────────────────────────────────

const SKIP_CATEGORIES = new Set([
    'Value Scales Reference',
    'Overview',
    'Test Case Generation Strategy',
]);

const SKIP_SUBSECTIONS = new Set([
    'Style Conflict Management',
    'Detecting classes in source files',
    'Using custom CSS & Plugins',
    'Prefix Option',
    'Parser Instructions',
]);

// ─── Main ────────────────────────────────────────────────────────────────────

interface ParserState {
    currentCategory: string;
    currentSubcategory: string;
    inTable: boolean;
    columnInfo: ColumnInfo | null;
    skipCurrentCategory: boolean;
    skipCurrentSubsection: boolean;
    tests: TestCase[];
    idCounter: Map<string, number>;
    skippedRows: number;
    warnings: string[];
    categoryCounts: Record<string, number>;
}

/**
 * Create isolated mutable state for one spec parsing pass.
 * @returns Empty parser state.
 */
function createParserState(): ParserState {
    return {
        currentCategory: '',
        currentSubcategory: '',
        inTable: false,
        columnInfo: null,
        skipCurrentCategory: false,
        skipCurrentSubsection: false,
        tests: [],
        idCounter: new Map<string, number>(),
        skippedRows: 0,
        warnings: [],
        categoryCounts: {},
    };
}

/**
 * Apply a heading transition to parser state.
 * @param state - Current parser state.
 * @param heading - Parsed heading level and text.
 */
function applyHeading(state: ParserState, heading: Heading): void {
    state.inTable = false;
    state.columnInfo = null;

    if (heading.level === 2) {
        state.currentCategory = heading.text;
        state.currentSubcategory = '';
        state.skipCurrentCategory = SKIP_CATEGORIES.has(heading.text);
        state.skipCurrentSubsection = false;
        if (!state.skipCurrentCategory) log(`Category: ${heading.text}`);
        return;
    }

    if (heading.level === 3) {
        state.currentSubcategory = heading.text;
        state.skipCurrentSubsection = SKIP_SUBSECTIONS.has(heading.text);
        if (!state.skipCurrentCategory && !state.skipCurrentSubsection) {
            log(`  Subcategory: ${heading.text}`);
        }
        return;
    }

    if (heading.level === 4 && SKIP_SUBSECTIONS.has(heading.text)) {
        state.skipCurrentSubsection = true;
    }
}

/**
 * Register generated tests and their per-category counts.
 * @param state - Current parser state.
 * @param generated - Tests produced by a range or comma expansion.
 */
function appendGeneratedTests(state: ParserState, generated: TestCase[]): void {
    for (const test of generated) {
        state.tests.push(test);
        state.categoryCounts[test.category] = (state.categoryCounts[test.category] || 0) + 1;
    }
}

/**
 * Detect whether a row with no Tailwind output still carries an sz object.
 * @param cells - Parsed table cells.
 * @param columnInfo - Utility table column layout.
 * @returns True when at least one sz column contains an object.
 */
function hasSzObject(cells: string[], columnInfo: ColumnInfo): boolean {
    return columnInfo.szIndices.some(({ idx }) => {
        const szRaw = stripMarkdown(cells[idx] || '');
        return Boolean(szRaw && szRaw !== 'N/A' && szRaw.startsWith('{'));
    });
}

/**
 * Process one sz column from a utility table row.
 * @param state - Current parser state.
 * @param cells - Parsed table cells.
 * @param szColumn - Current sz column metadata.
 * @param twCell - Expected Tailwind class cell.
 * @param concept - Normalized row concept.
 * @param lineNumber - One-based source line number.
 * @param columnInfo - Utility table column layout.
 */
function processSzColumn(
    state: ParserState,
    cells: string[],
    szColumn: ColumnInfo['szIndices'][number],
    twCell: string,
    concept: string,
    lineNumber: number,
    columnInfo: ColumnInfo,
): void {
    const szRaw = stripMarkdown(cells[szColumn.idx] || '');
    if (!szRaw || szRaw === 'N/A' || szRaw === 'N/A (Complex string)') return;
    if (!szRaw.includes('{')) return;

    const range = tryExpandRange(
        twCell,
        szRaw,
        state.currentCategory,
        state.currentSubcategory,
        concept,
        state.idCounter,
    );
    if (range.expanded) {
        appendGeneratedTests(state, range.tests);
        return;
    }

    const commaSeparated = parseCommaSeparatedRow(
        twCell,
        szRaw,
        state.currentCategory,
        state.currentSubcategory,
        concept,
        state.idCounter,
    );
    if (commaSeparated) {
        appendGeneratedTests(state, commaSeparated);
        return;
    }

    const parsed = parseSzProp(szRaw);
    if (!parsed) {
        const message = `Line ${lineNumber}: Could not parse sz prop: "${szRaw.slice(0, 60)}..."`;
        warn(message);
        state.warnings.push(message);
        state.skippedRows++;
        return;
    }
    if (!twCell) {
        state.skippedRows++;
        return;
    }

    const columnLabel = columnInfo.szIndices.length > 1 ? szColumn.label : undefined;
    state.tests.push({
        id: generateId(
            state.currentCategory,
            state.currentSubcategory,
            concept,
            columnLabel,
            state.idCounter,
        ),
        szInput: parsed,
        expectedClass: twCell,
        tailwindVersion: '4',
        category: state.currentCategory,
        subcategory: state.currentSubcategory || undefined,
    });
    state.categoryCounts[state.currentCategory] =
        (state.categoryCounts[state.currentCategory] || 0) + 1;
}

/**
 * Process one data row from a detected utility table.
 * @param state - Current parser state.
 * @param line - Markdown table row.
 * @param lineNumber - One-based source line number.
 */
function processTableDataRow(state: ParserState, line: string, lineNumber: number): void {
    const columnInfo = state.columnInfo;
    if (!columnInfo?.isUtilityTable) return;

    const cells = splitTableRow(line);
    const concept = stripMarkdown(cells[columnInfo.conceptIdx] || '');
    const twCell = stripMarkdown(cells[columnInfo.tailwindIdx] || '');
    const missingTailwind = !twCell || twCell === 'N/A' || twCell === 'N/A (Complex string)';
    if (missingTailwind && !hasSzObject(cells, columnInfo)) {
        state.skippedRows++;
        return;
    }

    for (const szColumn of columnInfo.szIndices) {
        processSzColumn(state, cells, szColumn, twCell, concept, lineNumber, columnInfo);
    }
}

/**
 * Detect and log one table header.
 * @param state - Current parser state.
 * @param line - Markdown table header row.
 */
function startTable(state: ParserState, line: string): void {
    const cells = splitTableRow(line);
    const columnInfo = detectColumns(cells);
    state.columnInfo = columnInfo;
    state.inTable = true;
    if (!columnInfo.isUtilityTable) return;

    const szColumns = columnInfo.szIndices
        .map(column => `col${column.idx}(${column.label})`)
        .join(', ');
    log(`  Table: ${cells.length} columns, tw=col${columnInfo.tailwindIdx}, sz=[${szColumns}]`);
}

/**
 * Process one source line through the heading/table state machine.
 * @param state - Current parser state.
 * @param line - Source line.
 * @param lineNumber - One-based source line number.
 */
function processSpecLine(state: ParserState, line: string, lineNumber: number): void {
    const heading = parseHeading(line);
    if (heading) {
        applyHeading(state, heading);
        return;
    }
    if (state.skipCurrentCategory || state.skipCurrentSubsection) return;

    if (!isTableRow(line)) {
        if (state.inTable) {
            state.inTable = false;
            state.columnInfo = null;
        }
        return;
    }
    if (isSeparatorRow(line)) return;
    if (!state.inTable) {
        startTable(state, line);
        return;
    }
    processTableDataRow(state, line, lineNumber);
}

/**
 * Parse every line from the Markdown spec.
 * @param lines - Spec source lines.
 * @returns Completed parser state.
 */
export function parseSpecLines(lines: string[]): ParserState {
    const state = createParserState();
    for (let index = 0; index < lines.length; index++) {
        processSpecLine(state, lines[index], index + 1);
    }
    return state;
}

/**
 * Validate generated test identities and required fields.
 * @param tests - Generated test cases.
 */
function validateGeneratedTests(tests: TestCase[]): void {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const test of tests) {
        if (seen.has(test.id)) duplicates.push(test.id);
        seen.add(test.id);
    }

    if (duplicates.length > 0) {
        warn(`Found ${duplicates.length} duplicate IDs: ${duplicates.slice(0, 5).join(', ')}...`);
    } else {
        log('No duplicate IDs found.');
    }

    if (tests.length < 200) {
        warn(`Only ${tests.length} test cases generated (minimum: 200)`);
    } else {
        log(`Test count: ${tests.length} (minimum 200 met)`);
    }

    const invalidCount = tests.filter(
        test => !test.id || !test.szInput || !test.expectedClass || !test.category,
    ).length;
    if (invalidCount > 0) {
        warn(`${invalidCount} test cases have missing required fields`);
    } else {
        log('All test cases have required fields.');
    }
}

/**
 * Serialize and write the generated test suite.
 * @param outputPath - Destination JSON path.
 * @param tests - Generated test cases.
 */
function writeTestSuite(outputPath: string, tests: TestCase[]): void {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const json = JSON.stringify(
        {
            version: '1.0.0',
            generatedAt: new Date().toISOString(),
            totalTests: tests.length,
            tests,
        } satisfies TestSuite,
        null,
        2,
    );
    try {
        JSON.parse(json);
    } catch {
        console.error('[spec-to-tests] ERROR: Generated JSON is invalid!');
        process.exit(1);
    }
    fs.writeFileSync(outputPath, json, 'utf-8');
}

/**
 * Print the parser summary.
 * @param state - Completed parser state.
 * @param outputPath - Generated JSON path.
 */
function logSummary(state: ParserState, outputPath: string): void {
    log('');
    log('=== SUMMARY ===');
    log(`Total test cases: ${state.tests.length}`);
    log(`Skipped rows: ${state.skippedRows}`);
    log(`Warnings: ${state.warnings.length}`);
    log('');
    log('Per category:');
    const counts = Object.entries(state.categoryCounts).sort((a, b) => b[1] - a[1]);
    for (const [category, count] of counts) log(`  ${category}: ${count}`);
    log('');
    log(`Output: ${outputPath}`);
}

/**
 * Main entry point: parses the spec and writes the generated tests to a JSON file.
 */
function main(): void {
    const specPath = path.resolve(__dirname, '..', 'docs', 'specs', 'SPEC_INDEX.md');
    const outputPath = path.resolve(__dirname, '..', 'tests', 'generated', 'spec-tests.json');

    if (!fs.existsSync(specPath)) {
        console.error(`[spec-to-tests] ERROR: Spec file not found at ${specPath}`);
        process.exit(1);
    }

    const lines = fs.readFileSync(specPath, 'utf-8').split('\n');

    log(`Parsing: ${specPath}`);
    log(`Total lines: ${lines.length}`);
    const state = parseSpecLines(lines);

    // ─── Validation ──────────────────────────────────────────────────────────

    log('');
    log('=== VALIDATION ===');
    validateGeneratedTests(state.tests);

    // ─── Output ──────────────────────────────────────────────────────────────
    writeTestSuite(outputPath, state.tests);

    // ─── Summary ─────────────────────────────────────────────────────────────
    logSummary(state, outputPath);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    main();
}
