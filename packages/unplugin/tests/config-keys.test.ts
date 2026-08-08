/**
 * Unknown plugin options must be reported, not ignored.
 *
 * `compilePackages` became `compileSources` before 0.12.0. A project still
 * passing the old name got no CSS for its workspace package, no cross-module
 * precompile, and not one word from the build — the option was simply never
 * read. TypeScript catches it in a typed config; a `vite.config.js` or a config
 * widened through `as any` reaches the plugin unchecked.
 */
import { describe, expect, it } from 'vitest';

import {
    findUnknownConfigKeys,
    nearestKnownConfigKey,
    unknownConfigKeysMessage,
} from '../src/config-keys.js';

describe('findUnknownConfigKeys', () => {
    it('accepts every option the plugin reads', () => {
        expect(
            findUnknownConfigKeys({
                include: ['src/**'],
                exclude: [/generated/],
                compileSources: ['../packages/vui'],
                contentScopeCheck: false,
                quiet: 'nudges',
                mode: 'production',
                development: {},
                production: {},
                build: {},
                hydration: {},
            }),
        ).toEqual([]);
    });

    it('reports the removed performance group', () => {
        // Every option it held described work the build never did, so the group
        // went with them. Reporting it is the point: a project still passing it
        // is passing something that has not done anything for a long time, and
        // silence would leave that believable.
        expect(findUnknownConfigKeys({ performance: { parallel: true } })).toEqual([
            { key: 'performance' },
        ]);
    });

    it('names the replacement for a renamed option', () => {
        // The reported case. A guess would have been wrong here — the old and
        // new names are eight edits apart — so renames are a table, not a
        // distance.
        expect(findUnknownConfigKeys({ compilePackages: ['vui'] })).toEqual([
            { key: 'compilePackages', renamedTo: 'compileSources' },
        ]);
    });

    it('suggests the nearest option for a plausible typo', () => {
        expect(findUnknownConfigKeys({ compileSource: [] })).toEqual([
            { key: 'compileSource', suggestion: 'compileSources' },
        ]);
    });

    it('reports an unrecognizable key with no guess attached', () => {
        expect(findUnknownConfigKeys({ zzzNotAnOption: 1 })).toEqual([{ key: 'zzzNotAnOption' }]);
    });

    it('preserves authoring order across several unknown keys', () => {
        expect(findUnknownConfigKeys({ compilePackages: [], quiet: true, nope: 1 })).toEqual([
            { key: 'compilePackages', renamedTo: 'compileSources' },
            { key: 'nope' },
        ]);
    });

    it('treats a missing or non-object config as having nothing to check', () => {
        // The plugin is callable with no arguments at all.
        expect(findUnknownConfigKeys(undefined)).toEqual([]);
        expect(findUnknownConfigKeys(null)).toEqual([]);
        expect(findUnknownConfigKeys(['compileSources'])).toEqual([]);
        expect(findUnknownConfigKeys('quiet')).toEqual([]);
    });
});

describe('nearestKnownConfigKey', () => {
    it('matches case-insensitively', () => {
        expect(nearestKnownConfigKey('CompileSources')).toBe('compileSources');
    });

    it('keeps the budget tight enough that short names do not cross-match', () => {
        // `quiet` and `mode` are both short; neither should claim the other.
        expect(nearestKnownConfigKey('quiet')).toBe('quiet');
        expect(nearestKnownConfigKey('silent')).toBeNull();
    });

    it('returns null when nothing is close', () => {
        expect(nearestKnownConfigKey('zzzNotAnOption')).toBeNull();
    });
});

describe('unknownConfigKeysMessage', () => {
    it('states the count, each key, and that an unread option does nothing', () => {
        const message = unknownConfigKeysMessage([
            { key: 'compilePackages', renamedTo: 'compileSources' },
            { key: 'compileSource', suggestion: 'compileSources' },
            { key: 'nope' },
        ]);
        expect(message).toContain('3 plugin option(s) are not recognized');
        expect(message).toContain('`compilePackages` was replaced by `compileSources`');
        expect(message).toContain('did you mean `compileSources`?');
        expect(message).toContain('- `nope`');
        expect(message).toContain('is not happening');
    });
});
