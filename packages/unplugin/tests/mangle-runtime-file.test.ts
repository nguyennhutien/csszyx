/**
 * The generated registration module webpack takes as a global entry.
 *
 * Webpack cannot take the `virtual:` specifier the other lanes resolve, so it
 * reads a real file instead. These are the things that file has to get right
 * off the happy path: an unwritable output directory must not fail the build,
 * and a write must never be observable half-done — the server and client
 * compilations share one project directory and run at the same time.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    applyMangleRuntimeEntry,
    ensureMangleRuntimeFile,
    ensureUnservedRuntimeFile,
    MANGLE_RUNTIME_FILE_MARKER,
} from '../src/mangle-runtime-file.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** @returns A fresh temp directory, cleaned up after the test. */
function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-mangle-file-'));
    roots.push(root);
    return root;
}

describe('ensureMangleRuntimeFile', () => {
    it('writes the registration module and returns its path', () => {
        const root = tempRoot();
        const file = ensureMangleRuntimeFile(join(root, '.csszyx'), '---g', false);

        expect(file).toBe(join(root, MANGLE_RUNTIME_FILE_MARKER));
        const source = readFileSync(file as string, 'utf8');
        expect(source).toContain('installMangleRuntime(');
        expect(source).toContain('exposeDebugGlobal: false');
        // Placeholders, not live values: the map is not final until the mangle
        // passes have run over the emitted assets.
        expect(source).toContain('___CSSZYX_MANGLE_MAP___');
    });

    it('carries the debug opt-in into the generated module', () => {
        const root = tempRoot();
        const file = ensureMangleRuntimeFile(join(root, '.csszyx'), '---g', true);

        expect(readFileSync(file as string, 'utf8')).toContain('exposeDebugGlobal: true');
    });

    it('returns null instead of failing the build when the directory is unwritable', () => {
        const root = tempRoot();
        // A FILE where the output directory belongs: `mkdir` fails with ENOTDIR.
        writeFileSync(join(root, '.csszyx'), 'not a directory', 'utf8');

        expect(ensureMangleRuntimeFile(join(root, '.csszyx'), '---g', false)).toBeNull();
    });
});

describe('the write is atomic', () => {
    it('leaves no staging file behind on success', () => {
        const root = tempRoot();
        ensureMangleRuntimeFile(join(root, '.csszyx'), '---g', false);

        // A reader of the generated directory during a parallel compilation
        // must never find a half-written module: the content is staged under
        // another name and renamed into place.
        expect(readdirSync(join(root, '.csszyx'))).toEqual(['mangle-runtime.mjs']);
    });

    it('leaves no staging file behind when the rename cannot happen', () => {
        const root = tempRoot();
        // A DIRECTORY where the module belongs: the write succeeds, the
        // rename fails with EISDIR.
        const target = join(root, '.csszyx', 'mangle-runtime.mjs');
        mkdirSync(target, { recursive: true });

        expect(ensureMangleRuntimeFile(join(root, '.csszyx'), '---g', false)).toBeNull();
        expect(readdirSync(join(root, '.csszyx'))).toEqual(['mangle-runtime.mjs']);
    });
});

describe('applyMangleRuntimeEntry', () => {
    it('registers a global entry through the compiler own webpack copy', () => {
        const applied: Array<[string, string, { name: undefined }]> = [];
        let appliedTo: unknown;
        class FakeEntryPlugin {
            constructor(
                readonly context: string,
                readonly entry: string,
                readonly options: { name: undefined },
            ) {
                applied.push([context, entry, options]);
            }
            apply(compiler: unknown): void {
                appliedTo = compiler;
            }
        }
        const compiler = { webpack: { EntryPlugin: FakeEntryPlugin } };
        let registered = 0;

        applyMangleRuntimeEntry(compiler, '/root', '/root/.csszyx/x.mjs', () => {
            registered += 1;
        });
        // `name: undefined` is the global form; a named entry would create one
        // of its own instead of prepending to every entrypoint.
        expect(applied).toEqual([['/root', '/root/.csszyx/x.mjs', { name: undefined }]]);
        expect(appliedTo).toBe(compiler);
        // The map's bytes are certain to ship only once the entry is in.
        expect(registered).toBe(1);
    });

    it('registers nothing when the compiler carries no plugin class', () => {
        // Anything webpack-shaped that is not webpack 5. No entry beats a
        // crash: the build keeps unmangled runtime class names, the same
        // degraded answer an unwritable directory gives.
        let registered = 0;
        const count = () => {
            registered += 1;
        };
        applyMangleRuntimeEntry({}, '/root', '/root/.csszyx/x.mjs', count);
        applyMangleRuntimeEntry({ webpack: {} }, '/root', '/root/.csszyx/x.mjs', count);
        // Nothing shipped, so nothing is charged for.
        expect(registered).toBe(0);
    });
});

describe('ensureUnservedRuntimeFile', () => {
    it('writes a module that registers the list the build fills in later', () => {
        const root = tempRoot();
        const file = ensureUnservedRuntimeFile(root);

        expect(file).toBe(join(root, 'unserved-runtime.mjs'));
        const body = readFileSync(file as string, 'utf8');
        // The hole, not the values: the names are only known once every module
        // has been transformed, and this file is written before that.
        expect(body).toContain('___CSSZYX_UNSERVED___');
        expect(body).toContain('registerUnservedClasses');
    });

    it('leaves no staging file behind', () => {
        // The write is a write then a rename, because the server and client
        // compilations share one project directory and run at the same time.
        const root = tempRoot();
        ensureUnservedRuntimeFile(root);

        expect(readdirSync(root)).toEqual(['unserved-runtime.mjs']);
    });

    it('overwrites a previous build without appending to it', () => {
        const root = tempRoot();
        writeFileSync(join(root, 'unserved-runtime.mjs'), 'stale\n');
        const file = ensureUnservedRuntimeFile(root);

        expect(readFileSync(file as string, 'utf8')).not.toContain('stale');
    });

    it('answers null rather than failing the build when the path is unwritable', () => {
        // A file where the directory should be. Registering nothing leaves
        // every token with the placement it had before this existed, which is
        // a working build rather than a wrong one.
        const root = tempRoot();
        const blocked = join(root, 'blocked');
        writeFileSync(blocked, 'not a directory\n');

        expect(ensureUnservedRuntimeFile(blocked)).toBeNull();
    });
});
