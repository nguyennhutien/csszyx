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
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';
import { transformSource } from '../src/transform-select.js';
import { transformWasm } from '../src/transform-wasm.js';

/** Cross-module sz objects, keyed by specifier then export name. */
type SzObjectRegistry = Record<string, Record<string, Record<string, unknown>>>;

type Engine = (
    source: string,
    filename?: string,
    options?: { crossModuleSzObjects?: SzObjectRegistry },
) => { code?: string; classes?: Set<string>; diagnostics?: string[] };

const ENGINES: ReadonlyArray<readonly [string, Engine]> = [
    ['babel', transformSource as Engine],
    ['oxc', transformWasm as Engine],
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

        it(`${name} ignores the namespace binding used as a whole style`, () => {
            // `sz={S}` asks for the module's export map as a style. Lowering it
            // would turn export NAMES into utility keys and emit classes for a
            // shape the author never wrote, which is worse than not compiling:
            // the CSS would be generated for them.
            const tsx = "import * as S from './styles';\nexport const A = () => <div sz={S} />;";
            const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: REGISTRY });
            expect(result.code ?? '').toContain('_sz(');
        });

        it(`${name} ignores a default import of a module with no default export`, () => {
            // The default slot is a separate registry entry. Answering it from
            // a named export would resolve a value the importer never asked
            // for, and the two names need not even describe the same style.
            const tsx =
                "import cardSz from './styles';\nexport const A = () => <div sz={cardSz} />;";
            const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: REGISTRY });
            expect(result.code ?? '').toContain('_sz(');
        });

        it(`${name} falls back for an entry that is not an sz object`, () => {
            // The registry is built by reading somebody else's module, so an
            // entry can be any exported value. Anything that is not a plain
            // object has no keys to lower, and lowering it anyway would put
            // whatever it stringifies to into a class name.
            const tsx =
                "import { cardSz } from './styles';\nexport const A = () => <div sz={cardSz} />;";
            for (const value of ['p-4', 42, [{ p: 4 }]]) {
                const result = engine(tsx, '/p/Card.tsx', {
                    crossModuleSzObjects: { './styles': { cardSz: value } },
                } as { crossModuleSzObjects: SzObjectRegistry });
                expect(result.code ?? '').toContain('_sz(');
                expect(result.code ?? '').not.toContain('p-4"');
            }
        });
    }
});

/**
 * The registry a bundler hands a file importing a token module.
 *
 * Separate from {@link REGISTRY} because these are read THROUGH: `LAYER` is a
 * map somebody reads one key off, not a style anybody applies whole.
 */
const TOKEN_REGISTRY: SzObjectRegistry = {
    './tokens': {
        LAYER: { modal: 60 },
        BRAND: { color: 'blue-500', op: 20 },
    },
};

/**
 * Run one engine over a module that imports from `./tokens`.
 *
 * @param engine - Engine under test.
 * @param body - Module body after the import line.
 * @returns Emitted className, the collected classes, and the emitted code.
 */
function runTokens(
    engine: Engine,
    body: string,
): { className: string | undefined; classes: string[]; code: string } {
    const tsx = `import { LAYER, BRAND } from './tokens';\n${body}`;
    const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: TOKEN_REGISTRY });
    const code = result.code ?? '';
    return {
        className: /className="([^"]*)"/.exec(code)?.[1],
        classes: [...(result.classes ?? [])],
        code,
    };
}

describe('an imported map read from inside an sz object', () => {
    for (const [name, engine] of ENGINES) {
        it(`${name} folds a property read off an imported map`, () => {
            const out = runTokens(
                engine,
                'export const A = () => <div sz={{ z: LAYER.modal }} />;',
            );
            expect(out.className).toBe('z-60');
        });

        it(`${name} contributes the class rather than a custom property`, () => {
            // The failure this replaces was not a fallback to `_sz(...)`: an
            // unresolved value compiles to `--_sz-z`, which is a working
            // element with no class to generate CSS for. Asserting the class is
            // collected is what separates the two outcomes.
            const out = runTokens(
                engine,
                'export const A = () => <div sz={{ z: LAYER.modal }} />;',
            );
            expect(out.classes).toEqual(['z-60']);
            expect(out.code).not.toContain('--_sz-z');
        });

        it(`${name} folds an imported object used as a property value`, () => {
            const out = runTokens(engine, 'export const A = () => <div sz={{ bg: BRAND }} />;');
            expect(out.className).toBe('bg-blue-500/20');
        });

        it(`${name} keeps the custom property for a key the map does not carry`, () => {
            // Answering here would be a guess: the runtime read yields
            // undefined, so any class this produced would style an element the
            // author never asked to style.
            const out = runTokens(
                engine,
                'export const A = () => <div sz={{ z: LAYER.missing }} />;',
            );
            expect(out.className).toBe('z-(--_sz-z)');
        });

        it(`${name} keeps the custom property for a computed read`, () => {
            const out = runTokens(
                engine,
                'export const A = ({ k }) => <div sz={{ z: LAYER[k] }} />;',
            );
            expect(out.className).toBe('z-(--_sz-z)');
        });

        it(`${name} lets a local map shadow the imported one`, () => {
            const out = runTokens(
                engine,
                'export const A = () => { const LAYER = { modal: 10 }; return <div sz={{ z: LAYER.modal }} />; };',
            );
            expect(out.className).toBe('z-10');
        });
    }
});

describe('a namespace import, which is read through rather than applied', () => {
    for (const [name, engine] of ENGINES) {
        it(`${name} resolves one style read off the namespace`, () => {
            const tsx =
                "import * as S from './styles';\nexport const A = () => <div sz={S.cardSz} />;";
            const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: REGISTRY });
            expect(/className="([^"]*)"/.exec(result.code ?? '')?.[1]).toBe('p-4 rounded-lg');
        });

        it(`${name} contributes the classes read through the namespace`, () => {
            const tsx =
                "import * as S from './styles';\nexport const A = () => <div sz={S.cardSz} />;";
            const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: REGISTRY });
            expect([...(result.classes ?? [])]).toEqual(['p-4', 'rounded-lg']);
        });

        it(`${name} keeps the runtime path for an export the module lacks`, () => {
            const tsx =
                "import * as S from './styles';\nexport const A = () => <div sz={S.missingSz} />;";
            const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: REGISTRY });
            expect(result.code ?? '').toContain('_sz(');
        });

        it(`${name} keeps the runtime path for a computed read`, () => {
            const tsx =
                "import * as S from './styles';\nexport const A = ({ k }) => <div sz={S[k]} />;";
            const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: REGISTRY });
            expect(result.code ?? '').toContain('_sz(');
        });
    }
});

describe('a module that exports its style as the default', () => {
    /** What the registry holds for `export default { p: 4, rounded: 'lg' }`. */
    const DEFAULT_REGISTRY: SzObjectRegistry = {
        './styles': { default: { p: 4, rounded: 'lg' } },
    };

    for (const [name, engine] of ENGINES) {
        it(`${name} resolves a default import by slot, not by local name`, () => {
            // The importer picks the local name, so two files importing the
            // same default write two different names for one value. Resolution
            // has to go by the slot or it answers one of them and not the other.
            for (const local of ['cardSz', 'anythingAtAll']) {
                const tsx = `import ${local} from './styles';\nexport const A = () => <div sz={${local}} />;`;
                const result = engine(tsx, '/p/Card.tsx', {
                    crossModuleSzObjects: DEFAULT_REGISTRY,
                });
                expect(/className="([^"]*)"/.exec(result.code ?? '')?.[1]).toBe('p-4 rounded-lg');
            }
        });

        it(`${name} contributes the default export's classes`, () => {
            const tsx =
                "import cardSz from './styles';\nexport const A = () => <div sz={cardSz} />;";
            const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: DEFAULT_REGISTRY });
            expect([...(result.classes ?? [])]).toEqual(['p-4', 'rounded-lg']);
        });

        it(`${name} ignores a type-only default import`, () => {
            const tsx =
                "import type cardSz from './styles';\nexport const A = () => <div sz={cardSz} />;";
            const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: DEFAULT_REGISTRY });
            expect(result.code ?? '').toContain('_sz(');
        });

        it(`${name} keeps the default and named slots apart`, () => {
            // One module can export both. A named import must not pick up the
            // default, and the check is that it stays on the runtime path.
            const tsx =
                "import { cardSz } from './styles';\nexport const A = () => <div sz={cardSz} />;";
            const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: DEFAULT_REGISTRY });
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

/**
 * Every position the binding can appear in OTHER than a direct `sz={binding}`.
 *
 * The refusals above are about how the module is IMPORTED. These are about how
 * the resolved binding is USED, and they were the untested half: v1 folds only
 * the direct attribute, so each of these keeps the runtime path.
 *
 * Two properties are pinned per shape, and the second is the one that matters.
 * The imported half contributes NO class — `p-4` appears in no output, so
 * nothing tells Tailwind to generate that rule, and only the runtime knows the
 * element wants it. That is the accepted cost of the v1 cut, but it is a cost
 * with a visible shape, and a future change that starts folding one of these
 * must not do it on one engine only. Locking the current answer on all three is
 * what makes such a change show up as a diff instead of as a divergence.
 */
const USE_SHAPES: ReadonlyArray<readonly [string, string, string]> = [
    ['a spread', 'export const A = () => <div sz={{ ...cardSz, m: 2 }} />;', 'm-2'],
    ['a ternary branch', 'export const A = ({ x }) => <div sz={x ? cardSz : { m: 1 }} />;', 'm-1'],
    ['an array element', 'export const A = () => <div sz={[cardSz, { m: 2 }]} />;', 'm-2'],
];

describe('where the resolved binding is used', () => {
    for (const [name, engine] of ENGINES) {
        for (const [shape, body, localClass] of USE_SHAPES) {
            it(`${name} keeps the runtime path for ${shape}`, () => {
                const out = run(engine, body);
                expect(out.className).toBeUndefined();
                // The local literal beside it still lowers. Only the part that
                // came through the import is left to the runtime, which is what
                // makes the missing class specific rather than total.
                expect(out.classes).toEqual([localClass]);
                expect(out.classes).not.toContain('p-4');
            });
        }

        it(`${name} keeps the runtime path for a helper call`, () => {
            // `szcn(cardSz)` is a runtime call, not an sz attribute — there is
            // no attribute to fold into, so nothing is collected at all.
            const tsx =
                "import { szcn } from '@csszyx/runtime';\nimport { cardSz } from './styles';\n" +
                'export const A = () => <div className={szcn(cardSz)} />;';
            const result = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: REGISTRY });
            expect(result.code ?? '').toContain('szcn(cardSz)');
            expect([...(result.classes ?? [])]).toEqual([]);
        });
    }

    it('babel keeps the runtime path when a local const re-wraps the import', () => {
        // Resolution is one hop: the registry answers for the IMPORTED binding,
        // and `local` is a different binding whose initializer merely mentions
        // it. Following that would mean folding arbitrary local dataflow.
        const out = run(
            transformSource as Engine,
            'const local = { ...cardSz };\nexport const A = () => <div sz={local} />;',
        );
        expect(out.code).toContain('_sz(local)');
        expect(out.classes).toEqual([]);
    });

    it('wasm keeps the runtime path when a local const re-wraps the import', () => {
        // The artifacts answer this case identically: a spread re-wrap is not
        // statically readable, so the value stays on the runtime path instead
        // of being resolved through the registry.
        const out = run(
            transformWasm as Engine,
            'const local = { ...cardSz };\nexport const A = () => <div sz={local} />;',
        );
        expect(out.code).toContain('_sz(local)');
        expect(out.classes).toEqual([]);
    });

    if (isRustTransformAvailable()) {
        it('rust keeps the runtime path when a local const re-wraps the import', () => {
            const out = run(
                transformRust as Engine,
                'const local = { ...cardSz };\nexport const A = () => <div sz={local} />;',
            );
            expect(out.code).toContain('_sz(local)');
            expect(out.classes).toEqual([]);
        });
    }
});

describe('import shapes the oxc reader has to tell apart', () => {
    it('ignores a specifier marked type-only inside a value import', () => {
        // `import { type cardSz, other }` is a VALUE import carrying a type-only
        // specifier. Reading it as a value would bind a name that does not exist
        // at runtime, so the importer would compile against a table for an
        // import the bundler erased.
        const tsx =
            "import { type cardSz } from './styles';\n" +
            'export const A = () => <div sz={{ p: 1 }} />;';
        const out = transformWasm(tsx, '/p/Card.tsx', { crossModuleSzObjects: REGISTRY });

        expect(out.code).toContain('p-1');
        expect(out.code).not.toContain('p-4');
    });

    it('records a reassignment through a plain binding, not through a member write', () => {
        // `styles.cardSz = …` writes a PROPERTY; the binding itself still points
        // at the object the module exported. Treating it as a reassignment would
        // withdraw the precompile from every importer that merely mutates a
        // field, which the shared-style contract already forbids for other
        // reasons.
        const tsx =
            "import { cardSz } from './styles';\n" +
            'const holder = { cardSz };\n' +
            'holder.cardSz = { p: 9 };\n' +
            'export const A = () => <div sz={cardSz} />;';
        const out = transformWasm(tsx, '/p/Card.tsx', { crossModuleSzObjects: REGISTRY });

        expect(out.code).toContain('p-4');
    });

    it('is read the same way by the oxc lane', () => {
        // The two lanes read the specifier through different AST shapes, and a
        // lane that fell back to the LOCAL name here would resolve a different
        // entry than its sibling for the same source.
        const tsx =
            'import { "card-sz" as card } from \'./styles\';\n' +
            'export const A = () => <div sz={card} />;';
        const out = transformWasm(tsx, '/p/Card.tsx', {
            crossModuleSzObjects: { './styles': { 'card-sz': { p: 4 } } },
        });

        expect(out.code).toContain('p-4');
    });
});

describe('an export named by a string literal', () => {
    it('is read through the specifier, not through the local binding', () => {
        // `import { "card-sz" as card }` is valid ES2022 and the only spelling
        // for an export whose name is not an identifier. The registry is keyed
        // by the EXPORT name, so reading the local one looks up a key nothing
        // ever put there.
        const tsx =
            'import { "card-sz" as card } from \'./styles\';\n' +
            'export const A = () => <div sz={card} />;';
        const out = transformSource(tsx, '/p/Card.tsx', {
            crossModuleSzObjects: { './styles': { 'card-sz': { p: 4 } } },
        } as never);

        expect(out.code).toContain('p-4');
    });
});

describe('a registry key that is not an ordinary property name', () => {
    it.each(ENGINES.filter(([name]) => name !== 'rust'))(
        '%s lowers nothing for an import named __proto__',
        (_name, engine) => {
            // Reading `registry['__proto__']` off an ordinary object answers
            // with `Object.prototype`, and reading a member off THAT answers
            // with whatever the prototype carries. Either would be lowered as
            // though a module had exported it — from a table no module wrote.
            const tsx =
                "import { toString } from '__proto__';\n" +
                'export const A = () => <div sz={toString} />;';
            const out = engine(tsx, '/p/Card.tsx', { crossModuleSzObjects: {} });

            expect(out.code).toContain('_sz(toString)');
        },
    );

    it.each(ENGINES.filter(([name]) => name !== 'rust'))(
        '%s lowers nothing for an export named __proto__ it was not given',
        (_name, engine) => {
            const tsx =
                "import { __proto__ } from './styles';\n" +
                'export const A = () => <div sz={__proto__} />;';
            const out = engine(tsx, '/p/Card.tsx', {
                crossModuleSzObjects: { './styles': { cardSz: { p: 4 } } },
            });

            expect(out.code).toContain('_sz(__proto__)');
            expect(out.code).not.toContain('p-4');
        },
    );
});
