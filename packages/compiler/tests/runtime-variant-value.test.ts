/**
 * A variant key whose value only the runtime knows.
 *
 * `sz={{ m: 1, hover: x }}` compiled to `hover-(--_sz-hover)` plus a style
 * variable holding the object: a utility Tailwind has no rule for, and an
 * object in a CSS variable. Nothing reported it, and the hover styles never
 * applied. The same happened to a three-arm chain under `hover`, to the chain
 * one variant deeper (`md: { hover: … }`), and to a namespace import
 * (`hover: S`).
 *
 * The key now goes to the runtime the way an sz array element does
 * (`_szPart`), so the runtime lowering styles it, and the static rest still
 * lowers at build time. Its classes are never collected, so the build reports
 * `fallback-missing-css` at the key, in the wording of an unreadable `sz={s}`.
 *
 * Probes: `council2-ce/probe*.mjs` (`local-nested`, `chain-flat`, `ns-hover`).
 */
import { describe, expect, it } from 'vitest';

import { transform as runtimeTransform } from '../src/transform-core.js';
import { engineMessage } from './engine-message.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

const REGISTRY = { './base': { base: { pb: 2, p: 4 } } };

/**
 * Compile one source on one engine.
 *
 * @param engine - Engine entry under test.
 * @param source - The module source.
 * @returns The captured run.
 */
function compile(engine: (typeof ENGINES)[number][1], source: string) {
    return captureWarnings(
        (code, filename) => engine(code, filename, { crossModuleSzObjects: REGISTRY }),
        source,
        '/p/App.tsx',
    );
}

/**
 * The codes and offsets one run reported.
 *
 * @param run - A captured run.
 * @returns `[code, line, column]` triples in emission order.
 */
function issuesOf(run: ReturnType<typeof compile>): Array<[string, number, number]> {
    return (run.result.issues ?? []).map(issue => [issue.code, issue.line, issue.column]);
}

describe.each(ENGINES)('a runtime value under a variant key (%s)', (_name, engine) => {
    it('defers the key to the runtime and lowers the static rest', () => {
        const source = 'export const A = ({ x }) => <div sz={{ m: 1, hover: x }} />;';
        const run = compile(engine, source);

        expect(run.result.code).toContain('className={_szcn("m-1", _szPart({ hover: x }))}');
        expect(run.result.code).not.toContain('--_sz-hover');
        expect([...(run.result.classes ?? [])]).toEqual(['m-1']);
    });

    it('reports fallback-missing-css at the key, with the way out', () => {
        const source = 'export const A = ({ x }) => <div sz={{ m: 1, hover: x }} />;';
        const run = compile(engine, source);

        expect(issuesOf(run)).toEqual([['fallback-missing-css', 1, source.indexOf('hover') + 1]]);
        expect(run.warnings).toHaveLength(1);
        expect(run.result.issues?.[0]?.args).toEqual({ site: 'sz-variant-key', keyPath: 'hover' });
        expect(run.warnings[0]).toBe(
            engineMessage(
                'fallback-missing-css',
                `/p/App.tsx:1:${source.indexOf('hover') + 1}`,
                '`sz` falls back to the runtime: key `hover` holds a value only known at runtime and no sz property claims it, so its classes were never collected.',
                'help: if the key is a variant, give it a static sz object literal or a two-branch `c ? { … } : { … }`; if it is an sz property, check its spelling. For runtime values use `dynamic()`.',
            ),
        );
    });

    it('defers a three-arm chain under a variant', () => {
        const chain = 'c ? { p: 4 } : d ? { m: 2 } : { p: 1 }';
        const source = `export const A = ({ c, d }) => <div sz={{ m: 1, hover: ${chain} }} />;`;
        const run = compile(engine, source);

        expect(run.result.code).toContain(`_szcn("m-1", _szPart({ hover: ${chain} }))`);
        expect(run.result.code).not.toContain('--_sz-hover');
        expect(issuesOf(run).map(([code]) => code)).toEqual(['fallback-missing-css']);
    });

    it('keeps the variant path of a nested key', () => {
        const chain = 'c ? { pb: 2, p: 4 } : d ? { m: 2, mx: 1 } : { p: 1 }';
        const source = `export const A = ({ c, d }) => <div sz={{ m: 1,\n  md: { hover: ${chain} } }} />;`;
        const run = compile(engine, source);

        expect(run.result.code).toContain(`_szcn("m-1", _szPart({ md: { hover: ${chain} } }))`);
        expect(run.result.code).not.toContain('--_sz-md-hover');
        expect(issuesOf(run)).toEqual([['fallback-missing-css', 2, 9]]);
        expect(run.result.issues?.[0]?.args).toMatchObject({ keyPath: 'md.hover' });
        expect(run.warnings[0]).toContain('[csszyx] fallback-missing-css: /p/App.tsx:2:9\n');
        expect(run.warnings[0]).toContain('key `md.hover` holds');
    });

    it('defers a conditional with one absent branch under a variant', () => {
        // Was `c ? "hover-(--_sz-hover)" : ""` with the object in a variable.
        const source = 'export const A = ({ c, x }) => <div sz={{ m: 1, hover: c ? x : null }} />;';
        const run = compile(engine, source);

        expect(run.result.code).toContain('_szcn("m-1", _szPart({ hover: c ? x : null }))');
        expect(run.result.code).not.toContain('--_sz-hover');
        expect(issuesOf(run).map(([code]) => code)).toEqual(['fallback-missing-css']);
    });

    it('quotes a variant key that is not an identifier', () => {
        const source = "export const A = ({ x }) => <div sz={{ '[&>li]': x }} />;";
        const run = compile(engine, source);

        expect(run.result.code).toContain('className={_szcn(_szPart({ "[&>li]": x }))}');
    });

    it('defers a namespace import under a variant', () => {
        const source =
            "import * as S from './base';\nexport const A = () => <div sz={{ hover: S }} />;";
        const run = compile(engine, source);

        expect(run.result.code).toContain('className={_szcn(_szPart({ hover: S }))}');
        expect(issuesOf(run).map(([code]) => code)).toEqual(['fallback-missing-css']);
    });

    it('defers the whole object when a runtime value sits beside the variant', () => {
        // A css variable or a conditional class beside the deferred key has no
        // home in an szcn composition, so the object takes the runtime path it
        // takes for an unresolvable spread; the classes it can see are still
        // collected.
        const source = 'export const A = ({ x, y }) => <div sz={{ m: 1, p: y, hover: x }} />;';
        const run = compile(engine, source);

        expect(run.result.code).toContain('className={_sz({ m: 1, p: y, hover: x })}');
        expect(issuesOf(run)).toEqual([['fallback-missing-css', 1, source.indexOf('hover') + 1]]);
    });

    it("defers a key from the project's own variant namespace", () => {
        // `tablet` is a `--breakpoint-tablet` of the app's `@theme` (or an
        // `@custom-variant`), which the engine never reads. It compiled to
        // `tablet-(--_sz-tablet)` with the object in a CSS variable. A key no
        // table claims holds sz the runtime lowers — a variant for an object,
        // the key's `@utility` class for a scalar — so it defers like `hover`.
        const source = 'export const A = ({ x }) => <div sz={{ m: 1, tablet: x }} />;';
        const run = compile(engine, source);

        expect(run.result.code).toContain('className={_szcn("m-1", _szPart({ tablet: x }))}');
        expect(run.result.code).not.toContain('--_sz-tablet');
        expect(issuesOf(run)).toEqual([['fallback-missing-css', 1, source.indexOf('tablet') + 1]]);
        expect(run.result.issues?.[0]?.args).toEqual({ site: 'sz-variant-key', keyPath: 'tablet' });
        expect(run.warnings[0]).toContain('key `tablet` holds');
    });

    it('does not call a key no table claims a variant', () => {
        // Any key no table claims is deferred as a variant — the project may
        // declare it — so a typo is reported too. The text must stay true for
        // the typo: it names the key and says how it was treated, not what it is.
        const source = 'export const A = ({ x }) => <div sz={{ m: 1, tablt: x }} />;';
        const run = compile(engine, source);

        expect(issuesOf(run)).toEqual([['fallback-missing-css', 1, source.indexOf('tablt') + 1]]);
        expect(run.result.issues?.[0]?.args).toEqual({ site: 'sz-variant-key', keyPath: 'tablt' });
        expect(run.warnings[0]).toContain(
            ': key `tablt` holds a value only known at runtime and no sz property claims it',
        );
        expect(run.warnings[0]).not.toContain('variant key');
        expect(run.warnings[0]).toContain('if it is an sz property, check its spelling');
    });

    it('defers a project variant nested under a built-in one, and a conditional under it', () => {
        const source =
            "export const A = ({ c, x }) => <div sz={{ m: 1, md: { 'desktop-sm': x }, wqhd: c ? x : null }} />;";
        const run = compile(engine, source);

        expect(run.result.code).toContain(
            'className={_szcn("m-1", _szPart({ md: { "desktop-sm": x } }), _szPart({ wqhd: c ? x : null }))}',
        );
        expect(run.result.code).not.toContain('--_sz-');
        expect(
            run.result.issues?.map(issue => (issue.args as { keyPath?: string }).keyPath),
        ).toEqual(['md.desktop-sm', 'wqhd']);
    });

    // @extracted-corpus-source-column
    it.each([
        [
            'leaves a two-arm conditional under a variant compiled',
            'export const A = ({ c }) => <div sz={{ m: 1, hover: c ? { p: 4 } : { p: 1 } }} />;',
            'className={`m-1 ${c ? "hover:p-4" : "hover:p-1"}`}',
        ],
        [
            'keeps a custom property and a known key on the css-variable lane',
            "export const A = ({ x }) => <div sz={{ '--brand': x, bg: x }} />;",
            'className="[--brand:var(--_sz---brand)] bg-(--_sz-bg)"',
        ],
        [
            'leaves a runtime value on a property key on its css-variable lane',
            'export const A = ({ x }) => <div sz={{ m: 1, p: x }} />;',
            'p-(--_sz-p)',
        ],
    ])('%s, with nothing to report', (_case, source, expected) => {
        const run = compile(engine, source);

        expect(run.result.code).toContain(expected);
        expect(issuesOf(run)).toEqual([]);
    });
});

describe.each(ENGINES)('a runtime variant value in an sz array element (%s)', (_name, engine) => {
    it('splits the element as it splits a lone object, and reports the key', () => {
        // The element went to `_szPart` whole with the nudge "its classes are
        // still safelisted best-effort" — true of `m-1`, never of the hover
        // classes, which nothing collects.
        const source = "export const A = ({ x }) => <div sz={['p-2', { m: 1, hover: x }]} />;";
        const run = compile(engine, source);

        expect(run.result.code).toContain('className={_szcn("p-2", "m-1", _szPart({ hover: x }))}');
        expect([...(run.result.classes ?? [])].sort()).toEqual(['m-1', 'p-2']);
        expect(issuesOf(run)).toEqual([['fallback-missing-css', 1, source.indexOf('hover') + 1]]);
        expect(run.warnings[0]).toContain('key `hover` holds');
    });

    it('keeps the element order around a split element', () => {
        const source = 'export const A = ({ x }) => <div sz={[{ md: { hover: x } }, { p: 2 }]} />;';
        const run = compile(engine, source);

        expect(run.result.code).toContain(
            'className={_szcn(_szPart({ md: { hover: x } }), "p-2")}',
        );
        expect(issuesOf(run).map(([code]) => code)).toEqual(['fallback-missing-css']);
    });

    it('defers the whole element when a css variable sits beside the key', () => {
        const source = 'export const A = ({ x, y }) => <div sz={[{ m: 1, p: y, hover: x }]} />;';
        const run = compile(engine, source);

        expect(run.result.code).toContain('className={_szcn(_szPart({ m: 1, p: y, hover: x }))}');
        expect(issuesOf(run)).toEqual([['fallback-missing-css', 1, source.indexOf('hover') + 1]]);
    });

    it('reports the key of a guarded element', () => {
        const source = 'export const A = ({ c, x }) => <div sz={[c && { m: 1, hover: x }]} />;';
        const run = compile(engine, source);

        expect(run.result.code).toContain('className={_szcn(_szPart(c && { m: 1, hover: x }))}');
        expect(issuesOf(run)).toEqual([['fallback-missing-css', 1, source.indexOf('hover') + 1]]);
    });

    it('reports the key of an object in a ternary branch of an element', () => {
        // The element goes to `_szPart` whole, which styles it at runtime, but
        // nothing collected the hover classes and nothing said so.
        const source = 'export const A = ({ c, x }) => <div sz={[c ? { hover: x } : { p: 2 }]} />;';
        const run = compile(engine, source);

        expect(run.result.code).toContain(
            'className={_szcn(_szPart(c ? { hover: x } : { p: 2 }))}',
        );
        expect([...(run.result.classes ?? [])]).toEqual(['p-2']);
        expect(issuesOf(run)).toEqual([['fallback-missing-css', 1, source.indexOf('hover') + 1]]);
    });

    it('reports keys in every branch of a nested conditional element and under a guard', () => {
        const source =
            'export const A = ({ c, d, x }) => <div sz={[c ? { md: { hover: x } } : d ? { p: 2 } : { focus: x }, c && (d ? { active: x } : null)]} />;';
        const run = compile(engine, source);

        expect(run.result.code).toContain(
            '_szPart(c ? { md: { hover: x } } : d ? { p: 2 } : { focus: x })',
        );
        expect(issuesOf(run)).toEqual([
            ['fallback-missing-css', 1, source.indexOf('hover') + 1],
            ['fallback-missing-css', 1, source.indexOf('focus') + 1],
            ['fallback-missing-css', 1, source.indexOf('active') + 1],
        ]);
        expect(run.warnings.map(text => /: key `([^`]*)` holds/.exec(text)?.[1])).toEqual([
            'md.hover',
            'focus',
            'active',
        ]);
    });

    it('leaves an element with a runtime property value on the nudge', () => {
        const source = 'export const A = ({ y }) => <div sz={[{ m: 1, p: y }]} />;';
        const run = compile(engine, source);

        expect(issuesOf(run).map(([code]) => code)).toEqual(['fallback-nudge']);
    });
});

describe.each(ENGINES)('a runtime variant value in a conditional sz (%s)', (_name, engine) => {
    it('reports the key of an object in a branch instead of the nudge', () => {
        // The nudge said the classes of a conditional are collected
        // best-effort, which is never true of the hover classes.
        const source =
            'export const A = ({ c, x }) => <div sz={c ? { m: 1, hover: x } : { p: 2 }} />;';
        const run = compile(engine, source);

        expect(run.result.code).toContain('className={_sz(c ? { m: 1, hover: x } : { p: 2 })}');
        expect([...(run.result.classes ?? [])].sort()).toEqual(['m-1', 'p-2']);
        expect(issuesOf(run)).toEqual([['fallback-missing-css', 1, source.indexOf('hover') + 1]]);
    });

    it('keeps the nudge for a conditional with no deferred key', () => {
        const source = 'export const A = ({ c, y }) => <div sz={c ? { p: y } : { p: 2 }} />;';
        const run = compile(engine, source);

        expect(issuesOf(run).map(([code]) => code)).toEqual(['fallback-nudge']);
    });

    it('leaves a conditional of static branches compiled', () => {
        const source =
            'export const A = ({ c }) => <div sz={c ? { hover: { p: 4 } } : { p: 2 }} />;';
        const run = compile(engine, source);

        expect(run.result.code).toContain('className={c ? "hover:p-4" : "p-2"}');
        expect(issuesOf(run)).toEqual([]);
    });
});

describe('the runtime lowering of a deferred variant', () => {
    it('styles a runtime object under a variant as the build styles a literal one', () => {
        // What `_szPart({ hover: x })` hands the runtime lowering, against the
        // build's lowering of the same object written as a literal.
        const [, engine] = ENGINES[0];
        const literal = engine(
            'export const A = () => <div sz={{ md: { hover: { pb: 2, p: 4 } } }} />;',
            '/p/App.tsx',
        );
        const built = /className="([^"]*)"/.exec(literal.code ?? '')?.[1];

        expect(runtimeTransform({ md: { hover: { pb: 2, p: 4 } } }).className).toBe(built);
    });
});
