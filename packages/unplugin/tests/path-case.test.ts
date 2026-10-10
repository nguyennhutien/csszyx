/**
 * Paths a watcher reports, compared with the paths a session recorded.
 *
 * On a file system that folds case (macOS and Windows by default), one file
 * has many spellings: a watcher started from `C:\Projects\app` and a root read
 * as `c:\projects\app` name the same config. Comparing them exactly missed the
 * edit. Whether a directory folds case is asked of the file system, never
 * assumed from the platform: a case-sensitive APFS volume and a Linux mount of
 * a Windows drive both exist. Every case here answers that question with a
 * stand-in, so none of them depends on the file system the suite runs on.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isCsszyxConfigFile } from '../src/csszyx-config-file.js';
import { isDiagnosticPolicyWatchFile } from '../src/diagnostic-policy-inputs.js';
import { foldsCase, type PathIdentity, projectRelative, samePath } from '../src/path-case.js';

/**
 * A file system that holds every spelling of the given paths as one file.
 *
 * @param present - The paths that exist, in any case.
 * @returns A stat stand-in.
 */
function folding(present: readonly string[]): (file: string) => PathIdentity | undefined {
    const known = present.map(file => path.resolve(file).toLowerCase());
    return file => {
        const index = known.indexOf(path.resolve(file).toLowerCase());
        return index === -1 ? undefined : { dev: 1, ino: index + 1 };
    };
}

/**
 * A file system where only the exact spelling of each path exists.
 *
 * @param present - The paths that exist.
 * @returns A stat stand-in.
 */
function exact(present: readonly string[]): (file: string) => PathIdentity | undefined {
    const known = present.map(file => path.resolve(file));
    return file => {
        const index = known.indexOf(path.resolve(file));
        return index === -1 ? undefined : { dev: 1, ino: index + 1 };
    };
}

describe('whether a directory folds case', () => {
    it('is answered by the file system: another spelling of the same entry is the same file', () => {
        const root = path.resolve('/Fold/Detect/app');
        expect(foldsCase(root, { stat: folding([root]) })).toBe(true);
        const sensitive = path.resolve('/Fold/Detect/exact');
        expect(foldsCase(sensitive, { stat: exact([sensitive]) })).toBe(false);
    });

    it('reads two entries that only differ in case as two files', () => {
        // A case-sensitive volume can hold `App` and `app` side by side.
        const root = path.resolve('/Fold/Twins/app');
        const twin = path.resolve('/Fold/Twins/APP');
        expect(foldsCase(root, { stat: exact([root, twin]) })).toBe(false);
    });

    it('asks of the nearest entry with a letter, and of none in a path without one', () => {
        const root = path.resolve('/Fold/2026/10');
        // `2026` and `10` have no case: `Fold` is the entry asked about.
        expect(foldsCase(root, { stat: folding([root, path.resolve('/Fold')]) })).toBe(true);
        expect(foldsCase(path.resolve('/2026/10'), { stat: folding([]) })).toBe(false);
    });

    it('keeps the first answer for a directory', () => {
        const root = path.resolve('/Fold/Kept/app');
        expect(foldsCase(root, { stat: folding([root]) })).toBe(true);
        expect(foldsCase(root)).toBe(true);
    });
});

describe('a path a watcher reports', () => {
    const FOLDING = path.resolve('/Case/Folding/App');
    const EXACT = path.resolve('/Case/Exact/App');
    foldsCase(FOLDING, { stat: folding([FOLDING]) });
    foldsCase(EXACT, { stat: exact([EXACT]) });
    const lower = (file: string): string => file.toLowerCase();

    it('names the config in any spelling where the file system folds case', () => {
        expect(isCsszyxConfigFile(FOLDING, path.join(lower(FOLDING), 'csszyx.config.mjs'))).toBe(
            true,
        );
        expect(isCsszyxConfigFile(FOLDING, path.join(FOLDING, 'CSSZYX.CONFIG.MJS'))).toBe(true);
        expect(isCsszyxConfigFile(FOLDING, path.join(FOLDING, 'csszyx.config.mjs.bak'))).toBe(
            false,
        );
    });

    it('names the config only as spelled where the file system keeps case', () => {
        expect(isCsszyxConfigFile(EXACT, path.join(EXACT, 'csszyx.config.mjs'))).toBe(true);
        expect(isCsszyxConfigFile(EXACT, path.join(lower(EXACT), 'csszyx.config.mjs'))).toBe(false);
        expect(isCsszyxConfigFile(EXACT, path.join(EXACT, 'CSSZYX.CONFIG.MJS'))).toBe(false);
    });

    it('names a module the config imports in any spelling where the file system folds case', () => {
        const inputs = [{ file: 'config/levels.mjs', mtimeMs: 1, size: 1 }];
        expect(
            isDiagnosticPolicyWatchFile(
                FOLDING,
                inputs,
                path.join(lower(FOLDING), 'CONFIG/levels.mjs'),
            ),
        ).toBe(true);
        expect(
            isDiagnosticPolicyWatchFile(
                EXACT,
                inputs,
                path.join(lower(EXACT), 'config/levels.mjs'),
            ),
        ).toBe(false);
        expect(
            isDiagnosticPolicyWatchFile(EXACT, inputs, path.join(EXACT, 'csszyx.config.ts')),
        ).toBe(true);
    });

    it('makes a path relative to a root that is the file system root', () => {
        const top = path.parse(path.resolve('/')).root;
        expect(projectRelative(top, path.join(top, 'app', 'csszyx.config.mjs'))).toBe(
            'app/csszyx.config.mjs',
        );
    });

    it('is compared, and made relative to the root, by the same rule', () => {
        expect(
            samePath(FOLDING, path.join(FOLDING, 'a.mjs'), path.join(lower(FOLDING), 'A.MJS')),
        ).toBe(true);
        expect(samePath(EXACT, path.join(EXACT, 'a.mjs'), path.join(EXACT, 'A.mjs'))).toBe(false);
        expect(projectRelative(FOLDING, path.join(lower(FOLDING), 'config', 'levels.mjs'))).toBe(
            'config/levels.mjs',
        );
        expect(projectRelative(EXACT, path.join(EXACT, 'config', 'levels.mjs'))).toBe(
            'config/levels.mjs',
        );
        expect(projectRelative(EXACT, path.join(lower(EXACT), 'levels.mjs'))).toBe(
            path
                .relative(EXACT, path.join(lower(EXACT), 'levels.mjs'))
                .split(path.sep)
                .join('/'),
        );
    });
});
