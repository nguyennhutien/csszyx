/**
 * A provider export qualifies across a module boundary exactly when the same
 * literal compiles declared in the consuming file.
 *
 * The registry used to be filled by an evaluator of its own, narrower than the
 * engine's: `const S = 4; export const card = { p: S }` was refused while the
 * same two lines written next to `sz={card}` lowered to `p-4`. The importer
 * then shipped `_sz(card)`, reached no safelist, and carried a hint telling
 * the author to do what they had already done.
 *
 * Each case runs the way the bundler runs it: read the provider's entries,
 * hand them to the importer's transform, and compare the importer's class
 * with the class the same literal gets when it is local. Both directions are
 * pinned — a shape the local path refuses must stay refused here too. Each
 * artifact reads the entries AND compiles the importer, so a lane whose
 * extraction drifted would fail on its own.
 */
import { describe, expect, it } from 'vitest';

import { extractCrossModuleRegistryEntries } from '../src/cross-module-extract.js';
import type { CrossModuleRegistryEntry } from '../src/module-links.js';
import {
    ENGINES,
    LINK_SCANNERS,
    type LinkScanner,
    type ParityEngine,
} from './engine-parity-harness.js';

/**
 * Pair each transform artifact with the same artifact's module-link scan.
 *
 * @returns Lane name, its transform, and its scan.
 */
function lanes(): Array<readonly [string, ParityEngine, LinkScanner]> {
    return ENGINES.map(([lane, engine]) => {
        const scanner = LINK_SCANNERS.find(([name]) => name === lane)?.[1];
        if (scanner === undefined) throw new Error(`no module-link scan for the ${lane} lane`);
        return [lane, engine, scanner] as const;
    });
}

/**
 * Read a provider's registry entries the way the bundler asks for them.
 *
 * @param scanner - The artifact's module-link scan.
 * @param provider - Provider module body.
 * @returns The entries that artifact records.
 */
function entriesOf(scanner: LinkScanner, provider: string): CrossModuleRegistryEntry[] {
    return scanner([{ filename: '/p/styles.ts', source: provider }], { registryEntries: true })[0]
        .registryEntries;
}

/** Registry payloads one importer receives, split by kind as the bundler splits them. */
interface ImporterRegistries {
    crossModuleSzObjects: Record<string, Record<string, Record<string, unknown>>>;
    crossModuleStatics: Record<string, Record<string, Record<string, unknown>>>;
}

/**
 * File the provider's entries under `./styles`, by kind.
 *
 * @param entries - What the registry read from the provider.
 * @returns The two option payloads an importer of `./styles` is handed.
 */
function registriesFor(entries: readonly CrossModuleRegistryEntry[]): ImporterRegistries {
    const objects: Record<string, Record<string, unknown>> = {};
    const configs: Record<string, Record<string, unknown>> = {};
    for (const entry of entries) {
        (entry.kind === 'sz-object' ? objects : configs)[entry.exportName] = entry.value;
    }
    return {
        crossModuleSzObjects: { './styles': objects },
        crossModuleStatics: { './styles': configs },
    };
}

/**
 * The className an emit carries, if it carries a static one.
 *
 * @param code - Emitted module.
 * @returns The static className, or undefined when the site stayed at runtime.
 */
function classNameOf(code: string | undefined): string | undefined {
    return /className="([^"]*)"/.exec(code ?? '')?.[1];
}

/** Provider bodies whose exported `card` compiles when written locally. */
const OBJECT_SHAPES: ReadonlyArray<readonly [string, string, string]> = [
    ['a plain literal', 'export const card = { p: 4 };', 'p-4'],
    ['a const reference', 'const S = 4;\nexport const card = { p: S };', 'p-4'],
    ['a unary plus', 'export const card = { p: +4 };', 'p-4'],
    ['a template literal', 'export const card = { p: `4` };', 'p-4'],
    ['a null value', 'export const card = { p: 4, m: null };', 'p-4'],
    [
        'a spread of a local const',
        'const base = { m: 2 };\nexport const card = { ...base, p: 4 };',
        'm-2 p-4',
    ],
    ['a member read', 'const SIZES = { md: 4 };\nexport const card = { p: SIZES.md };', 'p-4'],
];

/**
 * The provider body with its export keyword removed, so `card` is local.
 *
 * @param provider - Provider module body.
 * @returns The same declarations, declared in the consuming file.
 */
function asLocal(provider: string): string {
    return provider.replace(/^export /gm, '');
}

/**
 * Compile `sz={card}` against a local declaration, then through the registry.
 *
 * @param engine - Artifact under test.
 * @param scanner - The same artifact's module-link scan.
 * @param provider - Provider module body exporting `card`.
 * @returns The local className and the importer's className.
 */
function bothWays(
    engine: ParityEngine,
    scanner: LinkScanner,
    provider: string,
): { local: string | undefined; imported: string | undefined } {
    const use = 'export const A = () => <div sz={card} />;';
    const local = engine(`${asLocal(provider)}\n${use}`, '/p/Local.tsx').code;
    const registries = registriesFor(entriesOf(scanner, provider));
    const imported = engine(
        `import { card } from './styles';\n${use}`,
        '/p/Card.tsx',
        registries,
    ).code;
    return { local: classNameOf(local), imported: classNameOf(imported) };
}

describe('an exported sz object qualifies iff the same literal compiles locally', () => {
    for (const [lane, engine, scanner] of lanes()) {
        it.each(OBJECT_SHAPES)(`${lane}: %s`, (_label, provider, expected) => {
            const { local, imported } = bothWays(engine, scanner, provider);
            // The local half is the reference; asserting it keeps the case from
            // passing vacuously if the local path ever stops compiling it.
            expect(local).toBe(expected);
            expect(imported).toBe(local);
        });

        it(`${lane}: refuses what the local path refuses`, () => {
            // A read of a binding the module reassigns is not a value the
            // build can know, here or locally.
            const { local, imported } = bothWays(
                engine,
                scanner,
                'let S = 4;\nS = 8;\nexport const card = { p: S };',
            );
            expect(local).toBeUndefined();
            expect(imported).toBeUndefined();
        });
    }
});

/**
 * szv configs for an exported factory `card`, with what `szr(card(...))`
 * collapses to locally. The local precompile reads literals only, so a config
 * reading a const stays at runtime there and must stay at runtime here.
 */
const SZV_SHAPES: ReadonlyArray<readonly [string, string, string | undefined]> = [
    [
        'a literal config',
        "{ base: { p: 4 }, variants: { tone: { a: { bg: 'red-500' } } } }",
        'p-4 bg-red-500',
    ],
    [
        'a config reading a const',
        "{ base: { p: PAD }, variants: { tone: { a: { bg: 'red-500' } } } }",
        undefined,
    ],
];

const SZV_PRELUDE = "import { szv } from '@csszyx/runtime';\nconst PAD = 4;\n";
const SZR_IMPORT = "import { szr } from '@csszyx/runtime';\n";
const SZR_USE = "export const cls = szr(card({ tone: 'a' }));";

/**
 * Whether an emit collapsed `szr(card(...))` to a static class string.
 *
 * @param code - Emitted module.
 * @returns The collapsed string, or undefined when the call stayed at runtime.
 */
function collapsedSzr(code: string | undefined): string | undefined {
    return /szr\("([^"]*)"\)/.exec(code ?? '')?.[1];
}

describe('an exported szv factory qualifies iff the same config precompiles locally', () => {
    for (const [lane, engine, scanner] of lanes()) {
        it.each(SZV_SHAPES)(`${lane}: %s`, (_label, config, expected) => {
            const provider = `${SZV_PRELUDE}export const card = szv(${config});`;
            const local = engine(
                `${SZR_IMPORT}${asLocal(provider)}\n${SZR_USE}`,
                '/p/Local.tsx',
            ).code;
            const registries = registriesFor(entriesOf(scanner, provider));
            const imported = engine(
                `${SZR_IMPORT}import { card } from './styles';\n${SZR_USE}`,
                '/p/Card.tsx',
                registries,
            ).code;
            expect(collapsedSzr(local)).toBe(expected);
            expect(collapsedSzr(imported)).toBe(collapsedSzr(local));
        });
    }
});

describe('the bundler entry point', () => {
    it('answers what every artifact answers', () => {
        // `extractCrossModuleRegistryEntries` reads through whichever artifact
        // the host runs; that answer must be the one each artifact gives.
        for (const [, provider] of OBJECT_SHAPES) {
            const expected = extractCrossModuleRegistryEntries(provider, '/p/styles.ts');
            expect(expected).toHaveLength(1);
            for (const [lane, , scanner] of lanes()) {
                expect(entriesOf(scanner, provider), `${lane}: ${provider}`).toEqual(expected);
            }
        }
    });
});
