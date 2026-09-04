/**
 * The test-runner transform lane.
 *
 * A bundler plugin never runs under jest, so a rendered component carries `sz`
 * as a live prop and no `className`: every styling assertion reads the object
 * the author typed rather than the classes the browser gets, and the whole
 * defect class "this `sz` compiled to nothing" is invisible to the suite.
 *
 * Two sources answer, in order. The build's own transform cache holds the
 * output the bundler produced — including the cross-module `sz` objects and
 * `szv` factories a per-file compile cannot resolve — so it is read first,
 * keyed by the file's path and the hash of its current contents. When the file
 * has changed since that build, or was never built, the per-file compiler
 * answers instead, which is right for the inline and file-local shapes and
 * says so when it has to fall back.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTransformer, findCachedTransform } from '../src/jest-transform.js';

const roots: string[] = [];
afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A transform cache directory holding one entry, shaped as the plugin writes it.
 *
 * @param filename - Absolute path the entry was produced for.
 * @param source - Source the entry was produced from.
 * @param code - Compiled output to store.
 * @returns The cache root.
 */
function cacheWith(filename: string, source: string, code: string): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-jest-cache-'));
    roots.push(root);
    const dir = join(root, '9c');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, 'entry.json'),
        JSON.stringify({
            filename,
            inputSha256: createHash('sha256').update(source).digest('hex'),
            result: { code, transformed: true },
        }),
    );
    return root;
}

describe('reading the build cache', () => {
    const FILE = '/repo/src/Card.tsx';
    const SOURCE = 'export const A = () => <div sz={cardSz} />;';
    const CODE = 'export const A = () => <div className="p-4 rounded-lg" />;';

    it('answers with the build output when the file is unchanged', () => {
        expect(findCachedTransform(cacheWith(FILE, SOURCE, CODE), FILE, SOURCE)).toBe(CODE);
    });

    // The staleness rule, and the only one this lane can enforce: the entry
    // describes a source that is no longer on disk, so it describes nothing
    // about the file under test.
    it('refuses an entry whose source has changed since the build', () => {
        const root = cacheWith(FILE, SOURCE, CODE);
        expect(findCachedTransform(root, FILE, `${SOURCE}\n// edited`)).toBeNull();
    });

    it('answers null for a file the build never saw', () => {
        expect(
            findCachedTransform(cacheWith(FILE, SOURCE, CODE), '/repo/src/Other.tsx', SOURCE),
        ).toBeNull();
    });

    it('skips an entry a half-written build left unparseable', () => {
        // The cache is written during a build that can be interrupted, and a
        // truncated file must not take the whole lookup down with it — the
        // entry beside it may be the one that answers.
        const root = cacheWith(FILE, SOURCE, CODE);
        // Named to be read BEFORE the good entry: directory order is what
        // decides whether the torn file is reached at all.
        writeFileSync(join(root, '9c', '0torn.json'), '{"filename": "/repo/src/');
        // And a neighbour that is not an entry at all — the plugin's cache
        // directory holds more than these files.
        writeFileSync(join(root, '9c', '0notes.txt'), 'not an entry');
        expect(findCachedTransform(root, FILE, SOURCE)).toBe(CODE);
    });

    it('answers null when there is no cache at all', () => {
        expect(findCachedTransform(join(tmpdir(), 'csszyx-absent-cache'), FILE, SOURCE)).toBeNull();
    });
});

describe('the transformer jest calls', () => {
    /**
     * Run one file through the transformer, as jest's sync `process` hook does.
     *
     * @param source - File contents.
     * @param filename - Absolute path of the file.
     * @param cacheRoot - Transform cache directory to consult, if any.
     * @returns The code jest would execute.
     */
    function run(source: string, filename: string, cacheRoot?: string): string {
        return createTransformer({ cacheRoot }).process(source, filename).code;
    }

    it('compiles an inline sz to the class the browser gets', () => {
        const code = run(
            'export const A = () => <div sz={{ p: 4, bg: "red-500" }} />;',
            '/repo/a.tsx',
        );
        expect(code).toContain('className="p-4 bg-red-500"');
        expect(code).not.toContain('sz=');
    });

    it('compiles an sz built from a const in the same file', () => {
        const code = run(
            [
                'const card = { p: 4, rounded: "lg" };',
                'export const A = () => <div sz={card} />;',
            ].join('\n'),
            '/repo/a.tsx',
        );
        expect(code).toContain('className="p-4 rounded-lg"');
    });

    // The cache is the only source that can answer for a cross-module object,
    // so it wins over the per-file compile whenever it has a matching entry.
    it('prefers the build output over its own per-file compile', () => {
        const source = 'export const A = () => <div sz={{ p: 4 }} />;';
        const built = 'export const A = () => <div className="from-the-build" />;';
        expect(run(source, '/repo/a.tsx', cacheWith('/repo/a.tsx', source, built))).toBe(built);
    });

    // A file the compiler leaves alone is returned unchanged rather than
    // dropped: the suite still runs, and the diagnostic channel is what
    // reports the reason.
    it('leaves a file whose extension it was not given alone', () => {
        // jest hands the transformer every file matching its own pattern, so
        // the extension list is what keeps csszyx off a `.css` or a `.json`.
        const transformer = createTransformer({ extensions: ['.tsx'] });
        const source = 'export const A = () => <div sz={{ p: 4 }} />;';
        expect(transformer.process(source, '/repo/src/App.jsx').code).toBe(source);
    });

    it('returns a file it cannot compile unchanged', () => {
        const source = 'export const A = 1;';
        expect(run(source, '/repo/a.ts')).toBe(source);
    });
});
