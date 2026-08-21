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

/** The class names and namespaces a stylesheet claims with `@utility`. */
export interface ParsedUtilities {
    /** Static declarations, each claiming one class name: `panel-flat`. */
    statics: string[];
    /** Functional declarations, each claiming a namespace: `pad` for `pad-*`. */
    functionals: string[];
}

/**
 * Drop every closed block comment, in one pass.
 *
 * Not a regex on purpose. Both spellings of this — the lazy one and the
 * unrolled form that avoids backtracking — are reported as second-degree
 * polynomial, because the cost is not backtracking but SEARCH: a global regex
 * restarts from every position, so a stylesheet full of comment openers that
 * never close is quadratic however the body is written. A stylesheet is
 * attacker-controllable input inside a build.
 *
 * Two index scans cannot do that. Each character is passed at most once, and
 * an unterminated comment is left in place, which is what the previous regex
 * did too — it required a closing delimiter to match at all.
 *
 * @param css - Stylesheet source.
 * @returns The source with closed block comments removed.
 */
function stripBlockComments(css: string): string {
    let out = '';
    let from = 0;
    for (;;) {
        const open = css.indexOf('/*', from);
        if (open === -1) break;
        const close = css.indexOf('*/', open + 2);
        if (close === -1) break;
        out += css.slice(from, open);
        from = close + 2;
    }
    return from === 0 ? css : out + css.slice(from);
}

/**
 * Read the `@utility` declarations out of one stylesheet.
 *
 * A project claims class names two ways, and only one of them was ever read.
 * A `@theme` token claims them indirectly — `--color-brand` makes `text-brand`
 * and fourteen others — while `@utility` claims one outright. Tailwind MERGES
 * when the name is already taken rather than refusing it, and says nothing, so
 * `@utility text-balance { letter-spacing: … }` quietly ships a class that also
 * sets `text-wrap`. Reporting that needs this list first.
 *
 * Static and functional forms are kept apart because they answer different
 * questions. `panel-flat` is a class name and can be compared to one. `pad-*`
 * is a namespace whose members depend on the theme, so comparing its literal
 * text to a class list would ask something meaningless.
 *
 * @param cssContent Stylesheet source.
 * @returns The claimed names, both forms.
 */
export function parseUtilityBlocks(cssContent: string): ParsedUtilities {
    // Comments first: a commented-out declaration claims nothing, and reporting
    // it would send the reader to a line that is already inert.
    const source = stripBlockComments(cssContent);
    const statics: string[] = [];
    const functionals: string[] = [];
    const pattern = /@utility\s+([^\s{]+)\s*\{/g;
    let match = pattern.exec(source);
    while (match !== null) {
        const name = match[1];
        if (name.endsWith('-*')) {
            functionals.push(name.slice(0, -2));
        } else {
            statics.push(name);
        }
        // Skip the whole body: a nested rule inside it holds braces of its own,
        // and resuming mid-body would read them as declarations.
        const open = source.indexOf('{', match.index);
        const close = findMatchingBrace(source, open);
        pattern.lastIndex = close === -1 ? source.length : close + 1;
        match = pattern.exec(source);
    }
    return { statics, functionals };
}

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

/** Theme block body and the cursor where scanning should resume. */
interface ThemeBlockMatch {
    body: string | null;
    end: number;
}

/**
 * Validate one `@theme` marker and return its prelude start.
 *
 * @param css Complete CSS source.
 * @param at `@theme` marker offset.
 * @returns Prelude start, or null when the marker belongs to a longer identifier.
 */
function themePreludeStart(css: string, at: number): number | null {
    const cursor = at + '@theme'.length;
    const next = css[cursor];
    const validBoundary =
        next === '{' || next === ' ' || next === '\t' || next === '\n' || next === '\r';
    return validBoundary ? cursor : null;
}

/**
 * Scan one validated `@theme` prelude and optional body.
 *
 * @param css Complete CSS source.
 * @param start Prelude start after the marker.
 * @returns Extracted body and the last inspected offset.
 */
function readThemeBlock(css: string, start: number): ThemeBlockMatch {
    for (let cursor = start; cursor < css.length; cursor++) {
        const character = css[cursor];
        if (character === '{') {
            const close = findMatchingBrace(css, cursor);
            return {
                body: close === -1 ? null : css.slice(cursor + 1, close),
                end: close === -1 ? cursor : close,
            };
        }
        if (character === ';' || character === '}' || character === '@') {
            return { body: null, end: cursor };
        }
    }
    return { body: null, end: css.length };
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
        // The next char must be whitespace or `{` so `@themes {` never matches.
        const preludeStart = themePreludeStart(css, at);
        if (preludeStart === null) {
            searchFrom = at + '@theme'.length;
            continue;
        }
        // Walk over option keywords/whitespace to the opening brace; `;`, `}`
        // and `@` end the at-rule prelude, so stopping there both rejects
        // `@theme;` and keeps the walk from re-scanning past the next at-rule.
        const match = readThemeBlock(css, preludeStart);
        if (match.body !== null) blocks.push(match.body);
        // Every character is visited at most once across iterations — linear.
        searchFrom = Math.max(match.end, at + '@theme'.length);
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
