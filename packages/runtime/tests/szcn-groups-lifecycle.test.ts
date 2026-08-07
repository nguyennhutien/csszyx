/**
 * The theme-group registry as a lifecycle, not an append-only log.
 *
 * `registerSzcnGroups` could only ever ADD. That is enough while a build runs
 * once, and wrong the moment a dev server re-runs it: deleting or renaming a
 * `@theme` token left the old name registered, so `szcn` kept merging classes
 * the stylesheet no longer defines. The build regenerated correctly and the
 * browser ignored it.
 *
 * Two producers write here — the build's scan and an app registering
 * hand-written CSS — so a replace has to say WHOSE entries it replaces, or the
 * build would silently wipe the app's registration on every rebuild.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { szcn } from '../src/merge-classes.js';
import {
    _resetSzcnGroups,
    clearSzcnGroups,
    getSzcnGroups,
    registerSzcnGroups,
    setSzcnGroups,
} from '../src/merge-groups.js';

afterEach(() => {
    _resetSzcnGroups();
});

describe('replacing a source', () => {
    it('drops a token the new set no longer declares', () => {
        setSzcnGroups({ colors: ['brand', 'accent'] }, 'build');
        expect(szcn('text-brand', 'text-accent')).toBe('text-accent');

        // The stylesheet lost `--color-accent`; the classes must stop merging.
        setSzcnGroups({ colors: ['brand'] }, 'build');
        expect(szcn('text-brand', 'text-accent')).toBe('text-brand text-accent');
    });

    it('leaves another source alone', () => {
        registerSzcnGroups({ colors: ['handwritten'] });
        setSzcnGroups({ colors: ['scanned'] }, 'build');
        expect(szcn('text-handwritten', 'text-scanned')).toBe('text-scanned');

        // A rebuild replaces only what the build owns.
        setSzcnGroups({ colors: [] }, 'build');
        expect(szcn('text-handwritten', 'text-other')).toBe('text-handwritten text-other');
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
