/**
 * Two rewrites landing on one JSX element: the sz merge and the szv precompile.
 *
 * `className={szr(factory({...}))}` beside an `sz` attribute made both rewrites
 * target overlapping source ranges. The span-based engines cannot edit text they
 * have already replaced, so this shape used to end a build three different ways:
 * the rust lane aborted the process at `string_wizard` with no file name, the
 * the JavaScript lane it replaced threw from magic-string, and one the JavaScript path it replaced emitted malformed JSX with
 * no error at all. The babel lane survived only by silently dropping the
 * precompile — it re-descends into the attribute value it just rewrote and
 * counted the same factory call twice.
 *
 * The rule now: the sz merge edits only the text on either side of the authored
 * className expression, so the precompile keeps the inner range. Where that is
 * impossible — a factory call nested INSIDE the `sz` attribute, which is
 * replaced wholesale — both engine artifacts keep the runtime path instead.
 */
import { describe, expect, it } from 'vitest';

import { ENGINES, normalizeEmit } from './engine-parity-harness.js';

const IMPORTS = "import { szr, szv } from '@csszyx/runtime';\n";
const FACTORY =
    "const barSz = szv({ variants: { s: { t: { translateY: '-full' } } } });\n" as const;

/**
 * Transform one module on every engine.
 *
 * @param tsx - Module source under test.
 * @returns Each engine's name paired with its whitespace-normalized emit.
 */
function emitAll(tsx: string): Array<readonly [string, string]> {
    return ENGINES.map(([name, transform]) => {
        const source = `${IMPORTS}${FACTORY}${tsx}`;
        // A throw here is the regression itself, so it must surface as a
        // failure naming the engine rather than an unhandled rejection.
        let code: string;
        try {
            code = transform(source, 'overlap.tsx').code ?? '';
        } catch (error) {
            throw new Error(`${name} threw: ${String(error)}`);
        }
        return [name, normalizeEmit(code)] as const;
    });
}

describe('szv precompile beside an sz attribute', () => {
    it('precompiles a dynamic selection and merges into the same className', () => {
        for (const [name, code] of emitAll(
            'export const P = ({ h }) => (\n' +
                "    <div className={szr(barSz({ s: h ? 't' : undefined }))} sz={{ position: 'fixed', top: 0 }}>p</div>\n" +
                ');\n',
        )) {
            expect(code, name).toContain('__szvPick1(__szvT_barSz, "s", h ? \'t\' : undefined)');
            expect(code, name).toContain('_szMerge(');
            expect(code, name).toContain('fixed top-0');
            // The authored call is gone, so the runtime factory is unreachable
            // from this element and the szr import can drop the compiler.
            expect(code, name).not.toContain('szr(barSz(');
            expect(code, name).toContain('@csszyx/runtime/core');
        }
    });

    it('collapses a static selection to a literal and merges it', () => {
        for (const [name, code] of emitAll(
            'export const P = () => (\n' +
                "    <div className={szr(barSz({ s: 't' }))} sz={{ position: 'fixed' }}>p</div>\n" +
                ');\n',
        )) {
            expect(code, name).toContain('_szMerge(szr("-translate-y-full"), "fixed")');
        }
    });

    it('merges into the array lane without losing the precompile', () => {
        for (const [name, code] of emitAll(
            'export const P = ({ w }) => (\n' +
                "    <div className={szr(barSz({ s: 't' }))} sz={[{ p: 4 }, { w }]}>p</div>\n" +
                ');\n',
        )) {
            expect(code, name).toContain('_szcn(szr("-translate-y-full")');
            expect(code, name).not.toContain('barSz({');
        }
    });

    it('merges into the runtime fallback lane without losing the precompile', () => {
        for (const [name, code] of emitAll(
            'export const P = ({ extra }) => (\n' +
                "    <div className={szr(barSz({ s: 't' }))} sz={{ ...extra }}>p</div>\n" +
                ');\n',
        )) {
            expect(code, name).toContain('_szMerge(szr("-translate-y-full"), _sz(');
        }
    });

    it('merges into the conditional lane without losing the precompile', () => {
        for (const [name, code] of emitAll(
            'export const P = ({ on }) => (\n' +
                "    <div className={szr(barSz({ s: 't' }))} sz={{ p: on ? 4 : 8 }}>p</div>\n" +
                ');\n',
        )) {
            expect(code, name).toContain('_szMerge(szr("-translate-y-full")');
            expect(code, name).toContain('on ?');
        }
    });

    it('keeps merging a literal className, which has no range to preserve', () => {
        for (const [name, code] of emitAll(
            'export const P = () => <div className="base" sz={{ position: \'fixed\' }}>p</div>;\n',
        )) {
            expect(code, name).toMatch(/className="base fixed"/);
        }
    });

    // A literal className has no authored expression to preserve, so it takes
    // the wrapper's single-overwrite branch. One row per lane that merges.
    it.each([
        ['array', 'sz={[{ p: 4 }, { w }]}', '_szcn("base"'],
        ['conditional', 'sz={{ p: on ? 4 : 8 }}', '_szMerge("base"'],
        ['runtime fallback', 'sz={{ ...extra }}', '_szMerge("base", _sz('],
    ])('merges a literal className through the %s lane', (_lane, szAttr, expected) => {
        for (const [name, code] of emitAll(
            `export const P = ({ w, on, extra }) => <div className="base" ${szAttr}>p</div>;\n`,
        )) {
            expect(code, name).toContain(expected);
        }
    });

    it('keeps the runtime path for a factory call inside the sz attribute', () => {
        // The sz attribute is replaced by a generated expression, so there is
        // no range left to splice the pick into. Losing the optimization is the
        // correct outcome; crashing or emitting broken JSX was not.
        for (const [name, code] of emitAll(
            'export const P = () => (\n' +
                '    <div className="base" sz={[{ p: 4 }, szr(barSz({ s: \'t\' }))]}>p</div>\n' +
                ');\n',
        )) {
            expect(code, name).toContain("_szPart(szr(barSz({ s: 't' })))");
            expect(code, name).not.toContain('__szvPick');
            // Unproven argument, so the slim core entry must not be claimed.
            expect(code, name).not.toContain('@csszyx/runtime/core');
        }
    });

    it('keeps the runtime path inside an sz attribute with no className', () => {
        for (const [name, code] of emitAll(
            'export const P = () => (\n' +
                "    <div sz={[{ p: 4 }, szr(barSz({ s: 't' }))]}>p</div>\n" +
                ');\n',
        )) {
            expect(code, name).toContain("_szPart(szr(barSz({ s: 't' })))");
            expect(code, name).not.toContain('__szvPick');
        }
    });

    it('precompiles a call hoisted out of JSX, sz attribute or not', () => {
        for (const [name, code] of emitAll(
            "const cls = szr(barSz({ s: 't' }));\n" +
                "export const P = () => <div className={cls} sz={{ position: 'fixed' }}>p</div>;\n",
        )) {
            expect(code, name).toContain('szr("-translate-y-full")');
            expect(code, name).toContain('_szMerge(cls, "fixed")');
        }
    });
});
