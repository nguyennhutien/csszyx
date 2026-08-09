/**
 * Unit net for the cross-module registry's collection and resolution rules.
 *
 * The three-engine consumer and the extractor have their own suites in the
 * compiler package; what was untested was THIS layer — which files enter the
 * registry, and how a transformed file's import specifiers probe it. A wrong
 * probe here silently costs the optimization (safe direction), but a wrong
 * hit would feed a file a table for the wrong module, so the mapping rules
 * deserve their own lock.
 */
import { describe, expect, it } from 'vitest';
import {
    importedSpecifiersIn,
    mayExportSzvFactories,
    recordSzObjectRegistryFile,
    recordSzvRegistryFile,
    resolveCrossModuleStaticsFor,
    resolveProviderPath,
    type SzvCrossModuleRegistry,
    specifierBases,
} from '../src/cross-module-registry.js';

const STYLES_SOURCE =
    "import { szv } from '@csszyx/runtime';\n" +
    "export const cardSz = szv({ base: { rounded: 'lg' }, variants: { pad: { sm: { p: 2 } } } });\n" +
    'export const rowSz = szv({ variants: { gap: { tight: { gap: 1 } } } });\n';

/**
 * A registry pre-filled with one styles module.
 *
 * @param filePath - Where the styles module lives.
 * @returns The filled registry.
 */
function registryWith(filePath: string): SzvCrossModuleRegistry {
    const registry: SzvCrossModuleRegistry = new Map();
    recordSzvRegistryFile(registry, filePath, STYLES_SOURCE);
    return registry;
}

describe('mayExportSzvFactories', () => {
    // The prescan gate and the skipped-file report must ask the same question,
    // or the report claims a consequence the build did not have.
    it('needs both an szv call and an export marker', () => {
        expect(mayExportSzvFactories(STYLES_SOURCE)).toBe(true);
        expect(
            mayExportSzvFactories('const local = szv({ variants: { p: { a: { p: 1 } } } });'),
        ).toBe(false);
        expect(mayExportSzvFactories('export const x = 1;')).toBe(false);
    });
});

describe('recordSzvRegistryFile', () => {
    it('records every qualifying exported factory under the normalized path', () => {
        const registry = registryWith('/app/src/styles.ts');
        const entries = registry.get('/app/src/styles.ts');
        expect(entries).toBeDefined();
        expect(Object.keys(entries ?? {})).toEqual(['cardSz', 'rowSz']);
    });

    it('normalizes windows separators into the registry key', () => {
        const registry: SzvCrossModuleRegistry = new Map();
        recordSzvRegistryFile(registry, 'C:\\app\\src\\styles.ts', STYLES_SOURCE);
        expect(registry.has('C:/app/src/styles.ts')).toBe(true);
    });

    it('records nothing for files without qualifying factories', () => {
        const registry: SzvCrossModuleRegistry = new Map();
        recordSzvRegistryFile(registry, '/app/src/a.ts', 'export const x = 1;');
        recordSzvRegistryFile(
            registry,
            '/app/src/b.ts',
            "import { szv } from '@csszyx/runtime';\nconst local = szv({ variants: { p: { a: { p: 1 } } } });",
        );
        expect(registry.size).toBe(0);
    });
});

describe('resolveCrossModuleStaticsFor', () => {
    it('resolves a relative specifier through the extension probes', () => {
        const registry = registryWith('/app/src/styles.ts');
        const source = "import { cardSz } from './styles';\n";
        const resolved = resolveCrossModuleStaticsFor(registry, '/app/src/Card.tsx', source);
        expect(resolved).toBeDefined();
        expect(Object.keys(resolved.szvConfigs?.['./styles'] ?? {})).toEqual(['cardSz', 'rowSz']);
    });

    it.each([
        ['exact extension written out', './styles.ts', '/app/src/styles.ts'],
        ['tsx module', './panel', '/app/src/panel.tsx'],
        ['parent traversal', '../shared/styles', '/app/shared/styles.ts'],
        ['index file', './tokens', '/app/src/tokens/index.ts'],
        // Written with the EMITTED extension, which is how a `nodenext`
        // project spells every relative import.
        ['nodenext .js specifier', './styles.js', '/app/src/styles.ts'],
        ['nodenext .js specifier on a tsx module', './panel.js', '/app/src/panel.tsx'],
        ['nodenext .jsx specifier', './panel.jsx', '/app/src/panel.tsx'],
        ['nodenext .mjs specifier', './styles.mjs', '/app/src/styles.mts'],
        ['nodenext .cjs specifier', './styles.cjs', '/app/src/styles.cts'],
        ['nodenext index import', './tokens/index.js', '/app/src/tokens/index.ts'],
    ])('probes: %s', (_name, specifier, registryPath) => {
        const registry = registryWith(registryPath);
        const source = `import { cardSz } from '${specifier}';\n`;
        const resolved = resolveCrossModuleStaticsFor(registry, '/app/src/Card.tsx', source);
        expect(resolved.szvConfigs?.[specifier]).toBeDefined();
    });

    it('resolves a real .js module over its TypeScript twin', () => {
        // A JavaScript project's `./styles.js` is a file, not an emitted name.
        // The literal probe runs first, so the twin lookup never shadows it.
        const registry: SzvCrossModuleRegistry = new Map();
        recordSzvRegistryFile(registry, '/app/src/styles.js', STYLES_SOURCE);
        recordSzvRegistryFile(
            registry,
            '/app/src/styles.ts',
            "import { szv } from '@csszyx/runtime';\nexport const other = szv({ variants: { g: { a: { gap: 1 } } } });\n",
        );
        const resolved = resolveCrossModuleStaticsFor(
            registry,
            '/app/src/Card.tsx',
            "import { cardSz } from './styles.js';\n",
        );
        expect(Object.keys(resolved.szvConfigs?.['./styles.js'] ?? {})).toEqual([
            'cardSz',
            'rowSz',
        ]);
    });

    it('leaves an unknown emitted extension unresolved', () => {
        const registry = registryWith('/app/src/styles.ts');
        const source = "import { cardSz } from './styles.wasm';\n";
        expect(
            resolveCrossModuleStaticsFor(registry, '/app/src/Card.tsx', source).szvConfigs,
        ).toBeUndefined();
    });

    it('resolves no non-relative specifier without an alias table', () => {
        // The table is what makes a bare specifier mean anything. Absent one,
        // `pkg/styles` denotes no path at all rather than being resolved
        // against the importing file as if it were relative.
        const registry = registryWith('/app/node_modules/pkg/styles.ts');
        const source = "import { cardSz } from 'pkg/styles';\nimport { x } from '@alias/styles';\n";
        expect(
            resolveCrossModuleStaticsFor(registry, '/app/src/Card.tsx', source).szvConfigs,
        ).toBeUndefined();
    });

    it('resolves an aliased specifier through the same probes', () => {
        const registry = registryWith('/app/src/styles.ts');
        const aliases = [{ find: '@/', replacement: '/app/src/', exact: false }];
        const resolved = resolveCrossModuleStaticsFor(
            registry,
            '/app/src/ui/Card.tsx',
            "import { cardSz } from '@/styles';\n",
            aliases,
        );
        // Keyed by the specifier AS WRITTEN: the compiler looks the registry up
        // by the import's own source text, so an entry filed under the resolved
        // path would never be found.
        expect(Object.keys(resolved.szvConfigs?.['@/styles'] ?? {})).toEqual(['cardSz', 'rowSz']);
    });

    it('takes the first alias that answers and stops', () => {
        // Two candidates for one specifier is ordinary: tsconfig `paths` may
        // list several targets. Probing past a hit would merge two modules'
        // exports into one specifier's entry.
        const registry = registryWith('/app/src/styles.ts');
        recordSzvRegistryFile(
            registry,
            '/app/legacy/styles.ts',
            "import { szv } from '@csszyx/runtime';\nexport const legacySz = szv({ variants: { g: { a: { gap: 1 } } } });\n",
        );
        const resolved = resolveCrossModuleStaticsFor(
            registry,
            '/app/src/Card.tsx',
            "import { cardSz } from '@/styles';\n",
            [
                { find: '@/', replacement: '/app/src/', exact: false },
                { find: '@/', replacement: '/app/legacy/', exact: false },
            ],
        );
        expect(Object.keys(resolved.szvConfigs?.['@/styles'] ?? {})).toEqual(['cardSz', 'rowSz']);
    });

    it('honours an exact alias only on the whole specifier', () => {
        const registry = registryWith('/app/src/styles.ts');
        const aliases = [{ find: '@styles', replacement: '/app/src/styles', exact: true }];
        const hit = resolveCrossModuleStaticsFor(
            registry,
            '/app/src/Card.tsx',
            "import { cardSz } from '@styles';\n",
            aliases,
        );
        const miss = resolveCrossModuleStaticsFor(
            registry,
            '/app/src/Card.tsx',
            "import { cardSz } from '@styles/extra';\n",
            aliases,
        );
        expect(hit.szvConfigs?.['@styles']).toBeDefined();
        expect(miss.szvConfigs).toBeUndefined();
    });

    it('leaves an alias pointing nowhere as a miss, not an error', () => {
        // An over-broad alias is the expected failure mode of prefix matching.
        // It has to cost the optimization and nothing else — no throw, and no
        // entry invented for a module the prescan never walked.
        const registry = registryWith('/app/src/styles.ts');
        expect(
            resolveCrossModuleStaticsFor(
                registry,
                '/app/src/Card.tsx',
                "import { useState } from '@/react';\n",
                [{ find: '@/', replacement: '/app/src/', exact: false }],
            ).szvConfigs,
        ).toBeUndefined();
    });

    it('returns undefined when nothing matches, not an empty object', () => {
        const registry = registryWith('/app/src/styles.ts');
        const source = "import { other } from './elsewhere';\n";
        expect(
            resolveCrossModuleStaticsFor(registry, '/app/src/Card.tsx', source).szvConfigs,
        ).toBeUndefined();
    });

    it('resolves each specifier once and keeps distinct modules apart', () => {
        const registry = registryWith('/app/src/styles.ts');
        recordSzvRegistryFile(
            registry,
            '/app/src/rows.ts',
            "import { szv } from '@csszyx/runtime';\nexport const rowsOnly = szv({ variants: { g: { a: { gap: 2 } } } });\n",
        );
        const source =
            "import { cardSz } from './styles';\n" +
            "import { cardSz as again } from './styles';\n" +
            "import { rowsOnly } from './rows';\n";
        const resolved = resolveCrossModuleStaticsFor(registry, '/app/src/Card.tsx', source);
        expect(Object.keys(resolved.szvConfigs ?? {}).sort()).toEqual(['./rows', './styles']);
        expect(Object.keys(resolved.szvConfigs?.['./rows'] ?? {})).toEqual(['rowsOnly']);
    });

    it('short-circuits on an empty registry', () => {
        const registry: SzvCrossModuleRegistry = new Map();
        expect(
            resolveCrossModuleStaticsFor(registry, '/app/src/Card.tsx', "import x from './y';"),
        ).toEqual({});
    });
});

describe('registry staleness', () => {
    it('evicts a file that stops exporting a qualifying factory', () => {
        // Without the eviction, importers keep resolving a table the module no
        // longer exports — the same stale-registry class the watch-mode cut
        // guards against, reachable within one process via re-recording.
        const registry = registryWith('/app/src/styles.ts');
        expect(registry.size).toBe(1);
        recordSzvRegistryFile(registry, '/app/src/styles.ts', 'export const nothingHere = 1;\n');
        expect(registry.size).toBe(0);
        expect(
            resolveCrossModuleStaticsFor(
                registry,
                '/app/src/Card.tsx',
                "import { cardSz } from './styles';\n",
            ),
        ).toEqual({});
    });

    it('resolves mutually importing modules without recursing', () => {
        // Two files each importing the other's factory. Resolution reads the
        // prescan-built map and never follows an edge, so a cycle cannot
        // recurse by construction — pinned cheaply because "by construction"
        // stops being true the moment resolution learns to traverse.
        const registry: SzvCrossModuleRegistry = new Map();
        const aSource =
            "import { szv } from '@csszyx/runtime';\n" +
            "import { bSz } from './b';\n" +
            'export const aSz = szv({ variants: { pad: { sm: { p: 2 } } } });\n';
        const bSource =
            "import { szv } from '@csszyx/runtime';\n" +
            "import { aSz } from './a';\n" +
            'export const bSz = szv({ variants: { gap: { tight: { gap: 1 } } } });\n';
        recordSzvRegistryFile(registry, '/app/src/a.ts', aSource);
        recordSzvRegistryFile(registry, '/app/src/b.ts', bSource);

        expect(
            Object.keys(
                resolveCrossModuleStaticsFor(registry, '/app/src/a.ts', aSource).szvConfigs ?? {},
            ),
        ).toEqual(['./b']);
        expect(
            Object.keys(
                resolveCrossModuleStaticsFor(registry, '/app/src/b.ts', bSource).szvConfigs ?? {},
            ),
        ).toEqual(['./a']);
    });

    it('evicts when the factory no longer parses as a static config', () => {
        const registry = registryWith('/app/src/styles.ts');
        recordSzvRegistryFile(
            registry,
            '/app/src/styles.ts',
            "import { szv } from '@csszyx/runtime';\nexport const cardSz = szv(makeConfig());\n",
        );
        expect(registry.size).toBe(0);
    });
});

describe('the sz-object arm of the registry', () => {
    const PLAIN_SOURCE =
        "export const cardSz = { p: 4, rounded: 'lg' };\nexport const rowSz = { gap: 2 };\n";

    it('records exported static objects under the normalized path', () => {
        const registry: SzvCrossModuleRegistry = new Map();
        recordSzObjectRegistryFile(registry, '/app/src/styles.ts', PLAIN_SOURCE);
        expect(Object.keys(registry.get('/app/src/styles.ts') ?? {})).toEqual(['cardSz', 'rowSz']);
    });

    it('resolves the two kinds into their own channels', () => {
        // One module can export both. They must arrive apart, because an szv
        // config is a table to compile and an sz object is a value to lower —
        // handing either to the other's machinery would compile nonsense.
        const registry: SzvCrossModuleRegistry = new Map();
        recordSzvRegistryFile(registry, '/app/src/styles.ts', STYLES_SOURCE);
        recordSzObjectRegistryFile(
            registry,
            '/app/src/styles.ts',
            `${STYLES_SOURCE}export const plainSz = { m: 2 };\n`,
        );
        const resolved = resolveCrossModuleStaticsFor(
            registry,
            '/app/src/Card.tsx',
            "import { cardSz, plainSz } from './styles';\n",
        );
        expect(Object.keys(resolved.szvConfigs?.['./styles'] ?? {})).toEqual(['cardSz', 'rowSz']);
        expect(resolved.szObjects?.['./styles']).toEqual({ plainSz: { m: 2 } });
    });

    it('lets each pass evict only its own kind', () => {
        // The two are recorded at different times, so neither may clear the
        // other: a factory that stops qualifying must lose its entry without
        // taking the module's plain objects with it.
        const registry: SzvCrossModuleRegistry = new Map();
        recordSzvRegistryFile(registry, '/app/src/styles.ts', STYLES_SOURCE);
        recordSzObjectRegistryFile(registry, '/app/src/styles.ts', PLAIN_SOURCE);
        expect(Object.keys(registry.get('/app/src/styles.ts') ?? {})).toEqual(['cardSz', 'rowSz']);

        recordSzvRegistryFile(registry, '/app/src/styles.ts', 'export const nothing = 1;\n');
        const left = registry.get('/app/src/styles.ts') ?? {};
        expect(Object.keys(left)).toEqual(['cardSz', 'rowSz']);
        expect(Object.values(left).every(entry => entry.kind === 'sz-object')).toBe(true);
    });

    it('records nothing for a barrel that only re-exports', () => {
        // A barrel is the shape most likely to be mistaken for support: the
        // name IS exported from the module the importer names, just not
        // declared there. Recording the specifier with no value would be worse
        // than recording nothing — the importer would resolve an entry that
        // describes no object. Following the chain is out of v1 scope, so the
        // safe answer is an absent entry and the runtime path.
        const registry: SzvCrossModuleRegistry = new Map();
        recordSzObjectRegistryFile(
            registry,
            '/app/src/styles.ts',
            'export const cardSz = { p: 4 };',
        );
        recordSzObjectRegistryFile(
            registry,
            '/app/src/index.ts',
            "export { cardSz } from './styles';",
        );
        recordSzObjectRegistryFile(registry, '/app/src/star.ts', "export * from './styles';");
        expect([...registry.keys()]).toEqual(['/app/src/styles.ts']);
        expect(
            resolveCrossModuleStaticsFor(
                registry,
                '/app/src/ui/Card.tsx',
                "import { cardSz } from '../index';\n",
            ),
        ).toEqual({});
    });

    it('drops the file only when both kinds are gone', () => {
        const registry: SzvCrossModuleRegistry = new Map();
        recordSzObjectRegistryFile(registry, '/app/src/styles.ts', PLAIN_SOURCE);
        expect(registry.size).toBe(1);
        recordSzObjectRegistryFile(registry, '/app/src/styles.ts', 'export const nothing = 1;\n');
        expect(registry.size).toBe(0);
    });
});

describe('the demand-driven provider lookup', () => {
    it('reads every specifier a file imports from', () => {
        const source =
            "import { a } from './styles';\nimport b from '../shared/tokens.js';\n" +
            "import c from 'react';\n";
        // Package specifiers are collected but denote nothing without an alias
        // that claims them — the filtering happens in `specifierBases`, so that
        // one rule serves both the demand pass and the lookup.
        expect(importedSpecifiersIn(source)).toEqual(['./styles', '../shared/tokens.js', 'react']);
        expect(importedSpecifiersIn('const x = 1;')).toEqual([]);
        expect(specifierBases('react', '/app/src', [])).toEqual([]);
    });

    it('lands on the same file the registry lookup would', () => {
        // Both walk one probe list. If they disagreed, a provider would be
        // recorded under a path no consumer ever probes — the optimization
        // would go missing with nothing to show for it.
        const seen = new Set([
            '/app/src/styles.ts',
            '/app/src/panel.tsx',
            '/app/src/tokens/index.ts',
        ]);
        expect(resolveProviderPath(seen, '/app/src/styles')).toBe('/app/src/styles.ts');
        expect(resolveProviderPath(seen, '/app/src/styles.js')).toBe('/app/src/styles.ts');
        expect(resolveProviderPath(seen, '/app/src/panel')).toBe('/app/src/panel.tsx');
        expect(resolveProviderPath(seen, '/app/src/tokens')).toBe('/app/src/tokens/index.ts');
        expect(resolveProviderPath(seen, '/app/src/missing')).toBeUndefined();
    });
});
