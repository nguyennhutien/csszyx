import { afterEach, describe, expect, it } from 'vitest';
import { _szcn, registerMergeSignatures, szcn } from '../src/index.js';
import { clearMangleRegistry, installMangleRuntime } from '../src/mangle-registry.js';
import { __resetMergeSignaturesForTests } from '../src/merge-signatures.js';

describe('szcn — build-generated merge signatures', () => {
    afterEach(__resetMergeSignaturesForTests);
    afterEach(clearMangleRegistry);

    it('uses full-set coverage instead of a shared utility prefix', () => {
        registerMergeSignatures([
            {
                'outline-hidden': 0,
                'outline-none': 1,
                'text-2xl': 2,
                'text-[0.8rem]': 3,
                transition: 4,
                'transition-none': 5,
            },
            [[0], [1], [2], [3], [4], [5]],
        ]);

        expect(szcn('text-2xl', 'text-[0.8rem]')).toBe('text-2xl text-[0.8rem]');
        expect(szcn('transition', 'transition-none')).toBe('transition transition-none');
        expect(szcn('outline-hidden', 'outline-none')).toBe('outline-hidden outline-none');
    });

    it('lets a later full signature cover an earlier subset', () => {
        registerMergeSignatures([{ 'pb-2': 0, 'p-4': 1 }, [[0], [0, 1]]]);

        expect(szcn('pb-2', 'p-4')).toBe('p-4');
        expect(szcn('p-4', 'pb-2')).toBe('p-4 pb-2');
    });

    it('never deletes a token missing from the generated table', () => {
        registerMergeSignatures([{ 'p-4': 0 }, [[0]]]);

        expect(szcn('library-token', 'library-token-next')).toBe(
            'library-token library-token-next',
        );
    });

    it('reads an id with no coverage row as covering only itself', () => {
        // A table cut short must not cost the one merge that needs no
        // evidence: the same class written twice is still one class.
        registerMergeSignatures([{ 'p-4': 0, 'p-8': 1 }, [[0]]]);

        expect(szcn('p-8', 'p-8')).toBe('p-8');
        expect(szcn('p-4', 'p-8')).toBe('p-4 p-8');
    });

    it('replaces a class of the same signature when its row leaves itself out', () => {
        registerMergeSignatures([{ 'shadow-brand': 0, 'shadow-danger': 0 }, [[]]]);

        expect(szcn('shadow-brand', 'shadow-danger')).toBe('shadow-danger');
    });

    it('keeps unknown class spellings separate from numeric signature ids', () => {
        registerMergeSignatures([{ 'p-4': 0 }, [[0]]]);
        expect(szcn('#0', 'p-4')).toBe('#0 p-4');
        expect(szcn('p-4', '#0')).toBe('p-4 #0');
    });

    it('uses signature zero for aliases without swallowing a numeric-looking unknown', () => {
        registerMergeSignatures([{ first: 0, last: 0 }, [[0]]]);
        for (const merge of [szcn, _szcn]) {
            expect(merge('first', '0', 'last')).toBe('0 last');
            expect(merge('unknown', 'first', 'unknown', 'last')).toBe('unknown last');
        }
    });

    it('treats inherited object names as unknown classes', () => {
        registerMergeSignatures([{ 'p-4': 0 }, [[0]]]);
        expect(szcn('constructor toString __proto__')).toBe('constructor toString __proto__');
        expect(szcn('constructor constructor')).toBe('constructor');
    });

    it('does not read numeric signature ids from a prototype', () => {
        const classes = Object.assign(Object.create({ inherited: 0 }), { 'p-4': 0 });
        registerMergeSignatures([classes, [[0]]]);
        expect(szcn('inherited', 'p-4')).toBe('inherited p-4');
    });

    it('uses decoded names while preserving the encoded surviving tokens', () => {
        registerMergeSignatures([{ 'pb-2': 0, 'p-4': 1 }, [[0], [0, 1]]]);
        installMangleRuntime({
            mangleMap: { 'pb-2': 'x', 'p-4': 'y' },
            checksum: 'signature-test',
        });
        for (const merge of [szcn, _szcn]) {
            expect(merge('#0 x', 'y')).toBe('#0 y');
            expect(merge('pb-2', 'y')).toBe('y');
        }
    });

    it.each([64, 256, 1024])('preserves numeric-looking unknowns at %i signatures', size => {
        const names = Array.from({ length: size }, (_, id) => `class-${id}`);
        registerMergeSignatures([
            Object.fromEntries(names.map((name, id) => [name, id])),
            names.map((_, id) => [id]),
        ]);
        for (const merge of [szcn, _szcn]) {
            const tokens = names.flatMap((name, id) => [`#${id}`, name]);
            const expected = tokens.join(' ');
            expect(merge(...tokens)).toBe(expected);
            expect(merge(expected)).toBe(expected);
            expect(merge(merge(expected))).toBe(expected);
        }
    });
});

describe('szcn — before a build registers merge signatures', () => {
    afterEach(__resetMergeSignaturesForTests);

    // Nothing has compiled the project's CSS yet, so nothing has proved that
    // two classes set the same properties. A shared prefix is a spelling, and a
    // spelling is not evidence: deleting on it is the false delete the
    // generated table exists to end.
    it.each([
        ['a shared spacing prefix', ['p-4', 'p-2'], 'p-4 p-2'],
        ['a shorthand after its longhand', ['pb-2', 'p-4'], 'pb-2 p-4'],
        [
            'a font size with its own line height',
            ['text-2xl', 'text-[0.8rem]'],
            'text-2xl text-[0.8rem]',
        ],
        ['the same variant on both', ['hover:p-4', 'hover:p-2'], 'hover:p-4 hover:p-2'],
        ['an important flag on one side', ['p-4!', 'p-2'], 'p-4! p-2'],
    ])('keeps both classes for %s', (_case, tokens, expected) => {
        for (const merge of [szcn, _szcn]) expect(merge(...tokens)).toBe(expected);
    });

    it('re-derives a merge that was memoised before the table arrived', () => {
        // The memo is a performance layer and must never change a result: an
        // answer cached while nothing was proved cannot outlive the proof.
        expect(szcn('pb-2', 'p-4')).toBe('pb-2 p-4');
        registerMergeSignatures([{ 'pb-2': 0, 'p-4': 1 }, [[0], [0, 1]]]);
        expect(szcn('pb-2', 'p-4')).toBe('p-4');
        __resetMergeSignaturesForTests();
        expect(szcn('pb-2', 'p-4')).toBe('pb-2 p-4');
    });

    it('still drops an exact duplicate, keeping the later position', () => {
        for (const merge of [szcn, _szcn]) {
            expect(merge('p-4 p-4', 'p-4')).toBe('p-4');
            expect(merge('p-4', 'm-2', 'p-4')).toBe('m-2 p-4');
        }
    });

    it.each([64, 256, 1024])('keeps %i classes that share one prefix, byte for byte', size => {
        const tokens = Array.from({ length: size }, (_, n) => `p-${n}`);
        const expected = tokens.join(' ');
        for (const merge of [szcn, _szcn]) {
            expect(merge(...tokens)).toBe(expected);
            expect(merge(merge(...tokens))).toBe(expected);
            expect(merge(...tokens)).toBe(merge(...tokens));
        }
    });
});
