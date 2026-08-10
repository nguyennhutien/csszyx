/**
 * The path shapes that only differ on one platform, or at one directory depth.
 *
 * Each of these reads a path and decides something from its shape: whether two
 * directories are the same, whether a specifier needs a `./` to stay a path.
 * They are one-liners, and the arm that is easy to miss is always the one a
 * developer's own machine never produces — a Windows separator on macOS, a
 * generated file ABOVE the module importing it rather than below.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { discoverProjectTheme } from '../src/theme-discovery.js';
import { themeGroupsSpecifier } from '../src/theme-groups-file.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A project root holding one stylesheet that declares a token.
 *
 * @returns Absolute path, realpath-resolved the way the plugin resolves it.
 */
function projectWithTheme(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-paths-')));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/app.css'), '@theme { --color-brand: #123456; }\n');
    return root;
}

describe('an extra scan directory given with a trailing separator', () => {
    it('is still recognised as the root, and not walked twice', () => {
        // The comparison is textual, so `"/app/"` and `"/app"` have to normalise
        // to one string. Missing it walks the whole project a second time and
        // reports every stylesheet twice.
        const root = projectWithTheme();

        const discovered = discoverProjectTheme(root, [`${root}/`]);

        expect(discovered.files).toEqual([join(root, 'src/app.css')]);
    });

    it('is walked when it genuinely sits outside the root', () => {
        // The other arm: a directory that only shares a prefix by accident must
        // not be skipped, or a real second source of tokens goes unread.
        const root = projectWithTheme();
        const outside = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-outside-')));
        roots.push(outside);
        writeFileSync(join(outside, 'vendor.css'), '@theme { --color-vendor: #654321; }\n');

        const discovered = discoverProjectTheme(root, [`${outside}/`]);

        expect(discovered.theme?.colors).toContain('vendor');
    });
});

describe('the specifier a module uses to import the generated registration', () => {
    it('gains a ./ when the generated file sits below the importing module', () => {
        // `path.relative` yields `.csszyx/theme-groups.mjs`, which a bundler
        // resolves as a PACKAGE name — `startsWith('.')` is not the test.
        expect(themeGroupsSpecifier('/app/src/Card.tsx', '/app/src/.csszyx/theme-groups.mjs')).toBe(
            './.csszyx/theme-groups.mjs',
        );
    });

    it('keeps the ../ when the generated file sits above it', () => {
        // Already a path, and prefixing it would name a directory that is not
        // there. This is the ordinary layout — the file lives at the project
        // root while the modules importing it live in `src/`.
        expect(themeGroupsSpecifier('/app/src/ui/Card.tsx', '/app/.csszyx/theme-groups.mjs')).toBe(
            '../../.csszyx/theme-groups.mjs',
        );
    });
});
