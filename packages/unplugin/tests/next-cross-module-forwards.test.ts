/**
 * Following a barrel on the Turbopack lane.
 *
 * This lane has no prescan and no registry: it is handed one file and reads
 * providers from disk on demand. A re-export therefore has to be followed by
 * reading further files mid-resolution, which the prescan lane never does — and
 * every file read that way is a file whose edit must invalidate this importer,
 * so it has to come back in `providers` exactly like a directly named one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearNextAliasCache, resolveNextCrossModule } from '../src/next-cross-module.js';

const roots: string[] = [];

/**
 * Write a throwaway project and return its root.
 *
 * @param files - Project-relative path to contents.
 * @returns The root directory.
 */
function projectWith(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-next-fwd-'));
    roots.push(root);
    for (const [name, contents] of Object.entries(files)) {
        const target = join(root, name);
        mkdirSync(join(target, '..'), { recursive: true });
        writeFileSync(target, contents);
    }
    return root;
}

/**
 * Resolve one importer against a project.
 *
 * @param root - Project root.
 * @param source - Importer source text.
 * @returns The resolution.
 */
function resolve(root: string, source: string) {
    return resolveNextCrossModule({
        root,
        filename: join(root, 'src/ui/Card.tsx'),
        source,
        importedStaticSz: true,
    });
}

beforeEach(() => {
    clearNextAliasCache();
});

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('a barrel on the Turbopack lane', () => {
    it('resolves the value its provider declares', () => {
        const root = projectWith({
            'src/styles.ts': 'export const cardSz = { p: 7 };\n',
            'src/index.ts': "export { cardSz } from './styles';\n",
        });

        const resolved = resolve(root, "import { cardSz } from '../index';\n");

        expect(resolved.statics.szObjects?.['../index']?.cardSz).toEqual({ p: 7 });
    });

    it('declares the module it followed through, not only the one named', () => {
        // The importer never mentions `styles.ts`, so nothing else would put it
        // in the watch set — and an edit there changes what this file compiles
        // to. Missing it is a stale-output bug that only shows up on the second
        // build.
        const root = projectWith({
            'src/styles.ts': 'export const cardSz = { p: 7 };\n',
            'src/index.ts': "export { cardSz } from './styles';\n",
        });

        const resolved = resolve(root, "import { cardSz } from '../index';\n");

        expect(resolved.providers).toContain(join(root, 'src/styles.ts'));
        expect(resolved.providers).toContain(join(root, 'src/index.ts'));
    });

    it('follows a chain of barrels', () => {
        const root = projectWith({
            'src/tokens/layers.ts': 'export const LAYER = { z: 10 };\n',
            'src/tokens/index.ts': "export { LAYER } from './layers';\n",
            'src/index.ts': "export { LAYER } from './tokens';\n",
        });

        const resolved = resolve(root, "import { LAYER } from '../index';\n");

        expect(resolved.statics.szObjects?.['../index']?.LAYER).toEqual({ z: 10 });
        expect(resolved.providers).toContain(join(root, 'src/tokens/layers.ts'));
    });

    it('terminates on a cycle between two barrels', () => {
        const root = projectWith({
            'src/a.ts': "export { LAYER } from './b';\n",
            'src/b.ts': "export { LAYER } from './a';\n",
        });

        expect(resolve(root, "import { LAYER } from '../a';\n").statics.szObjects).toBeUndefined();
    });

    it('keeps a value the barrel declares itself', () => {
        const root = projectWith({
            'src/styles.ts': 'export const cardSz = { p: 7 };\n',
            'src/index.ts': "export { cardSz } from './styles';\nexport const rowSz = { m: 2 };\n",
        });

        const objects = resolve(root, "import { cardSz } from '../index';\n").statics.szObjects;

        expect(objects?.['../index']).toEqual({ cardSz: { p: 7 }, rowSz: { m: 2 } });
    });

    it('stops when the chain outruns the hop limit', () => {
        // Depth is capped on this lane too, and it must be the SAME cap: a
        // chain that folds under the prescan and falls back under Turbopack
        // would ship different CSS for the same source.
        const files: Record<string, string> = {
            'src/h0.ts': 'export const LAYER = { z: 10 };\n',
        };
        for (let hop = 1; hop <= 12; hop += 1) {
            files[`src/h${hop}.ts`] = `export { LAYER } from './h${hop - 1}';\n`;
        }
        const root = projectWith(files);

        expect(
            resolve(root, "import { LAYER } from '../h3';\n").statics.szObjects?.['../h3']?.LAYER,
        ).toEqual({ z: 10 });
        expect(
            resolve(root, "import { LAYER } from '../h12';\n").statics.szObjects,
        ).toBeUndefined();
    });

    it('resolves nothing when the provider does not export that name', () => {
        const root = projectWith({
            'src/styles.ts': 'export const other = { p: 7 };\n',
            'src/index.ts': "export { cardSz } from './styles';\n",
        });

        expect(
            resolve(root, "import { cardSz } from '../index';\n").statics.szObjects,
        ).toBeUndefined();
    });

    it('resolves each name of a multi-link barrel through its own link', () => {
        const root = projectWith({
            'src/pad.ts': 'export const padSz = { p: 4 };\n',
            'src/gap.ts': 'export const gapSz = { gap: 2 };\n',
            'src/index.ts': "export { padSz } from './pad';\nexport { gapSz } from './gap';\n",
        });

        expect(
            resolve(root, "import { padSz, gapSz } from '../index';\n").statics.szObjects?.[
                '../index'
            ],
        ).toEqual({ padSz: { p: 4 }, gapSz: { gap: 2 } });
    });

    it('lets a name the barrel declares win over a link of the same name', () => {
        const root = projectWith({
            'src/styles.ts': 'export const cardSz = { p: 7 };\n',
            'src/index.ts': "export { cardSz } from './styles';\nexport const cardSz = { m: 9 };\n",
        });

        expect(
            resolve(root, "import { cardSz } from '../index';\n").statics.szObjects?.['../index'],
        ).toEqual({ cardSz: { m: 9 } });
    });

    it('reads a provider once when two specifiers reach it', () => {
        // Two barrels forwarding to one module: the second walk must answer
        // from the cache rather than parse the file again.
        const root = projectWith({
            'src/styles.ts': 'export const cardSz = { p: 7 };\n',
            'src/one.ts': "export { cardSz } from './styles';\n",
            'src/two.ts': "export { cardSz as card } from './styles';\n",
        });

        const resolved = resolve(
            root,
            "import { cardSz } from '../one';\nimport { card } from '../two';\n",
        );

        expect(resolved.statics.szObjects?.['../one']?.cardSz).toEqual({ p: 7 });
        expect(resolved.statics.szObjects?.['../two']?.card).toEqual({ p: 7 });
    });

    it('follows a link written through a tsconfig alias', () => {
        // A `paths` entry may offer several candidate roots, so the walk has to
        // keep probing past the ones that hold nothing rather than stop at the
        // first miss — otherwise the alias resolves only when its first
        // candidate happens to be the right one.
        const root = projectWith({
            'app/tokens.ts': 'export const cardSz = { p: 7 };\n',
            'app/index.ts': "export { cardSz } from '@/app/tokens';\n",
            'tsconfig.json': JSON.stringify({
                compilerOptions: { paths: { '@/*': ['./missing/*', './*'] } },
            }),
        });

        const resolved = resolveNextCrossModule({
            root,
            filename: join(root, 'app/ui/page.tsx'),
            source: "import { cardSz } from '../index';\n",
            importedStaticSz: true,
        });

        expect(resolved.statics.szObjects?.['../index']?.cardSz).toEqual({ p: 7 });
        expect(resolved.providers).toContain(join(root, 'app/tokens.ts'));
    });

    it('resolves nothing when the forward leaves the project', () => {
        const root = projectWith({ 'src/index.ts': "export { LAYER } from 'some-package';\n" });

        expect(
            resolve(root, "import { LAYER } from '../index';\n").statics.szObjects,
        ).toBeUndefined();
    });
});
