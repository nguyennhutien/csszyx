/**
 * Every call to `szNodeWarningsUnmuted` is gated on `NODE_ENV` at the call site,
 * and so is every `szReport` call that names a line the registry keeps out of
 * production.
 *
 * The helper answers only "outside a browser, and not muted"; it does not read
 * `NODE_ENV`, because each read of `process.env` is a call into the host on
 * Node and the call sites already make one. The production check therefore has
 * to sit in the same condition, written out as `process.env.NODE_ENV` — the
 * spelling a bundler folds, so a production app drops the whole warning. A call
 * without it would warn in production and keep its message in every bundle,
 * with nothing failing; this test is what fails instead.
 *
 * `szReport` prints the development form and reads no `NODE_ENV` itself (ADR
 * 0031): a call that a production build can reach would print the full
 * sentence there and keep its templates in the bundle. Its check has to be the
 * branch the call sits on — an early `return` above it is not enough, since
 * esbuild keeps the templates a call names when the call follows a `return`
 * (measured on the runtime app bundle). The runtime's `devWarn`, which dedupes
 * and caps before it calls `szReport`, names its template the same way, so
 * its calls are held to the same rule.
 *
 * The browser packages report through the same two, so their sources are read
 * too: the runtime, `@csszyx/dynamic` and the umbrella's CDN entry.
 *
 * A thrown error words its message with `szRender`, the same template without
 * the printing, and its production message is the compact line whatever the
 * registry says of the console line: so every `szRender` call is held to the
 * rule, a line that prints in production included. A call inside a helper
 * counts as gated when every call of that helper in its file is, and the
 * helper is not exported: a bundler drops a module-local function nothing
 * calls, with the templates it names (the lite runtime's dev-only throw).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';

import { SZ_DIAGNOSTIC_REGISTRY } from '../src/diagnostic-spec.generated.js';

const SRC = path.resolve(import.meta.dirname, '../src');
const HELPER = 'szNodeWarningsUnmuted';
/** Every package whose sources report a diagnostic (`turbo.json` lists them as inputs). */
const PACKAGES = path.resolve(SRC, '../..');
const REPORTING_SOURCES = ['compiler', 'runtime', 'dynamic', 'csszyx'].map(name =>
    path.join(PACKAGES, name, 'src'),
);
/** The calls that print a registry template: the reporter, and the runtime's deduping wrapper. */
const REPORTERS: ReadonlySet<string> = new Set(['szReport', 'devWarn']);
/** The call that words a thrown error from a registry template, in development only. */
const RENDERER = 'szRender';
/** Where the reporter is defined: `szReport` words its line with `szRender`. */
const REPORTER_MODULE = path.join(SRC, 'diagnostic-report.ts');

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
                at: `${path.relative(PACKAGES, file)}:${line}`,
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

const SOURCES = REPORTING_SOURCES.flatMap(dir =>
    readdirSync(dir, { recursive: true })
        .map(String)
        .filter(name => name.endsWith('.ts') && !name.endsWith('.d.ts'))
        .map(name => path.join(dir, name)),
);

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

/**
 * Whether a branch runs only outside production, as its parent decides it:
 * the consequent of a test whose first `&&` operand is `!== 'production'`,
 * the alternate of one whose first `||` operand is `=== 'production'`, or the
 * right side of such a chain. Only a first operand folds the whole test when
 * a bundler defines `NODE_ENV`; a later one leaves the operands before it.
 * @param parent - The node holding the branch.
 * @param child - The branch.
 * @returns True when production never runs it.
 */
function isDevelopmentBranch(parent: Node, child: Node): boolean {
    const first = (test: Node, operator: string) => operands(test, operator)[0] as Node;
    if (parent.type === 'IfStatement' || parent.type === 'ConditionalExpression') {
        const test = parent.test as Node;
        if (parent.consequent === child) return isProductionCheck(first(test, '&&'), '!==');
        if (parent.alternate === child) return isProductionCheck(first(test, '||'), '===');
        return false;
    }
    return (
        parent.type === 'LogicalExpression' &&
        parent.operator === '&&' &&
        parent.right === child &&
        isProductionCheck(first(parent.left as Node, '&&'), '!==')
    );
}

/** Each id's `runtime.production`, by the name of its browser module export. */
const PRODUCTION_BY_EXPORT: ReadonlyMap<string, boolean | readonly string[]> = new Map(
    SZ_DIAGNOSTIC_REGISTRY.map(spec => [
        spec.id.toUpperCase().replaceAll('-', '_'),
        spec.surfaces.runtime?.production ?? false,
    ]),
);

/**
 * Whether a `szReport` call names a line that prints in production: its
 * diagnostic's `runtime.production` is true, or lists the literal `form` its
 * args name. Anything the call does not spell out counts as development only.
 * @param call - The call.
 * @returns True when the call may run in production.
 */
function printsInProduction(call: Node): boolean {
    const [options] = call.arguments as Node[];
    if (options?.type !== 'ObjectExpression') return false;
    const property = (object: Node, name: string) =>
        (object.properties as Node[]).find(
            p => p.type === 'Property' && (p.key as Node & { name?: string }).name === name,
        )?.value as Node | undefined;
    const diagnostic = property(options, 'diagnostic') as (Node & { name?: string }) | undefined;
    const production = PRODUCTION_BY_EXPORT.get(diagnostic?.name ?? '') ?? false;
    if (typeof production === 'boolean') return production;
    const args = property(options, 'args');
    const form = args?.type === 'ObjectExpression' ? property(args, 'form') : undefined;
    return form?.type === 'Literal' && production.includes(form.value as string);
}

/** A call, with its ancestors, root first. */
type Located = { call: Node; chain: Node[] };

/**
 * Every call expression in a program, with its ancestors.
 * @param program - The program.
 * @returns The calls, in source order.
 */
function callsIn(program: unknown): Located[] {
    const found: Located[] = [];
    const visit = (node: unknown, ancestors: Node[]) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const child of node) visit(child, ancestors);
            return;
        }
        const current = node as Node;
        if (current.type === 'CallExpression') {
            found.push({ call: current, chain: [...ancestors, current] });
        }
        for (const [key, value] of Object.entries(current)) {
            if (key !== 'parent') visit(value, [...ancestors, current]);
        }
    };
    visit(program, []);
    return found;
}

/**
 * The name a call is made by, when its callee is a plain identifier.
 * @param call - The call.
 * @returns The name, or an empty string.
 */
function calleeName(call: Node): string {
    return (call.callee as Node & { name?: string }).name ?? '';
}

/**
 * Whether production never reaches a call: a development branch holds it, or
 * it sits in a module-local function every call of which production never
 * reaches.
 * @param located - The call and its ancestors.
 * @param calls - Every call in the file.
 * @param seen - Functions already on the path, so recursion ends.
 * @returns True when production never makes the call.
 */
function isDevelopmentOnly(
    located: Located,
    calls: readonly Located[],
    seen: ReadonlySet<string> = new Set(),
): boolean {
    const { chain } = located;
    if (chain.some((child, i) => i > 0 && isDevelopmentBranch(chain[i - 1] as Node, child))) {
        return true;
    }
    const at = chain.findLastIndex(node => node.type === 'FunctionDeclaration');
    const helper = chain[at] as (Node & { id?: { name?: string } }) | undefined;
    const name = helper?.id?.name;
    if (name === undefined || seen.has(name)) return false;
    if (chain[at - 1]?.type.startsWith('Export')) return false;
    const callers = calls.filter(other => calleeName(other.call) === name);
    const inner = new Set([...seen, name]);
    return callers.length > 0 && callers.every(caller => isDevelopmentOnly(caller, calls, inner));
}

/**
 * Every `szReport` or `devWarn` call in one file that names a development-only
 * line, and every `szRender` call, with whether production never reaches it
 * and the name it was made by.
 * @param file - A source file.
 * @param source - Its text; read from disk when omitted.
 * @returns One finding per call; production lines are left out.
 */
function reportSites(
    file: string,
    source = readFileSync(file, 'utf8'),
): Array<{ at: string; gated: boolean; name: string }> {
    const { program } = parseSync(file, source);
    const calls = callsIn(program);
    return calls
        .filter(({ call }) => {
            const name = calleeName(call);
            if (name === RENDERER) return file !== REPORTER_MODULE;
            return REPORTERS.has(name) && !printsInProduction(call);
        })
        .map(located => ({
            at: `${path.relative(PACKAGES, file)}:${source.slice(0, located.call.start).split('\n').length}`,
            gated: isDevelopmentOnly(located, calls),
            name: calleeName(located.call),
        }));
}

describe('szReport call sites of a development-only line', () => {
    const calls = SOURCES.flatMap(file => reportSites(file));

    it('exist, so the check below is not vacuous', () => {
        expect(calls.length).toBeGreaterThan(10);
    });

    // The umbrella's one report, the CDN's parse error, prints in production.
    it.each(['runtime', 'dynamic'])('exist in %s too, so its sources are read', name => {
        expect(calls.filter(call => call.at.startsWith(`${name}/`)).length).toBeGreaterThan(0);
    });

    it('each sit on a branch a literal NODE_ENV check keeps out of production', () => {
        expect(calls.filter(call => !call.gated).map(call => call.at)).toEqual([]);
    });
});

describe('the szReport gate itself', () => {
    const gated = (body: string) =>
        reportSites(path.join(SRC, 'probe.ts'), `export function f(k, args) { ${body} }`).map(
            c => c.gated,
        );

    it.each([
        ["if (process.env.NODE_ENV !== 'production') szReport({ diagnostic: UNKNOWN_KEY, args });"],
        [
            "if (process.env.NODE_ENV !== 'production' && k) { szReport({ diagnostic: UNKNOWN_KEY, args }); }",
        ],
        [
            "if (process.env.NODE_ENV === 'production') return; else szReport({ diagnostic: UNKNOWN_KEY, args });",
        ],
        [
            "if (process.env.NODE_ENV === 'production' || k) {} else { szReport({ diagnostic: UNKNOWN_KEY, args }); }",
        ],
        [
            "process.env.NODE_ENV !== 'production' && szReport({ diagnostic: OFF_SCALE_VALUE, args });",
        ],
        [
            "if ('production' !== process.env.NODE_ENV) { if (k) szReport({ diagnostic: CLOSED_ENUM_VALUE, args: { form: 'dead' } }); }",
        ],
        [
            "if (process.env.NODE_ENV !== 'production' && szNodeWarningsUnmuted()) { if (k.has(args)) return; k.add(args); szReport({ diagnostic: OFF_SCALE_VALUE, args }); }",
        ],
    ])('accepts %s', body => {
        expect(gated(body)).toEqual([true]);
    });

    it.each([
        [
            "if (process.env.NODE_ENV === 'production') return; szReport({ diagnostic: UNKNOWN_KEY, args });",
        ],
        [
            "if (k && process.env.NODE_ENV !== 'production') szReport({ diagnostic: UNKNOWN_KEY, args });",
        ],
        [
            "if (process?.env.NODE_ENV !== 'production') szReport({ diagnostic: UNKNOWN_KEY, args });",
        ],
        ["if (process.env.NODE_ENV === 'production') szReport({ diagnostic: UNKNOWN_KEY, args });"],
        ['szReport({ diagnostic: UNKNOWN_KEY, args });'],
        ["szReport({ diagnostic: CLOSED_ENUM_VALUE, args: { form: 'dead', key: k } });"],
        ['szReport({ diagnostic: CLOSED_ENUM_VALUE, args });'],
        ['szReport(options);'],
    ])('refuses %s', body => {
        expect(gated(body)).toEqual([false]);
    });

    it.each([
        [
            "if (process.env.NODE_ENV !== 'production') devWarn({ diagnostic: SZV_UNKNOWN_VARIANT, args });",
        ],
    ])('accepts the runtime wrapper on a development branch: %s', body => {
        expect(gated(body)).toEqual([true]);
    });

    it.each([
        ['devWarn({ diagnostic: SZV_UNKNOWN_VARIANT, args });'],
        [
            "if (process.env.NODE_ENV === 'production') return; devWarn({ diagnostic: SZV_UNKNOWN_VARIANT, args });",
        ],
    ])('refuses the runtime wrapper off a development branch: %s', body => {
        expect(gated(body)).toEqual([false]);
    });

    it.each([
        ['szReport({ diagnostic: REMOVED_KEY, args });'],
        ["szReport({ diagnostic: CLOSED_ENUM_VALUE, args: { form: 'sibling-group', key: k } });"],
    ])('leaves a line that prints in production to the size gate: %s', body => {
        expect(gated(body)).toEqual([]);
    });

    it.each([
        [
            "throw new CsszyxError({ code: 'sz-object-depth', args, message: process.env.NODE_ENV !== 'production' ? szRender({ diagnostic: SZ_OBJECT_DEPTH, args }) : 'c' });",
        ],
        [
            "const m = process.env.NODE_ENV !== 'production' ? szRender({ diagnostic: SZ_ATTRIBUTE_SYNTAX, args }) : 'c';",
        ],
        [
            "if (process.env.NODE_ENV !== 'production' && k.trim()) throw new TypeError(szRender({ diagnostic: SPLIT_BOX_SZ_STRING, args }));",
        ],
        [
            "function a(v) { throw new Error(szRender({ diagnostic: LITE_SZ_OBJECT, args: v })); } if (process.env.NODE_ENV !== 'production') a(k); for (const x of k) { if (process.env.NODE_ENV !== 'production') a(x); }",
        ],
    ])('accepts a thrown message worded on a development branch: %s', body => {
        expect(gated(body)).toEqual([true]);
    });

    it.each([
        // A thrown message is compact in production even for a line the
        // console prints there, so no `szRender` call is left to the size gate.
        ['throw new SyntaxError(szRender({ diagnostic: SZ_ATTRIBUTE_SYNTAX, args }));'],
        [
            "const m = process.env.NODE_ENV === 'production' ? szRender({ diagnostic: SZ_OBJECT_DEPTH, args }) : 'c';",
        ],
        [
            "function a(v) { throw new Error(szRender({ diagnostic: LITE_SZ_OBJECT, args: v })); } if (process.env.NODE_ENV !== 'production') a(k); a(args);",
        ],
        ['function a(v) { throw new Error(szRender({ diagnostic: LITE_SZ_OBJECT, args: v })); }'],
        ['function a(v) { return a(szRender({ diagnostic: LITE_SZ_OBJECT, args: v })); }'],
    ])('refuses a thrown message production can reach: %s', body => {
        expect(gated(body)).toEqual([false]);
    });

    it('refuses a helper another module may call', () => {
        const sites = reportSites(
            path.join(SRC, 'probe.ts'),
            "export function a(v) { throw new Error(szRender({ diagnostic: LITE_SZ_OBJECT, args: v })); } if (process.env.NODE_ENV !== 'production') a(1);",
        );
        expect(sites.map(site => site.gated)).toEqual([false]);
    });
});

describe('szRender call sites', () => {
    const calls = SOURCES.flatMap(file => reportSites(file)).filter(call => call.name === RENDERER);

    // One per thrown code in the browser packages, at least.
    it.each(['compiler', 'runtime', 'dynamic', 'csszyx'])('exist in %s', name => {
        expect(calls.filter(call => call.at.startsWith(`${name}/`)).length).toBeGreaterThan(0);
    });
});
