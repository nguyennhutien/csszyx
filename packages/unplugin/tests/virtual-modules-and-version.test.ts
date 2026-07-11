/**
 * The virtual-module generators/resolvers and the package-version fallback —
 * small build-plumbing helpers with no direct suite of their own.
 */
import { describe, expect, it } from 'vitest';

import { readPackageVersion } from '../src/next-package-version';
import {
    createChecksumModule,
    createMangleMapModule,
    createThemeGroupsModule,
    isVirtualModule,
    RESOLVED_THEME_GROUPS_VIRTUAL_ID,
    RESOLVED_VIRTUAL_CHECKSUM_ID,
    RESOLVED_VIRTUAL_MODULE_ID,
    resolveVirtualModule,
    THEME_GROUPS_VIRTUAL_ID,
    VIRTUAL_CHECKSUM_ID,
    VIRTUAL_MODULE_ID,
} from '../src/virtual-modules';

describe('readPackageVersion', () => {
    it('reads the real package version relative to a module URL', () => {
        const version = readPackageVersion('../package.json', import.meta.url);
        expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('falls back to 0.0.0 for a missing file or missing version field', () => {
        expect(readPackageVersion('./does-not-exist.json', import.meta.url)).toBe('0.0.0');
        // tsconfig.json parses but has no version string.
        expect(readPackageVersion('../tsconfig.json', import.meta.url)).toBe('0.0.0');
    });
});

describe('virtual module generators', () => {
    it('emits the mangle-map module with maps, metrics and checksum', () => {
        const source = createMangleMapModule({ 'p-4': 'z' }, 'sum', { '--x': 'y' }, null);
        expect(source).toContain('"p-4": "z"');
        expect(source).toContain('"--x": "y"');
        expect(source).toContain('export const checksum = "sum"');
        expect(source).toContain('export default');
    });

    it('emits the checksum-only module', () => {
        expect(createChecksumModule('abc')).toContain('export const checksum = "abc"');
    });

    it('emits the theme-groups module', () => {
        const source = createThemeGroupsModule({} as never);
        expect(source).toContain('export');
    });
});

describe('virtual module resolution', () => {
    it('recognizes exactly the three csszyx virtual ids', () => {
        expect(isVirtualModule(VIRTUAL_MODULE_ID)).toBe(true);
        expect(isVirtualModule(VIRTUAL_CHECKSUM_ID)).toBe(true);
        expect(isVirtualModule(THEME_GROUPS_VIRTUAL_ID)).toBe(true);
        expect(isVirtualModule('virtual:someone-else')).toBe(false);
    });

    it('resolves each id to its \\0-prefixed form and unknown ids to undefined', () => {
        expect(resolveVirtualModule(VIRTUAL_MODULE_ID)).toBe(RESOLVED_VIRTUAL_MODULE_ID);
        expect(resolveVirtualModule(VIRTUAL_CHECKSUM_ID)).toBe(RESOLVED_VIRTUAL_CHECKSUM_ID);
        expect(resolveVirtualModule(THEME_GROUPS_VIRTUAL_ID)).toBe(
            RESOLVED_THEME_GROUPS_VIRTUAL_ID,
        );
        expect(resolveVirtualModule('other')).toBeUndefined();
    });
});
