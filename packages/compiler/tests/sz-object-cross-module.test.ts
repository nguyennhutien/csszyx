/**
 * Lowering an imported static sz object, on every engine.
 *
 * `export const cardSz = { p: 4 }` in one module and `sz={cardSz}` in another
 * is an ordinary way to share a fixed style. The compiler resolved the same
 * object declared locally and gave up on the imported one, so the importer
 * shipped `_sz(cardSz)` and contributed NO classes: the class text existed in
 * no output at all, and nothing downstream was told to generate the CSS the
 * browser would ask for.
 *
 * These tests inject the registry through options directly — the consumer
 * contract does not depend on how the bundler resolved the paths, and the
 * bundler's own resolution is covered where it lives.
 *
 * v1 is deliberately narrow: a direct `sz={binding}` from a relative NAMED
 * import. Everything outside that must fall back to exactly today's behaviour,
 * which is why the refusals are pinned as hard as the successes — a fallback
 * that quietly became a wrong compile is the failure this feature could
 * introduce.
 */
import { describe, expect, it } from 'vitest';

import { transformSourceCode } from '../src/transform.js';
import { transformOxc } from '../src/transform-oxc.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';

/** Cross-module sz objects, keyed by specifier then export name. */
type SzObjectRegistry = Record<string, Record<string, Record<string, unknown>>>;

type Engine = (
    source: string,
    filename?: string,
    options?: { crossModuleSzObjects?: SzObjectRegistry },
) => { code?: string; classes?: Set<string>; diagnostics?: string[] };

const ENGINES: ReadonlyArray<readonly [string, Engine]> = [
    ['babel', transformSourceCode as Engine],
    ['oxc', transformOxc as Engine],
    ...(isRustTransformAvailable() ? ([['rust', transformRust as Engine]] as const) : []),
];

/** The registry a bundler would hand a file importing from `./styles`. */
const REGISTRY: SzObjectRegistry = {
    './styles': {
        cardSz: { p: 4, rounded: 'lg' },
        hoverSz: { p: 2, hover: { bg: 'blue-500' } },
    },
};

/**
 * Run one engine over a module that imports from `./styles`.
 *
 * @param engine - Engine under test.
 * @param body - Module body after the import line.
 * @returns Emitted className, the collected classes, and the emitted code.
 */
function run(
    engine: Engine,
    body: string,
): { className: string | undefined; classes: string[]; code: string } {
    const tsx = `import { cardSz, hoverSz } from './styles';\n${body}`;
    const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: REGISTRY });
    const code = result.code ?? '';
    return {
        className: /className="([^"]*)"/.exec(code)?.[1],
        classes: [...(result.classes ?? [])],
        code,
    };
}

describe('an imported static sz object lowers like a local literal', () => {
    for (const [name, engine] of ENGINES) {
        it(`${name} compiles a direct sz={binding}`, () => {
            const out = run(engine, 'export const A = () => <div sz={cardSz} />;');
            expect(out.className).toBe('p-4 rounded-lg');
            expect(out.code).not.toContain('_sz(');
        });

        it(`${name} contributes the classes, which is the whole point`, () => {
            // Without this the CSS is absent however good the emitted code
            // looks: the safelist is what tells Tailwind these exist.
            const out = run(engine, 'export const A = () => <div sz={cardSz} />;');
            expect(out.classes).toEqual(['p-4', 'rounded-lg']);
        });

        it(`${name} lowers nested variants the same way`, () => {
            const out = run(engine, 'export const A = () => <div sz={hoverSz} />;');
            expect(out.className).toBe('p-2 hover:bg-blue-500');
        });

        it(`${name} keeps the import statement standing`, () => {
            // The binding is gone from the emitted JSX, but dropping the import
            // would take the exporter's side effects and the module-graph edge
            // a watch rebuild needs with it. Removing dead imports is the
            // bundler's job, not this transform's.
            const out = run(engine, 'export const A = () => <div sz={cardSz} />;');
            expect(out.code).toContain("from './styles'");
        });

        it(`${name} merges an existing className, in the documented order`, () => {
            const out = run(engine, 'export const A = () => <div sz={cardSz} className="m-2" />;');
            expect(out.code).toContain('p-4');
            expect(out.code).toContain('m-2');
        });
    }
});

describe('what v1 refuses, and must keep refusing', () => {
    for (const [name, engine] of ENGINES) {
        it(`${name} falls back without a registry`, () => {
            // Called without the option at all, not with an empty one: absent
            // and empty must both mean "resolve nothing".
            const tsx =
                "import { cardSz } from './styles';\nexport const A = () => <div sz={cardSz} />;";
            for (const options of [undefined, { crossModuleSzObjects: {} }]) {
                const code = engine(tsx, '/p/Card.tsx', options).code ?? '';
                expect(/className="([^"]*)"/.exec(code)?.[1]).toBeUndefined();
                expect(code).toContain('_sz(');
            }
        });

        it(`${name} falls back for an export the registry does not carry`, () => {
            const tsx =
                "import { otherSz } from './styles';\nexport const A = () => <div sz={otherSz} />;";
            const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: REGISTRY });
            expect(result.code ?? '').toContain('_sz(');
        });

        it(`${name} falls back for a specifier the registry does not carry`, () => {
            const tsx =
                "import { cardSz } from './elsewhere';\nexport const A = () => <div sz={cardSz} />;";
            const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: REGISTRY });
            expect(result.code ?? '').toContain('_sz(');
        });

        it(`${name} lets a local declaration shadow the imported name`, () => {
            // Resolution is by BINDING, never by matching a text name against
            // the registry. A local const wins because it is what the code
            // actually refers to.
            const out = run(
                engine,
                'export const A = () => { const cardSz = { m: 2 }; return <div sz={cardSz} />; };',
            );
            expect(out.className).toBe('m-2');
        });

        it(`${name} ignores a type-only import`, () => {
            const tsx =
                "import type { cardSz } from './styles';\nexport const A = () => <div sz={cardSz} />;";
            const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: REGISTRY });
            expect(result.code ?? '').toContain('_sz(');
        });

        it(`${name} ignores a namespace import, which is out of v1 scope`, () => {
            const tsx =
                "import * as S from './styles';\nexport const A = () => <div sz={S.cardSz} />;";
            const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: REGISTRY });
            expect(result.code ?? '').toContain('_sz(');
        });

        it(`${name} ignores a default import, which is out of v1 scope`, () => {
            const tsx =
                "import cardSz from './styles';\nexport const A = () => <div sz={cardSz} />;";
            const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: REGISTRY });
            expect(result.code ?? '').toContain('_sz(');
        });
    }
});

describe('the local alias an import may carry', () => {
    for (const [name, engine] of ENGINES) {
        it(`${name} resolves through a renamed import`, () => {
            // The registry is keyed by EXPORT name; the code refers to the
            // local one. Reading the local name against the registry would
            // resolve the wrong entry whenever the two differ.
            const tsx =
                "import { cardSz as card } from './styles';\nexport const A = () => <div sz={card} />;";
            const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: REGISTRY });
            expect(/className="([^"]*)"/.exec(result.code ?? '')?.[1]).toBe('p-4 rounded-lg');
        });
    }
});
