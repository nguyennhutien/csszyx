/**
 * A class the project's Tailwind does not serve is placed by the fallback,
 * exactly as a class nothing classifies already is.
 *
 * `classify` matches by class PREFIX with no knowledge of which suffixes
 * Tailwind accepts, so an app's own `tab-items-wrapper` reads as a `tab-size`
 * utility and a rule sends it to the inner node. The build knows better: it
 * compiles the project's real design system and can say the name produces no
 * CSS. Handing that list to the runtime turns a wrong rule into the same
 * fallback that already handles `card`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { splitBox } from '../src/split-box.js';
import { getUnservedGeneration, registerUnservedClasses } from '../src/unserved-classes.js';

afterEach(() => {
    registerUnservedClasses([]);
    vi.restoreAllMocks();
});

describe('unserved classes', () => {
    it('routes a recognised-but-unserved token by a rule until the build says otherwise', () => {
        // The bug, stated as a test: the prefix matched, so a rule placed it.
        expect(splitBox('tab-items-wrapper p-4')).toEqual({
            outer: '',
            inner: 'tab-items-wrapper p-4',
        });
    });

    it('places it by the fallback once registered', () => {
        registerUnservedClasses(['tab-items-wrapper']);
        expect(splitBox('tab-items-wrapper p-4')).toEqual({
            outer: 'tab-items-wrapper',
            inner: 'p-4',
        });
    });

    it('honours an explicit fallback role', () => {
        registerUnservedClasses(['tab-items-wrapper']);
        expect(splitBox('tab-items-wrapper p-4', { fallback: 'inner' })).toEqual({
            outer: '',
            inner: 'tab-items-wrapper p-4',
        });
    });

    it('stays silent, because the build already resolved the ambiguity', () => {
        // The unplaced warning asks the developer to decide. Here the build
        // decided, correctly, so asking again is the noise this design exists
        // to remove.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerUnservedClasses(['tab-items-wrapper']);
        splitBox('tab-items-wrapper p-4');
        expect(warn).not.toHaveBeenCalled();
    });

    it('still warns for a class nothing classifies at all', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        splitBox('card p-4');
        expect(warn).toHaveBeenCalledOnce();
    });

    it('follows the variant to its base', () => {
        registerUnservedClasses(['tab-items-wrapper']);
        expect(splitBox('hover:tab-items-wrapper p-4')).toEqual({
            outer: 'hover:tab-items-wrapper',
            inner: 'p-4',
        });
    });

    it('leaves a served class alone', () => {
        registerUnservedClasses(['tab-items-wrapper']);
        expect(splitBox('p-4 mt-2')).toEqual({ outer: 'mt-2', inner: 'p-4' });
    });

    it('does not bump the generation when the build reports the same set', () => {
        // A dev server re-running an unchanged build re-executes the generated
        // module. Bumping here would flush every memo for no reason.
        registerUnservedClasses(['tab-items-wrapper', 'row']);
        const after = getUnservedGeneration();
        registerUnservedClasses(['row', 'tab-items-wrapper']);
        expect(getUnservedGeneration()).toBe(after);
    });

    it('bumps the generation when a rebuild drops a name', () => {
        registerUnservedClasses(['tab-items-wrapper', 'row']);
        const after = getUnservedGeneration();
        registerUnservedClasses(['row']);
        expect(getUnservedGeneration()).toBe(after + 1);
        // Replaced rather than merged: the dropped name is back under a rule.
        expect(splitBox('tab-items-wrapper p-4')).toEqual({
            outer: '',
            inner: 'tab-items-wrapper p-4',
        });
    });

    it('emptying an already-empty registry changes nothing', () => {
        const before = getUnservedGeneration();
        registerUnservedClasses([]);
        expect(getUnservedGeneration()).toBe(before);
    });
});
