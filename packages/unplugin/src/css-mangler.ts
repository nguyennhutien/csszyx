/**
 * CSS Mangler Module - Zero-Risk CSS Selector Transformation.
 *
 * Uses PostCSS AST to safely transform CSS class selectors using the mangle map.
 * This module guarantees:
 * - Only class selectors are touched (never IDs, attributes, CSS variables)
 * - Exact class matching (no partial replacements)
 * - Proper handling of Tailwind's escaped characters
 * - Zero CSS syntax errors after transformation
 *
 * @module @csszyx/unplugin/css-mangler
 */

import postcss, { type Root, type Rule } from 'postcss';
import selectorParser from 'postcss-selector-parser';

/**
 * Mangle map type: original class name -> mangled ID.
 */
export type MangleMap = Record<string, string>;

/**
 * CSS Mangler options.
 */
export interface CSSManglerOptions {
    /**
     * Enable debug logging.
     */
    debug?: boolean;

    /**
     * Source file path for better error messages.
     */
    from?: string;
}

/**
 * CSS Mangler result.
 */
export interface CSSManglerResult {
    /**
     * The transformed CSS.
     */
    css: string;

    /**
     * Number of selectors transformed.
     */
    transformedCount: number;

    /**
     * List of classes that were mangled.
     */
    mangledClasses: string[];

    /**
     * List of classes not found in the mangle map.
     */
    unmangledClasses: string[];
}

/**
 * Unescape a Tailwind CSS class name.
 *
 * Tailwind uses CSS escape sequences for special characters:
 * - `\.` for literal `.` (e.g., `p-0\.5` -> `p-0.5`)
 * - `\/` for literal `/` (e.g., `w-1\/2` -> `w-1/2`)
 * - `\:` for literal `:` (e.g., `hover\:bg-red-500` in CSS -> `hover:bg-red-500`)
 * - `\!` for literal `!` (important modifier)
 * - `\[` and `\]` for arbitrary values
 * - `\#` for hex colors
 * - `\@` for at-rules in class names
 * - `\32` (hex for '2') for numeric prefixes like `2xl:`
 * - Unicode escapes like `\31 ` (space-terminated)
 *
 * @param {string} escapedName - The escaped class name from CSS selector
 * @returns {string} The unescaped class name
 */
export function unescapeTailwindClass(escapedName: string): string {
    let result = '';
    let i = 0;

    while (i < escapedName.length) {
        if (escapedName[i] === '\\') {
            i++;
            if (i >= escapedName.length) {
                break;
            }

            const char = escapedName[i];

            // Check for hex escape sequences (e.g., \31, \32 for digits)
            if (/[0-9a-fA-F]/.test(char)) {
                // Collect up to 6 hex digits
                let hexStr = '';
                while (
                    i < escapedName.length &&
                    /[0-9a-fA-F]/.test(escapedName[i]) &&
                    hexStr.length < 6
                ) {
                    hexStr += escapedName[i];
                    i++;
                }

                // If followed by a space, consume it (CSS escape terminator)
                if (i < escapedName.length && escapedName[i] === ' ') {
                    i++;
                }

                // Convert hex to character
                const codePoint = parseInt(hexStr, 16);
                if (codePoint > 0) {
                    result += String.fromCodePoint(codePoint);
                }
                continue;
            }

            // Simple escape: \. \/ \: \! \[ \] \# \@ etc.
            result += char;
            i++;
        } else {
            result += escapedName[i];
            i++;
        }
    }

    return result;
}

/**
 * Escape a class name for use in CSS selector.
 *
 * This is the inverse of unescapeTailwindClass.
 *
 * @param {string} className - The unescaped class name
 * @returns {string} The escaped class name for CSS
 */
export function escapeCSSClassName(className: string): string {
    let result = '';

    for (let i = 0; i < className.length; i++) {
        const char = className[i];
        const code = char.charCodeAt(0);

        // First character rules
        if (i === 0) {
            // If starts with digit, escape it
            if (/[0-9]/.test(char)) {
                result += `\\3${char} `;
                continue;
            }
            // If starts with hyphen followed by digit or another hyphen
            if (char === '-' && i + 1 < className.length) {
                const next = className[i + 1];
                if (/[0-9]/.test(next) || next === '-') {
                    result += '\\-';
                    continue;
                }
            }
        }

        // Characters that need escaping in CSS identifiers
        if (/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/.test(char)) {
            result += `\\${char}`;
        } else if (code >= 0x80) {
            // Non-ASCII characters don't need escaping in modern CSS
            result += char;
        } else {
            // Safe characters
            result += char;
        }
    }

    return result;
}

/**
 * Create a PostCSS selector processor that mangles class names.
 *
 * @param {MangleMap} mangleMap - The mangle map
 * @param {Set<string>} mangledClasses - Set to track which classes were mangled
 * @param {Set<string>} unmangledClasses - Set to track classes not in the map
 * @returns {selectorParser.SyncProcessor<string>} PostCSS selector processor
 */
function createSelectorProcessor(
    mangleMap: MangleMap,
    mangledClasses: Set<string>,
    unmangledClasses: Set<string>,
     
): any {
    return selectorParser(selectors => {
        selectors.walkClasses(classNode => {
            // Get the class value (already unescaped by postcss-selector-parser)
            const originalValue = classNode.value;

            // Also try to unescape in case there are nested escapes
            const unescapedValue = unescapeTailwindClass(originalValue);

            // Check both values against the mangle map
            let mangledValue: string | undefined, matchedKey: string | undefined;

            if (mangleMap[unescapedValue]) {
                mangledValue = mangleMap[unescapedValue];
                matchedKey = unescapedValue;
            } else if (mangleMap[originalValue]) {
                mangledValue = mangleMap[originalValue];
                matchedKey = originalValue;
            }

            if (mangledValue && matchedKey) {
                // Update the class node value
                classNode.value = mangledValue;
                mangledClasses.add(matchedKey);
            } else {
                // Track unmangled classes for debugging
                unmangledClasses.add(originalValue);
            }
        });
    });
}

/**
 * Mangle CSS selectors using the provided mangle map.
 *
 * This function uses PostCSS AST to safely transform only class selectors,
 * ensuring zero risk of breaking CSS syntax or mangling unintended content.
 *
 * @param {string} css - The CSS content to transform
 * @param {MangleMap} mangleMap - The mangle map (original -> mangled)
 * @param {CSSManglerOptions} options - Options
 * @returns {Promise<CSSManglerResult>} The transformation result
 */
export async function mangleCSS(
    css: string,
    mangleMap: MangleMap,
    options: CSSManglerOptions = {},
): Promise<CSSManglerResult> {
    const mangledClasses = new Set<string>();
    const unmangledClasses = new Set<string>();
    let transformedCount = 0;

    // Create the selector processor
    const selectorProcessor = createSelectorProcessor(mangleMap, mangledClasses, unmangledClasses);

    // Create PostCSS plugin
    const csszyxManglerPlugin = {
        postcssPlugin: 'csszyx-css-mangler',
        Rule(rule: Rule) {
            try {
                const originalSelector = rule.selector;
                const newSelector = selectorProcessor.processSync(originalSelector);

                if (newSelector !== originalSelector) {
                    rule.selector = newSelector;
                    transformedCount++;
                }
            } catch (error) {
                // Log but don't fail on selector parsing errors
                if (options.debug) {
                    console.warn(`[csszyx] Failed to process selector: ${rule.selector}`, error);
                }
            }
        },
    };

    // Process the CSS
    const result = await postcss([csszyxManglerPlugin]).process(css, {
        from: options.from,
    });

    if (options.debug) {
         
        console.log(`[csszyx] CSS Mangler: ${transformedCount} selectors transformed`);
         
        console.log(`[csszyx] Mangled classes: ${mangledClasses.size}`);
         
        console.log(`[csszyx] Unmangled classes: ${unmangledClasses.size}`);
    }

    return {
        css: result.css,
        transformedCount,
        mangledClasses: Array.from(mangledClasses),
        unmangledClasses: Array.from(unmangledClasses),
    };
}

/**
 * Synchronous version of mangleCSS.
 *
 * @param {string} css - The CSS content to transform
 * @param {MangleMap} mangleMap - The mangle map
 * @param {CSSManglerOptions} options - Options
 * @returns {CSSManglerResult} The transformation result
 */
export function mangleCSSSync(
    css: string,
    mangleMap: MangleMap,
    options: CSSManglerOptions = {},
): CSSManglerResult {
    const mangledClasses = new Set<string>();
    const unmangledClasses = new Set<string>();
    let transformedCount = 0;

    // Create the selector processor
    const selectorProcessor = createSelectorProcessor(mangleMap, mangledClasses, unmangledClasses);

    // Parse CSS
    const root: Root = postcss.parse(css, { from: options.from });

    // Walk all rules
    root.walkRules(rule => {
        try {
            const originalSelector = rule.selector;
            const newSelector = selectorProcessor.processSync(originalSelector);

            if (newSelector !== originalSelector) {
                rule.selector = newSelector;
                transformedCount++;
            }
        } catch (error) {
            if (options.debug) {
                console.warn(`[csszyx] Failed to process selector: ${rule.selector}`, error);
            }
        }
    });

    if (options.debug) {
         
        console.log(`[csszyx] CSS Mangler: ${transformedCount} selectors transformed`);
         
        console.log(`[csszyx] Mangled classes: ${mangledClasses.size}`);
         
        console.log(`[csszyx] Unmangled classes: ${unmangledClasses.size}`);
    }

    return {
        css: root.toString(),
        transformedCount,
        mangledClasses: Array.from(mangledClasses),
        unmangledClasses: Array.from(unmangledClasses),
    };
}

/**
 * Create a PostCSS plugin for CSS mangling.
 *
 * This can be used directly in a PostCSS pipeline.
 *
 * @param {MangleMap} mangleMap - The mangle map
 * @param {CSSManglerOptions} options - Options
 * @returns {postcss.Plugin} PostCSS plugin
 *
 * @example
 * ```typescript
 * import postcss from 'postcss';
 * import { createPostCSSPlugin } from '@csszyx/unplugin/css-mangler';
 *
 * const result = await postcss([
 *     createPostCSSPlugin(mangleMap, { debug: true })
 * ]).process(css);
 * ```
 */
export function createPostCSSPlugin(
    mangleMap: MangleMap,
    options: CSSManglerOptions = {},
): postcss.Plugin {
    const mangledClasses = new Set<string>();
    const unmangledClasses = new Set<string>();

    const selectorProcessor = createSelectorProcessor(mangleMap, mangledClasses, unmangledClasses);

    return {
        postcssPlugin: 'csszyx-css-mangler',
        Rule(rule) {
            try {
                const originalSelector = rule.selector;
                const newSelector = selectorProcessor.processSync(originalSelector);

                if (newSelector !== originalSelector) {
                    rule.selector = newSelector;
                }
            } catch (error) {
                if (options.debug) {
                    console.warn(`[csszyx] Failed to process selector: ${rule.selector}`, error);
                }
            }
        },
        OnceExit() {
            if (options.debug) {
                 
                console.log(`[csszyx] Mangled ${mangledClasses.size} unique classes`);
            }
        },
    };
}
