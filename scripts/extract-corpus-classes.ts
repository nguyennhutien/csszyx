const TAILWIND_TOKEN = /^!?(?:[\w-]+:)*[\w\-./[\]()@#%]+$/;
const CSS_FUNCTION = /^(?:calc|var|url|rgb|rgba|hsl|hsla|oklch|color|env|min|max|clamp)\(/;

const CLASS_STRING_PATTERNS = [
    /className="([^"\\]+)"/g,
    /className='([^'\\]+)'/g,
    /className=\{'([^'\\]+)'\}/g,
    /\bclass="([^"\\]+)"/g,
    /\bclass='([^'\\]+)'/g,
    /\bcn\("([^"\\]+)"/g,
    /\bcn\('([^'\\]+)'/g,
    /\bclsx\("([^"\\]+)"/g,
    /\bclsx\('([^'\\]+)'/g,
    /\bcva\("([^"\\]+)"/g,
    /\bcva\('([^'\\]+)'/g,
    /\bcx\("([^"\\]+)"/g,
    /\bcx\('([^'\\]+)'/g,
    /"([a-z!][-a-z0-9 !:/.[\\()\]@#%]{15,})"/g,
    /'([a-z!][-a-z0-9 !:/.[\\()\]@#%]{15,})'/g,
];
const GENERIC_PATTERN_START = 13;

/**
 * Check whether a token belongs to the bounded Tailwind corpus grammar.
 * @param token - Candidate token.
 * @returns True when the token is safe to retain.
 */
export function isValidTailwindToken(token: string): boolean {
    if (token === '-' || token === '/' || CSS_FUNCTION.test(token)) return false;
    return TAILWIND_TOKEN.test(token) && token.length >= 1 && token.length <= 120;
}

/**
 * Check whether generic text contains Tailwind-specific punctuation.
 * @param token - Valid Tailwind candidate.
 * @returns True when the token is unlikely to be prose.
 */
function hasTailwindMarker(token: string): boolean {
    return token.includes('-') || token.includes(':') || token.includes('/');
}

/**
 * Normalize one captured string when enough of its tokens look like Tailwind.
 * @param value - Captured string contents.
 * @param generic - Whether the capture came from the generic fallback.
 * @returns Normalized valid tokens, or null when the capture is too ambiguous.
 */
function normalizeClassString(value: string, generic: boolean): string | null {
    const tokens = value.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return null;

    const valid = tokens.filter(isValidTailwindToken);
    if (valid.length < 2 || valid.length / tokens.length < 0.8) return null;
    if (generic && !valid.some(hasTailwindMarker)) return null;
    return valid.join(' ');
}

/**
 * Extract static className/class string values from source content.
 * @param content - Source file content to scan.
 * @returns One normalized string per matching source occurrence.
 */
export function extractClassStrings(content: string): string[] {
    const results: string[] = [];
    for (let index = 0; index < CLASS_STRING_PATTERNS.length; index++) {
        const pattern = CLASS_STRING_PATTERNS[index];
        for (const match of content.matchAll(pattern)) {
            const normalized = normalizeClassString(match[1] ?? '', index >= GENERIC_PATTERN_START);
            if (normalized) results.push(normalized);
        }
    }
    return results;
}
