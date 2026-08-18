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

    it('resolves nothing when the forward leaves the project', () => {
        const root = projectWith({ 'src/index.ts': "export { LAYER } from 'some-package';\n" });

        expect(
            resolve(root, "import { LAYER } from '../index';\n").statics.szObjects,
        ).toBeUndefined();
    });
});
