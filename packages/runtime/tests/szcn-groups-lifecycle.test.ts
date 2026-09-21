/**
 * The theme-group registry as a lifecycle, not an append-only log.
 *
 * `registerSzcnGroups` could only ever ADD. That is enough while a build runs
 * once, and wrong the moment a dev server re-runs it: deleting or renaming a
 * `@theme` token left the old name registered, so `classify` and `splitBox`
 * kept routing classes the stylesheet no longer defines. The build regenerated correctly and the
 * browser ignored it.
 *
 * Two producers write here — the build's scan and an app registering
 * hand-written CSS — so a replace has to say WHOSE entries it replaces, or the
 * build would silently wipe the app's registration on every rebuild.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
    _resetSzcnGroups,
    clearSzcnGroups,
    getSzcnGroups,
    getSzcnGroupsGeneration,
    registerSzcnGroups,
    setSzcnGroups,
} from '../src/merge-groups.js';

import { sameGroup } from './helpers/same-group.js';

afterEach(() => {
    _resetSzcnGroups();
});

describe('replacing a source', () => {
    it('drops a token the new set no longer declares', () => {
        setSzcnGroups({ colors: ['brand', 'accent'] }, 'build');
        expect(sameGroup('text', 'brand', 'accent')).toBe(true);

        // The stylesheet lost `--color-accent`; the token must leave its group.
        setSzcnGroups({ colors: ['brand'] }, 'build');
        expect(sameGroup('text', 'brand', 'accent')).toBe(false);
    });

    it('leaves another source alone', () => {
        registerSzcnGroups({ colors: ['handwritten'] });
        setSzcnGroups({ colors: ['scanned'] }, 'build');
        expect(sameGroup('text', 'handwritten', 'scanned')).toBe(true);

        // A rebuild replaces only what the build owns.
        setSzcnGroups({ colors: [] }, 'build');
        expect(sameGroup('text', 'handwritten', 'scanned')).toBe(false);
        expect(getSzcnGroups().colors).toEqual(['handwritten']);
    });
});

describe('clearing', () => {
    it('removes one source and keeps the rest', () => {
        registerSzcnGroups({ colors: ['manual'] });
        setSzcnGroups({ colors: ['built'] }, 'build');

        clearSzcnGroups('build');

        expect(getSzcnGroups().colors).toEqual(['manual']);
    });

    it('removes everything when given no source', () => {
        registerSzcnGroups({ colors: ['manual'] });
        setSzcnGroups({ colors: ['built'] }, 'build');

        clearSzcnGroups();

        expect(getSzcnGroups().colors).toEqual([]);
    });
});

describe('reading', () => {
    it('reports the effective sets, sorted and copied', () => {
        registerSzcnGroups({ colors: ['b', 'a'], fontWeights: ['chunky'] });

        const first = getSzcnGroups();
        expect(first.colors).toEqual(['a', 'b']);
        expect(first.fontWeights).toEqual(['chunky']);

        // A caller must not be able to mutate the registry through the result.
        first.colors.push('injected');
        expect(getSzcnGroups().colors).toEqual(['a', 'b']);
    });

    it('omits a name the guard rails rejected', () => {
        // `cover` would misclassify `bg-cover`, so it never enters the registry
        // and reading must not claim otherwise.
        registerSzcnGroups({ colors: ['cover', 'safe'] });
        expect(getSzcnGroups().colors).toEqual(['safe']);
    });
});

describe('registering stays additive', () => {
    it('accumulates across calls within one source', () => {
        registerSzcnGroups({ colors: ['one'] });
        registerSzcnGroups({ colors: ['two'] });
        expect(getSzcnGroups().colors).toEqual(['one', 'two']);
    });
});

describe('clearing a source that never registered', () => {
    it('changes nothing and does not bump the generation', () => {
        // The early return matters because the generation counter is what
        // invalidates szcn's memo. Recomputing on a no-op clear would flush the
        // cache of every merge on the page for a source that was never there.
        registerSzcnGroups({ colors: ['brand'] }, 'build');
        const generation = getSzcnGroupsGeneration();

        clearSzcnGroups('a-source-nobody-registered');

        expect(getSzcnGroupsGeneration()).toBe(generation);
        expect(getSzcnGroups().colors).toContain('brand');
    });
});
