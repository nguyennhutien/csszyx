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
    recordSzvRegistryFile,
    resolveCrossModuleStaticsFor,
    type SzvCrossModuleRegistry,
} from '../src/szv-registry.js';

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
        expect(Object.keys(resolved?.['./styles'] ?? {})).toEqual(['cardSz', 'rowSz']);
    });

    it.each([
        ['exact extension written out', './styles.ts', '/app/src/styles.ts'],
        ['tsx module', './panel', '/app/src/panel.tsx'],
        ['parent traversal', '../shared/styles', '/app/shared/styles.ts'],
        ['index file', './tokens', '/app/src/tokens/index.ts'],
    ])('probes: %s', (_name, specifier, registryPath) => {
        const registry = registryWith(registryPath);
        const source = `import { cardSz } from '${specifier}';\n`;
        const resolved = resolveCrossModuleStaticsFor(registry, '/app/src/Card.tsx', source);
        expect(resolved?.[specifier]).toBeDefined();
    });

    it('never resolves package or aliased specifiers', () => {
        const registry = registryWith('/app/node_modules/pkg/styles.ts');
        const source = "import { cardSz } from 'pkg/styles';\nimport { x } from '@alias/styles';\n";
        expect(resolveCrossModuleStaticsFor(registry, '/app/src/Card.tsx', source)).toBeUndefined();
    });

    it('returns undefined when nothing matches, not an empty object', () => {
        const registry = registryWith('/app/src/styles.ts');
        const source = "import { other } from './elsewhere';\n";
        expect(resolveCrossModuleStaticsFor(registry, '/app/src/Card.tsx', source)).toBeUndefined();
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
        expect(Object.keys(resolved ?? {}).sort()).toEqual(['./rows', './styles']);
        expect(Object.keys(resolved?.['./rows'] ?? {})).toEqual(['rowsOnly']);
    });

    it('short-circuits on an empty registry', () => {
        const registry: SzvCrossModuleRegistry = new Map();
        expect(
            resolveCrossModuleStaticsFor(registry, '/app/src/Card.tsx', "import x from './y';"),
        ).toBeUndefined();
    });
});
