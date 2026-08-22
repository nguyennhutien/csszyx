/**
 * Paths the CLI takes in and hands out, on a platform that writes them with
 * backslashes.
 *
 * Two directions, one helper each. Inbound: a glob a Windows user types has
 * `\` where fast-glob expects `/`, and fast-glob reads `\` as an escape — the
 * pattern silently matches nothing and a scan reports zero files as clean.
 * Outbound: `path.relative` on Windows yields `src\App.tsx`, and that string
 * is a machine-read contract in `--json` output, so it must not vary by host.
 *
 * Both are tested against `path.win32` so the Windows behaviour is pinned
 * from a Linux runner instead of waiting for a Windows one to notice.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { relativePosix, withPosixSeparators } from '../src/utils/posix-path.js';

describe('withPosixSeparators', () => {
    it('turns a Windows-style glob into the form fast-glob reads', () => {
        expect(withPosixSeparators('src\\**\\*.tsx')).toBe('src/**/*.tsx');
    });

    it('returns a posix path unchanged, as the same string', () => {
        const given = 'src/**/*.tsx';
        expect(withPosixSeparators(given)).toBe(given);
    });
});

describe('relativePosix', () => {
    it('emits forward slashes from a Windows relative path', () => {
        expect(relativePosix('C:\\proj', 'C:\\proj\\src\\App.tsx', path.win32)).toBe('src/App.tsx');
    });

    it('is plain path.relative on posix', () => {
        expect(relativePosix('/proj', '/proj/src/App.tsx', path.posix)).toBe('src/App.tsx');
    });

    it('defaults to the host path module', () => {
        expect(relativePosix('/proj', '/proj/src/App.tsx')).toBe(
            path.relative('/proj', '/proj/src/App.tsx').split(path.sep).join('/'),
        );
    });
});
