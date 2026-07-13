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

    it('merges CSS-var class into an existing object style attribute', () => {
        const jsx = 'const A = ({ v }) => <div style={{ color: "red" }} sz={{ p: v }} />;';
        const r = run(jsx);
        expect(r.code).toContain('color: "red"');
        expect(r.code).toContain('"--_sz-p"');
    });

    it('parses an existing string style attribute and merges CSS vars', () => {
        const jsx =
            'const A = ({ v }) => <div style="color: red; margin-top: 10px" sz={{ p: v }} />;';
        const r = run(jsx);
        expect(r.code).toContain('marginTop: "10px"');
        expect(r.code).toContain('"--_sz-p"');
    });

    it('preserves a CSS custom property key when parsing a style string', () => {
        const jsx = 'const A = ({ v }) => <div style="--x: 1px; color: red" sz={{ p: v }} />;';
        const r = run(jsx);
        expect(r.code).toContain('"--x": "1px"');
    });

    it('spreads a dynamic style reference alongside injected CSS vars', () => {
        const jsx = 'const A = ({ v, myStyle }) => <div style={myStyle} sz={{ p: v }} />;';
        const r = run(jsx);
        expect(r.code).toContain('...myStyle');
        expect(r.code).toContain('"--_sz-p"');
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

    it('emits _szPart for a truly dynamic array element and safelists ternary branches', () => {
        const jsx = 'const A = ({ c }) => <div sz={[{ p: 4 }, c ? { m: 2 } : { m: 8 }]} />;';
        const r = run(jsx);
        expect(r.usesSzPart).toBe(true);
        expect(r.code).toContain('_szPart(');
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
    it('warns about a function call and wraps it in _sz', () => {
        const jsx = 'const A = () => <div sz={getStyles()} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
        expect(r.diagnostics.some(d => d.includes('function call `getStyles()`'))).toBe(true);
    });

    it('warns about a member-call callee name', () => {
        const jsx = 'const A = () => <div sz={styles.get()} />;';
        const r = run(jsx);
        expect(r.diagnostics.some(d => d.includes('function call `get()`'))).toBe(true);
    });

    it('warns about an unresolvable identifier', () => {
        const jsx = "import { external } from './x'; const A = () => <div sz={external} />;";
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
        expect(r.diagnostics.some(d => d.includes('identifier `external`'))).toBe(true);
    });

    it('warns about a member expression', () => {
        const jsx = 'const A = ({ o }) => <div sz={o.styles} />;';
        const r = run(jsx);
        expect(r.diagnostics.some(d => d.includes('member expression is not statically'))).toBe(
            true,
        );
    });

    it('warns about an otherwise non-analyzable expression type', () => {
        const jsx = 'const A = ({ a, b }) => <div sz={a + b} />;';
        const r = run(jsx);
        expect(r.diagnostics.some(d => d.includes('is not statically analyzable'))).toBe(true);
    });

    it('surfaces an unresolvable top-level object spread as a build warning', () => {
        const jsx = "import { x } from './x'; const A = () => <div sz={{ ...x }} />;";
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
        expect(r.diagnostics.some(d => d.includes('unresolvable sz spread'))).toBe(true);
    });
});

// ── szv catalog extraction ──────────────────────────────────────────────────
describe('szv catalog extraction (VariableDeclarator)', () => {
    it('ignores a declarator whose init is not a call', () => {
        const jsx = 'const notSzv = 5; const A = () => <div sz={{ p: 4 }} />;';
        const r = run(jsx);
        expect(r.code).not.toContain('_szv_catalog');
    });

    it('ignores a non-szv call', () => {
        const jsx = 'const x = other({ base: { p: 4 } }); const B = () => <i sz="m-1" />;';
        const r = run(jsx);
        expect(r.code).not.toContain('_szv_catalog');
    });

    it('ignores szv() with no arguments', () => {
        const jsx = 'const x = szv(); const B = () => <i sz="m-1" />;';
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
    it('ignores an unrelated call whose callee is neither dynamic nor szr', () => {
        // `szx` contains "sz" so the source is parsed, but the callee check bails.
        const jsx = 'const A = () => <div className={szx({ p: 4 })} />;';
        const r = run(jsx);
        expect(r.classes.size).toBe(0);
    });

    it('ignores dynamic() with no arguments', () => {
        const jsx = DYN + 'const A = () => <div className={dynamic()} />;';
        const r = run(jsx);
        expect(r.classes.size).toBe(0);
    });

    it('ignores szr() with no arguments', () => {
        const jsx = 'const A = () => <div className={szr()} />;';
        const r = run(jsx);
        expect(r.classes.size).toBe(0);
    });

    it('extracts classes from an inline szr object', () => {
        const jsx = 'const A = () => <div className={szr({ p: 4, m: 2 })} />;';
        const r = run(jsx);
        expect(r.classes.has('p-4')).toBe(true);
        expect(r.classes.has('m-2')).toBe(true);
    });

    it('extracts classes from an inline static dynamic() object', () => {
        const jsx = DYN + 'const A = () => <div className={dynamic({ p: 4 })} />;';
        const r = run(jsx);
        expect(r.classes.has('p-4')).toBe(true);
    });

    it('does not extract from a non-static inline dynamic() object', () => {
        const jsx = DYN + 'const A = ({ v }) => <div className={dynamic({ p: v })} />;';
        const r = run(jsx);
        expect(r.classes.has('p-4')).toBe(false);
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

    it('skips a dynamic(identifier) with no binding at all', () => {
        const jsx = DYN + 'const A = () => <div className={dynamic(GLOBALTHING)} />;';
        const r = run(jsx);
        expect(r.classes.size).toBe(0);
    });

    it('skips a dynamic(identifier) bound to a non-object', () => {
        const jsx = DYN + 'const n = 5; const A = () => <div className={dynamic(n)} />;';
        const r = run(jsx);
        expect(r.classes.size).toBe(0);
    });

    it('skips a dynamic(identifier) bound to a non-static object', () => {
        const jsx =
            DYN + 'const s = { p: sizeVar }; const A = () => <div className={dynamic(s)} />;';
        const r = run(jsx);
        expect(r.classes.size).toBe(0);
    });

    it('skips a dynamic(imported) unresolvable identifier', () => {
        const jsx =
            DYN + "import { s } from './s'; const A = () => <div className={dynamic(s)} />;";
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
});

// ── color-object + style-value edge cases ────────────────────────────────────
describe('partial color-object and style-value categories', () => {
    it('emits ANGLE-category style value (deg) for a dynamic rotate', () => {
        const jsx = 'const A = ({ v }) => <div sz={{ rotate: v }} />;';
        const r = run(jsx);
        expect(r.code).toContain('__szUnitVar(v, "deg", "rotate")');
    });

    it('emits DURATION-category style value (ms) for a dynamic duration', () => {
        const jsx = 'const A = ({ v }) => <div sz={{ duration: v }} />;';
        const r = run(jsx);
        expect(r.code).toContain('__szUnitVar(v, "ms", "duration")');
    });

    it('emits a bare unitless style value for a dynamic opacity', () => {
        const jsx = 'const A = ({ v }) => <div sz={{ opacity: v }} />;';
        const r = run(jsx);
        expect(r.code).toContain('"--_sz-opacity": `${v}`');
    });

    it('handles a static color + static op inside an otherwise-dynamic color object', () => {
        const jsx =
            'const A = ({ d }) => <div sz={{ bg: { color: "red-500", op: 20, extra: d } }} />;';
        const r = run(jsx);
        // The color+op pair resolves statically; the extra dynamic key pushes the
        // whole thing to runtime fallback.
        expect(r.usesRuntime).toBe(true);
    });

    it('handles a static color with no op inside an otherwise-dynamic color object', () => {
        const jsx = 'const A = ({ d }) => <div sz={{ bg: { color: "red-500", extra: d } }} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
    });

    it('falls back for an unknown dynamic nested object (not a color, not a variant)', () => {
        const jsx = 'const A = ({ d }) => <div sz={{ unknownKey: { p: d } }} />;';
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

    it('resolves a spread inside a catalog object', () => {
        const jsx =
            'const SH = { p: 3 }; const x = szv({ base: { ...SH, m: 1 }, variants: { s: { a: { w: 2 } } } });';
        const r = run(jsx);
        expect(r.classes.has('p-3')).toBe(true);
        expect(r.classes.has('m-1')).toBe(true);
        expect(r.classes.has('w-2')).toBe(true);
    });

    it('skips null / undefined leaf values but keeps siblings', () => {
        const jsx =
            'const x = szv({ base: { p: null, m: undefined, w: 2 }, variants: { s: { a: { h: 1 } } } });';
        const r = run(jsx);
        expect(r.classes.has('w-2')).toBe(true);
        expect(r.classes.has('h-1')).toBe(true);
    });

    it('handles unary +/- leaf values', () => {
        const jsx =
            'const x = szv({ base: { mx: -2, my: +3 }, variants: { s: { a: { h: 1 } } } });';
        const r = run(jsx);
        expect(r.classes.has('-mx-2')).toBe(true);
        expect(r.classes.has('my-3')).toBe(true);
    });

    it('skips a call-expression leaf but keeps siblings', () => {
        const jsx = 'const x = szv({ base: { p: fn() }, variants: { s: { a: { h: 1 } } } });';
        const r = run(jsx);
        expect(r.classes.has('h-1')).toBe(true);
    });

    it('skips an unresolvable const leaf identifier', () => {
        const jsx = 'const x = szv({ base: { p: EXT }, variants: { s: { a: { h: 1 } } } });';
        const r = run(jsx);
        expect(r.classes.has('h-1')).toBe(true);
    });

    it('expands a conditional-object variant value into both branches', () => {
        const jsx =
            'const x = szv({ base: { p: 1 }, variants: { s: { a: cond ? { w: 2 } : { w: 8 } } } });';
        const r = run(jsx);
        expect(r.classes.has('w-2')).toBe(true);
        expect(r.classes.has('w-8')).toBe(true);
    });

    it('resolves a const-bound variant object value', () => {
        const jsx =
            'const V = { w: 5 }; const x = szv({ base: { p: 1 }, variants: { s: { a: V } } });';
        const r = run(jsx);
        expect(r.classes.has('w-5')).toBe(true);
    });

    it('memoizes a shared const referenced from two variant values', () => {
        const jsx =
            'const S = { w: 5 }; const x = szv({ base: { p: 1 }, variants: { d: { a: S, b: S } } });';
        const r = run(jsx);
        expect(r.classes.has('w-5')).toBe(true);
    });

    it('ignores a reassignable (let) config binding', () => {
        const jsx = 'let cfg = { base: { p: 1 } }; const x = szv(cfg);';
        const r = run(jsx);
        expect(r.code).not.toContain('_szv_catalog');
    });

    it('ignores a runtime (member-expression) config argument', () => {
        const jsx = 'const x = szv(props.cfg); const A = () => <i sz="m-1" />;';
        const r = run(jsx);
        expect(r.code).not.toContain('_szv_catalog');
    });

    it('ignores a non-identifier declarator id (array destructure)', () => {
        const jsx = 'const [a] = szv({ base: { p: 1 } }); const A = () => <i sz="m-1" />;';
        const r = run(jsx);
        expect(r.code).not.toContain('_szv_catalog');
    });

    it('skips a computed variant dimension key', () => {
        const jsx = "const x = szv({ base: { p: 1 }, variants: { ['s']: { a: { w: 2 } } } });";
        const r = run(jsx);
        expect(r.classes.has('p-1')).toBe(true);
    });

    it('skips a computed variant value key', () => {
        const jsx = "const x = szv({ base: { p: 1 }, variants: { s: { ['a']: { w: 2 } } } });";
        const r = run(jsx);
        expect(r.classes.has('p-1')).toBe(true);
    });

    it('handles a numeric leaf key in a catalog object', () => {
        const jsx = 'const x = szv({ base: { 2: 4 }, variants: { s: { a: { w: 2 } } } });';
        const r = run(jsx);
        // Numeric key ignored by transform; sibling variant class still emitted.
        expect(r.classes.has('w-2')).toBe(true);
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

    it('emits a variant-scoped CSS var for a fully-dynamic conditional inside a variant', () => {
        const jsx = 'const A = ({ c, d1, d2 }) => <div sz={{ hover: { m: c ? d1 : d2 } }} />;';
        const r = run(jsx);
        expect(r.code).toContain('hover:m-(--_sz-hover-m)');
    });

    it('handles a static color + static string op inside an otherwise-dynamic color object', () => {
        const jsx =
            'const A = ({ d }) => <div sz={{ bg: { color: "red-500", op: "20", extra: d } }} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
    });

    it('supports a string-literal key with a dynamic value', () => {
        const jsx = "const A = ({ v }) => <div sz={{ 'p': v }} />;";
        const r = run(jsx);
        expect(r.code).toContain('p-(--_sz-p)');
    });

    it('supports a numeric-literal key with a dynamic value', () => {
        const jsx = 'const A = ({ v }) => <div sz={{ 2: v }} />;';
        const r = run(jsx);
        expect(r.code).toContain('--_sz-2');
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

    it('walks an object-valued catalog leaf through the values lane', () => {
        const jsx =
            'const x = szv({ base: { hover: { p: 1 } }, variants: { s: { a: { w: 2 } } } });';
        const r = run(jsx);
        expect(r.classes.has('hover:p-1')).toBe(true);
        expect(r.classes.has('w-2')).toBe(true);
    });

    it('memoizes a const leaf referenced twice in a catalog object (value lane)', () => {
        const jsx =
            'const G = 4; const x = szv({ base: { mx: G, my: G }, variants: { s: { a: { w: 2 } } } });';
        const r = run(jsx);
        expect(r.classes.has('mx-4')).toBe(true);
        expect(r.classes.has('my-4')).toBe(true);
    });

    it('kebab-cases an unknown camelCase conditional-dynamic key inside a variant', () => {
        const jsx = 'const A = ({ c, dv }) => <div sz={{ hover: { fooBar: c ? 4 : dv } }} />;';
        const r = run(jsx);
        expect(r.code).toContain('hover:foo-bar-(--_sz-hover-foo-bar)');
    });

    it('collects a nested non-variant object with an unresolvable spread in a fallback', () => {
        const jsx =
            "import { imp, imp2 } from './x';\n" +
            'const A = () => <div sz={{ ...imp, card: { ...imp2, m: 2 } }} />;';
        const r = run(jsx);
        expect(r.usesRuntime).toBe(true);
        expect(r.classes.has('m-2')).toBe(true);
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
