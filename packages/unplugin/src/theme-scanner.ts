/**
 * Theme Scanner — parses Tailwind v4 @theme blocks from CSS files.
 *
 * Extracts custom design tokens and categorizes them by type so the
 * type writer can generate accurate TypeScript augmentation.
 *
 * Supports:
 *   - Multiple @theme blocks per file
 *   - @theme option keywords (inline, static, reference, combinations — ignored)
 *   - @theme inside @layer (two-pass strip)
 *   - --color-brand-50 shade suffixes (deduped to 'brand')
 *   - Multi-file merge via mergeThemes()
 */

import { sortStrings } from './sort.js';

/** Extracted and categorized custom tokens from @theme blocks. */
export interface ParsedTheme {
    /** Custom color names (from --color-*): e.g. ['brand', 'brand-dark'] */
    colors: string[];
    /** Custom spacing tokens (from --spacing-*): e.g. ['xl', '2xs'] */
    spacings: string[];
    /** Custom font families (from --font-*): e.g. ['display', 'body'] */
    fonts: string[];
    /** Custom font sizes (from --text-*): e.g. ['huge'] */
    textSizes: string[];
    /** Custom font weights (from --font-weight-*): e.g. ['chunky'] */
    fontWeights: string[];
    /** Custom border radii (from --radius-*): e.g. ['button'] */
    radii: string[];
    /** Custom shadows (from --shadow-*): e.g. ['card'] */
    shadows: string[];
    /** Custom responsive breakpoints (from --breakpoint-*): e.g. ['tablet', '3xl'] */
    breakpoints: string[];
}

const EMPTY_THEME: ParsedTheme = {
    colors: [],
    spacings: [],
    fonts: [],
    textSizes: [],
    fontWeights: [],
    radii: [],
    shadows: [],
    breakpoints: [],
};

/**
 * Find the closing brace paired with one opening brace.
 *
 * @param source Source text containing the block.
 * @param openBrace Opening-brace offset.
 * @returns Matching closing-brace offset, or -1 when unmatched.
 */
function findMatchingBrace(source: string, openBrace: number): number {
    let depth = 0;
    for (let index = openBrace; index < source.length; index++) {
        if (source[index] === '{') {
            depth++;
        } else if (source[index] === '}') {
            depth--;
            if (depth === 0) {
                return index;
            }
        }
    }
    return -1;
}

/**
 * Strip @layer { ... } wrappers so @theme blocks inside layers are still found.
 * Only strips one level — @theme cannot be nested inside nested @layer.
 *
 * @param css - Raw CSS file content
 * @returns CSS with @layer wrappers removed (content preserved)
 */
function stripLayerWrappers(css: string): string {
    // Remove "@layer <name> {" ... "}" outer wrappers, preserving inner content.
    // Uses a brace-depth tracker to handle the closing brace correctly.
    let result = '';
    let i = 0;
    while (i < css.length) {
        // Look for "@layer" start
        const layerIdx = css.indexOf('@layer', i);
        if (layerIdx === -1) {
            result += css.slice(i);
            break;
        }
        // Append everything before @layer
        result += css.slice(i, layerIdx);
        // Find the opening brace
        const openBrace = css.indexOf('{', layerIdx);
        if (openBrace === -1) {
            result += css.slice(layerIdx);
            break;
        }
        const closeBrace = findMatchingBrace(css, openBrace);
        if (closeBrace === -1) {
            // Unmatched brace — give up stripping, append rest as-is
            result += css.slice(openBrace);
            break;
        }
        result += css.slice(openBrace + 1, closeBrace);
        i = closeBrace + 1;
    }
    return result;
}

/**
 * Extract all @theme block bodies from CSS content.
 * Handles nested braces correctly (does not use simple [^}]* regex).
 *
 * @param css - CSS content with @layer wrappers already stripped
 * @returns Array of block body strings (content between the outermost braces)
 */
function extractThemeBlocks(css: string): string[] {
    const blocks: string[] = [];
    // Find `@theme` followed by any option keywords, then {. Tailwind v4 accepts
    // option keywords after @theme (`inline`, `static`, `reference`, and their
    // combinations); only matching `inline` silently dropped `@theme static`
    // palettes from the szcn groups. A manual scan (mirroring
    // scanCustomPropertyNames) instead of `[^{};]*\{`, whose scan-to-brace run
    // was polynomial-by-search on brace-less content.
    let searchFrom = 0;
    for (;;) {
        const at = css.indexOf('@theme', searchFrom);
        if (at === -1) {
            break;
        }
        let cursor = at + '@theme'.length;
        // The next char must be whitespace or `{` so `@themes {` never matches.
        const next = css[cursor];
        if (next !== '{' && next !== ' ' && next !== '\t' && next !== '\n' && next !== '\r') {
            searchFrom = cursor;
            continue;
        }
        // Walk over option keywords/whitespace to the opening brace; `;`, `}`
        // and `@` end the at-rule prelude, so stopping there both rejects
        // `@theme;` and keeps the walk from re-scanning past the next at-rule.
        while (cursor < css.length) {
            const ch = css[cursor];
            if (ch === '{') {
                const closePos = findMatchingBrace(css, cursor);
                if (closePos !== -1) {
                    blocks.push(css.slice(cursor + 1, closePos));
                }
                break;
            }
            if (ch === ';' || ch === '}' || ch === '@') {
                break;
            }
            cursor++;
        }
        // Every character is visited at most once across iterations — linear.
        searchFrom = Math.max(cursor, at + '@theme'.length);
    }
    return blocks;
}

/**
 * Parse CSS custom property name into category and token name.
 * Returns null for unrecognized categories.
 *
 * @param prop - CSS custom property name without leading '--', e.g. 'color-brand-500'
 * @returns { category, token } or null
 */
function categorizeProperty(prop: string): { category: keyof ParsedTheme; token: string } | null {
    const categoryMap: Array<[string, keyof ParsedTheme]> = [
        ['color-', 'colors'],
        ['spacing-', 'spacings'],
        // `font-weight-` MUST precede `font-`: startsWith would otherwise route
        // `font-weight-chunky` into font FAMILIES as token "weight-chunky".
        ['font-weight-', 'fontWeights'],
        ['font-', 'fonts'],
        // `--text-*` defines font-size utilities (text-huge) in Tailwind v4.
        ['text-', 'textSizes'],
        ['radius-', 'radii'],
        ['shadow-', 'shadows'],
        ['breakpoint-', 'breakpoints'],
    ];

    for (const [prefix, category] of categoryMap) {
        if (prop.startsWith(prefix)) {
            let token = prop.slice(prefix.length);
            // Breakpoint names are literal variant names (tablet, 3xl); only the
            // design-token categories carry numeric shade suffixes that should be
            // collapsed: "brand-500" → "brand", "brand-dark" → "brand-dark".
            if (category !== 'breakpoints') {
                token = token.replace(/-\d+$/, '');
            }
            if (token) {
                return { category, token };
            }
        }
    }
    return null;
}

/**
 * Parse all @theme blocks in a CSS file and extract design tokens.
 *
 * @param cssContent - Raw CSS file content
 * @returns Categorized design tokens
 */
export function parseThemeBlocks(cssContent: string): ParsedTheme {
    const result: { [K in keyof ParsedTheme]: Set<string> } = {
        colors: new Set(),
        spacings: new Set(),
        fonts: new Set(),
        textSizes: new Set(),
        fontWeights: new Set(),
        radii: new Set(),
        shadows: new Set(),
        breakpoints: new Set(),
    };

    const stripped = stripLayerWrappers(cssContent);
    const blocks = extractThemeBlocks(stripped);

    // Extract custom-property NAMES from `--name: value;` / `--name;`
    // declarations. See scanCustomPropertyNames — a linear scan replacing
    // `/--([a-z][a-z0-9-]*)(?:\s*:[^;]+)?;/g`, whose `[^;]+` value run was
    // quadratic-by-search on a `;`-less block.
    for (const block of blocks) {
        for (const name of scanCustomPropertyNames(block)) {
            const categorized = categorizeProperty(name);
            if (categorized) {
                result[categorized.category].add(categorized.token);
            }
        }
    }

    return {
        colors: sortStrings(result.colors),
        spacings: sortStrings(result.spacings),
        fonts: sortStrings(result.fonts),
        textSizes: sortStrings(result.textSizes),
        fontWeights: sortStrings(result.fontWeights),
        radii: sortStrings(result.radii),
        shadows: sortStrings(result.shadows),
        breakpoints: sortStrings(result.breakpoints),
    };
}

/**
 * Merge multiple ParsedTheme objects into one, deduplicating tokens.
 *
 * @param themes - Array of parsed themes to merge
 * @returns Merged theme with unique tokens per category
 */
export function mergeThemes(themes: ParsedTheme[]): ParsedTheme {
    if (themes.length === 0) {
        return { ...EMPTY_THEME };
    }
    const merged: { [K in keyof ParsedTheme]: Set<string> } = {
        colors: new Set(),
        spacings: new Set(),
        fonts: new Set(),
        textSizes: new Set(),
        fontWeights: new Set(),
        radii: new Set(),
        shadows: new Set(),
        breakpoints: new Set(),
    };
    for (const theme of themes) {
        for (const cat of Object.keys(merged) as (keyof ParsedTheme)[]) {
            for (const token of theme[cat]) {
                merged[cat].add(token);
            }
        }
    }
    return {
        colors: sortStrings(merged.colors),
        spacings: sortStrings(merged.spacings),
        fonts: sortStrings(merged.fonts),
        textSizes: sortStrings(merged.textSizes),
        fontWeights: sortStrings(merged.fontWeights),
        radii: sortStrings(merged.radii),
        shadows: sortStrings(merged.shadows),
        breakpoints: sortStrings(merged.breakpoints),
    };
}

/**
 * Check if a ParsedTheme has any tokens.
 *
 * @param theme - Parsed theme to check
 * @returns True if at least one category has tokens
 */
export function hasTokens(theme: ParsedTheme): boolean {
    return Object.values(theme).some(arr => arr.length > 0);
}

/**
 * Read a valid custom-property name after a `--` marker.
 *
 * @param block Theme block source.
 * @param dashes Offset of the `--` marker.
 * @returns Name and exclusive name end, or null.
 */
function readCustomPropertyName(
    block: string,
    dashes: number,
): { name: string; end: number } | null {
    let end = dashes + 2;
    if (end >= block.length || !/[a-z]/.test(block[end] as string)) {
        return null;
    }
    end++;
    while (end < block.length && /[a-z0-9-]/.test(block[end] as string)) {
        end++;
    }
    return { name: block.slice(dashes + 2, end), end };
}

/**
 * Find the exclusive declaration end after a custom-property name.
 *
 * @param block Theme block source.
 * @param nameEnd Exclusive property-name end.
 * @returns Exclusive declaration end, or -1 when invalid.
 */
function findCustomPropertyDeclarationEnd(block: string, nameEnd: number): number {
    let cursor = nameEnd;
    while (cursor < block.length && /\s/.test(block[cursor] as string)) {
        cursor++;
    }
    if (block[cursor] === ':') {
        const valueStart = cursor + 1;
        const semicolon = block.indexOf(';', valueStart);
        return semicolon > valueStart ? semicolon + 1 : -1;
    }
    return block[nameEnd] === ';' ? nameEnd + 1 : -1;
}

/**
 * Yield the NAME of every `--name: value;` / `--name;` custom-property
 * declaration in `block`, exactly as `/--([a-z][a-z0-9-]*)(?:\s*:[^;]+)?;/g`
 * captured group 1 — including its terminator rules (a value, when present,
 * must be non-empty and end at a `;`; otherwise the `;` follows the name
 * directly). Linear: each `--` is examined once, with a single forward scan to
 * the terminating `;`, so a `;`-less block can no longer drive the quadratic
 * `[^;]+` re-scan.
 *
 * Exported for the equivalence test.
 *
 * @param block - The inside of a `@theme { … }` block.
 * @returns The declared custom-property names, in source order.
 */
export function scanCustomPropertyNames(block: string): string[] {
    const names: string[] = [];
    let i = 0;
    while (i < block.length) {
        const dashes = block.indexOf('--', i);
        if (dashes === -1) {
            break;
        }
        const property = readCustomPropertyName(block, dashes);
        if (!property) {
            // No valid name here — the /g scan would retry one char over,
            // which matters for overlapping runs like `---name;`.
            i = dashes + 1;
            continue;
        }
        const matchEnd = findCustomPropertyDeclarationEnd(block, property.end);
        if (matchEnd === -1) {
            i = dashes + 1;
            continue;
        }
        names.push(property.name);
        i = matchEnd;
    }
    return names;
}
