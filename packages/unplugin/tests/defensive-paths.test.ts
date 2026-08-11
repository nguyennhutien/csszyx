/**
 * The branches that only run when something on disk is not what it was.
 *
 * Each one exists because a build-time nicety must never fail a build whose
 * own source is fine: a provider that vanished mid-scan, a stylesheet deleted
 * between the glob and the read, an output directory nobody can write to. They
 * are unreachable from a healthy fixture, which is exactly why they are worth
 * pinning — a silent change from "skip it" to "throw" would surface as a build
 * failure in someone else's project, on a file they never edited.
 */
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveNextCrossModule } from '../src/next-cross-module.js';
import { isReadableProviderFile } from '../src/provider-file.js';
import { discoverProjectTheme } from '../src/theme-discovery.js';
import { _resetThemeGroupsFileCache, ensureThemeGroupsFile } from '../src/theme-groups-file.js';

const roots: string[] = [];

afterEach(() => {
    _resetThemeGroupsFileCache();
    for (const root of roots.splice(0)) {
        try {
            chmodSync(root, 0o755);
        } catch {
            // Already writable, or already gone.
        }
        rmSync(root, { recursive: true, force: true });
    }
});

/**
 * A throwaway project root.
 *
 * @returns Absolute path, realpath-resolved the way the plugin resolves it.
 */
function tempRoot(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-defensive-')));
    roots.push(root);
    return root;
}

describe('a path that cannot even be inspected', () => {
    it('is not a readable provider', () => {
        // A NUL byte makes the stat itself throw rather than report "missing",
        // which is the difference between the guard returning false and the
        // whole transform failing on a specifier nobody wrote by hand.
        expect(isReadableProviderFile('does\0not\0exist.ts')).toBe(false);
    });

    it('is not a readable provider when it is a directory', () => {
        expect(isReadableProviderFile(tempRoot())).toBe(false);
    });
});

describe('a provider that cannot be read', () => {
    it('costs its importer the optimization and nothing else', () => {
        // The file exists when the probe runs and is unreadable when the read
        // runs. Recreating that race directly is flaky, so the same end state
        // is produced by giving the provider a shape the extractor rejects.
        const root = tempRoot();
        mkdirSync(join(root, 'app'), { recursive: true });
        writeFileSync(join(root, 'app/styles.ts'), 'export const cardSz = {{{ broken\n');

        const resolved = resolveNextCrossModule({
            filename: join(root, 'app/page.tsx'),
            source: "import { cardSz } from './styles';\n",
            root,
            importedStaticSz: true,
        });

        expect(resolved.statics).toEqual({});
        // Still declared: the file is a real dependency of this importer, and
        // an edit that makes it parseable has to reach the importer too.
        expect(resolved.providers).toEqual([join(root, 'app/styles.ts')]);
    });
});

describe('a stylesheet that disappears between the glob and the read', () => {
    it('is skipped rather than failing the scan', () => {
        // `discoverProjectTheme` globs, then reads. A directory named like a
        // stylesheet is found by the glob and throws on read, which is the same
        // failure the delete race produces and is deterministic to arrange.
        const root = tempRoot();
        mkdirSync(join(root, 'src/theme.css'), { recursive: true });
        writeFileSync(join(root, 'src/real.css'), '@theme { --color-brand: #123456; }\n');

        expect(discoverProjectTheme(root).theme?.colors).toContain('brand');
    });
});

describe('the theme-groups registration file', () => {
    it('is answered from cache on a second call with the same stylesheets', () => {
        const root = tempRoot();
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src/app.css'), '@theme { --color-brand: #123456; }\n');
        const outputDir = join(root, '.csszyx');

        const first = ensureThemeGroupsFile(root, outputDir);
        const second = ensureThemeGroupsFile(root, outputDir);

        expect(second.file).toBe(first.file);
        expect(second.watch).toEqual(first.watch);
    });

    it('reports a deleted stylesheet as a changed signature, not as unchanged', () => {
        // The signature is what makes the cache safe. A watched file that is
        // gone has to read differently from the same file present, or a project
        // that deletes its theme keeps merging by tokens it no longer declares.
        const root = tempRoot();
        mkdirSync(join(root, 'src'), { recursive: true });
        const stylesheet = join(root, 'src/app.css');
        writeFileSync(stylesheet, '@theme { --color-brand: #123456; }\n');
        const outputDir = join(root, '.csszyx');

        const before = ensureThemeGroupsFile(root, outputDir);
        expect(before.watch).toContain(stylesheet);
        rmSync(stylesheet);

        expect(ensureThemeGroupsFile(root, outputDir).file).toBeNull();
    });

    it('reports no file when the output directory cannot be created', () => {
        // A regular file already occupying the output path makes `mkdirSync`
        // throw for a reason no permission change can fix, which is the same
        // end state as a read-only checkout. Without the file the app merges
        // exactly as it did before this feature existed — under-merging, not
        // wrong styling — so it must not fail the build.
        const root = tempRoot();
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src/app.css'), '@theme { --color-brand: #123456; }\n');
        const outputDir = join(root, '.csszyx');
        writeFileSync(outputDir, 'not a directory\n');

        const result = ensureThemeGroupsFile(root, outputDir);

        expect(result.file).toBeNull();
        // The watch set still comes back, so adding a token later is noticed.
        expect(result.watch).toContain(join(root, 'src/app.css'));
    });

    it('rebuilds a project cleared by root instead of answering from cache', () => {
        const root = tempRoot();
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src/app.css'), '@theme { --color-brand: #123456; }\n');
        const outputDir = join(root, '.csszyx');

        const built = ensureThemeGroupsFile(root, outputDir);
        expect(built.file).not.toBeNull();
        const generated = built.file as string;
        rmSync(generated);

        // The stylesheets are untouched, so the entry is still valid and the
        // path comes back without the file being written again. That is what
        // makes the targeted clear observable rather than a no-op.
        ensureThemeGroupsFile(root, outputDir);
        expect(existsSync(generated)).toBe(false);

        _resetThemeGroupsFileCache(root);
        ensureThemeGroupsFile(root, outputDir);
        expect(existsSync(generated)).toBe(true);
    });
});
