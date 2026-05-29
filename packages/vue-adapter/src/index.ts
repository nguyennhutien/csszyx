/**
 * @csszyx/vue-adapter - Vue SFC preprocessor for csszyx.
 *
 * Transforms `sz` props in Vue SFC templates into Tailwind CSS class strings.
 *
 * @module @csszyx/vue-adapter
 */

import { type SzObject, transform } from '@csszyx/compiler';
import { parseSync } from 'oxc-parser';

/**
 * Preprocessor options.
 */
export interface VueAdapterOptions {
    /**
     * Enable verbose logging for debugging.
     */
    debug?: boolean;
}

/**
 * Result of preprocessing a Vue SFC.
 */
export interface PreprocessResult {
    /**
     * The transformed source code.
     */
    code: string;
    /**
     * Whether any transformations were made.
     */
    transformed: boolean;
    /**
     * Number of sz props transformed.
     */
    count: number;
}

/**
 *
 */
type SafeValue = string | number | boolean | null | SafeValue[] | { [key: string]: SafeValue };
/**
 *
 */
type OxcNode = Record<string, unknown>;

/**
 * @param node - ESTree AST node to extract a literal value from
 * @returns The extracted value, or undefined if the node type is unsupported
 */
function extractValue(node: OxcNode): SafeValue | undefined {
    switch (node.type) {
        case 'Literal':
            return node.value as SafeValue;
        case 'UnaryExpression':
            if (
                node.operator === '-' &&
                (node.argument as OxcNode).type === 'Literal' &&
                typeof (node.argument as OxcNode).value === 'number'
            ) {
                return -((node.argument as OxcNode).value as number);
            }
            return undefined;
        case 'ArrayExpression': {
            const arr: SafeValue[] = [];
            for (const el of (node.elements as OxcNode[]) ?? []) {
                if (!el) {
                    arr.push(null);
                    continue;
                }
                const v = extractValue(el);
                if (v === undefined) return undefined;
                arr.push(v);
            }
            return arr;
        }
        case 'ObjectExpression':
            return extractObjectNode(node);
        case 'TemplateLiteral':
            if (((node.expressions as unknown[]) ?? []).length === 0) {
                const quasis = node.quasis as OxcNode[];
                return ((quasis[0].value as OxcNode).cooked as string) ?? undefined;
            }
            return undefined;
        default:
            return undefined;
    }
}

/**
 * @param node - ObjectExpression AST node
 * @returns Plain object with extracted key-value pairs, or undefined if any property is unsupported
 */
function extractObjectNode(node: OxcNode): Record<string, SafeValue> | undefined {
    const obj: Record<string, SafeValue> = {};
    for (const prop of (node.properties as OxcNode[]) ?? []) {
        if (prop.type !== 'Property') return undefined;
        if (prop.computed) return undefined;

        const key_node = prop.key as OxcNode;
        let key: string;
        if (key_node.type === 'Identifier') {
            key = key_node.name as string;
        } else if (key_node.type === 'Literal' && typeof key_node.value === 'string') {
            key = key_node.value;
        } else if (key_node.type === 'Literal' && typeof key_node.value === 'number') {
            key = String(key_node.value);
        } else {
            return undefined;
        }

        const value = extractValue(prop.value as OxcNode);
        if (value === undefined) return undefined;
        obj[key] = value;
    }
    return obj;
}

/**
 * Parse a JavaScript object literal string into an object.
 * Handles nested objects for variants like hover, focus, etc.
 *
 * @param {string} objStr - Object literal string (e.g., "{ p: 4, bg: 'red-500' }")
 * @returns {SzObject | null} Parsed object or null if invalid
 */
export function parseObjectLiteral(objStr: string): SzObject | null {
    try {
        const src = `const _=${objStr.trim()}`;
        const parsed = parseSync('sz.js', src);
        if (parsed.errors.length > 0) return null;
        const decl = (parsed.program as unknown as OxcNode).body as OxcNode[];
        const init = ((decl[0].declarations as OxcNode[])[0].init as OxcNode) ?? null;
        if (!init || init.type !== 'ObjectExpression') return null;
        return (extractObjectNode(init) as SzObject) ?? null;
    } catch {
        return null;
    }
}

/**
 * Extract the template section from a Vue SFC.
 *
 * @param {string} source - Vue SFC source code
 * @returns {{ content: string; start: number; end: number } | null} Template info or null
 */
export function extractTemplate(source: string): {
    content: string;
    start: number;
    end: number;
} | null {
    // indexOf-based scan avoids the polynomial backtracking that a
    // <template(\s[^>]*)?>...</template> regex would suffer on inputs
    // with repeated "<template " prefixes.
    const lowered = source.toLowerCase();
    let openStart = -1;
    let openEnd = -1;
    let i = 0;
    while (i < lowered.length) {
        const candidate = lowered.indexOf('<template', i);
        if (candidate === -1) return null;
        const after = lowered.charAt(candidate + '<template'.length);
        if (after === '>' || after === ' ' || after === '\t' || after === '\n' || after === '\r') {
            const tagClose = lowered.indexOf('>', candidate);
            if (tagClose === -1) return null;
            openStart = candidate;
            openEnd = tagClose + 1;
            break;
        }
        i = candidate + 1;
    }
    if (openStart === -1) return null;

    const closeStart = lowered.indexOf('</template>', openEnd);
    if (closeStart === -1) return null;

    return {
        content: source.slice(openEnd, closeStart),
        start: openEnd,
        end: closeStart,
    };
}

/**
 * Transform sz props in a template string.
 *
 * Supports:
 * - Static: sz="{ p: 4 }" or sz='{ p: 4 }'
 * - Bound (Vue): :sz="{ p: 4 }" or v-bind:sz="{ p: 4 }"
 *
 * @param {string} template - Template string
 * @param {VueAdapterOptions} options - Options
 * @returns {PreprocessResult} Transformation result
 */
export function transformTemplate(
    template: string,
    options: VueAdapterOptions = {},
): PreprocessResult {
    let result = template;
    let count = 0;

    // Pattern to match sz attributes. The non-greedy [^"']* avoids the
    // backtracking that [\s\S]*? would suffer on inputs with repeated
    // sz="{{ openings — quotes cannot appear inside the captured object
    // literal, so a negated class is both safer and more accurate.
    const szPattern = /(?:v-bind:|:)?sz=(?:"(\{[^"]*\})"|'(\{[^']*\})')/g;

    result = result.replace(szPattern, (match, doubleQuoted, singleQuoted) => {
        const objStr = doubleQuoted ?? singleQuoted;
        const szObj = parseObjectLiteral(objStr);

        if (!szObj) {
            if (options.debug) {
                console.warn(`[csszyx/vue] Failed to parse sz object: ${objStr}`);
            }
            return match; // Return unchanged if parsing fails
        }

        const className = transform(szObj);
        count++;

        if (options.debug) {
            console.log(`[csszyx/vue] Transformed: ${objStr} -> "${className}"`);
        }

        return `class="${className}"`;
    });

    return {
        code: result,
        transformed: count > 0,
        count,
    };
}

/**
 * Merge transformed classes with existing class attribute.
 *
 * @param {string} template - Template with sz props transformed to class
 * @returns {string} Template with merged class attributes
 */
export function mergeClassAttributes(template: string): string {
    let result = template;
    let i = 0;
    while (i < result.length) {
        const start = result.indexOf('<', i);
        if (start === -1) break;
        const end = result.indexOf('>', start);
        if (end === -1) break;
        const tag = result.slice(start, end + 1);
        i = end + 1;
        if (!/^<[a-z]/i.test(tag)) continue;
        const staticMatch = /\bclass="([^"]*)"/.exec(tag);
        const dynamicMatch = /\b(?::class|v-bind:class)="([^"]*)"/.exec(tag);
        if (!staticMatch || !dynamicMatch) continue;
        const cleaned = tag
            .replace(/\bclass="[^"]*"/, '')
            .replace(/\b(?::class|v-bind:class)="[^"]*"/, '');
        const insertIdx = cleaned.indexOf(' ') + 1;
        const newTag = `${cleaned.slice(0, insertIdx)}:class="['${staticMatch[1]}', ${dynamicMatch[1]}]" ${cleaned.slice(insertIdx)}`;
        result = result.slice(0, start) + newTag + result.slice(end + 1);
        i = start + newTag.length;
    }
    return result;
}

/**
 * Preprocess a Vue SFC file, transforming sz props to class attributes.
 *
 * @param {string} source - Vue SFC source code
 * @param {VueAdapterOptions} options - Preprocessor options
 * @returns {PreprocessResult} Preprocessing result
 *
 * @example
 * ```typescript
 * import { preprocess } from '@csszyx/vue-adapter';
 *
 * const result = preprocess(`
 *   <template>
 *     <div sz="{ p: 4, bg: 'red-500' }">Hello</div>
 *   </template>
 * `);
 *
 * // result.code contains:
 * // <template>
 * //   <div class="p-4 bg-red-500">Hello</div>
 * // </template>
 * ```
 */
export function preprocess(source: string, options: VueAdapterOptions = {}): PreprocessResult {
    // Extract template section
    const templateInfo = extractTemplate(source);

    if (!templateInfo) {
        return {
            code: source,
            transformed: false,
            count: 0,
        };
    }

    // Transform sz props in template
    const transformResult = transformTemplate(templateInfo.content, options);

    if (!transformResult.transformed) {
        return {
            code: source,
            transformed: false,
            count: 0,
        };
    }

    // Merge any duplicate class attributes
    const mergedContent = mergeClassAttributes(transformResult.code);

    // Reconstruct the source with transformed template
    const code =
        source.slice(0, templateInfo.start) + mergedContent + source.slice(templateInfo.end);

    return {
        code,
        transformed: true,
        count: transformResult.count,
    };
}

/**
 * Create a Vite plugin for Vue SFC preprocessing.
 *
 * @param {VueAdapterOptions} options - Plugin options
 * @returns {object} Vite plugin
 *
 * @example
 * ```typescript
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import vue from '@vitejs/plugin-vue';
 * import { vitePlugin as csszyx } from '@csszyx/vue-adapter';
 *
 * export default defineConfig({
 *     plugins: [
 *         csszyx(),
 *         vue(),
 *     ],
 * });
 * ```
 */
import type { Plugin } from 'vite';

/**
 * Create a Vite plugin for Vue SFC preprocessing.
 *
 * @param {VueAdapterOptions} options - Plugin options
 * @returns {Plugin} Vite plugin
 */
export function vitePlugin(options: VueAdapterOptions = {}): Plugin {
    return {
        name: 'csszyx-vue',
        enforce: 'pre' as const,

        transform(code: string, id: string) {
            // Only process Vue SFC files
            if (!id.endsWith('.vue')) {
                return null;
            }

            // Skip if no sz props
            if (!code.includes('sz=')) {
                return null;
            }

            const result = preprocess(code, options);

            if (!result.transformed) {
                return null;
            }

            return {
                code: result.code,
                map: null, // TODO: Generate source map
            };
        },
    };
}

/**
 * Default export for convenient importing.
 */
export default vitePlugin;
