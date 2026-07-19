import { describe, expect, it } from 'vitest';

import { ASTBudgetExceededError, transform, transformSourceCode } from '../src/transform.js';

/**
 * Branch-coverage tests for the pure-JS (Babel) source transform in
 * `src/transform.ts`. Each test feeds a real JSX/TS source through
 * `transformSourceCode` and asserts the actual rewritten `code`, collected
 * `classes`, diagnostics, or runtime-helper flags — exercising the specific
 * branch under test.
 */

/**
 * Transform a JSX/TS source under a fixed filename.
 * @param jsx - Source to compile.
 * @param opts - Optional transform options.
 * @returns The transform result.
 */
const run = (jsx: string, opts?: Parameters<typeof transformSourceCode>[2]) =>
    transformSourceCode(jsx, 'file.tsx', opts);

// ── Fast path + className/class piggyback ───────────────────────────────────
describe('fast path + raw className collection', () => {
    it('returns source unchanged when it does not contain "sz"', () => {
        const jsx = 'const A = () => <div className="foo bar" title="hi" />;';
        const r = run(jsx);
        expect(r.transformed).toBe(false);
        expect(r.code).toBe(jsx);
        // Fast path bails before parsing, so nothing is collected.
        expect(r.classes.size).toBe(0);
        expect(r.rawClassNames.size).toBe(0);
    });

    it('collects className string literals into rawClassNames (not classes)', () => {
        const jsx = 'const A = () => <div className="foo bar" sz={{ p: 4 }} />;';
        const r = run(jsx);
        expect(r.rawClassNames.has('foo')).toBe(true);
        expect(r.rawClassNames.has('bar')).toBe(true);
        // sz-derived classes go to collectedClasses, raw ones do not.
        expect(r.classes.has('foo')).toBe(false);
    });

    it('collects a `class` (not className) attribute and skips empty tokens', () => {
        const jsx = 'const A = () => <div class="a   b" data-sz="x" />;';
        const r = run(jsx);
        expect(r.rawClassNames.has('a')).toBe(true);
        expect(r.rawClassNames.has('b')).toBe(true);
        expect(r.rawClassNames.has('')).toBe(false);
    });
});

// ── szRecover ───────────────────────────────────────────────────────────────
describe('szRecover attribute', () => {
    it('warns and skips a non-string-literal szRecover value', () => {
        const jsx = 'const A = ({ mode }) => <div szRecover={mode} />;';
        const r = run(jsx);
        expect(r.recoveryTokens.size).toBe(0);
        expect(
            r.diagnostics.some(d => d.includes('szRecover') && d.includes('string-literal')),
        ).toBe(true);
    });

    it('warns and skips an unknown szRecover mode', () => {
        const jsx = 'const A = () => <div szRecover="bogus" />;';
        const r = run(jsx);
        expect(r.recoveryTokens.size).toBe(0);
        expect(r.diagnostics.some(d => d.includes('unknown mode "bogus"'))).toBe(true);
    });

    it('emits a recovery token + data attribute for a valid csr mode', () => {
        const jsx = 'const A = () => <div szRecover="csr" />;';
        const r = run(jsx);
        expect(r.transformed).toBe(true);
        expect(r.recoveryTokens.size).toBe(1);
        expect(r.code).toContain('data-sz-recovery-token=');
        const [, tokenData] = [...r.recoveryTokens.entries()][0];
        expect(tokenData.mode).toBe('csr');
        expect(tokenData.component).toBe('div');
    });

    it('records a member-expression element type as <member>', () => {
        const jsx = 'const A = () => <Card.Header szRecover="dev-only" />;';
        const r = run(jsx);
        expect(r.recoveryTokens.size).toBe(1);
        const [, tokenData] = [...r.recoveryTokens.entries()][0];
        expect(tokenData.component).toBe('<member>');
        expect(tokenData.mode).toBe('dev-only');
    });

    it('is idempotent — skips an element already carrying a recovery token', () => {
        const jsx =
            'const A = () => <div szRecover="csr" data-sz-recovery-token="deadbeef0000" />;';
        const r = run(jsx);
        // Already tagged → no new token emitted.
        expect(r.recoveryTokens.size).toBe(0);
    });
});

// ── szs slot maps ───────────────────────────────────────────────────────────
describe('szs slot maps', () => {
    it('warns when szs is placed on a host element', () => {
        const jsx = 'const A = () => <div szs={{ root: { p: 4 } }} />;';
        const r = run(jsx);
        expect(r.diagnostics.some(d => d.includes('no effect on a host element'))).toBe(true);
        // Left unchanged: still szs, not szsc.
        expect(r.code).toContain('szs=');
        expect(r.code).not.toContain('szsc');
    });

    it('warns when szs value is not an object expression container', () => {
        const jsx = 'const A = () => <Comp szs="not-an-object" />;';
        const r = run(jsx);
        expect(r.diagnostics.some(d => d.includes('every slot must be an identifier key'))).toBe(
            true,
        );
    });

    it('warns when a slot value violates the v1 contract', () => {
        const jsx = 'const A = ({ x }) => <Comp szs={{ root: x }} />;';
        const r = run(jsx);
        expect(r.diagnostics.some(d => d.includes('every slot must be an identifier key'))).toBe(
            true,
        );
    });

    it('compiles object slot values and renames szs → szsc', () => {
        const jsx = 'const A = () => <Comp szs={{ root: { p: 4 }, title: { text: "lg" } }} />;';
        const r = run(jsx);
        expect(r.transformed).toBe(true);
        expect(r.code).toContain('szsc=');
        expect(r.code).toContain('"p-4"');
        expect(r.code).toContain('"text-lg"');
        expect(r.classes.has('p-4')).toBe(true);
        expect(r.classes.has('text-lg')).toBe(true);
    });

    it('keeps a raw class-string slot value as-is (idempotent) and still renames', () => {
        const jsx = 'const A = () => <Comp szs={{ root: "flex gap-2" }} />;';
        const r = run(jsx);
        expect(r.transformed).toBe(true);
        expect(r.code).toContain('szsc=');
        expect(r.code).toContain('"flex gap-2"');
        expect(r.classes.has('flex')).toBe(true);
        expect(r.classes.has('gap-2')).toBe(true);
    });
});

// ── sz string literal ───────────────────────────────────────────────────────
describe('sz="string" (Case 1)', () => {
    it('renames sz to className and collects the raw classes', () => {
        const jsx = 'const A = () => <div sz="p-4 bg-red-500" />;';
        const r = run(jsx);
        expect(r.transformed).toBe(true);
        expect(r.code).toContain('className="p-4 bg-red-500"');
        expect(r.classes.has('p-4')).toBe(true);
        expect(r.classes.has('bg-red-500')).toBe(true);
    });

    it('merges an sz string with an existing static className', () => {
        const jsx = 'const A = () => <div className="base" sz="p-4" />;';
        const r = run(jsx);
        expect(r.code).toContain('className="base p-4"');
    });
});

// ── className / style existing-attr detection + merge ────────────────────────
describe('existing className/style detection', () => {
    it('merges an expression className with static sz via _szMerge', () => {
        const jsx = 'const A = ({ x }) => <div className={x} sz={{ p: 4 }} />;';
        const r = run(jsx);
        expect(r.usesMerge).toBe(true);
        expect(r.code).toContain('_szMerge(x, "p-4")');
    });

    it('lowers sz={{}} with no className to className={undefined}', () => {
        const jsx = 'const A = () => <div sz={{}} />;';
        const r = run(jsx);
        expect(r.transformed).toBe(true);
        expect(r.code).toContain('className={undefined}');
    });

    it.each([
        [
            'an object attribute',
            'const A = ({ v }) => <div style={{ color: "red" }} sz={{ p: v }} />;',
            ['color: "red"', '"--_sz-p"'],
        ],
        [
            'a string attribute',
            'const A = ({ v }) => <div style="color: red; margin-top: 10px" sz={{ p: v }} />;',
            ['marginTop: "10px"', '"--_sz-p"'],
        ],
        [
            'a custom property',
            'const A = ({ v }) => <div style="--x: 1px; color: red" sz={{ p: v }} />;',
            ['"--x": "1px"', '"--_sz-p"'],
        ],
        [
            'a dynamic reference',
            'const A = ({ v, myStyle }) => <div style={myStyle} sz={{ p: v }} />;',
            ['...myStyle', '"--_sz-p"'],
        ],
    ])('merges CSS variables with %s style', (_label, jsx, expectedCode) => {
        const r = run(jsx);
        for (const fragment of expectedCode) expect(r.code).toContain(fragment);
    });
});

// ── Case 2: sz={{ static }} ──────────────────────────────────────────────────
describe('sz={{ static object }} (Case 2)', () => {
    it('compiles a static object to a className string', () => {
        const jsx = 'const A = () => <div sz={{ p: 4, bg: "blue-500" }} />;';
        const r = run(jsx);
        expect(r.code).toContain('className="p-4 bg-blue-500"');
        expect(r.classes.has('p-4')).toBe(true);
    });

    it('resolves a local-variable spread before static evaluation', () => {
        const jsx = 'const base = { p: 4 }; const A = () => <div sz={{ ...base, m: 2 }} />;';
        const r = run(jsx);
        expect(r.code).toContain('className="p-4 m-2"');
    });

    it('hoists a conditional spread into a className ternary', () => {
        const jsx =
            'const a = { p: 4 }; const b = { p: 8 }; const A = ({ c }) => <div sz={{ ...(c ? a : b), m: 2 }} />;';
        const r = run(jsx);
        expect(r.transformed).toBe(true);
        expect(r.code).toContain('c ?');
        expect(r.classes.has('p-4')).toBe(true);
        expect(r.classes.has('p-8')).toBe(true);
        expect(r.classes.has('m-2')).toBe(true);
    });

    it('hoists a finite conditional nested in a value into both branches', () => {
        const jsx =
            'const A = ({ c }) => <div sz={{ borderColor: { color: c ? "red-700" : "gray-500", op: 18 }, bg: "white" }} />;';
        const r = run(jsx);
        expect(r.transformed).toBe(true);
        expect(r.classes.has('bg-white')).toBe(true);
        expect(r.classes.has('border-red-700/18')).toBe(true);
        expect(r.classes.has('border-gray-500/18')).toBe(true);
    });

    it('hoists a deeply-nested conditional value', () => {
        const jsx =
            'const A = ({ c }) => <div sz={{ hover: { borderColor: { color: c ? "red-500" : "blue-500", op: 20 } } }} />;';
        const r = run(jsx);
        expect(r.transformed).toBe(true);
        expect(r.classes.has('hover:border-red-500/20')).toBe(true);
        expect(r.classes.has('hover:border-blue-500/20')).toBe(true);
    });
});

// ── Partial / CSS-variable path ──────────────────────────────────────────────
describe('sz partial (CSS variable) path', () => {
    it('emits a CSS-var class + inline style for a fully dynamic spacing prop', () => {
        const jsx = 'const A = ({ v }) => <div sz={{ p: v }} />;';
        const r = run(jsx);
        expect(r.code).toContain('p-(--_sz-p)');
        expect(r.code).toContain('__szSpacingVar(v, "p")');
    });

    it('compiles a static+dynamic-branch ternary prop with no style props', () => {
        const jsx = 'const A = ({ c }) => <div sz={{ scale: c ? 75 : 100 }} />;';
        const r = run(jsx);
        expect(r.transformed).toBe(true);
        // Bare ternary of two class strings, no style attribute needed.
        expect(r.code).toContain('scale-75');
        expect(r.code).toContain('scale-100');
        expect(r.code).not.toContain('style={{');
    });

    it('mixes a static prop with a conditional prop (template literal className)', () => {
        const jsx = 'const A = ({ c }) => <div sz={{ bg: "red-500", scale: c ? 75 : 100 }} />;';
        const r = run(jsx);
        expect(r.classes.has('bg-red-500')).toBe(true);
        expect(r.classes.has('scale-75')).toBe(true);
        expect(r.classes.has('scale-100')).toBe(true);
    });

    it('emits a CSS-var color class for a static color with dynamic opacity', () => {
        const jsx = 'const A = ({ o }) => <div sz={{ bg: { color: "red-500", op: o } }} />;';
        const r = run(jsx);
        expect(r.code).toContain('bg-red-500/(--_sz-bg-op)');
    });

    it('uses __szColorVar for a fully dynamic color object', () => {
        const jsx = 'const A = ({ col, o }) => <div sz={{ bg: { color: col, op: o } }} />;';
        const r = run(jsx);
        expect(r.usesColorVar).toBe(true);
        expect(r.code).toContain('__szColorVar');
    });

    it('handles a dynamic prop nested inside a known variant', () => {
        const jsx = 'const A = ({ v }) => <div sz={{ hover: { p: v } }} />;';
        const r = run(jsx);
        expect(r.code).toContain('hover:p-(--_sz-hover-p)');
    });

    it('handles a conditional prop inside a variant (prefixed both branches)', () => {
        const jsx = 'const A = ({ c }) => <div sz={{ hover: { scale: c ? 75 : 100 } }} />;';
        const r = run(jsx);
        expect(r.classes.has('hover:scale-75')).toBe(true);
        expect(r.classes.has('hover:scale-100')).toBe(true);
    });

    it('emits a color CSS var for a fully dynamic top-level color prop', () => {
        const jsx = 'const A = ({ col }) => <div sz={{ bg: col }} />;';
        const r = run(jsx);
        expect(r.usesColorVar).toBe(true);
        expect(r.code).toContain('__szColorVar');
    });
});

// ── Identifier / conditional resolution ──────────────────────────────────────
describe('sz={identifier} and sz={ternary}', () => {
    it('resolves a local const sz object', () => {
        const jsx = 'const s = { p: 4, m: 2 }; const A = () => <div sz={s} />;';
        const r = run(jsx);
        expect(r.code).toContain('className="p-4 m-2"');
    });

    it('resolves a ternary of two static objects to a className ternary', () => {
        const jsx = 'const A = ({ c }) => <div sz={c ? { p: 4 } : { m: 2 }} />;';
        const r = run(jsx);
        expect(r.transformed).toBe(true);
        expect(r.classes.has('p-4')).toBe(true);
        expect(r.classes.has('m-2')).toBe(true);
        expect(r.code).toContain('c ?');
    });

    it('resolves a ternary whose branches are const identifiers', () => {
        const jsx =
            'const a = { p: 4 }; const b = { m: 2 }; const A = ({ c }) => <div sz={c ? a : b} />;';
        const r = run(jsx);
        expect(r.classes.has('p-4')).toBe(true);
        expect(r.classes.has('m-2')).toBe(true);
    });

    it('emits className={undefined} for a ternary branch that lowers to empty', () => {
        const jsx = 'const A = ({ c }) => <div sz={c ? { p: 4 } : {}} />;';
        const r = run(jsx);
        expect(r.code).toContain('undefined');
    });
});

// ── Array composition (szcn) ─────────────────────────────────────────────────
describe('sz={[ ... ]} array composition', () => {
    it('deep-merges an all-static-object array into one className', () => {
        const jsx = 'const A = () => <div sz={[{ p: 4 }, { p: 8, m: 2 }]} />;';
        const r = run(jsx);
        // Later leaf wins for p.
        expect(r.classes.has('p-8')).toBe(true);
        expect(r.classes.has('m-2')).toBe(true);
        expect(r.code).not.toContain('_szcn');
    });

    it('skips false / null / undefined / sparse elements', () => {
        // Sparse hole, then bare false/null/undefined literals — all dropped,
        // leaving a single static object that compiles directly.
        const jsx = 'const A = () => <div sz={[, false, null, undefined, { p: 4 }]} />;';
        const r = run(jsx);
        expect(r.classes.has('p-4')).toBe(true);
        expect(r.code).not.toContain('_szcn');
    });

    it('emits _szcn for a mixed static/conditional/string array', () => {
        const jsx = 'const A = ({ c }) => <div sz={["flex", c && { p: 4 }, { m: 2 }]} />;';
        const r = run(jsx);
        expect(r.usesSzcn).toBe(true);
        expect(r.code).toContain('_szcn(');
        expect(r.classes.has('flex')).toBe(true);
        expect(r.classes.has('p-4')).toBe(true);
        expect(r.classes.has('m-2')).toBe(true);
    });

    it('drops a `cond && {}` element that lowers to empty classes', () => {
        const jsx = 'const A = ({ c }) => <div sz={[c && {}, { p: 4 }]} />;';
        const r = run(jsx);
        expect(r.classes.has('p-4')).toBe(true);
    });

    it('resolves a `cond && staticObj` array element to a conditional', () => {
        const jsx = 'const A = ({ c }) => <div sz={[c && { p: 4 }, foo.bar]} />;';
        const r = run(jsx);
        expect(r.usesSzcn).toBe(true);
        expect(r.usesSzPart).toBe(true);
        expect(r.classes.has('p-4')).toBe(true);
    });

    it('precompiles a finite ternary array element', () => {
        const jsx = 'const A = ({ c }) => <div sz={[{ p: 4 }, c ? { m: 2 } : { m: 8 }]} />;';
        const r = run(jsx);
        expect(r.usesSzPart).toBe(false);
        expect(r.code).toContain('c ? "m-2" : "m-8"');
        expect(r.classes.has('m-2')).toBe(true);
        expect(r.classes.has('m-8')).toBe(true);
    });

    it('safelists nested string/logical branches of a dynamic element', () => {
        const jsx =
            'const A = ({ c, d, foo }) => <div sz={[{ p: 4 }, foo || (d && { m: 2 }), c ? "flex" : "block"]} />;';
        const r = run(jsx);
        expect(r.usesSzPart).toBe(true);
        expect(r.classes.has('m-2')).toBe(true);
        expect(r.classes.has('flex')).toBe(true);
        expect(r.classes.has('block')).toBe(true);
    });

    it('prepends an existing className into the _szcn call', () => {
        const jsx = 'const A = ({ c }) => <div className="base" sz={["flex", foo.bar]} />;';
        const r = run(jsx);
        expect(r.code).toContain('_szcn("base"');
    });

    it('falls through to runtime _sz when the array contains a spread', () => {
        const jsx = 'const A = ({ rest }) => <div sz={[{ p: 4 }, ...rest]} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
        expect(r.code).toContain('_sz(');
    });
});

// ── Runtime fallback + diagnostics ──────────────────────────────────────────
describe('runtime fallback diagnostics', () => {
    it.each([
        [
            'a function call',
            'const A = () => <div sz={getStyles()} />;',
            'function call `getStyles()`',
        ],
        ['a member call', 'const A = () => <div sz={styles.get()} />;', 'function call `get()`'],
        [
            'an imported identifier',
            "import { external } from './x'; const A = () => <div sz={external} />;",
            'identifier `external`',
        ],
        [
            'a member expression',
            'const A = ({ o }) => <div sz={o.styles} />;',
            'member expression is not statically',
        ],
        [
            'a binary expression',
            'const A = ({ a, b }) => <div sz={a + b} />;',
            'is not statically analyzable',
        ],
        [
            'an unresolvable object spread',
            "import { x } from './x'; const A = () => <div sz={{ ...x }} />;",
            'unresolvable sz spread',
        ],
    ])('falls back with a diagnostic for %s', (_label, jsx, diagnostic) => {
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
        expect(r.diagnostics.some(message => message.includes(diagnostic))).toBe(true);
    });
});

// ── szv catalog extraction ──────────────────────────────────────────────────
describe('szv catalog extraction (VariableDeclarator)', () => {
    it.each([
        ['a non-call initializer', 'const notSzv = 5; const A = () => <div sz={{ p: 4 }} />;'],
        [
            'a different callee',
            'const x = other({ base: { p: 4 } }); const B = () => <i sz="m-1" />;',
        ],
        ['no arguments', 'const x = szv(); const B = () => <i sz="m-1" />;'],
    ])('does not inject a catalog for %s', (_label, jsx) => {
        const r = run(jsx);
        expect(r.code).not.toContain('_szv_catalog');
    });

    it('extracts a full base + variants catalog and inserts _szv_catalog_X', () => {
        const jsx = `
            const button = szv({
                base: { p: 4, rounded: "md" },
                variants: {
                    intent: { primary: { bg: "blue-500" }, danger: { bg: "red-500" } },
                    size: { sm: { text: "sm" }, lg: { text: "lg" } },
                },
            });
        `;
        const r = run(jsx);
        expect(r.transformed).toBe(true);
        expect(r.code).toContain('_szv_catalog_button');
        expect(r.classes.has('p-4')).toBe(true);
        expect(r.classes.has('bg-blue-500')).toBe(true);
        expect(r.classes.has('bg-red-500')).toBe(true);
        expect(r.classes.has('text-lg')).toBe(true);
    });

    it('resolves a const-bound config object', () => {
        const jsx = `
            const cfg = { base: { p: 2 }, variants: { size: { sm: { text: "xs" } } } };
            const card = szv(cfg);
        `;
        const r = run(jsx);
        expect(r.code).toContain('_szv_catalog_card');
        expect(r.classes.has('p-2')).toBe(true);
        expect(r.classes.has('text-xs')).toBe(true);
    });

    it('expands finite conditional leaves into both branches', () => {
        const jsx = `
            const box = szv({
                base: { p: 4 },
                variants: { dense: { on: { mx: cond ? 0 : 2 } } },
            });
        `;
        const r = run(jsx);
        expect(r.classes.has('mx-0')).toBe(true);
        expect(r.classes.has('mx-2')).toBe(true);
    });

    it('skips a non-object variant dimension value', () => {
        const jsx = 'const x = szv({ base: { p: 1 }, variants: { size: 5 } });';
        const r = run(jsx);
        // base still emitted; dimension skipped without crashing.
        expect(r.classes.has('p-1')).toBe(true);
    });

    it('emits nothing when the catalog compiles to no classes', () => {
        const jsx = 'const empty = szv({ base: {} });';
        const r = run(jsx);
        expect(r.code).not.toContain('_szv_catalog');
    });

    it('resolves a const-bound variant leaf identifier', () => {
        const jsx = `
            const GUTTER = 6;
            const y = szv({ base: { mx: GUTTER }, variants: { size: { sm: { p: 2 } } } });
        `;
        const r = run(jsx);
        expect(r.classes.has('mx-6')).toBe(true);
        expect(r.classes.has('p-2')).toBe(true);
    });
});

// ── dynamic() / szr() extraction ─────────────────────────────────────────────
// NOTE: the transform has a fast path that skips any source without the
// substring "sz". `szr` contains it; for `dynamic` sources we import from
// `@csszyx/dynamic` (which contains "sz") so the visitor actually runs.
const DYN = "import { dynamic } from '@csszyx/dynamic';\n";
describe('dynamic()/szr() extraction (CallExpression)', () => {
    it.each([
        ['an unrelated call', 'const A = () => <div className={szx({ p: 4 })} />;', []],
        ['dynamic() without arguments', DYN + 'const A = () => <div className={dynamic()} />;', []],
        ['szr() without arguments', 'const A = () => <div className={szr()} />;', []],
        [
            'an inline szr object',
            'const A = () => <div className={szr({ p: 4, m: 2 })} />;',
            ['p-4', 'm-2'],
        ],
        [
            'an inline static dynamic object',
            DYN + 'const A = () => <div className={dynamic({ p: 4 })} />;',
            ['p-4'],
        ],
        [
            'a non-static dynamic object',
            DYN + 'const A = ({ v }) => <div className={dynamic({ p: v })} />;',
            [],
        ],
    ])('collects expected classes from %s', (_label, jsx, expectedClasses) => {
        const r = run(jsx);
        expect([...r.classes]).toEqual(expectedClasses);
    });

    it('extracts from a const identifier with a satisfies wrapper', () => {
        const jsx =
            DYN +
            'const styles = { p: 4, rounded: "md" } satisfies object;\n' +
            'const A = () => <div className={dynamic(styles)} />;';
        const r = run(jsx);
        expect(r.classes.has('p-4')).toBe(true);
        expect(r.classes.has('rounded-md')).toBe(true);
    });

    it.each([
        [
            'an unbound identifier',
            DYN + 'const A = () => <div className={dynamic(GLOBALTHING)} />;',
        ],
        [
            'a non-object binding',
            DYN + 'const n = 5; const A = () => <div className={dynamic(n)} />;',
        ],
        [
            'a non-static object binding',
            DYN + 'const s = { p: sizeVar }; const A = () => <div className={dynamic(s)} />;',
        ],
        [
            'an imported binding',
            DYN + "import { s } from './s'; const A = () => <div className={dynamic(s)} />;",
        ],
    ])('skips dynamic() with %s', (_label, jsx) => {
        const r = run(jsx);
        expect(r.classes.size).toBe(0);
    });
});

// ── numeric keys + AST budget + parse failure ───────────────────────────────
describe('edge cases: numeric keys, budget, parse failure', () => {
    it('accepts a numeric key in a static sz object', () => {
        const jsx = 'const A = () => <div sz={{ p: 4, "2": 8 }} />;';
        const r = run(jsx);
        // Numeric-ish key still compiles the recognized props.
        expect(r.classes.has('p-4')).toBe(true);
    });

    it('throws ASTBudgetExceededError when the node budget is exceeded', () => {
        const jsx = 'const A = () => <div sz={{ p: 4 }} />;';
        expect(() => run(jsx, { astBudget: 1 })).toThrow(ASTBudgetExceededError);
    });

    it('falls back to the original source on a parse failure', () => {
        // Contains "sz" (skips the fast path) but is syntactically invalid.
        const jsx = 'const A = () => <div sz={{ p: }} />;';
        const r = run(jsx);
        expect(r.transformed).toBe(false);
        expect(r.code).toBe(jsx);
    });
});

// ── runtime-fallback candidate collection ───────────────────────────────────
describe('runtime-fallback safelist candidate collection', () => {
    it('walks a fallback object literal for variant / nested / conditional / static candidates', () => {
        const jsx =
            "import { imported } from './x';\n" +
            'const base = { m: 3 };\n' +
            'const A = ({ cond, dynVar }) => <div sz={{ ...base, ...imported, hover: { p: 2 }, card: { m: 4 }, dynObj: { p: dynVar }, pc: cond ? 4 : 8, pd: cond ? dynVar : 8, bg: "red-500", w: dynVar }} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
        // Resolvable static candidates are safelisted even though the whole
        // expression falls back to _sz() at runtime.
        expect(r.classes.has('m-3')).toBe(true);
        expect(r.classes.has('hover:p-2')).toBe(true);
        expect(r.classes.has('bg-red-500')).toBe(true);
        expect(r.classes.has('pc-4')).toBe(true);
        expect(r.classes.has('pc-8')).toBe(true);
    });

    it('walks a const-bound array reference for candidates (identifier + logical)', () => {
        const jsx = 'const arr = [{ p: 4 }, cond && { m: 2 }]; const A = () => <div sz={arr} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
        expect(r.classes.has('p-4')).toBe(true);
        expect(r.classes.has('m-2')).toBe(true);
    });

    it('unwraps a TS-cast identifier during candidate collection', () => {
        const jsx = 'const arr = [{ p: 4 }]; const A = () => <div sz={arr as any} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
        expect(r.classes.has('p-4')).toBe(true);
    });

    // The `...imported` spread is unresolvable, so the whole sz falls back to
    // _sz() and every member goes through CANDIDATE collection (the partial
    // static lane would otherwise expand these without touching it).
    const fallback = (member: string): string =>
        `import { imported } from './x';\nconst A = ({ cond, dynVar, k }) => <div sz={{ ...imported, ${member} }} />;`;

    it('expands a conditional color with a static opacity into both branch candidates', () => {
        const r = run(fallback('bg: { color: cond ? "red-500" : "blue-500", op: 50 }'));
        expect(r.usesRuntime).toBe(true);
        expect(r.classes.has('bg-red-500/50')).toBe(true);
        expect(r.classes.has('bg-blue-500/50')).toBe(true);
    });

    it('expands a static color with a conditional opacity into both branch candidates', () => {
        const r = run(fallback('bg: { color: "red-500", op: cond ? 20 : 80 }'));
        expect(r.usesRuntime).toBe(true);
        expect(r.classes.has('bg-red-500/20')).toBe(true);
        expect(r.classes.has('bg-red-500/80')).toBe(true);
    });

    it('prefixes conditional color-opacity candidates nested under a variant', () => {
        const r = run(fallback('hover: { bg: { color: cond ? "red-500" : "blue-500", op: 50 } }'));
        expect(r.usesRuntime).toBe(true);
        expect(r.classes.has('hover:bg-red-500/50')).toBe(true);
        expect(r.classes.has('hover:bg-blue-500/50')).toBe(true);
    });

    it('falls through to the keyed walk when a color member is dynamic', () => {
        // Dynamic color: not statically compilable, and no branch pair to
        // expand — the color-conditional collector must decline, not emit.
        const r = run(fallback('bg: { color: dynVar, op: 20 }'));
        expect(r.usesRuntime).toBe(true);
        expect([...r.classes].some(c => c.startsWith('bg-'))).toBe(false);
    });

    it('declines a color object with duplicate members or without a color', () => {
        const dup = run(fallback('bg: { color: dynVar, color: cond ? "red-500" : "blue-500" }'));
        expect(dup.usesRuntime).toBe(true);
        const opOnly = run(fallback('bg: { op: 50 }'));
        expect(opOnly.usesRuntime).toBe(true);
    });

    it('walks keyed-object members: nested object, conditional, computed, and static', () => {
        const r = run(
            fallback(
                'bg: { color: cond ? "red-500" : dynVar, extra: { p: 2 }, ["x" + k]: 2, op: 50 }',
            ),
        );
        expect(r.usesRuntime).toBe(true);
        // The static branch of the conditional compiles at its full path.
        expect(r.classes.has('bg-red-500')).toBe(true);
    });

    it('declines a candidate color conditional with a dynamic branch', () => {
        // extractStaticLiteralValue yields null for the dynamic branch, so no
        // combined pair exists; the keyed walk still salvages the static one.
        const left = run(fallback('bg: { color: cond ? dynVar : "red-500", op: 50 }'));
        expect([...left.classes].some(c => c.includes('/'))).toBe(false);
        expect(left.classes.has('bg-red-500')).toBe(true);
        const right = run(fallback('bg: { color: cond ? "red-500" : dynVar, op: 50 }'));
        expect([...right.classes].some(c => c.includes('/'))).toBe(false);
        expect(right.classes.has('bg-red-500')).toBe(true);
    });

    it('declines a candidate opacity conditional whose branches are not literals', () => {
        const left = run(fallback('bg: { color: "red-500", op: cond ? dynVar : 20 }'));
        expect([...left.classes].some(c => c.includes('/'))).toBe(false);
        const right = run(fallback('bg: { color: "red-500", op: cond ? 20 : dynVar }'));
        expect([...right.classes].some(c => c.includes('/'))).toBe(false);
    });

    it('skips a bigint-literal member key inside a keyed candidate object', () => {
        const r = run(fallback('bg: { 5n: 2, color: cond ? "red-500" : dynVar }'));
        expect(r.usesRuntime).toBe(true);
        expect(r.classes.has('bg-red-500')).toBe(true);
    });

    it('hoists conditional branches wrapped in TS as-casts', () => {
        const jsx = 'const A = ({ cond }) => <div sz={{ p: cond ? (4 as const) : 8 }} />;';
        const r = run(jsx);
        expect(r.code).toContain('p-4');
        expect(r.code).toContain('p-8');
    });
});

// ── partial color-conditional lane (no runtime fallback) ────────────────────
describe('partial-lane color conditionals beside dynamic members', () => {
    it('compiles both color branches without opacity next to a dynamic member', () => {
        const jsx =
            'const A = ({ cond, dynVar }) => <div sz={{ w: dynVar, bg: { color: cond ? "red-500" : "blue-500" } }} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(false);
        expect(r.code).toContain('bg-red-500');
        expect(r.code).toContain('bg-blue-500');
    });

    it('prefixes both compiled branches under a variant chain', () => {
        const jsx =
            'const A = ({ cond, dynVar }) => <div sz={{ w: dynVar, hover: { bg: { color: cond ? "red-500" : "blue-500", op: 50 } } }} />;';
        const r = run(jsx);
        expect(r.code).toContain('hover:bg-red-500/50');
        expect(r.code).toContain('hover:bg-blue-500/50');
    });

    it('declines when a color branch is not a string literal', () => {
        const alternateSide =
            'const A = ({ cond, dynVar }) => <div sz={{ w: dynVar, bg: { color: cond ? "red-500" : 5 } }} />;';
        expect(run(alternateSide).code).not.toContain('bg-red-500');
        const consequentSide =
            'const A = ({ cond, dynVar }) => <div sz={{ w: dynVar, bg: { color: cond ? 5 : "red-500" } }} />;';
        expect(run(consequentSide).code).not.toContain('bg-red-500');
    });

    it('declines when the static opacity is not a string or number literal', () => {
        const jsx =
            'const A = ({ cond, dynVar }) => <div sz={{ w: dynVar, bg: { color: cond ? "red-500" : "blue-500", op: true } }} />;';
        const r = run(jsx);
        expect(r.code).not.toContain('bg-red-500/');
    });

    it('accepts mixed string and number opacity conditional branches', () => {
        const jsx =
            'const A = ({ cond, dynVar }) => <div sz={{ w: dynVar, bg: { color: "red-500", op: cond ? "20" : 80 } }} />;';
        const r = run(jsx);
        // A string op is an arbitrary modifier, a number op stays bare.
        expect(r.code).toContain('bg-red-500/[20]');
        expect(r.code).toContain('bg-red-500/80');
        const flipped =
            'const A = ({ cond, dynVar }) => <div sz={{ w: dynVar, bg: { color: "red-500", op: cond ? 20 : "80" } }} />;';
        const f = run(flipped);
        expect(f.code).toContain('bg-red-500/20');
        expect(f.code).toContain('bg-red-500/[80]');
    });

    it('spreads an unresolvable identifier branch of a conditional spread as-is', () => {
        const jsx =
            'const A = ({ on, objA }) => <div sz={{ ...(on ? objA : { m: 2 }), block: true }} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
        expect(r.classes.has('m-2')).toBe(true);
    });
});

// ── color-object + style-value edge cases ────────────────────────────────────
describe('partial color-object and style-value categories', () => {
    it.each([
        [
            'ANGLE',
            'const A = ({ v }) => <div sz={{ rotate: v }} />;',
            '__szUnitVar(v, "deg", "rotate")',
        ],
        [
            'DURATION',
            'const A = ({ v }) => <div sz={{ duration: v }} />;',
            '__szUnitVar(v, "ms", "duration")',
        ],
        ['UNITLESS', 'const A = ({ v }) => <div sz={{ opacity: v }} />;', '"--_sz-opacity": v'],
    ])('emits the %s dynamic style category', (_category, jsx, expectedCode) => {
        const r = run(jsx);
        expect(r.code).toContain(expectedCode);
    });

    it.each([
        [
            'a static color and opacity',
            'const A = ({ d }) => <div sz={{ bg: { color: "red-500", op: 20, extra: d } }} />;',
        ],
        [
            'a static color without opacity',
            'const A = ({ d }) => <div sz={{ bg: { color: "red-500", extra: d } }} />;',
        ],
        ['an unknown nested object', 'const A = ({ d }) => <div sz={{ unknownKey: { p: d } }} />;'],
    ])('uses runtime fallback for %s with dynamic siblings', (_label, jsx) => {
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
        expect(r.code).toContain('_sz(');
    });

    it('falls back when a known variant contains an unresolvable spread', () => {
        const jsx =
            "import { X } from './x'; const A = () => <div sz={{ hover: { ...X, p: 2 } }} />;";
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
    });

    it('emits a color CSS var for a fully-dynamic conditional color prop', () => {
        const jsx = 'const A = ({ c, a, b }) => <div sz={{ bg: c ? a : b }} />;';
        const r = run(jsx);
        expect(r.usesColorVar).toBe(true);
        expect(r.code).toContain('__szColorVar');
    });

    it('compiles a negative-number ternary branch (unary literal extraction)', () => {
        const jsx = 'const A = ({ c }) => <div sz={{ scale: c ? -75 : 100 }} />;';
        const r = run(jsx);
        expect(r.classes.has('scale--75')).toBe(true);
        expect(r.classes.has('scale-100')).toBe(true);
    });
});

// ── spread resolution edges ──────────────────────────────────────────────────
describe('spread resolution edges', () => {
    it('resolves an `as const` spread source', () => {
        const jsx =
            'const base = { p: 1 } as const; const A = () => <div sz={{ ...base, m: 2 }} />;';
        const r = run(jsx);
        expect(r.code).toContain('className="p-1 m-2"');
    });

    it('falls back when a spread source is a non-object binding', () => {
        const jsx = 'const base = 5; const A = () => <div sz={{ ...base, m: 2 }} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
        expect(r.code).toContain('_sz(');
    });
});

// ── szs pure-literal contract ────────────────────────────────────────────────
describe('szs pure-literal slot values', () => {
    it('accepts a negative-number slot value', () => {
        const jsx = 'const A = () => <Comp szs={{ root: { m: -2 } }} />;';
        const r = run(jsx);
        expect(r.code).toContain('szsc=');
        expect(r.code).toContain('"-m-2"');
    });

    it('accepts a nested-object slot value with a variant', () => {
        const jsx = 'const A = () => <Comp szs={{ root: { hover: { p: 2 } } }} />;';
        const r = run(jsx);
        expect(r.code).toContain('"hover:p-2"');
    });
});

// ── szv catalog internals ────────────────────────────────────────────────────
describe('szv catalog internals', () => {
    it('handles an absent base (empty base object)', () => {
        const jsx = 'const x = szv({ variants: { size: { sm: { p: 1 } } } });';
        const r = run(jsx);
        expect(r.classes.has('p-1')).toBe(true);
    });

    it.each([
        [
            'an object spread',
            'const SH = { p: 3 }; const x = szv({ base: { ...SH, m: 1 }, variants: { s: { a: { w: 2 } } } });',
            ['p-3', 'm-1', 'w-2'],
        ],
        [
            'nullish leaves with siblings',
            'const x = szv({ base: { p: null, m: undefined, w: 2 }, variants: { s: { a: { h: 1 } } } });',
            ['w-2', 'h-1'],
        ],
        [
            'unary numeric leaves',
            'const x = szv({ base: { mx: -2, my: +3 }, variants: { s: { a: { h: 1 } } } });',
            ['-mx-2', 'my-3'],
        ],
        [
            'a skipped call leaf',
            'const x = szv({ base: { p: fn() }, variants: { s: { a: { h: 1 } } } });',
            ['h-1'],
        ],
        [
            'an unresolvable identifier leaf',
            'const x = szv({ base: { p: EXT }, variants: { s: { a: { h: 1 } } } });',
            ['h-1'],
        ],
        [
            'conditional object branches',
            'const x = szv({ base: { p: 1 }, variants: { s: { a: cond ? { w: 2 } : { w: 8 } } } });',
            ['w-2', 'w-8'],
        ],
        [
            'a const-bound variant object',
            'const V = { w: 5 }; const x = szv({ base: { p: 1 }, variants: { s: { a: V } } });',
            ['w-5'],
        ],
        [
            'a shared const variant object',
            'const S = { w: 5 }; const x = szv({ base: { p: 1 }, variants: { d: { a: S, b: S } } });',
            ['w-5'],
        ],
    ])('collects catalog classes through %s', (_label, jsx, expectedClasses) => {
        const r = run(jsx);
        expect([...r.classes]).toEqual(expect.arrayContaining(expectedClasses));
    });

    it.each([
        ['a reassignable binding', 'let cfg = { base: { p: 1 } }; const x = szv(cfg);'],
        ['a runtime member argument', 'const x = szv(props.cfg); const A = () => <i sz="m-1" />;'],
        [
            'a destructured declarator',
            'const [a] = szv({ base: { p: 1 } }); const A = () => <i sz="m-1" />;',
        ],
    ])('does not inject a catalog for %s', (_label, jsx) => {
        const r = run(jsx);
        expect(r.code).not.toContain('_szv_catalog');
    });

    it.each([
        [
            'a computed dimension key',
            "const x = szv({ base: { p: 1 }, variants: { ['s']: { a: { w: 2 } } } });",
            'p-1',
        ],
        [
            'a computed value key',
            "const x = szv({ base: { p: 1 }, variants: { s: { ['a']: { w: 2 } } } });",
            'p-1',
        ],
        [
            'a numeric leaf key',
            'const x = szv({ base: { 2: 4 }, variants: { s: { a: { w: 2 } } } });',
            'w-2',
        ],
    ])('keeps valid siblings beside %s', (_label, jsx, expectedClass) => {
        const r = run(jsx);
        expect(r.classes.has(expectedClass)).toBe(true);
    });
});

// ── numeric literal key in an sz object ──────────────────────────────────────
describe('numeric literal sz key', () => {
    it('ignores a numeric-literal key and renders no class', () => {
        const jsx = 'const A = () => <div sz={{ 0: 4 }} />;';
        const r = run(jsx);
        expect(r.transformed).toBe(true);
        expect(r.code).toContain('className={undefined}');
    });
});

// ── partial-path static value shapes + variant nesting ───────────────────────
describe('partial-path static value shapes', () => {
    it('classifies numeric / boolean / unary / nested-object static props alongside a dynamic one', () => {
        const jsx = 'const A = ({ v }) => <div sz={{ p: v, w: 4, mx: -3, hover: { m: 2 } }} />;';
        const r = run(jsx);
        expect(r.classes.has('w-4')).toBe(true);
        expect(r.classes.has('-mx-3')).toBe(true);
        expect(r.classes.has('hover:m-2')).toBe(true);
        expect(r.classes.has('p-(--_sz-p)')).toBe(true);
    });

    it('merges static + dynamic props inside a variant', () => {
        const jsx = 'const A = ({ v }) => <div sz={{ hover: { p: v, m: 4 } }} />;';
        const r = run(jsx);
        expect(r.classes.has('hover:m-4')).toBe(true);
        expect(r.classes.has('hover:p-(--_sz-hover-p)')).toBe(true);
    });

    it.each([
        {
            label: 'a fully dynamic variant conditional',
            jsx: 'const A = ({ c, d1, d2 }) => <div sz={{ hover: { m: c ? d1 : d2 } }} />;',
            expectedCode: 'hover:m-(--_sz-hover-m)',
        },
        {
            label: 'a dynamic sibling in a color object',
            jsx: 'const A = ({ d }) => <div sz={{ bg: { color: "red-500", op: "20", extra: d } }} />;',
            usesRuntime: true,
        },
        {
            label: 'a string-literal key',
            jsx: "const A = ({ v }) => <div sz={{ 'p': v }} />;",
            expectedCode: 'p-(--_sz-p)',
        },
        {
            label: 'a numeric-literal key',
            jsx: 'const A = ({ v }) => <div sz={{ 2: v }} />;',
            expectedCode: '--_sz-2',
        },
    ])('handles $label on the partial path', ({ jsx, expectedCode, usesRuntime }) => {
        const r = run(jsx);
        if (expectedCode) expect(r.code).toContain(expectedCode);
        if (usesRuntime) expect(r.usesRuntime).toBe(true);
    });
});

// ── tryStaticTransformNode / array element identifiers ───────────────────────
describe('static resolution of array elements and ternary strings', () => {
    it('resolves a const-identifier array element by value', () => {
        const jsx = 'const o = { p: 4 }; const A = () => <div sz={[o, { m: 2 }]} />;';
        const r = run(jsx);
        expect(r.code).toContain('className="p-4 m-2"');
    });

    it('passes a ternary of two string literals straight through', () => {
        const jsx = "const A = ({ c }) => <div sz={c ? 'flex' : 'block'} />;";
        const r = run(jsx);
        expect(r.code).toContain("c ? 'flex' : 'block'");
        expect(r.classes.has('flex')).toBe(true);
        expect(r.classes.has('block')).toBe(true);
    });
});

// ── fallback candidate collection: key types + conditionals ──────────────────
describe('fallback candidate collection key types', () => {
    it('collects string/numeric keys and conditional object/value branches', () => {
        const jsx =
            "import { imported } from './x';\n" +
            "const A = ({ cond }) => <div sz={{ ...imported, 'pp': 4, 2: 8, hover: { p: cond ? 4 : 8 }, cc: cond ? { m: 1 } : { m: 2 } }} />;";
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
        expect(r.classes.has('hover:p-4')).toBe(true);
        expect(r.classes.has('hover:p-8')).toBe(true);
        expect(r.classes.has('cc:m-1')).toBe(true);
        expect(r.classes.has('cc:m-2')).toBe(true);
    });
});

// ── variant-scoped color / conditional / multi-conditional ───────────────────
describe('variant-scoped dynamic paths', () => {
    it('emits a variant-scoped CSS-var opacity for a static color inside a variant', () => {
        const jsx =
            'const A = ({ o }) => <div sz={{ hover: { bg: { color: "red-500", op: o } } }} />;';
        const r = run(jsx);
        expect(r.code).toContain('hover:bg-red-500/(--_sz-hover-bg-op)');
    });

    it('uses __szColorVar for a fully-dynamic color inside a variant', () => {
        const jsx =
            'const A = ({ col, o }) => <div sz={{ hover: { bg: { color: col, op: o } } }} />;';
        const r = run(jsx);
        expect(r.usesColorVar).toBe(true);
    });

    it('emits a variant-scoped CSS var for a static/dynamic ternary inside a variant', () => {
        const jsx = 'const A = ({ c, dv }) => <div sz={{ hover: { w: c ? 4 : dv } }} />;';
        const r = run(jsx);
        expect(r.code).toContain('hover:w-(--_sz-hover-w)');
    });

    it('builds a two-conditional template literal className', () => {
        const jsx =
            'const A = ({ c, d }) => <div sz={{ scale: c ? 75 : 100, opacity: d ? 50 : 100 }} />;';
        const r = run(jsx);
        expect(r.classes.has('scale-75')).toBe(true);
        expect(r.classes.has('opacity-50')).toBe(true);
        expect(r.code).toContain('${c ?');
        expect(r.code).toContain('${d ?');
    });

    it('collects nested variant + non-variant + partly-dynamic candidates in a fallback object', () => {
        const jsx =
            "import { imp } from './x';\n" +
            'const A = ({ cond, dv }) => <div sz={{ ...imp, hover: { focus: { p: 4 }, card: { m: 2 }, w: cond ? 4 : dv } }} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
        expect(r.classes.has('hover:focus:p-4')).toBe(true);
        expect(r.classes.has('hover:card:m-2')).toBe(true);
        expect(r.classes.has('hover:w-4')).toBe(true);
    });
});

// ── tryStaticTransformNode TS-wrapper + nested hoist ─────────────────────────
describe('tryStaticTransformNode wrappers', () => {
    it('resolves an `as const` identifier binding', () => {
        const jsx = 'const s = { p: 4 } as const; const A = () => <div sz={s} />;';
        const r = run(jsx);
        expect(r.code).toContain('className="p-4"');
    });

    it('hoists a conditional spread inside a ternary branch', () => {
        const jsx =
            'const a = { p: 1 }; const b = { p: 2 }; const A = ({ c, d }) => <div sz={c ? { ...(d ? a : b), m: 1 } : { m: 2 }} />;';
        const r = run(jsx);
        expect(r.transformed).toBe(true);
        expect(r.classes.has('p-1')).toBe(true);
        expect(r.classes.has('p-2')).toBe(true);
        expect(r.classes.has('m-1')).toBe(true);
        expect(r.classes.has('m-2')).toBe(true);
    });
});

// ── anonymous filename fallbacks ─────────────────────────────────────────────
describe('anonymous filename (<anonymous>) diagnostics', () => {
    it('uses <anonymous> in an szRecover diagnostic when no filename is given', () => {
        const r = transformSourceCode('const A = () => <div szRecover="bad" />;');
        expect(r.diagnostics.some(d => d.includes('szRecover at <anonymous>'))).toBe(true);
    });

    it('uses <anonymous> in an szs host-element diagnostic when no filename is given', () => {
        const r = transformSourceCode('const A = () => <div szs={{ r: { p: 4 } }} />;');
        expect(r.diagnostics.some(d => d.includes('szs at <anonymous>'))).toBe(true);
    });

    it('uses <anonymous> for a non-string-literal szRecover value with no filename', () => {
        const r = transformSourceCode('const A = ({ m }) => <div szRecover={m} />;');
        expect(
            r.diagnostics.some(
                d => d.includes('szRecover at <anonymous>') && d.includes('string-literal'),
            ),
        ).toBe(true);
    });

    it('still extracts an szv catalog and compiles sz without a filename', () => {
        const r = transformSourceCode(
            'const x = szv({ base: { p: 1 } }); const A = () => <div sz={{ m: 2 }} />;',
        );
        expect(r.classes.has('p-1')).toBe(true);
        expect(r.classes.has('m-2')).toBe(true);
    });

    it('extracts an inline szr catalog without a filename', () => {
        const r = transformSourceCode('const A = () => <div className={szr({ p: 4 })} />;');
        expect(r.classes.has('p-4')).toBe(true);
    });

    it('uses <anonymous> in the unsupported-szs diagnostic when no filename is given', () => {
        const r = transformSourceCode('const A = () => <Comp szs="bad" />;');
        expect(r.diagnostics.some(d => d.includes('szs at <anonymous>: every slot'))).toBe(true);
    });
});

// ── remaining resolution / catalog branches ──────────────────────────────────
describe('remaining resolution and catalog branches', () => {
    it('resolves an identifier bound to a ternary of objects', () => {
        const jsx = 'const s = c ? { p: 4 } : { m: 2 }; const A = () => <div sz={s} />;';
        const r = run(jsx);
        expect(r.code).toContain('c ? "p-4" : "m-2"');
    });

    it('handles a `cond && "string"` array element', () => {
        const jsx = 'const A = ({ c }) => <div sz={[c && "flex", { p: 4 }]} />;';
        const r = run(jsx);
        expect(r.code).toContain('_szcn(c && "flex"');
        expect(r.classes.has('flex')).toBe(true);
    });

    it('skips a computed key inside a catalog object', () => {
        const jsx =
            "const k = 's'; const x = szv({ base: { [k]: 1, p: 2 }, variants: { s: { a: { w: 2 } } } });";
        const r = run(jsx);
        expect(r.classes.has('p-2')).toBe(true);
        expect(r.classes.has('w-2')).toBe(true);
    });

    it('skips an unresolvable variant dimension identifier', () => {
        const jsx = 'const x = szv({ base: { p: 1 }, variants: { s: EXT } });';
        const r = run(jsx);
        expect(r.classes.has('p-1')).toBe(true);
    });

    it('skips an unresolvable variant value identifier', () => {
        const jsx = 'const x = szv({ base: { p: 1 }, variants: { s: { a: EXT } } });';
        const r = run(jsx);
        expect(r.classes.has('p-1')).toBe(true);
    });

    it('falls back when a variant contains an unknown dynamic nested object', () => {
        const jsx = 'const A = ({ v }) => <div sz={{ hover: { unknownKey: { p: v } } }} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
    });
});

// ── object-method / computed / boolean / camel-key value shapes ──────────────
describe('object method, computed key, boolean and camel-key values', () => {
    it('falls back for an object method property', () => {
        const jsx = 'const A = ({ v }) => <div sz={{ m() {}, p: v }} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
    });

    it('falls back for a computed key property', () => {
        const jsx = 'const A = ({ k, v }) => <div sz={{ [k]: 4, p: v }} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
    });

    it('classifies a boolean value inside a partial object', () => {
        const jsx = 'const A = ({ v }) => <div sz={{ x: true, p: v }} />;';
        const r = run(jsx);
        expect(r.code).toContain('p-(--_sz-p)');
    });

    it('classifies a boolean value inside a fully-static object', () => {
        const jsx = 'const A = () => <div sz={{ p: 4, x: true }} />;';
        const r = run(jsx);
        expect(r.classes.has('p-4')).toBe(true);
    });

    it('compiles a conditional prop with static string branches', () => {
        const jsx = "const A = ({ c, v }) => <div sz={{ foo: c ? 'a' : 'b', p: v }} />;";
        const r = run(jsx);
        expect(r.classes.has('foo-a')).toBe(true);
        expect(r.classes.has('foo-b')).toBe(true);
    });

    it('compiles a conditional prop with static boolean branches', () => {
        const jsx = 'const A = ({ c, v }) => <div sz={{ foo: c ? true : false, p: v }} />;';
        const r = run(jsx);
        expect(r.transformed).toBe(true);
        expect(r.code).toContain('p-(--_sz-p)');
    });

    it('kebab-cases an unknown camelCase dynamic key (PROPERTY_MAP fallback)', () => {
        const jsx = 'const A = ({ v }) => <div sz={{ fooBarBaz: v }} />;';
        const r = run(jsx);
        expect(r.code).toContain('foo-bar-baz-(--_sz-foo-bar-baz)');
    });
});

// ── conditional / logical fallback expression collection ─────────────────────
describe('conditional and logical fallback expressions', () => {
    it('wraps a conditional-of-calls in _sz', () => {
        const jsx = 'const A = ({ c }) => <div sz={c ? foo() : bar()} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
        expect(r.code).toContain('_sz(c ? foo() : bar())');
    });

    it('wraps a logical-of-call in _sz', () => {
        const jsx = 'const A = ({ c }) => <div sz={c && getStyles()} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
        expect(r.code).toContain('_sz(c && getStyles())');
    });

    it('emits _szPart for an array element object with an unresolvable spread', () => {
        const jsx =
            "import { imp } from './x'; const A = () => <div sz={[{ ...imp, p: 4 }, { m: 2 }]} />;";
        const r = run(jsx);
        expect(r.usesSzPart).toBe(true);
        expect(r.code).toContain('_szPart(');
        expect(r.classes.has('m-2')).toBe(true);
    });
});

// ── szr() const-identifier resolution (module scope) ─────────────────────────
// `szr` already contains "sz", so these sources reach the visitor.
describe('szr() const-identifier resolution', () => {
    it('skips a szr(identifier) bound to a non-object', () => {
        const jsx = 'const n = 5;\nconst A = () => <div className={szr(n)} />;';
        const r = run(jsx);
        expect(r.classes.size).toBe(0);
    });

    it('skips a szr(identifier) bound to a non-static object', () => {
        const jsx = 'const s = { p: vv };\nconst A = () => <div className={szr(s)} />;';
        const r = run(jsx);
        expect(r.classes.size).toBe(0);
    });

    it('extracts a szr(identifier) with an `as const` object', () => {
        const jsx = 'const s = { p: 4 } as const;\nconst A = () => <div className={szr(s)} />;';
        const r = run(jsx);
        expect(r.classes.has('p-4')).toBe(true);
    });
});

// ── string config keys + more spread/hoist edges ─────────────────────────────
describe('string config keys and spread/hoist edges', () => {
    it('reads string-literal base/variants keys in an szv config', () => {
        const jsx = "const x = szv({ 'base': { p: 1 }, 'variants': { s: { a: { w: 2 } } } });";
        const r = run(jsx);
        expect(r.classes.has('p-1')).toBe(true);
        expect(r.classes.has('w-2')).toBe(true);
    });

    it('falls back when a conditional spread branch is unresolvable', () => {
        const jsx =
            "import { foo } from 'x';\nconst a = { p: 4 };\nconst A = ({ c }) => <div sz={{ ...(c ? a : foo), m: 2 }} />;";
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
    });

    it('falls back when a spread-of-spread source is unresolvable', () => {
        const jsx =
            "import { imp } from 'x';\nconst a = { ...imp };\nconst A = () => <div sz={{ ...a, p: 4 }} />;";
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
    });
});

// ── final reachable branches ─────────────────────────────────────────────────
describe('final reachable branches', () => {
    it('rejects two conditional spreads (falls back to runtime)', () => {
        const jsx =
            'const a = { p: 1 }; const b = { p: 2 }; const e = { m: 1 }; const f = { m: 2 };\n' +
            'const A = ({ c, d }) => <div sz={{ ...(c ? a : b), ...(d ? e : f) }} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
    });

    it('rejects a conditional spread whose branch resolves to a non-string (nested ternary)', () => {
        const jsx =
            'const a = { p: 1 }; const b = { p: 2 }; const e = { m: 9 };\n' +
            'const A = ({ c, d }) => <div sz={{ ...(c ? (d ? a : b) : e) }} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
    });

    it.each([
        {
            label: 'an object-valued catalog leaf',
            jsx: 'const x = szv({ base: { hover: { p: 1 } }, variants: { s: { a: { w: 2 } } } });',
            expectedClasses: ['hover:p-1', 'w-2'],
        },
        {
            label: 'a shared const catalog leaf',
            jsx: 'const G = 4; const x = szv({ base: { mx: G, my: G }, variants: { s: { a: { w: 2 } } } });',
            expectedClasses: ['mx-4', 'my-4'],
        },
        {
            label: 'an unknown camelCase dynamic key',
            jsx: 'const A = ({ c, dv }) => <div sz={{ hover: { fooBar: c ? 4 : dv } }} />;',
            expectedCode: 'hover:foo-bar-(--_sz-hover-foo-bar)',
        },
        {
            label: 'an unresolvable nested spread',
            jsx:
                "import { imp, imp2 } from './x';\n" +
                'const A = () => <div sz={{ ...imp, card: { ...imp2, m: 2 } }} />;',
            // The runtime resolves {card:{m:2}} to card:m-2 — the path-aware
            // candidate walk safelists that real class; the old keyless walk
            // recorded a bare m-2 the runtime never produces.
            expectedClasses: ['card:m-2'],
            usesRuntime: true,
        },
    ])('covers $label in final branches', ({ jsx, expectedClasses, expectedCode, usesRuntime }) => {
        const r = run(jsx);
        if (expectedClasses) {
            expect([...r.classes]).toEqual(expect.arrayContaining(expectedClasses));
        }
        if (expectedCode) expect(r.code).toContain(expectedCode);
        if (usesRuntime) expect(r.usesRuntime).toBe(true);
    });

    it('prefixes a variant conditional-both-static prop when the object is not hoistable', () => {
        // A top-level conditional disables the nested-conditional hoist, forcing the
        // partial path where the variant-scoped ternary is compiled + prefixed.
        const jsx =
            'const A = ({ c, d }) => <div sz={{ scale: c ? 75 : 100, hover: { m: d ? 2 : 4 } }} />;';
        const r = run(jsx);
        expect(r.classes.has('hover:m-2')).toBe(true);
        expect(r.classes.has('hover:m-4')).toBe(true);
        expect(r.classes.has('scale-75')).toBe(true);
    });

    it('builds a two-level variant chain for a dynamic prop', () => {
        const jsx = 'const A = ({ v }) => <div sz={{ hover: { focus: { p: v } } }} />;';
        const r = run(jsx);
        expect(r.code).toContain('hover-focus:p-(--_sz-hover-focus-p)');
    });

    it('reads a string-literal leaf key in a catalog object', () => {
        const jsx = "const x = szv({ base: { 'p': 1 }, variants: { s: { a: { w: 2 } } } });";
        const r = run(jsx);
        expect(r.classes.has('p-1')).toBe(true);
        expect(r.classes.has('w-2')).toBe(true);
    });

    it('ignores a spread property in an szv config object', () => {
        const jsx =
            'const E = { x: 1 }; const x = szv({ ...E, base: { p: 1 }, variants: { s: { a: { w: 2 } } } });';
        const r = run(jsx);
        expect(r.classes.has('p-1')).toBe(true);
        expect(r.classes.has('w-2')).toBe(true);
    });

    it('breaks a cyclic const reference in a variant object value (cycle guard)', () => {
        const jsx =
            'const A2 = B2; const B2 = A2; const x = szv({ base: { p: 1 }, variants: { s: { a: A2 } } });';
        const r = run(jsx);
        // Cycle is cut; the sibling base class still compiles.
        expect(r.classes.has('p-1')).toBe(true);
    });

    it('breaks a cyclic const reference in a catalog leaf value (cycle guard)', () => {
        const jsx =
            'const G2 = H2; const H2 = G2; const x = szv({ base: { mx: G2 }, variants: { s: { a: { p: 1 } } } });';
        const r = run(jsx);
        expect(r.classes.has('p-1')).toBe(true);
    });
});

// ── re-exported transform() smoke ────────────────────────────────────────────
describe('re-exported transform()', () => {
    it('is re-exported from transform.ts and lowers an sz object', () => {
        expect(transform({ p: 4 }).className).toBe('p-4');
    });
});
