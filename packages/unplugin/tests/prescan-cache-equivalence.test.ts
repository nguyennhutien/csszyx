/**
 * Transform-cache equivalence over the REAL prescan pipeline.
 *
 * The cache has unit nets (key composition, atomic writes, eviction), but no
 * net asserted the property that actually matters: a cache-off run, a cold
 * cache-populating run, and a warm cache-served run must produce the IDENTICAL
 * safelist. A stale or mis-keyed cache would silently serve another
 * configuration's classes — the same "silently dead classes" failure mode as
 * every scan bug in the field reports, but triggered by the second build
 * instead of the first.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadNativeBinding } from '../../core/native/index.js';
import { vitePlugin } from '../src/unplugin.js';

type ViteConfigHook = {
    configResolved?: (config: { root: string }) => void;
};

const FIXTURE_FILES: Record<string, string> = {
    'src/App.tsx': `
export const App = ({ c }) => <div className={c} sz={{ p: 4, hover: { bg: 'zinc-100' } }} />;
`,
    'src/tags.ts': `
import { szv } from '@csszyx/runtime';
export const tagSz = szv({ variants: { c: { blue: { bg: 'tag-blue-bg' } } satisfies Record<string, object> } });
`,
    'src/toolbar.js': `
export const Toolbar = () => <div className="toolbar" sz={{ mx: 0 }} />;
`,
    // An szcn-using module: the theme-groups import injection must be
    // cache-safe (it keys on the source, not on scan-time state), so cached
    // and uncached runs of this file must agree like every other.
    'src/merge.ts': `
import { szcn } from '@csszyx/runtime';
export const cls = szcn('gap-2 p-4', 'gap-8');
`,
};

const tempDirs: string[] = [];

afterAll(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/**
 * Run the real prescan once against `root` and return the safelist tokens.
 *
 * @param root - fixture root (reused across runs so the disk cache persists).
 * @param parser - engine under test.
 * @param cache - transform-cache toggle for this run.
 * @returns sorted safelist tokens.
 */
function runPrescan(root: string, parser: 'rust' | 'oxc', cache: boolean): string[] {
    // Each run must observe only its own scan: the safelist writer merges with
    // an existing file, which would mask a run that discovered fewer classes.
    rmSync(join(root, 'csszyx-classes.html'), { force: true });
    const [prePlugin] = vitePlugin({ build: { parser, cache } }) as ViteConfigHook[];
    prePlugin?.configResolved?.({ root });
    const html = readFileSync(join(root, 'csszyx-classes.html'), 'utf8');
    const classList = html.match(/class="([^"]*)"/)?.[1] ?? '';
    return [...new Set(classList.split(/\s+/).filter(Boolean))].sort();
}

describe('prescan cache equivalence (off == cold == warm)', () => {
    beforeAll(() => {
        loadNativeBinding();
    });

    for (const parser of ['rust', 'oxc'] as const) {
        it(`${parser}: cache-off, cache-cold and cache-warm scans agree`, () => {
            const root = mkdtempSync(join(tmpdir(), `csszyx-cache-eq-${parser}-`));
            tempDirs.push(root);
            mkdirSync(join(root, 'src'), { recursive: true });
            for (const [file, source] of Object.entries(FIXTURE_FILES)) {
                writeFileSync(join(root, file), source, 'utf8');
            }

            const off = runPrescan(root, parser, false);
            const cold = runPrescan(root, parser, true); // populates the disk cache
            const warm = runPrescan(root, parser, true); // must be served from it

            expect(off.length).toBeGreaterThan(0);
            expect(cold).toEqual(off);
            expect(warm).toEqual(off);
        });
    }

    it('a source edit after a warm cache is picked up (no stale serve)', () => {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-cache-eq-edit-'));
        tempDirs.push(root);
        mkdirSync(join(root, 'src'), { recursive: true });
        for (const [file, source] of Object.entries(FIXTURE_FILES)) {
            writeFileSync(join(root, file), source, 'utf8');
        }

        const warm = runPrescan(root, 'rust', true);
        expect(warm).not.toContain('indent-8');

        writeFileSync(
            join(root, 'src/App.tsx'),
            'export const App = () => <div sz={{ p: 4, indent: 8 }} />;',
            'utf8',
        );
        const afterEdit = runPrescan(root, 'rust', true);
        expect(afterEdit).toContain('indent-8');
    });
});

describe('prescan → transform-hook result handoff (1× cold transform)', () => {
    // The two lanes never share CACHE entries (budget-keyed), so before the
    // handoff every sz-file was transformed twice per cold start — once by the
    // prescan, once by the transform hook — and the hook wrote a SECOND disk
    // entry per file. The hook only writes an entry after actually
    // transforming, so the on-disk entry count is the witness: unchanged
    // content must add zero entries, edited content must still add one.
    it('the hook adds no disk entry for content the prescan already transformed', async () => {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-handoff-'));
        tempDirs.push(root);
        mkdirSync(join(root, 'src'), { recursive: true });
        for (const [file, source] of Object.entries(FIXTURE_FILES)) {
            writeFileSync(join(root, file), source, 'utf8');
        }

        const [prePlugin] = vitePlugin({ build: { parser: 'oxc', cache: true } }) as Array<
            ViteConfigHook & {
                transform?:
                    | { handler?: (code: string, id: string) => unknown }
                    | ((code: string, id: string) => unknown);
            }
        >;
        prePlugin?.configResolved?.({ root });

        const cacheDir = join(root, '.csszyx/cache/transform');
        const entriesAfterPrescan = countJsonFiles(cacheDir);
        expect(entriesAfterPrescan).toBeGreaterThan(0);

        const appPath = join(root, 'src/App.tsx');
        const appSource = readFileSync(appPath, 'utf8');
        const rawTransform = prePlugin?.transform;
        const transform = typeof rawTransform === 'function' ? rawTransform : rawTransform?.handler;
        expect(typeof transform).toBe('function');

        // Unchanged content → handoff serves the prescan result; no re-transform,
        // no second entry.
        const reused = (await transform?.(appSource, appPath)) as { code?: string } | null;
        expect(reused?.code).toContain('className');
        expect(countJsonFiles(cacheDir)).toBe(entriesAfterPrescan);

        // Edited content → sha mismatch, the hook transforms and caches as before.
        const edited = appSource.replace('p: 4', 'p: 8');
        const fresh = (await transform?.(edited, appPath)) as { code?: string } | null;
        expect(fresh?.code).toContain('p-8');
        expect(countJsonFiles(cacheDir)).toBe(entriesAfterPrescan + 1);
    });
});

/**
 * Count `.json` cache entries under a transform-cache directory.
 *
 * @param dir - transform cache root.
 * @returns number of entry files.
 */
function countJsonFiles(dir: string): number {
    let count = 0;
    let entries: import('node:fs').Dirent[];
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            count += countJsonFiles(join(dir, entry.name));
        } else if (entry.name.endsWith('.json')) {
            count += 1;
        }
    }
    return count;
}
