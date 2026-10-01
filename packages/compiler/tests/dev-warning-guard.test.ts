/**
 * Every call to `szNodeWarningsUnmuted` is gated on `NODE_ENV` at the call site.
 *
 * The helper answers only "outside a browser, and not muted"; it does not read
 * `NODE_ENV`, because each read of `process.env` is a call into the host on
 * Node and the call sites already make one. The production check therefore has
 * to sit in the same condition, written out as `process.env.NODE_ENV` — the
 * spelling a bundler folds, so a production app drops the whole warning. A call
 * without it would warn in production and keep its message in every bundle,
 * with nothing failing; this test is what fails instead.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../src');
const HELPER = 'szNodeWarningsUnmuted';

type Node = { type: string; start: number; end: number; [key: string]: unknown };

/**
 * Whether a node is `process.env.NODE_ENV`.
 * @param node - Any AST node.
 * @returns True for exactly that member chain.
 */
function isNodeEnv(node: Node | undefined): boolean {
    const object = node?.object as Node | undefined;
    return (
        node?.type === 'MemberExpression' &&
        (node.property as Node & { name?: string }).name === 'NODE_ENV' &&
        object?.type === 'MemberExpression' &&
        (object.object as Node & { name?: string }).name === 'process' &&
        (object.property as Node & { name?: string }).name === 'env'
    );
}

/**
 * Whether a node is `process.env.NODE_ENV <op> 'production'`.
 * @param node - Any AST node.
 * @param operator - `!==` for an `&&` chain, `===` for an `||` chain.
 * @returns True when the comparison short-circuits that chain in production.
 */
function isProductionCheck(node: Node, operator: '!==' | '==='): boolean {
    if (node.type !== 'BinaryExpression' || node.operator !== operator) return false;
    const [left, right] = [node.left as Node, node.right as Node];
    const literal = (n: Node) => n.type === 'Literal' && n.value === 'production';
    return (isNodeEnv(left) && literal(right)) || (isNodeEnv(right) && literal(left));
}

/**
 * The operands of a flat `&&` / `||` chain, in evaluation order.
 * @param node - A logical expression.
 * @param operator - The chain's operator.
 * @returns Its operands, nested parentheses unwrapped.
 */
function operands(node: Node, operator: string): Node[] {
    const unwrap = (n: Node): Node =>
        n.type === 'ParenthesizedExpression' ? unwrap(n.expression as Node) : n;
    const inner = unwrap(node);
    if (inner.type !== 'LogicalExpression' || inner.operator !== operator) return [inner];
    return [...operands(inner.left as Node, operator), ...operands(inner.right as Node, operator)];
}

/**
 * Every call to the helper in one file, with whether its condition is gated.
 * @param file - A source file.
 * @param source - Its text; read from disk when omitted.
 * @returns One finding per call.
 */
function callSites(
    file: string,
    source = readFileSync(file, 'utf8'),
): Array<{ at: string; gated: boolean }> {
    const { program } = parseSync(file, source);
    const found: Array<{ at: string; gated: boolean }> = [];
    const visit = (node: unknown, ancestors: Node[]) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const child of node) visit(child, ancestors);
            return;
        }
        const current = node as Node;
        if (
            current.type === 'CallExpression' &&
            (current.callee as Node & { name?: string }).name === HELPER
        ) {
            const line = source.slice(0, current.start).split('\n').length;
            found.push({
                at: `${path.relative(SRC, file)}:${line}`,
                gated: isGated(current, ancestors),
            });
        }
        for (const [key, value] of Object.entries(current)) {
            if (key !== 'parent') visit(value, [...ancestors, current]);
        }
    };
    visit(program, []);
    return found;
}

/** The comparison that short-circuits each chain operator in production. */
const PRODUCTION_CHECK_FOR: Readonly<Record<string, '!==' | '==='>> = { '&&': '!==', '||': '===' };

/**
 * Whether a call evaluates only after a production check in its own condition.
 * @param call - The helper call.
 * @param ancestors - Its ancestors, root first.
 * @returns True when an earlier operand of the enclosing chain is the check.
 */
function isGated(call: Node, ancestors: Node[]): boolean {
    for (let i = ancestors.length - 1; i >= 0; i--) {
        const node = ancestors[i];
        if (node?.type === 'LogicalExpression') {
            const operator = node.operator as string;
            const check = PRODUCTION_CHECK_FOR[operator];
            if (
                check &&
                operands(node, operator).some(
                    o => o.end <= call.start && isProductionCheck(o, check),
                )
            ) {
                return true;
            }
            continue;
        }
        const negation = node?.type === 'UnaryExpression' && node.operator === '!';
        if (!negation && node?.type !== 'ParenthesizedExpression') return false;
    }
    return false;
}

const SOURCES = readdirSync(SRC, { recursive: true })
    .map(String)
    .filter(name => name.endsWith('.ts') && !name.endsWith('.d.ts'))
    .map(name => path.join(SRC, name));

describe(`${HELPER} call sites`, () => {
    const calls = SOURCES.flatMap(file => callSites(file));

    it('exist, so the check below is not vacuous', () => {
        expect(calls.length).toBeGreaterThan(5);
    });

    it('each check process.env.NODE_ENV before the helper in the same condition', () => {
        expect(calls.filter(call => !call.gated).map(call => call.at)).toEqual([]);
    });
});

describe('the gate itself', () => {
    const gated = (body: string) =>
        callSites(path.join(SRC, 'probe.ts'), `export function f(k) { ${body} }`).map(c => c.gated);

    it.each([
        ["if (process.env.NODE_ENV === 'production' || !szNodeWarningsUnmuted()) return;"],
        ["if (k && process.env.NODE_ENV !== 'production' && szNodeWarningsUnmuted()) warn();"],
        ["if (!k || (process.env.NODE_ENV === 'production' || !szNodeWarningsUnmuted())) return;"],
        ["return 'production' !== process.env.NODE_ENV && szNodeWarningsUnmuted();"],
    ])('accepts %s', body => {
        expect(gated(body)).toEqual([true]);
    });

    it.each([
        ['if (!szNodeWarningsUnmuted()) return;'],
        ["if (szNodeWarningsUnmuted() && process.env.NODE_ENV !== 'production') warn();"],
        ["if (process.env.NODE_ENV !== 'production' || szNodeWarningsUnmuted()) warn();"],
        ["if (process.env.NODE_ENV !== 'production' && typeof szNodeWarningsUnmuted()) warn();"],
        ["if (process?.env.NODE_ENV !== 'production' && szNodeWarningsUnmuted()) warn();"],
        [
            "const on = process.env.NODE_ENV !== 'production'; if (on && szNodeWarningsUnmuted()) warn();",
        ],
    ])('refuses %s', body => {
        expect(gated(body)).toEqual([false]);
    });
});
