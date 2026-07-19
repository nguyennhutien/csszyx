/**
 * Umbrella export-surface lock.
 *
 * The documentation tells users `import { szr, szcn } from 'csszyx'` works —
 * but the umbrella re-export list is hand-maintained, so a helper can exist in
 * `@csszyx/runtime`, be documented as importable from `csszyx`, and silently
 * be missing here (szr/szcn shipped that way for several releases). This test
 * pins the documented public authoring surface so removing or forgetting a
 * name fails CI instead of only failing in a user's project.
 */
import { describe, expect, it } from 'vitest';

import * as csszyx from '../src/index.js';

describe('csszyx umbrella exports', () => {
    it('exposes the documented authoring helpers', () => {
        // Public composition/authoring names users import from `csszyx`.
        for (const name of ['szr', 'szcn', 'szv'] as const) {
            // biome-ignore lint/performance/noDynamicNamespaceImportAccess: enumerating the export surface is this test's purpose
            expect(typeof csszyx[name], name).toBe('function');
        }
    });

    it('exposes the compiler-injected helpers and plugin entry points', () => {
        for (const name of [
            '_sz',
            '_szMerge',
            'transform',
            'vitePlugin',
            'webpackPlugin',
        ] as const) {
            // biome-ignore lint/performance/noDynamicNamespaceImportAccess: enumerating the export surface is this test's purpose
            expect(typeof csszyx[name], name).toBe('function');
        }
    });
});
