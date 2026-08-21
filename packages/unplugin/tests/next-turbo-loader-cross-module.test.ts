/**
 * The Turbopack loader compiling a style object from another module.
 *
 * The resolver has its own unit net; this is the loader keeping the bargain
 * that made resolution allowable at all. Two things have to be true together:
 * the attribute lowers into a class, AND the provider is declared to the
 * watcher. Compiling without declaring is the failure this lane refused to
 * risk for as long as it did — the importer would keep serving the value the
 * style module had before an edit, which is worse than the runtime path it
 * would otherwise have taken.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearNextAliasCache } from '../src/next-cross-module.js';
import { type NextTurboLoaderContext, runNextTurboLoader } from '../src/next-turbo-loader.js';

const roots: string[] = [];

const OPTIONS = {
    parserMode: 'auto',
    config: { mangleVars: false },
    nextVersion: '16.2.7',
    csszyxVersion: '0.9.0',
    compilerVersion: '0.9.0',
    nativeVersion: '0.9.0-test',
    writeOptions: { retryDelayMs: 0 },
} as const;

const IMPORTER =
    "import { cardSz } from '@/app/styles';\nexport default () => <div sz={cardSz} />;\n";

/**
 * Build a Next-shaped project whose page imports its styles through `@/`.
 *
 * @param extra - Extra files to write, project-relative.
 * @returns The root, the page path, and a loader context recording deps.
 */
function project(extra: Record<string, string> = {}): {
    root: string;
    filename: string;
    ctx: NextTurboLoaderContext & { dependencies: string[] };
} {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-next-xmod-loader-'));
    roots.push(root);
    mkdirSync(join(root, 'app'), { recursive: true });
    // The Next root resolver walks up to the nearest package.json.
    writeFileSync(join(root, 'package.json'), '{"name":"fixture"}\n');
    writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } }),
    );
    writeFileSync(join(root, 'app/styles.ts'), 'export const cardSz = { p: 7 };\n');
    for (const [name, contents] of Object.entries(extra)) {
        writeFileSync(join(root, name), contents);
    }
    const filename = join(root, 'app/page.tsx');
    writeFileSync(filename, IMPORTER);

    const dependencies: string[] = [];
    const ctx = {
        resourcePath: filename,
        rootContext: root,
        context: join(root, 'app'),
        mode: 'development',
        addDependency: (file: string) => {
            dependencies.push(file);
        },
        dependencies,
    } as unknown as NextTurboLoaderContext & { dependencies: string[] };
    return { root, filename, ctx };
}

beforeEach(() => {
    clearNextAliasCache();
});

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('the Turbopack loader and an imported style object', () => {
    it('compiles it and declares the provider it read', () => {
        const { root, ctx } = project();
        const result = runNextTurboLoader(IMPORTER, ctx, { ...OPTIONS, importedStaticSz: true });

        expect(result.code).toContain('className="p-7"');
        expect(result.code).not.toContain('_sz(');
        expect(ctx.dependencies).toContain(join(root, 'app/styles.ts'));
    });

    it('keeps the runtime path when the setting is turned off', () => {
        const { ctx } = project();
        const result = runNextTurboLoader(IMPORTER, ctx, { ...OPTIONS, importedStaticSz: false });

        expect(result.code).toContain('_sz(cardSz)');
        expect(result.code).not.toContain('className="p-7"');
    });

    it('declares the provider even when it compiles nothing from it', () => {
        // The declaration is what lets a LATER edit reach this importer, and by
        // then the loader is not running to notice it had nothing to say now.
        const { root, ctx } = project();
        runNextTurboLoader(IMPORTER, ctx, OPTIONS);

        expect(ctx.dependencies).toContain(join(root, 'app/styles.ts'));
    });

    it('recompiles against the edited provider rather than a cached value', () => {
        // Same importer, same options, changed provider. The transform cache
        // keys on the file's own source, so without the resolved entries in
        // that key the second run would replay the first one's output.
        const { root, ctx } = project();
        const first = runNextTurboLoader(IMPORTER, ctx, { ...OPTIONS, importedStaticSz: true });
        expect(first.code).toContain('className="p-7"');

        writeFileSync(join(root, 'app/styles.ts'), 'export const cardSz = { p: 9 };\n');
        const second = runNextTurboLoader(IMPORTER, ctx, { ...OPTIONS, importedStaticSz: true });

        expect(second.code).toContain('className="p-9"');
    });
});
