/**
 * `stripVariant` and `normalizeBase` are public.
 *
 * Both existed in `split-box.ts` and were exported from it, but not from the
 * package entry, so a component that needed to tell a variant token from a
 * plain one — "did the caller set a width at the base breakpoint?" — had to
 * copy the bracket-depth scanner. The copies got the easy cases right and the
 * hard ones wrong: `[&:hover]:w-4` cut at the colon inside the brackets, and
 * `w-[url(http://a/b)]` was read as having a variant.
 */
import { describe, expect, it } from 'vitest';
import { normalizeBase, stripVariant } from '../src/index.js';

describe('stripVariant from the package entry', () => {
    it.each([
        ['w-4', 'w-4'],
        ['md:w-24', 'w-24'],
        ['dark:md:hover:w-4', 'w-4'],
        ['[&:hover]:w-full', 'w-full'],
        ['supports-[display:grid]:w-4', 'w-4'],
        ['@max-[600px]:w-4', 'w-4'],
        ['aria-[sort=asc]:w-4', 'w-4'],
        ['group-has-[:checked]:w-4', 'w-4'],
        ['md:!w-4', '!w-4'],
        ['md:-mt-4', '-mt-4'],
        ['bg-[url(http://a/b)]', 'bg-[url(http://a/b)]'],
        ["content-['a:b']", "content-['a:b']"],
        ['[color:red]', '[color:red]'],
    ])('%s → %s', (token, base) => {
        expect(stripVariant(token)).toBe(base);
    });

    it('lets a caller tell a base-breakpoint token from a variant one', () => {
        const isBase = (token: string): boolean => stripVariant(token) === token;
        expect(isBase('w-4')).toBe(true);
        expect(isBase('md:w-4')).toBe(false);
        expect(isBase('bg-[url(http://a/b)]')).toBe(true);
    });
});

describe('normalizeBase from the package entry', () => {
    it.each([
        ['!w-4', 'w-4'],
        ['w-4!', 'w-4'],
        ['-mt-4', 'mt-4'],
        ['w-4', 'w-4'],
    ])('%s → %s', (base, normalized) => {
        expect(normalizeBase(base)).toBe(normalized);
    });
});

describe('the base-breakpoint idiom on a mangled build', () => {
    it('decodes before it compares, or a responsive token passes as base', async () => {
        const { clearMangleRegistry, installMangleRuntime } = await import(
            '../src/mangle-registry.js'
        );
        const { szDecode } = await import('../src/index.js');
        installMangleRuntime({ mangleMap: { 'md:w-1/2': 'f', 'w-4': 'g' }, checksum: 'idiom' });
        try {
            const isBase = (token: string): boolean => {
                const original = szDecode(token);
                return stripVariant(original) === original;
            };
            expect(isBase('f')).toBe(false);
            expect(isBase('g')).toBe(true);
            // The naive form is what a reader copies by mistake.
            expect(stripVariant('f') === 'f').toBe(true);
        } finally {
            clearMangleRegistry();
        }
    });
});
