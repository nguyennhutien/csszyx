/**
 * Which authored class names the project's Tailwind serves nothing for.
 *
 * This is the half of the answer that needs no bundler: given the names an
 * author wrote and a way to ask the design system, it returns the set the
 * runtime has to place by the fallback.
 */
import { describe, expect, it, vi } from 'vitest';

import { unservedAuthoredClasses } from '../src/unserved-classes.js';

/**
 * An ask that calls every listed name dead and serves everything else.
 *
 * @param dead - Names the design system produces no CSS for.
 * @returns A stand-in for the oracle's `findDead`.
 */
const deadOnly =
    (dead: readonly string[]) =>
    (classes: readonly string[]): string[] =>
        classes.filter(c => dead.includes(c));

describe('unservedAuthoredClasses', () => {
    it('keeps a name the toolkit recognises that the design system does not serve', () => {
        const found = unservedAuthoredClasses(
            ['tab-items-wrapper', 'p-4'],
            deadOnly(['tab-items-wrapper']),
        );
        expect(found).toEqual(['tab-items-wrapper']);
    });

    it('drops a name the toolkit does not recognise, which already falls back', () => {
        // `card` is placed by the fallback today, so listing it would be a
        // payload entry that changes nothing.
        expect(unservedAuthoredClasses(['card'], deadOnly(['card']))).toEqual([]);
    });

    it('drops a name the design system serves', () => {
        expect(unservedAuthoredClasses(['p-4'], deadOnly([]))).toEqual([]);
    });

    it('asks about each base once, however many times it was written', () => {
        const ask = vi.fn(deadOnly(['tab-items-wrapper']));
        unservedAuthoredClasses(
            ['tab-items-wrapper', 'hover:tab-items-wrapper', 'md:tab-items-wrapper!'],
            ask,
        );
        expect(ask).toHaveBeenCalledOnce();
        expect(ask.mock.calls[0][0]).toEqual(['tab-items-wrapper']);
    });

    it('reports the base, so a variant written in source resolves through it', () => {
        const found = unservedAuthoredClasses(
            ['hover:tab-items-wrapper'],
            deadOnly(['tab-items-wrapper']),
        );
        expect(found).toEqual(['tab-items-wrapper']);
    });

    it('sorts, so two builds of the same project emit the same module', () => {
        const found = unservedAuthoredClasses(
            ['row', 'end', 'tab-items-wrapper'],
            deadOnly(['row', 'end', 'tab-items-wrapper']),
        );
        expect(found).toEqual(['end', 'row', 'tab-items-wrapper']);
    });

    it('asks nothing when no authored name is recognised', () => {
        const ask = vi.fn(deadOnly([]));
        expect(unservedAuthoredClasses(['card', 'btn-primary'], ask)).toEqual([]);
        expect(ask).not.toHaveBeenCalled();
    });
});
