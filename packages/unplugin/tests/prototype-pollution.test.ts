/**
 * Names read out of somebody else's source cannot reach `Object.prototype`.
 *
 * The cross-module tables are keyed twice over by text the build did not write:
 * by the specifier as the importer spelled it, and by the name the provider
 * exported. Two of those names are not ordinary keys on an ordinary object.
 * Assigning `__proto__` REPLACES the object's prototype instead of adding a
 * property, and reading it answers with `Object.prototype` rather than nothing
 * — so a `??=` guard sees a value already there and the write that follows
 * lands on the prototype every object in the process shares.
 *
 * A dependency shipping one `export const __proto__` is enough, and a build
 * tool reads dependencies. Two defences answer that, and these cases hold both:
 * the name is refused before it can become a key, and the tables are built
 * without a prototype so a name nobody thought to refuse still has no setter to
 * trigger. Either alone would pass most of what follows; the canary assertions
 * fail loudly if both are ever dropped, which is a small edit away at every
 * call site.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    recordSzObjectRegistryFile,
    resolveCrossModuleStaticsFor,
    type SzvCrossModuleRegistry,
} from '../src/cross-module-registry.js';
import { clearNextAliasCache, resolveNextCrossModule } from '../src/next-cross-module.js';

const roots: string[] = [];

/** Anything a poisoned prototype would make appear on an unrelated object. */
const CANARY = 'csszyxPrototypeCanary';

afterEach(() => {
    clearNextAliasCache();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    // Undo a leak rather than let it bleed into the next file's assertions.
    delete (Object.prototype as Record<string, unknown>)[CANARY];
});

/**
 * A project whose provider exports the one name that is not a plain key.
 *
 * @returns The project root and its page path.
 */
function projectExportingProto(): { root: string; page: string } {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-proto-')));
    roots.push(root);
    mkdirSync(join(root, 'app'), { recursive: true });
    writeFileSync(
        join(root, 'app/styles.ts'),
        `export const __proto__ = { ${CANARY}: 'reached' };\n`,
    );
    return { root, page: join(root, 'app/page.tsx') };
}

describe('a provider exporting __proto__', () => {
    it('does not reach Object.prototype through the Turbopack lane', () => {
        const { root, page } = projectExportingProto();

        const resolved = resolveNextCrossModule({
            filename: page,
            source: "import { __proto__ } from './styles';\n",
            root,
            importedStaticSz: true,
        });

        expect(({} as Record<string, unknown>)[CANARY]).toBeUndefined();
        // Refused rather than recorded. The importer loses the precompile for
        // that one name and compiles it at runtime, which is what every module
        // csszyx cannot read statically already does.
        expect(resolved.statics.szObjects).toBeUndefined();
        // The provider is still declared to the watcher. Reading a file and
        // recording nothing from it is exactly the case that has to invalidate
        // this importer when the file later exports something usable.
        expect(resolved.providers).toHaveLength(1);
    });

    it('does not reach Object.prototype through the prescan registry', () => {
        const { root, page } = projectExportingProto();
        const registry: SzvCrossModuleRegistry = new Map();
        recordSzObjectRegistryFile(
            registry,
            join(root, 'app/styles.ts'),
            `export const __proto__ = { ${CANARY}: 'reached' };\n`,
        );

        const resolved = resolveCrossModuleStaticsFor(
            registry,
            page,
            "import { __proto__ } from './styles';\n",
        );

        expect(({} as Record<string, unknown>)[CANARY]).toBeUndefined();
        expect(resolved.szObjects).toBeUndefined();
    });

    it('does not take the whole module down with it', () => {
        // The refusal is per name, not per provider: a module exporting the
        // hazardous name alongside real ones keeps the real ones.
        const { root, page } = projectExportingProto();
        const registry: SzvCrossModuleRegistry = new Map();
        recordSzObjectRegistryFile(
            registry,
            join(root, 'app/styles.ts'),
            `export const __proto__ = { ${CANARY}: 'reached' };\nexport const cardSz = { p: 4 };\n`,
        );

        const resolved = resolveCrossModuleStaticsFor(
            registry,
            page,
            "import { cardSz } from './styles';\n",
        );

        expect(({} as Record<string, unknown>)[CANARY]).toBeUndefined();
        const slice = resolved.szObjects?.['./styles'];
        expect(slice && Object.keys(slice)).toEqual(['cardSz']);
        expect(slice && Object.getPrototypeOf(slice)).toBeNull();
    });
});

describe('an importer whose specifier is spelled __proto__', () => {
    it('files it as an ordinary key rather than through the prototype', () => {
        // The other half of the same hazard: the outer table is keyed by the
        // specifier too, so a module resolvable under that name would reach the
        // prototype through the OUTER write even with every export name clean.
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-proto-spec-')));
        roots.push(root);
        mkdirSync(join(root, 'app/__proto__'), { recursive: true });
        writeFileSync(
            join(root, 'app/__proto__/index.ts'),
            `export const cardSz = { ${CANARY}: 'reached' };\n`,
        );
        writeFileSync(
            join(root, 'tsconfig.json'),
            JSON.stringify({ compilerOptions: { paths: { '*': ['./app/*'] } } }),
        );

        const resolved = resolveNextCrossModule({
            filename: join(root, 'app/page.tsx'),
            source: "import { cardSz } from '__proto__';\n",
            root,
            importedStaticSz: true,
        });

        expect(({} as Record<string, unknown>)[CANARY]).toBeUndefined();
        expect(resolved.statics.szObjects).toBeUndefined();
    });
});
