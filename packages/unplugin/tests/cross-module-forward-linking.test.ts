/**
 * Following a re-export to the module that declares the value.
 *
 * The extractor reads one module at a time, so a barrel — which exports names
 * it does not declare — could only ever contribute links. This is the pass that
 * turns a link into the value, against a registry that has read the provider
 * too, and it is where the hazards of doing so live: a chain of barrels, a
 * cycle between them, and a link that points at nothing.
 *
 * Resolution is deliberately the SAME probe list the direct lookup uses. A
 * forward that landed on a different file than a direct import of the same
 * specifier would make one module's value depend on which route reached it.
 */
import { describe, expect, it } from 'vitest';

import {
    type CrossModuleForwardIndex,
    recordCrossModuleForwards,
    recordSzObjectRegistryFile,
    recordSzvRegistryFile,
    resolveCrossModuleStaticsFor,
    type SzvCrossModuleRegistry,
} from '../src/cross-module-registry.js';

/** A registry plus its forward index, built together as the prescan builds them. */
interface Project {
    registry: SzvCrossModuleRegistry;
    forwards: CrossModuleForwardIndex;
}

/**
 * Build a project from path-to-source pairs, recording both kinds and forwards.
 *
 * @param files - Absolute path to module source.
 * @returns The registry and forward index.
 */
function project(files: Record<string, string>): Project {
    const registry: SzvCrossModuleRegistry = new Map();
    const forwards: CrossModuleForwardIndex = new Map();
    for (const [filePath, content] of Object.entries(files)) {
        recordSzvRegistryFile(registry, filePath, content);
        recordSzObjectRegistryFile(registry, filePath, content);
        recordCrossModuleForwards(forwards, filePath, content);
    }
    return { registry, forwards };
}

/**
 * Resolve what one importer sees, through the forward index.
 *
 * @param built - The project.
 * @param filename - Importing file path.
 * @param source - Importing file text.
 * @returns The specifier-keyed sz objects.
 */
function szObjectsFor(built: Project, filename: string, source: string) {
    return resolveCrossModuleStaticsFor(built.registry, filename, source, [], built.forwards)
        .szObjects;
}

describe('a barrel that re-exports a value', () => {
    it('resolves the value the provider declares', () => {
        const built = project({
            '/app/src/styles.ts': 'export const cardSz = { p: 4 };',
            '/app/src/index.ts': "export { cardSz } from './styles';",
        });

        expect(
            szObjectsFor(built, '/app/src/ui/Card.tsx', "import { cardSz } from '../index';"),
        ).toEqual({ '../index': { cardSz: { p: 4 } } });
    });

    it('files the value under the name the barrel exports, not the provider name', () => {
        const built = project({
            '/app/src/styles.ts': 'export const cardSz = { p: 4 };',
            '/app/src/index.ts': "export { cardSz as card } from './styles';",
        });

        expect(
            szObjectsFor(built, '/app/src/ui/Card.tsx', "import { card } from '../index';"),
        ).toEqual({ '../index': { card: { p: 4 } } });
    });

    it('resolves the two-statement form the same way', () => {
        const built = project({
            '/app/src/styles.ts': 'export const cardSz = { p: 4 };',
            '/app/src/index.ts': "import { cardSz } from './styles';\nexport { cardSz };",
        });

        expect(
            szObjectsFor(built, '/app/src/ui/Card.tsx', "import { cardSz } from '../index';"),
        ).toEqual({ '../index': { cardSz: { p: 4 } } });
    });

    it('carries an szv config through, still tagged as a config', () => {
        const built = project({
            '/app/src/styles.ts':
                'export const cardSz = szv({ base: { p: 4 }, variants: { s: { lg: { m: 8 } } } });',
            '/app/src/index.ts': "export { cardSz } from './styles';",
        });
        const resolved = resolveCrossModuleStaticsFor(
            built.registry,
            '/app/src/ui/Card.tsx',
            "import { cardSz } from '../index';",
            [],
            built.forwards,
        );

        expect(resolved.szvConfigs?.['../index']?.cardSz).toEqual({
            base: { p: 4 },
            variants: { s: { lg: { m: 8 } } },
        });
        expect(resolved.szObjects).toBeUndefined();
    });

    it('resolves the provider default slot', () => {
        const built = project({
            '/app/src/styles.ts': 'export default { p: 4 };',
            '/app/src/index.ts': "export { default as card } from './styles';",
        });

        expect(
            szObjectsFor(built, '/app/src/ui/Card.tsx', "import { card } from '../index';"),
        ).toEqual({ '../index': { card: { p: 4 } } });
    });

    it('keeps a value the barrel declares itself alongside one it forwards', () => {
        const built = project({
            '/app/src/styles.ts': 'export const cardSz = { p: 4 };',
            '/app/src/index.ts':
                "export { cardSz } from './styles';\nexport const rowSz = { m: 2 };",
        });

        expect(
            szObjectsFor(built, '/app/src/ui/Card.tsx', "import { cardSz } from '../index';"),
        ).toEqual({ '../index': { cardSz: { p: 4 }, rowSz: { m: 2 } } });
    });
});

describe('chains and their limits', () => {
    it('follows a barrel that re-exports another barrel', () => {
        const built = project({
            '/app/src/tokens/layers.ts': 'export const LAYER = { z: 10 };',
            '/app/src/tokens/index.ts': "export { LAYER } from './layers';",
            '/app/src/index.ts': "export { LAYER } from './tokens';",
        });

        expect(
            szObjectsFor(built, '/app/src/ui/Bar.tsx', "import { LAYER } from '../index';"),
        ).toEqual({ '../index': { LAYER: { z: 10 } } });
    });

    it('terminates on a cycle instead of resolving forever', () => {
        // Two barrels forwarding to each other is a real thing to write, and it
        // is the shape that turns a naive follow into a hang.
        //
        // The unrelated value matters: with nothing declared anywhere the
        // resolver short-circuits on an empty registry and the walk never runs,
        // so the test would pass without ever reaching the cycle guard.
        const built = project({
            '/app/src/other.ts': 'export const other = { p: 1 };',
            '/app/src/a.ts': "export { LAYER } from './b';",
            '/app/src/b.ts': "export { LAYER } from './a';",
        });

        expect(
            szObjectsFor(built, '/app/src/ui/Bar.tsx', "import { LAYER } from '../a';"),
        ).toBeUndefined();
    });

    it('resolves nothing when the chain outruns the hop limit', () => {
        // Depth is capped rather than trusted: a generated barrel tree is
        // finite but need not be short, and the cost is paid per importer.
        const files: Record<string, string> = {
            '/app/src/h0.ts': 'export const LAYER = { z: 10 };',
        };
        for (let hop = 1; hop <= 12; hop += 1) {
            files[`/app/src/h${hop}.ts`] = `export { LAYER } from './h${hop - 1}';`;
        }
        const built = project(files);

        expect(szObjectsFor(built, '/app/src/ui/A.tsx', "import { LAYER } from '../h3';")).toEqual({
            '../h3': { LAYER: { z: 10 } },
        });
        expect(
            szObjectsFor(built, '/app/src/ui/A.tsx', "import { LAYER } from '../h12';"),
        ).toBeUndefined();
    });
});

describe('a forward that answers nothing', () => {
    it('resolves nothing when the provider is outside the registry', () => {
        // The unrelated value keeps the registry non-empty, so the specifier is
        // really walked and found wanting rather than skipped wholesale.
        const built = project({
            '/app/src/other.ts': 'export const other = { p: 1 };',
            '/app/src/index.ts': "export { LAYER } from 'some-package';",
        });

        expect(
            szObjectsFor(built, '/app/src/ui/Bar.tsx', "import { LAYER } from '../index';"),
        ).toBeUndefined();
    });

    it('resolves nothing when the provider does not export that name', () => {
        const built = project({
            '/app/src/styles.ts': 'export const other = { p: 4 };',
            '/app/src/index.ts': "export { cardSz } from './styles';",
        });

        expect(
            szObjectsFor(built, '/app/src/ui/Card.tsx', "import { cardSz } from '../index';"),
        ).toEqual(undefined);
    });

    it('resolves nothing when the provider value is not static', () => {
        const built = project({
            '/app/src/styles.ts': 'export const cardSz = makeStyles();',
            '/app/src/index.ts': "export { cardSz } from './styles';",
        });

        expect(
            szObjectsFor(built, '/app/src/ui/Card.tsx', "import { cardSz } from '../index';"),
        ).toBeUndefined();
    });

    it('still records nothing for `export *`', () => {
        // Out of scope on purpose: a star names no export, so it cannot be
        // filed under one without reading the provider's whole export list.
        const built = project({
            '/app/src/styles.ts': 'export const cardSz = { p: 4 };',
            '/app/src/index.ts': "export * from './styles';",
        });

        expect(
            szObjectsFor(built, '/app/src/ui/Card.tsx', "import { cardSz } from '../index';"),
        ).toBeUndefined();
    });
});

describe('a barrel with more than one link', () => {
    it('resolves each name through its own link', () => {
        const built = project({
            '/app/src/pad.ts': 'export const padSz = { p: 4 };',
            '/app/src/gap.ts': 'export const gapSz = { gap: 2 };',
            '/app/src/index.ts': "export { padSz } from './pad';\nexport { gapSz } from './gap';",
        });

        expect(
            szObjectsFor(built, '/app/src/ui/Card.tsx', "import { padSz, gapSz } from '../index';"),
        ).toEqual({ '../index': { padSz: { p: 4 }, gapSz: { gap: 2 } } });
    });

    it('lets a name the barrel declares win over a link of the same name', () => {
        // Malformed input, but the resolver has to pick one answer rather than
        // depend on which pass ran last. The declaration is the value the
        // module actually holds.
        const built = project({
            '/app/src/styles.ts': 'export const cardSz = { p: 4 };',
            '/app/src/index.ts':
                "export { cardSz } from './styles';\nexport const cardSz = { m: 9 };",
        });

        expect(
            szObjectsFor(built, '/app/src/ui/Card.tsx', "import { cardSz } from '../index';"),
        ).toEqual({ '../index': { cardSz: { m: 9 } } });
    });

    it('picks the right link when the module it points at has several', () => {
        // Reached through ANOTHER barrel, so the lookup has to search the inner
        // module's links by name rather than take the first one.
        const built = project({
            '/app/src/pad.ts': 'export const padSz = { p: 4 };',
            '/app/src/gap.ts': 'export const gapSz = { gap: 2 };',
            '/app/src/inner.ts': "export { padSz } from './pad';\nexport { gapSz } from './gap';",
            '/app/src/index.ts': "export { gapSz } from './inner';",
        });

        expect(
            szObjectsFor(built, '/app/src/ui/Card.tsx', "import { gapSz } from '../index';"),
        ).toEqual({ '../index': { gapSz: { gap: 2 } } });
    });

    it('resolves a link written through a project alias', () => {
        // An alias offers several candidate bases, so the walk has to keep
        // probing past the ones that match nothing.
        const built = project({
            '/app/src/tokens.ts': 'export const cardSz = { p: 4 };',
            '/app/src/index.ts': "export { cardSz } from '@/tokens';",
        });
        const aliases = [
            { find: '@/', replacement: '/app/nowhere/', exact: false },
            { find: '@/', replacement: '/app/src/', exact: false },
        ];

        expect(
            resolveCrossModuleStaticsFor(
                built.registry,
                '/app/src/ui/Card.tsx',
                "import { cardSz } from '../index';",
                aliases,
                built.forwards,
            ).szObjects,
        ).toEqual({ '../index': { cardSz: { p: 4 } } });
    });
});

describe('what the forward index must not change', () => {
    it('leaves a direct import resolving exactly as before', () => {
        const built = project({ '/app/src/styles.ts': 'export const cardSz = { p: 4 };' });

        expect(
            szObjectsFor(built, '/app/src/ui/Card.tsx', "import { cardSz } from '../styles';"),
        ).toEqual({ '../styles': { cardSz: { p: 4 } } });
    });

    it('leaves a module that declares its exports free of forward entries', () => {
        const built = project({ '/app/src/styles.ts': 'export const cardSz = { p: 4 };' });

        expect(built.forwards.size).toBe(0);
    });

    it('evicts a forward when the module stops re-exporting', () => {
        const built = project({
            '/app/src/styles.ts': 'export const cardSz = { p: 4 };',
            '/app/src/index.ts': "export { cardSz } from './styles';",
        });
        recordCrossModuleForwards(built.forwards, '/app/src/index.ts', 'export const x = 1;');

        expect(built.forwards.size).toBe(0);
        expect(
            szObjectsFor(built, '/app/src/ui/Card.tsx', "import { cardSz } from '../index';"),
        ).toBeUndefined();
    });
});
