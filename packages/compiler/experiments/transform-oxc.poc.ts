/**
 * Phase D foundation POC — verify the oxc-parser + magic-string contract
 * that section #27 of `.agent/workflows/future-roadmap.md` calls for.
 *
 * Not part of the public surface, not part of unbuild entries, not part
 * of `tsc -b` (lives outside `src/`). Lives here only so the test
 * harness can prove the pipeline shape before D2 starts a real port.
 *
 * Mock-compile rule: `{ p: 4, bg: 'blue-500' }` → `['p-4', 'bg-blue-500']`.
 * That is NOT how `@csszyx/compiler` actually resolves sz objects — it
 * is just enough to drive the parse → walk → magic-string → emit loop
 * end-to-end so we can spot interop issues early (start/end offsets,
 * source-map shape, node type names) before committing to D2.
 */

import MagicString, { type SourceMap } from 'magic-string';
import { parseSync } from 'oxc-parser';

/**
 * Result of running the POC transform on a source string.
 */
export interface PocResult {
    /** Rewritten source with sz attributes replaced by className. */
    code: string;
    /** v3 source map covering the surgical edits. */
    map: SourceMap;
    /** Mock-compiled class names extracted from sz attributes. */
    classes: string[];
}

/**
 * Run the POC pipeline: parse → walk → magic-string → emit.
 *
 * @param source Source TSX/JSX text.
 * @param filename Filename passed to oxc-parser (drives JSX detection).
 * @returns Rewritten code, source map, and extracted classes.
 * @throws If the parser reports any errors.
 */
export function transformOxcPoc(source: string, filename: string): PocResult {
    const parsed = parseSync(filename, source);
    if (parsed.errors.length > 0) {
        const detail = parsed.errors.map(e => e.message).join('; ');
        throw new Error(`oxc-parser errors in ${filename}: ${detail}`);
    }

    const edits = new MagicString(source);
    const classes: string[] = [];

    walk(parsed.program, node => {
        if (!isSzJsxAttribute(node)) {
            return;
        }
        const compiled = mockCompileSz(node.value);
        classes.push(...compiled);
        edits.overwrite(node.start, node.end, `className="${compiled.join(' ')}"`);
    });

    return {
        code: edits.toString(),
        map: edits.generateMap({
            source: filename,
            hires: 'boundary',
            includeContent: true,
        }),
        classes,
    };
}

/**
 *
 */
interface OxcNode {
    type: string;
    start: number;
    end: number;
    [key: string]: unknown;
}

/**
 *
 */
interface JsxAttributeNode extends OxcNode {
    type: 'JSXAttribute';
    name: { type: string; name?: string };
    value: OxcNode | null;
}

/**
 * Narrow a generic oxc node to a JSXAttribute named `sz`.
 *
 * @param node Any oxc AST node.
 * @returns True if the node is `sz={...}` on a JSX element.
 */
function isSzJsxAttribute(node: OxcNode): node is JsxAttributeNode {
    if (node.type !== 'JSXAttribute') {
        return false;
    }
    const name = (node as JsxAttributeNode).name;
    return name?.type === 'JSXIdentifier' && name.name === 'sz';
}

/**
 * Compile a JSX `sz={...}` value into class names. This is a stand-in
 * for the real `@csszyx/compiler` transform — only enough to drive the
 * POC pipeline.
 *
 * @param value The attribute value AST node, or null for boolean attrs.
 * @returns Class names mock-derived from the sz object.
 */
function mockCompileSz(value: OxcNode | null): string[] {
    if (!value || value.type !== 'JSXExpressionContainer') {
        return [];
    }
    const expression = (value as unknown as { expression: OxcNode }).expression;
    if (expression.type !== 'ObjectExpression') {
        return [];
    }
    const properties = (expression as unknown as { properties: OxcNode[] }).properties;
    return properties
        .filter((p): p is OxcNode & { key: OxcNode; value: OxcNode } => p.type === 'Property')
        .map(prop => {
            const key = prop.key;
            const keyName =
                key.type === 'Identifier'
                    ? String((key as unknown as { name: string }).name)
                    : key.type === 'Literal'
                      ? String((key as unknown as { value: unknown }).value)
                      : '';
            const val = prop.value;
            const valStr =
                val.type === 'Literal'
                    ? String((val as unknown as { value: unknown }).value)
                    : val.type === 'Identifier'
                      ? String((val as unknown as { name: string }).name)
                      : '';
            return `${keyName}-${valStr}`;
        });
}

/**
 * Hand-rolled depth-first AST walker. Replaces a Babel `traverse` call
 * for the POC scope — the visitor pattern in D2 will be richer, but
 * for now we only need to enter every node and call a single visitor.
 *
 * @param node Root AST node.
 * @param visit Function called for every visited node.
 */
function walk(node: unknown, visit: (node: OxcNode) => void): void {
    if (!node || typeof node !== 'object') {
        return;
    }
    const typed = node as OxcNode;
    if (typeof typed.type !== 'string') {
        return;
    }
    visit(typed);
    for (const key of Object.keys(typed)) {
        if (
            key === 'loc' ||
            key === 'range' ||
            key === 'start' ||
            key === 'end' ||
            key === 'type'
        ) {
            continue;
        }
        const child = (typed as Record<string, unknown>)[key];
        if (Array.isArray(child)) {
            for (const item of child) {
                walk(item, visit);
            }
        } else if (child && typeof child === 'object') {
            walk(child, visit);
        }
    }
}
