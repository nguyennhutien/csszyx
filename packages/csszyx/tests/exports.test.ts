/**
 * Umbrella export-surface lock.
 *
 * The documentation tells users `import { szr, szcn } from 'csszyx'` works —
 * but the umbrella re-export list is hand-maintained, so a helper can exist in
 * `@csszyx/runtime`, be documented as importable from `csszyx`, and silently
 * be missing here (szr/szcn shipped that way for several releases). This test
 * pins the documented public authoring surface so removing or forgetting a
 * name fails CI instead of only failing in a user's project.
 *
 * The same names have to survive the split between the node entry and the
 * `browser`-condition entry, so both are checked against one list: a browser
 * bundle silently losing `szcn` would be the same class of defect, found by
 * users instead of by CI.
 */
import { describe, expect, it } from 'vitest';

import * as browserEntry from '../src/index.browser.js';
import * as csszyx from '../src/index.js';

/** Public composition/authoring names users import from `csszyx`. */
const AUTHORING_HELPERS = ['szr', 'szcn', 'szv'] as const;

/** Helpers the compiler injects into transformed modules. */
const INJECTED_HELPERS = ['_sz', '_szMerge'] as const;

describe('csszyx umbrella exports', () => {
    it('exposes the documented authoring helpers', () => {
        for (const name of AUTHORING_HELPERS) {
            // biome-ignore lint/performance/noDynamicNamespaceImportAccess: enumerating the export surface is this test's purpose
            expect(typeof csszyx[name], name).toBe('function');
        }
    });

    it('exposes the compiler-injected helpers and plugin entry points', () => {
        for (const name of [
            ...INJECTED_HELPERS,
            'transform',
            'vitePlugin',
            'webpackPlugin',
        ] as const) {
            // biome-ignore lint/performance/noDynamicNamespaceImportAccess: enumerating the export surface is this test's purpose
            expect(typeof csszyx[name], name).toBe('function');
        }
    });

    it('carries the authoring and injected helpers on the browser entry too', () => {
        for (const name of [...AUTHORING_HELPERS, ...INJECTED_HELPERS]) {
            // biome-ignore lint/performance/noDynamicNamespaceImportAccess: enumerating the export surface is this test's purpose
            expect(typeof browserEntry[name], name).toBe('function');
        }
    });

    it('keeps the build-time surface off the browser entry', () => {
        // Not cosmetic: naming any of these reaches `@csszyx/core/native`,
        // `oxc-parser` or `node:fs`, and a bundler fails at RESOLVE — so one
        // re-export added back here breaks every client import of `csszyx`,
        // including the ones that never mention the compiler.
        for (const name of ['transform', 'vitePlugin', 'webpackPlugin', 'encode']) {
            expect(Object.keys(browserEntry), name).not.toContain(name);
        }
    });
});
