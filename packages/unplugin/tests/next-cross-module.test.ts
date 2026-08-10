/**
 * Cross-module resolution on the Turbopack lane.
 *
 * Every other lane resolves against a registry a whole-project prescan built.
 * This one has no prescan: it is handed one file and reads the providers from
 * disk itself. That inversion is the thing under test — the same specifier has
 * to land on the same file it would have on the other lanes, and every file it
 * read has to come back so the caller can declare it to the watcher.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_IMPORTED_STATIC_SZ } from '@csszyx/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    clearNextAliasCache,
    configWithImportedStaticSz,
    resolveNextCrossModule,
    withCrossModuleStatics,
} from '../src/next-cross-module.js';

const roots: string[] = [];

const SZ_OBJECT = "export const cardSz = { p: 7, tracking: 'widest' };\n";
const SZV_FACTORY =
    "import { szv } from '@csszyx/runtime';\n" +
    'export const rowSz = szv({ variants: { gap: { tight: { gap: 1 } } } });\n';

/**
 * Write a throwaway project and return its root.
 *
 * @param files - Project-relative path to contents.
 * @returns The root directory.
 */
function projectWith(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-next-xmod-'));
    roots.push(root);
    for (const [name, contents] of Object.entries(files)) {
        const target = join(root, name);
        mkdirSync(join(target, '..'), { recursive: true });
        writeFileSync(target, contents);
    }
    return root;
}

beforeEach(() => {
    // The table is cached per root, and every case builds a new one.
    clearNextAliasCache();
});

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('the setting an unset lane resolves to', () => {
    it('compiles an imported object when nothing configures it', () => {
        // The default is what almost every project runs, and it is the one
        // configuration no explicit-value test can cover. Left unpinned, a lane
        // that forgot the shared fallback would read `undefined` as off and
        // quietly stop compiling for everyone who never set it.
        const root = projectWith({ 'app/styles.ts': SZ_OBJECT });
        const resolved = resolveNextCrossModule({
            filename: join(root, 'app/page.tsx'),
            source: "import { cardSz } from './styles';\n",
            root,
        });

        expect(resolved.statics.szObjects?.['./styles']).toBeDefined();
    });

    it('folds the resolved value into the identity config, not the raw option', () => {
        // The loader and the prebuild reach this from different processes. If
        // an unset option contributed nothing, one lane turned off and one
        // left alone would hash the SAME and emit different output — the exact
        // drift the hash gate exists to catch.
        expect(configWithImportedStaticSz({}, undefined)).toEqual({
            importedStaticSz: DEFAULT_IMPORTED_STATIC_SZ,
        });
        expect(configWithImportedStaticSz({}, false)).toEqual({ importedStaticSz: false });
        expect(configWithImportedStaticSz({}, true)).toEqual({ importedStaticSz: true });
    });
});

describe('the shapes withCrossModuleStatics has to keep apart', () => {
    it('leaves the options untouched when nothing resolved', () => {
        const options = { rootDir: '/app' };
        expect(withCrossModuleStatics(options, {})).toBe(options);
    });

    it.each([
        ['szv configs only', { szvConfigs: { './s': { rowSz: {} } } }, 'crossModuleStatics'],
        ['sz objects only', { szObjects: { './s': { cardSz: {} } } }, 'crossModuleSzObjects'],
    ])('carries %s under its own key, and only that key', (_name, statics, expected) => {
        // The two channels ride separately all the way to the engines, which do
        // different things with them: a variant table to compile and pick from,
        // a value to lower. Folding an absent one in as an empty object would
        // put it in the cache key and tell the decoder to validate nothing.
        const merged = withCrossModuleStatics(undefined, statics) as Record<string, unknown>;
        expect(Object.keys(merged)).toEqual([expected]);
    });
});

describe('resolving one file against the disk', () => {
    it('reads a relative provider and reports it as a dependency', () => {
        const root = projectWith({ 'app/styles.ts': SZ_OBJECT });
        const resolved = resolveNextCrossModule({
            filename: join(root, 'app/page.tsx'),
            source: "import { cardSz } from './styles';\n",
            root,
            importedStaticSz: true,
        });

        expect(resolved.statics.szObjects?.['./styles']).toEqual({
            cardSz: { p: 7, tracking: 'widest' },
        });
        // Without this the loader cannot register the file, and an edit to the
        // style module would leave every importer compiled against the value
        // it used to have — the reason this lane refused the feature before.
        expect(resolved.providers).toEqual([join(root, 'app/styles.ts')]);
    });

    it('reads a provider named through the tsconfig alias', () => {
        // The alias source Next actually uses: `@/*` lives in tsconfig, and
        // Turbopack never hands the loader a webpack-style alias table.
        const root = projectWith({
            'app/styles.ts': SZ_OBJECT,
            'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } }),
        });
        const resolved = resolveNextCrossModule({
            filename: join(root, 'app/ui/page.tsx'),
            source: "import { cardSz } from '@/app/styles';\n",
            root,
            importedStaticSz: true,
        });

        expect(Object.keys(resolved.statics.szObjects?.['@/app/styles'] ?? {})).toEqual(['cardSz']);
    });

    it('resolves an szv factory even with sz objects turned off', () => {
        // Two kinds, two rules. A variant factory is an explicit csszyx call in
        // the provider's own text, so the setting has nothing to say about it;
        // turning the setting off withdraws plain objects only.
        const root = projectWith({ 'app/styles.ts': `${SZV_FACTORY}${SZ_OBJECT}` });
        const resolved = resolveNextCrossModule({
            filename: join(root, 'app/page.tsx'),
            source: "import { rowSz, cardSz } from './styles';\n",
            root,
            importedStaticSz: false,
        });

        expect(Object.keys(resolved.statics.szvConfigs?.['./styles'] ?? {})).toEqual(['rowSz']);
        expect(resolved.statics.szObjects).toBeUndefined();
    });

    it('declares a provider that currently exports nothing usable', () => {
        // An edit that ADDS an export has to invalidate this importer too, and
        // by then the loader is not running. Declaring on the read rather than
        // on the hit is what makes that edit reach it.
        const root = projectWith({ 'app/util.ts': 'export const n = 1;\n' });
        const resolved = resolveNextCrossModule({
            filename: join(root, 'app/page.tsx'),
            source: "import { n } from './util';\n",
            root,
            importedStaticSz: true,
        });

        expect(resolved.statics).toEqual({});
        expect(resolved.providers).toEqual([join(root, 'app/util.ts')]);
    });

    it('resolves a specifier written twice only once', () => {
        // The same module named by two imports is one lookup and one dependency
        // declaration. Probing it again would double the loader's disk work per
        // file and hand the watcher a duplicate to invalidate.
        const root = projectWith({ 'app/styles.ts': SZ_OBJECT });
        const resolved = resolveNextCrossModule({
            filename: join(root, 'app/page.tsx'),
            source:
                "import { cardSz } from './styles';\n" +
                "import { cardSz as again } from './styles';\n",
            root,
            importedStaticSz: true,
        });

        expect(resolved.providers).toEqual([join(root, 'app/styles.ts')]);
    });

    it('keeps looking when one alias candidate names nothing on disk', () => {
        // Two targets for one pattern is ordinary tsconfig; the first is a
        // fallback that need not exist. Stopping at it would cost the importer
        // its precompile for a path the project deliberately listed second.
        const root = projectWith({
            'app/styles.ts': SZ_OBJECT,
            'tsconfig.json': JSON.stringify({
                compilerOptions: { paths: { '@/*': ['./missing/*', './app/*'] } },
            }),
        });
        const resolved = resolveNextCrossModule({
            filename: join(root, 'app/page.tsx'),
            source: "import { cardSz } from '@/styles';\n",
            root,
            importedStaticSz: true,
        });

        expect(resolved.providers).toEqual([join(root, 'app/styles.ts')]);
    });

    it('reports nothing for a package specifier', () => {
        const root = projectWith({ 'app/styles.ts': SZ_OBJECT });
        const resolved = resolveNextCrossModule({
            filename: join(root, 'app/page.tsx'),
            source: "import { useState } from 'react';\n",
            root,
            importedStaticSz: true,
        });

        expect(resolved.providers).toEqual([]);
        expect(resolved.statics).toEqual({});
    });

    it('reports nothing for a file that imports nothing', () => {
        const root = projectWith({ 'app/styles.ts': SZ_OBJECT });
        expect(
            resolveNextCrossModule({
                filename: join(root, 'app/page.tsx'),
                source: 'export const A = 1;\n',
                root,
                importedStaticSz: true,
            }),
        ).toEqual({ statics: {}, providers: [] });
    });

    it('survives a provider it cannot parse', () => {
        // A broken neighbour costs this importer its optimization. Throwing
        // would fail the build of a file whose own source is fine.
        const root = projectWith({ 'app/styles.ts': 'export const = ;\n' });
        const resolved = resolveNextCrossModule({
            filename: join(root, 'app/page.tsx'),
            source: "import { cardSz } from './styles';\n",
            root,
            importedStaticSz: true,
        });

        expect(resolved.statics).toEqual({});
        expect(resolved.providers).toEqual([join(root, 'app/styles.ts')]);
    });

    it('probes the same extension order the prescan lanes do', () => {
        const root = projectWith({ 'app/tokens/index.ts': SZ_OBJECT });
        const resolved = resolveNextCrossModule({
            filename: join(root, 'app/page.tsx'),
            source: "import { cardSz } from './tokens';\n",
            root,
            importedStaticSz: true,
        });

        expect(resolved.providers).toEqual([join(root, 'app/tokens/index.ts')]);
    });
});
