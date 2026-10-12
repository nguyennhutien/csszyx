/**
 * `csszyx explain` answers with the build's engine, not a second reader.
 *
 * The command exists to show what csszyx emits for an sz object. It used to
 * read the literal with the adapters' TypeScript walker and lower it with the
 * TypeScript runtime transform, and that pair disagreed with the build on
 * shapes people write: a unary plus, an `undefined` value and a spread of a
 * literal were called dynamic while the build emitted `p-4`; a template string
 * printed `p-4` while the build sets the value through a style variable; an
 * array value was resolved while the build leaves the whole object to `_sz()`.
 *
 * Every expectation below is what the build writes into `className` for the
 * same object, and each runs on both engine artifacts: the native addon and
 * the wasm build answer for different hosts, so the command has to agree with
 * whichever one a build would use.
 */
import { type SourceTransformResult, transformRust, transformWasm } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';

import { ExplainParseError, explainSz } from '../src/commands/explain.js';

type Engine = (source: string, filename?: string) => SourceTransformResult;

const ARTIFACTS: Array<[string, Engine]> = [
    ['native', transformRust],
    ['wasm', transformWasm],
];

/**
 * The className a build writes for one sz object, read from a component
 * shaped unlike the one the command synthesizes, so agreement cannot come
 * from both sides sharing a wrapper.
 * @param engine - The engine artifact to build with.
 * @param sz - The sz object source.
 * @returns The className attribute the build wrote.
 */
function buildClassName(engine: Engine, sz: string): string {
    const { code } = engine(
        `export function Card() {\n    return <section id="card" sz={${sz}}>hi</section>;\n}\n`,
        'Card.tsx',
    );
    const match = /className="([^"]*)"/.exec(code);
    if (!match) throw new Error(`build left ${sz} to the runtime: ${code}`);
    return match[1];
}

describe.each(ARTIFACTS)('explainSz on the %s artifact', (_name, engine) => {
    it.each([
        ['{ p: 4 }', 'p-4'],
        ["{ p: 4, bg: 'blue-500' }", 'p-4 bg-blue-500'],
        ["{ hover: { bg: 'blue-500' } }", 'hover:bg-blue-500'],
        ['{ mt: -4 }', '-mt-4'],
        ['{ p: -2 }', '-p-2'],
        ['{ p: +4 }', 'p-4'],
        ['{ p: 4, m: undefined }', 'p-4'],
        ['{ p: 4, m: null }', 'p-4'],
        ['{ ...{ p: 4 } }', 'p-4'],
        ["{ md: { p: 4 }, hover: { color: 'red-500' } }", 'md:p-4 hover:text-red-500'],
        ['{ p: `4` }', 'p-(--_sz-p)'],
        ['{ content: `x` }', 'content-(--_sz-content)'],
        ['{ p: size }', 'p-(--_sz-p)'],
    ])('%s compiles to what the build emits', (sz, className) => {
        const explained = explainSz(sz, engine);
        expect(explained.className).toBe(className);
        expect(explained.className).toBe(buildClassName(engine, sz));
    });

    it('names the variable a style attribute sets at runtime', () => {
        expect(explainSz('{ p: `4` }', engine).runtimeValues).toEqual(['--_sz-p']);
        expect(explainSz('{ p: 4 }', engine).runtimeValues).toEqual([]);
    });

    it('reports an empty object as no classes', () => {
        expect(explainSz('{}', engine)).toEqual({
            className: '',
            runtimeValues: [],
            diagnostics: [],
        });
    });

    it("passes the engine's diagnostics through without the synthesized location", () => {
        const unknown = explainSz('{ foo: 4 }', engine);
        expect(unknown.className).toBe('foo-4');
        expect(unknown.diagnostics).toHaveLength(1);
        expect(unknown.diagnostics[0]).toMatch(/^\[csszyx\] Unknown property "foo" in sz prop\./);
        expect(unknown.diagnostics[0]).not.toMatch(/\.tsx|\d:\d/);

        const numeric = explainSz('{ 4: 1 }', engine);
        expect(numeric.className).toBe('');
        expect(numeric.diagnostics[0]).toMatch(/numeric key "4"/);
    });

    it.each([
        ['{ p: [4] }', /not statically analyzable/],
        ['{ p: [1, , 2] }', /not statically analyzable/],
        ['{ ...props }', /unresolvable sz spread|not statically analyzable/],
        ['{ [key]: 4 }', /not statically analyzable/],
        ['{ go() {} }', /not statically analyzable/],
        ['someVar', /`someVar` could not be resolved/],
        ['42', /not statically analyzable/],
    ])('%s is left to the runtime, as the build leaves it', (sz, reason) => {
        expect(() => buildClassName(engine, sz)).toThrow(/left .* to the runtime/);
        expect(() => explainSz(sz, engine)).toThrow(ExplainParseError);
        expect(() => explainSz(sz, engine)).toThrow(/resolved at runtime by `_sz\(\)`/);
        expect(() => explainSz(sz, engine)).toThrow(reason);
        expect(() => explainSz(sz, engine)).not.toThrow(/\d:\d/);
    });

    it.each(['{ p:', '{{{{', 'not an object', '{ p: 4 } }'])('%s is a syntax error', sz => {
        expect(() => explainSz(sz, engine)).toThrow(/could not be parsed/);
    });

    it('reads an attribute name inside a value as text', () => {
        expect(explainSz("{ p: 'className=' }", engine).className).toBe('p-className=');
    });

    it('accepts the array form the build accepts', () => {
        expect(explainSz('[{ p: 4 }, { m: 2 }]', engine).className).toBe('p-4 m-2');
    });

    it('refuses input that closes the sz expression and opens another element', () => {
        expect(() => explainSz('{ p: 4 }} /><b sz={{ m: 2 }', engine)).toThrow(
            /not one sz expression/,
        );
    });
});

describe('explainSz on a runtime fallback the engine gives no reason for', () => {
    it('still says the object is resolved at runtime', () => {
        const silent: Engine = source => ({
            ...transformWasm(source, 'sz.tsx'),
            code: 'export const A = () => <div className={_sz(x)} />;\n',
            diagnostics: [],
            issues: undefined,
        });
        expect(() => explainSz('x', silent)).toThrow(
            /^the build emits no classes for it; it is resolved at runtime by `_sz\(\)`$/,
        );
    });
});

describe('explainSz without a chosen artifact', () => {
    it('uses whichever artifact this host runs', () => {
        expect(explainSz('{ p: +4 }').className).toBe('p-4');
    });
});
