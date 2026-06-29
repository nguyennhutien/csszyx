import { describe, expect, it } from 'vitest';

import { collectMangleHybridHazards, mangleHybridHazardMessage } from '../src/unplugin.js';

describe('collectMangleHybridHazards', () => {
    it('flags tokens that collide with literal class names in external CSS', () => {
        // `w-full`→`y`, `top-0`→`x`; the app authors literal `.x`/`.y` resize
        // handles, so those classes show up as external (non-map) class names.
        const map = { 'w-full': 'y', 'top-0': 'x', 'p-4': 'a' };
        const mangledSources = new Set(['w-full', 'top-0', 'p-4']);
        const externalClasses = new Set(['x', 'y', 'draggable']);

        const { collisions, orphans } = collectMangleHybridHazards(
            map,
            mangledSources,
            externalClasses,
        );

        expect(collisions).toEqual(['x', 'y']);
        expect(orphans).toEqual([]);
    });

    it('flags map sources whose class never produced a CSS rule (orphans)', () => {
        const map = { 'p-4': 'a', 'bg-violet-a-100': 'f7', '4-0': 'g3' };
        // Only `p-4` actually appeared and was mangled in some asset.
        const mangledSources = new Set(['p-4']);
        const externalClasses = new Set<string>();

        const { collisions, orphans } = collectMangleHybridHazards(
            map,
            mangledSources,
            externalClasses,
        );

        expect(collisions).toEqual([]);
        expect(orphans).toEqual(['4-0', 'bg-violet-a-100']);
    });

    it('returns nothing to warn for a clean, csszyx-owned build', () => {
        const hazards = collectMangleHybridHazards(
            { 'p-4': 'a', flex: 'b' },
            new Set(['p-4', 'flex']),
            new Set(['some-app-class']), // external, but not a token value
        );
        expect(hazards.collisions).toEqual([]);
        expect(hazards.orphans).toEqual([]);
        expect(mangleHybridHazardMessage(hazards)).toBeNull();
    });

    it('points collisions at the scan-collisions CLI to keep mangling on', () => {
        const message = mangleHybridHazardMessage({
            collisions: ['x', 'y'],
            orphans: ['bg-violet-a-100'],
        });
        expect(message).toContain('collide');
        expect(message).toContain('no emitted CSS rule');
        expect(message).toContain('scan-collisions');
        expect(message).toContain('mangleExclude');
    });

    it('suggests disabling mangle when there are only orphans, no collisions', () => {
        const message = mangleHybridHazardMessage({ collisions: [], orphans: ['bg-violet-a-100'] });
        expect(message).toContain('production.mangle: false');
    });
});
