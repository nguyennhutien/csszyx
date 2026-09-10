/**
 * Reads the attributes off transformed JSX, using the compiler's own parser.
 *
 * A gate that inspects transformed output has to agree with the thing that
 * produced it about where an element ends. A regex does not: matching
 * `<tag ...>` with a negated character class stops at the first `>`, and a `>`
 * inside an earlier attribute value truncates the list — so an attribute after
 * it is not seen at all. Measured on this shape:
 *
 * ```
 * <div onClick={() => x} sz={{ p: 4 }} />
 * <div title={"a>b"}     sz={{ p: 4 }} />
 * ```
 *
 * both hide the `sz` from a regex while `parseSync` reports it. A gate that
 * silently misses is worse than no gate, which is why this reads an AST.
 *
 * It lives beside the other compiler test helpers because `oxc-parser` is a
 * dependency of THIS package — `packages/core` resolves it only through the
 * hoisted store, which is an accident of the install layout rather than a
 * declared dependency.
 *
 * NOT a `.test.ts` file on purpose: vitest must not collect it as a suite.
 */
import { parseSync } from 'oxc-parser';

/** One attribute, with the element it sits on. */
export interface JsxAttributeRef {
    /** The tag as written: `div`, `Card`, `Ui.Box`. */
    tag: string;
    /** The attribute name as written. */
    name: string;
}

/**
 * Every JSX attribute in a module, in source order.
 *
 * Spread attributes carry no name and are skipped; a caller asking "is this
 * prop still here" is asking about a named one.
 *
 * @param code The module source to read.
 * @param filename Name used for parse diagnostics.
 * @returns One entry per named attribute.
 * @throws When the source does not parse — output that cannot be read must not
 *   be reported as output with no attributes.
 */
export function jsxAttributes(code: string, filename = 'probe.tsx'): JsxAttributeRef[] {
    const parsed = parseSync(filename, code);
    if (parsed.errors.length > 0) {
        throw new Error(
            `jsxAttributes: ${filename} did not parse: ` +
                parsed.errors.map(error => error.message).join('; '),
        );
    }

    const found: JsxAttributeRef[] = [];
    const visit = (node: unknown): void => {
        if (node === null || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const child of node) visit(child);
            return;
        }
        const record = node as Record<string, unknown> & { type?: string };
        if (record.type === 'JSXOpeningElement') {
            const name = record.name as { start: number; end: number };
            const tag = code.slice(name.start, name.end);
            const attributes = (record.attributes ?? []) as {
                type: string;
                name?: { start: number; end: number };
            }[];
            for (const attribute of attributes) {
                if (attribute.type !== 'JSXAttribute' || attribute.name === undefined) continue;
                found.push({ tag, name: code.slice(attribute.name.start, attribute.name.end) });
            }
        }
        for (const key of Object.keys(record)) {
            if (key === 'type') continue;
            visit(record[key]);
        }
    };
    visit(parsed.program);
    return found;
}
