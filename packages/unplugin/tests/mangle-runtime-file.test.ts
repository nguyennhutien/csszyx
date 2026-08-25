/**
 * The generated registration module webpack imports.
 *
 * Webpack cannot take the `virtual:` specifier the other lanes resolve, so it
 * reads a real file instead. These are the two things that file has to get
 * right off the happy path: an unwritable output directory must not fail the
 * build, and the specifier must resolve as a PATH rather than as a package
 * name from wherever the importing module sits.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    ensureMangleRuntimeFile,
    MANGLE_RUNTIME_FILE_MARKER,
    mangleRuntimeSpecifier,
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

describe('mangleRuntimeSpecifier', () => {
    it('prefixes a sibling path so it is not read as a package name', () => {
        const root = tempRoot();
        mkdirSync(join(root, '.csszyx'), { recursive: true });
        const file = join(root, MANGLE_RUNTIME_FILE_MARKER);

        // Without the prefix this reads `.csszyx/mangle-runtime.mjs`, which a
        // bundler resolves as a package.
        expect(mangleRuntimeSpecifier(join(root, 'src.js'), file)).toBe(
            './.csszyx/mangle-runtime.mjs',
        );
    });

    it('leaves an already-relative parent path alone', () => {
        const root = tempRoot();
        const file = join(root, MANGLE_RUNTIME_FILE_MARKER);

        expect(mangleRuntimeSpecifier(join(root, 'src/deep/a.ts'), file)).toBe(
            '../../.csszyx/mangle-runtime.mjs',
        );
    });
});
