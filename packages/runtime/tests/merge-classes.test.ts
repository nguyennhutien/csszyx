import { afterEach, describe, expect, it } from 'vitest';
import { _szMerge } from '../src/concatenate.js';
import { _szcn, szcn } from '../src/merge-classes.js';

// szcn is the single resolution point for a layered design-system
// component (Box < Flex < Row/Col): combine default classes with the forwarded
// override, last-wins per utility, while staying mangle-aware (unlike npm
// tailwind-merge). These lock the override contract + the fail-safe
// (never drop a class we can't confidently group).

describe('szcn — single-property override (last wins)', () => {
    it('overrides the same utility, keeps unrelated classes', () => {
        expect(szcn('gap-2 p-4', 'gap-8')).toBe('p-4 gap-8');
    });

    it('concatenates when there is no collision', () => {
        expect(szcn('m-4', 'p-2')).toBe('m-4 p-2');
    });

    it('overrides spacing/sizing/rounded by prefix', () => {
        expect(szcn('p-2', 'p-8')).toBe('p-8');
        expect(szcn('w-1/2', 'w-full')).toBe('w-full');
        expect(szcn('rounded-md', 'rounded-xl')).toBe('rounded-xl');
    });

    it('keeps the last occurrence position for an overridden utility', () => {
        // gap-2 then m-4 then gap-8 → gap survivor takes gap-8's later slot
        expect(szcn('gap-2 m-4 gap-8')).toBe('m-4 gap-8');
    });
});

describe('szcn — variant isolation', () => {
    it('does not let a base utility override its responsive variant', () => {
        expect(szcn('gap-2', 'md:gap-8')).toBe('gap-2 md:gap-8');
    });

    it('overrides within the same responsive variant', () => {
        expect(szcn('md:gap-2', 'md:gap-8')).toBe('md:gap-8');
    });

    it('isolates state variants from the base and each other', () => {
        expect(szcn('gap-2', 'hover:gap-8')).toBe('gap-2 hover:gap-8');
        expect(szcn('hover:p-2', 'hover:p-8')).toBe('hover:p-8');
    });

    it('keeps responsive + state combos distinct', () => {
        expect(szcn('md:hover:p-2 p-1', 'p-8')).toBe('md:hover:p-2 p-8');
    });
});

describe('szcn — fail-safe: never drop an ambiguous/unknown class', () => {
    it('under-merges flex-* (flex shorthand vs flex-direction are different properties)', () => {
        expect(szcn('flex-1', 'flex-row')).toBe('flex-1 flex-row');
    });

    it('under-merges text-* (font-size vs text-color)', () => {
        expect(szcn('text-sm', 'text-red-500')).toBe('text-sm text-red-500');
    });

    it('under-merges bg-* (color vs position vs size)', () => {
        expect(szcn('bg-red-500', 'bg-cover')).toBe('bg-red-500 bg-cover');
    });

    it('never drops an unrecognized custom class', () => {
        expect(szcn('my-custom-thing', 'p-4')).toBe('my-custom-thing p-4');
        expect(szcn('a b', 'c')).toBe('a b c');
    });

    it('groups font-* by property (family vs weight never merged into each other)', () => {
        // Regression: `font` was NOT in the ambiguous set, so the prefix merge
        // deleted `font-sans` when `font-bold` followed — a wrongly-dropped
        // class across two CSS properties.
        expect(szcn('font-sans', 'font-bold')).toBe('font-sans font-bold');
        // Same-property pairs dedupe last-wins via value-set classification
        // (merge-groups.ts); exact duplicates dedupe by name as always.
        expect(szcn('font-semibold', 'font-normal')).toBe('font-normal');
        expect(szcn('font-bold', 'font-bold')).toBe('font-bold');
    });

    it('under-merges exact value-keyed display tokens (flex vs block)', () => {
        // both set `display`, but the box-role map keys them only by category,
        // so they are under-merged rather than risk dropping a sibling.
        expect(szcn('flex', 'block')).toBe('flex block');
    });
});

describe('szcn — directional shorthand/longhand override (padding/margin)', () => {
    it('a later longhand refines an earlier shorthand (keeps both)', () => {
        // default p-4, override pb-8 → padding all + bottom override
        expect(szcn('p-4', 'pb-8')).toBe('p-4 pb-8');
        expect(szcn('m-8', 'mb-2')).toBe('m-8 mb-2');
    });

    it('a later shorthand overrides an earlier longhand it subsumes', () => {
        // default pb-4, override p-8 → p-8 wins (the reverse-direction fix)
        expect(szcn('pb-4', 'p-8')).toBe('p-8');
        expect(szcn('mt-2', 'm-8')).toBe('m-8');
    });

    it('a later mid-axis shorthand overrides the longhands it covers', () => {
        expect(szcn('pl-4', 'px-2')).toBe('px-2'); // px covers pl/pr
        expect(szcn('px-2', 'pl-4')).toBe('px-2 pl-4'); // pl refines px-left
    });

    it('keeps distinct shorthand + non-covered longhand', () => {
        expect(szcn('p-4', 'px-2')).toBe('p-4 px-2'); // px refines x
        expect(szcn('px-2', 'p-4')).toBe('p-4'); // p subsumes px
    });

    it('isolates directional coverage by variant', () => {
        // a base p-8 must not remove an md: longhand, and vice-versa
        expect(szcn('md:pb-4', 'p-8')).toBe('md:pb-4 p-8');
        expect(szcn('p-4', 'md:p-8')).toBe('p-4 md:p-8');
    });

    it('does not let padding coverage touch margin', () => {
        expect(szcn('mb-4', 'p-8')).toBe('mb-4 p-8');
    });
});

describe('szcn — directional override (inset / rounded)', () => {
    it('inset subsumes axis + physical sides; refinement keeps both', () => {
        expect(szcn('top-0', 'inset-0')).toBe('inset-0');
        expect(szcn('inset-x-2', 'inset-0')).toBe('inset-0');
        expect(szcn('inset-0', 'top-4')).toBe('inset-0 top-4');
        expect(szcn('left-0', 'inset-x-2')).toBe('inset-x-2');
        expect(szcn('inset-x-2', 'left-0')).toBe('inset-x-2 left-0');
        expect(szcn('inset-x-2', 'top-4')).toBe('inset-x-2 top-4'); // x vs y → both
    });

    it('rounded subsumes edges + corners; refinement keeps both', () => {
        expect(szcn('rounded-t-sm', 'rounded-lg')).toBe('rounded-lg');
        expect(szcn('rounded-tl-sm', 'rounded-t-lg')).toBe('rounded-t-lg');
        expect(szcn('rounded-lg', 'rounded-t-sm')).toBe('rounded-lg rounded-t-sm');
        expect(szcn('rounded-tl-sm', 'rounded-r-lg')).toBe('rounded-tl-sm rounded-r-lg'); // tl ∉ r
    });

    it('keeps logical sides/corners separate from physical (RTL-safe under-merge)', () => {
        // start/end (logical) and rounded-s/e are a different CSS longhand that can
        // flip under RTL, so they are not crossed with physical — keep both.
        expect(szcn('start-0', 'inset-0')).toBe('start-0 inset-0');
        expect(szcn('rounded-s-lg', 'rounded-lg')).toBe('rounded-s-lg rounded-lg');
    });

    it('does not let inset coverage touch rounded or spacing', () => {
        expect(szcn('rounded-lg', 'inset-0')).toBe('rounded-lg inset-0');
        expect(szcn('p-4', 'inset-0')).toBe('p-4 inset-0');
    });
});

describe('szcn — input handling', () => {
    it('skips falsy inputs', () => {
        expect(szcn('p-4', false, null, undefined, '', 'm-2')).toBe('p-4 m-2');
    });

    it('returns empty for all-falsy / empty', () => {
        expect(szcn()).toBe('');
        expect(szcn(false, null, undefined, '')).toBe('');
        expect(szcn('   ')).toBe('');
    });

    it('splits on any whitespace and dedupes an exact duplicate', () => {
        expect(szcn('p-4\n  m-2', 'p-4')).toBe('m-2 p-4');
    });

    it('overrides arbitrary values of a single-property utility', () => {
        expect(szcn('w-[337px]', 'w-[400px]')).toBe('w-[400px]');
    });

    it('treats important / negative markers as the same utility for override', () => {
        expect(szcn('mt-2', '-mt-4')).toBe('-mt-4');
        expect(szcn('p-2', '!p-8')).toBe('!p-8');
    });
});

describe('szcn — mangle-aware (the reason this exists)', () => {
    afterEach(() => {
        (globalThis as { __csszyx?: unknown }).__csszyx = undefined;
    });

    const withDecode = (map: Record<string, string>) => {
        (globalThis as { __csszyx?: { decode: (c: string) => string | undefined } }).__csszyx = {
            decode: c => map[c],
        };
    };

    it('overrides two MANGLED classes of the same utility', () => {
        // q3 = gap-2, q7 = gap-8 → q7 wins, returned in its mangled form
        withDecode({ q3: 'gap-2', q7: 'gap-8' });
        expect(szcn('q3', 'q7')).toBe('q7');
    });

    it('keeps mangled classes of different utilities', () => {
        withDecode({ q3: 'gap-2', q9: 'p-4' });
        expect(szcn('q3', 'q9')).toBe('q3 q9');
    });

    it('handles a mangled default + a raw (unmangled) literal override', () => {
        withDecode({ q3: 'gap-2' });
        // q3 (gap-2) and a raw flex-1 literal — different utilities, both kept
        expect(szcn('q3 flex-1', 'm-4')).toBe('q3 flex-1 m-4');
    });

    it('falls back to the token itself when no decode map is present', () => {
        // production-without-map / dev: tokens are already original names
        expect(szcn('gap-2', 'gap-8')).toBe('gap-8');
    });
});

describe('szcn — custom @theme semantic colors', () => {
    // bg-warning / bg-danger are both background-color (the `bg` prefix). Today
    // `bg` is in the ambiguous set, so they under-merge (safe). This documents
    // the v1 behavior; a future conflict-group pass could override them.
    it('under-merges semantic background colors (v1 ambiguous bg)', () => {
        expect(szcn('bg-warning', 'bg-danger')).toBe('bg-warning bg-danger');
    });

    it('still overrides an unambiguous text-adjacent utility like leading', () => {
        expect(szcn('leading-4', 'leading-8')).toBe('leading-8');
    });
});

describe('szcn — decode resilience (a broken map must never crash the merge)', () => {
    afterEach(() => {
        (globalThis as { __csszyx?: unknown }).__csszyx = undefined;
    });
    const setDecode = (decode: (c: string) => unknown) => {
        (globalThis as { __csszyx?: unknown }).__csszyx = { decode };
    };

    it('falls back to raw tokens when decode THROWS (no crash, no merge)', () => {
        setDecode(() => {
            throw new Error('boom');
        });
        // szcn is the leaf merge of every layered component — a throwing decode
        // must degrade to "keep both raw", never blank the render.
        expect(() => szcn('q3', 'q7')).not.toThrow();
        expect(szcn('q3', 'q7')).toBe('q3 q7');
    });

    it('falls back to the raw token when decode returns a non-string', () => {
        setDecode(c => (c === 'q3' ? 42 : undefined));
        expect(() => szcn('q3', 'q7')).not.toThrow();
        expect(szcn('q3', 'q7')).toBe('q3 q7');
    });

    it('falls back when decode returns an object', () => {
        setDecode(() => ({}));
        expect(() => szcn('q3', 'q7')).not.toThrow();
        expect(szcn('q3', 'q7')).toBe('q3 q7');
    });

    it('still merges normally with a valid decode map', () => {
        setDecode(c => ({ q3: 'gap-2', q7: 'gap-8' })[c]);
        expect(szcn('q3', 'q7')).toBe('q7');
    });

    it('handles a partial map (some tokens decode, some are already raw)', () => {
        setDecode(c => ({ q3: 'gap-2' })[c]); // q3 → gap-2; gap-8 undecoded (raw)
        expect(szcn('q3', 'gap-8')).toBe('gap-8'); // both are `gap` → override
    });
});

describe('szcn — complex & arbitrary variants stay isolated and override', () => {
    it('overrides within group/peer state variants', () => {
        expect(szcn('group-hover:gap-2', 'group-hover:gap-8')).toBe('group-hover:gap-8');
        expect(szcn('peer-checked:p-2', 'peer-checked:p-8')).toBe('peer-checked:p-8');
    });

    it('isolates a group variant from the base', () => {
        expect(szcn('gap-2', 'group-hover:gap-8')).toBe('gap-2 group-hover:gap-8');
    });

    it('handles data/aria arbitrary variants with an inner = (and bracket)', () => {
        expect(szcn('data-[state=open]:gap-2', 'data-[state=open]:gap-8')).toBe(
            'data-[state=open]:gap-8',
        );
    });

    it('does not mistake an inner colon inside [] for the variant separator', () => {
        // supports-[display:grid]: the colon is INSIDE the brackets, not a variant sep.
        expect(szcn('supports-[display:grid]:gap-2', 'supports-[display:grid]:gap-8')).toBe(
            'supports-[display:grid]:gap-8',
        );
    });

    it('handles arbitrary breakpoint, container, and arbitrary-selector variants', () => {
        expect(szcn('min-[320px]:gap-2', 'min-[320px]:gap-8')).toBe('min-[320px]:gap-8');
        expect(szcn('@md:gap-2', '@md:gap-8')).toBe('@md:gap-8');
        expect(szcn('[&>span]:gap-2', '[&>span]:gap-8')).toBe('[&>span]:gap-8');
    });
});

describe('szcn — negative & important markers with directional coverage', () => {
    it('a negative shorthand subsumes a negative longhand it covers', () => {
        expect(szcn('-mt-2', '-m-8')).toBe('-m-8');
        expect(szcn('-m-4', '-mb-8')).toBe('-m-4 -mb-8'); // refine keeps both
    });

    it('leading-important directional coverage (subsume + refine)', () => {
        expect(szcn('!pb-2', '!p-8')).toBe('!p-8');
        expect(szcn('!p-8', '!pb-2')).toBe('!p-8 !pb-2');
    });

    it('trailing-important (Tailwind v4 canonical) directional coverage', () => {
        expect(szcn('pb-2!', 'p-8!')).toBe('p-8!');
        expect(szcn('p-8!', 'pb-2!')).toBe('p-8! pb-2!');
        expect(szcn('p-2!', 'p-8!')).toBe('p-8!');
    });

    it('treats an important variant as the same utility regardless of marker side', () => {
        expect(szcn('p-2', 'p-8!')).toBe('p-8!');
        expect(szcn('gap-2!', 'gap-8')).toBe('gap-8');
    });
});

describe('szcn — arbitrary values with directional coverage', () => {
    it('a later shorthand with an arbitrary value subsumes a covered longhand', () => {
        expect(szcn('pb-[2px]', 'p-[9px]')).toBe('p-[9px]');
    });

    it('a later arbitrary longhand refines an arbitrary shorthand (keeps both)', () => {
        expect(szcn('p-[10px]', 'pb-[2px]')).toBe('p-[10px] pb-[2px]');
    });
});

describe('szcn — logical vs physical spacing (documented v1 behavior)', () => {
    // INTENTIONAL asymmetry vs inset/rounded: a padding/margin shorthand DOES
    // subsume its logical sides (ps/pe via px, ms/me via mx), whereas inset/rounded
    // keep logical separate. Documented here so a future RTL-correctness pass is a
    // deliberate change, not a silent regression.
    it('px subsumes the logical inline padding sides ps/pe', () => {
        expect(szcn('ps-2', 'px-4')).toBe('px-4');
        expect(szcn('pe-2', 'p-4')).toBe('p-4');
    });

    it('contrast: inset-x does NOT subsume the logical start/end', () => {
        expect(szcn('start-0', 'inset-x-4')).toBe('start-0 inset-x-4');
    });
});

describe('szcn — determinism & idempotency (flaky guards)', () => {
    it('dedupes an exact duplicate ungroupable token', () => {
        expect(szcn('flex', 'flex')).toBe('flex');
        expect(szcn('custom-x custom-x', 'custom-x')).toBe('custom-x');
    });

    it('is idempotent: szcn(szcn(x)) === szcn(x)', () => {
        const once = szcn('gap-2 p-4 m-4', 'gap-8 p-8');
        expect(szcn(once)).toBe(once);
    });

    it('is deterministic: repeated calls return identical output', () => {
        const run = () => szcn('gap-2 m-4 p-4 rounded-md', 'gap-8 p-8 rounded-xl');
        const first = run();
        for (let i = 0; i < 5; i++) {
            expect(run()).toBe(first);
        }
    });

    it('preserves a stable survivor order across many mixed inputs', () => {
        expect(szcn('a gap-2 b', 'm-4 gap-8', false, 'c', 'm-2')).toBe('a b gap-8 c m-2');
    });
});

describe('szcn — BEM base + modifier are distinct classes (never collapsed)', () => {
    it('keeps a base whose name starts with a real utility prefix when its --modifier is present', () => {
        // `tab` IS the real tab-size utility prefix, so `tab-item-header` used to
        // classify as a `tab` utility and get dropped by `tab-item-header--active`.
        expect(szcn('tab-item-header tab-item-header--active')).toBe(
            'tab-item-header tab-item-header--active',
        );
    });

    it('keeps base + modifier for non-utility names too', () => {
        expect(szcn('foo-bar foo-bar--active')).toBe('foo-bar foo-bar--active');
        expect(szcn('btn btn--lg')).toBe('btn btn--lg');
    });

    it('still overrides genuine same-utility value pairs', () => {
        expect(szcn('gap-2 gap-8')).toBe('gap-8');
        expect(szcn('p-2 p-8')).toBe('p-8');
    });
});

describe('_szcn — the unmemoized compiler-emitted twin', () => {
    it('merges identically to szcn on the same inputs', () => {
        expect(_szcn('gap-2 p-4', 'gap-8')).toBe(szcn('gap-2 p-4', 'gap-8'));
        expect(_szcn('text-base', false, 'text-sm')).toBe('text-sm');
        expect(_szcn()).toBe('');
    });

    it('never serves a stale memoized result (no cache by design)', () => {
        // Prime szcn's memo AND call _szcn once, then swap the decode bridge.
        // szcn deliberately invalidates on bridge identity; _szcn must reflect
        // the new bridge because it holds NO cache at all — compiled arrays
        // pass per-render values where a shared LRU would only thrash.
        expect(_szcn('q1', 'q2')).toBe('q1 q2'); // unknown tokens, would be cached
        const reverse = new Map([
            ['q1', 'gap-2'],
            ['q2', 'gap-8'],
        ]);
        (globalThis as { __csszyx?: unknown }).__csszyx = {
            decode: (token: string) => reverse.get(token),
        };
        try {
            expect(_szcn('q1', 'q2')).toBe('q2'); // mangle-aware: same utility, last wins
        } finally {
            (globalThis as { __csszyx?: unknown }).__csszyx = undefined;
        }
    });
});

describe('_szMerge — utility-aware parity with szcn', () => {
    const corpus: ReadonlyArray<readonly (string | false | null | undefined)[]> = [
        ['gap-2 p-4', 'gap-8'],
        ['m-4', 'p-2'],
        ['p-2', 'p-8'],
        ['w-1/2', 'w-full'],
        ['rounded-md', 'rounded-xl'],
        ['gap-2 m-4 gap-8'],
        ['gap-2', 'md:gap-8'],
        ['md:gap-2', 'md:gap-8'],
        ['gap-2', 'hover:gap-8'],
        ['hover:p-2', 'hover:p-8'],
        ['md:hover:p-2 p-1', 'p-8'],
        ['flex-1', 'flex-row'],
        ['text-sm', 'text-red-500'],
        ['text-base', 'text-sm'],
        ['bg-red-500', 'bg-cover'],
        ['my-custom-thing', 'p-4'],
        ['a b', 'c'],
        ['font-sans', 'font-bold'],
        ['font-semibold', 'font-normal'],
        ['font-bold', 'font-bold'],
        ['flex', 'block'],
        ['p-4', 'pb-8'],
        ['m-8', 'mb-2'],
        ['pb-4', 'p-8'],
        ['mt-2', 'm-8'],
        ['pl-4', 'px-2'],
        ['px-2', 'pl-4'],
        ['p-4', 'px-2'],
        ['px-2', 'p-4'],
        ['md:pb-4', 'p-8'],
        ['p-4', 'md:p-8'],
        ['mb-4', 'p-8'],
        ['top-0', 'inset-0'],
        ['inset-x-2', 'inset-0'],
        ['inset-0', 'top-4'],
        ['left-0', 'inset-x-2'],
        ['inset-x-2', 'left-0'],
        ['inset-x-2', 'top-4'],
        ['rounded-t-sm', 'rounded-lg'],
        ['rounded-tl-sm', 'rounded-t-lg'],
        ['rounded-lg', 'rounded-t-sm'],
        ['rounded-tl-sm', 'rounded-r-lg'],
        ['start-0', 'inset-0'],
        ['rounded-s-lg', 'rounded-lg'],
        ['rounded-lg', 'inset-0'],
        ['p-4', 'inset-0'],
        [],
        [false, null, undefined, ''],
        ['   '],
        ['p-4\n  m-2', 'p-4'],
        ['w-[337px]', 'w-[400px]'],
        ['mt-2', '-mt-4'],
        ['p-2', '!p-8'],
        ['bg-warning', 'bg-danger'],
        ['leading-4', 'leading-8'],
        ['group-hover:gap-2', 'group-hover:gap-8'],
        ['peer-checked:p-2', 'peer-checked:p-8'],
        ['gap-2', 'group-hover:gap-8'],
        ['data-[state=open]:gap-2', 'data-[state=open]:gap-8'],
        ['supports-[display:grid]:gap-2', 'supports-[display:grid]:gap-8'],
        ['min-[320px]:gap-2', 'min-[320px]:gap-8'],
        ['@md:gap-2', '@md:gap-8'],
        ['[&>span]:gap-2', '[&>span]:gap-8'],
        ['-mt-2', '-m-8'],
        ['-m-4', '-mb-8'],
        ['!pb-2', '!p-8'],
        ['!p-8', '!pb-2'],
        ['pb-2!', 'p-8!'],
        ['p-8!', 'pb-2!'],
        ['p-2!', 'p-8!'],
        ['p-2', 'p-8!'],
        ['gap-2!', 'gap-8'],
        ['pb-[2px]', 'p-[9px]'],
        ['p-[10px]', 'pb-[2px]'],
        ['ps-2', 'px-4'],
        ['pe-2', 'p-4'],
        ['start-0', 'inset-x-4'],
        ['flex', 'flex'],
        ['tab-item-header', 'tab-item-header--active'],
        ['foo-bar', 'foo-bar--active'],
        ['btn', 'btn--lg'],
        ['gap-2 gap-8'],
        ['p-2 p-8'],
        ['custom-x custom-x', 'custom-x'],
        ['p-4', false, null, undefined, '', 'm-2'],
        ['gap-2 p-4 m-4', 'gap-8 p-8'],
        ['gap-2 m-4 p-4 rounded-md', 'gap-8 p-8 rounded-xl'],
        ['a gap-2 b', 'm-4 gap-8', false, 'c', 'm-2'],
    ];

    it.each(corpus)('matches szcn for %j', (...inputs) => {
        expect(_szMerge(...inputs)).toBe(szcn(...inputs));
    });

    it('matches szcn through the production mangle decode bridge', () => {
        (globalThis as { __csszyx?: unknown }).__csszyx = {
            decode: (token: string) => ({ q3: 'gap-2', q7: 'gap-8' })[token],
        };
        try {
            expect(_szMerge('q3', 'q7')).toBe(szcn('q3', 'q7'));
            expect(_szMerge('q3', 'q7')).toBe('q7');
        } finally {
            (globalThis as { __csszyx?: unknown }).__csszyx = undefined;
        }
    });

    it.each([
        ['different decoded utilities', { q3: 'gap-2', q9: 'p-4' }],
        ['a partial decode map', { q3: 'gap-2' }],
    ] as const)('matches szcn with %s', (_label, decodeMap) => {
        (globalThis as { __csszyx?: unknown }).__csszyx = {
            decode: (token: string) => decodeMap[token as keyof typeof decodeMap],
        };
        try {
            const right = 'q9' in decodeMap ? 'q9' : 'gap-8';
            expect(_szMerge('q3', right)).toBe(szcn('q3', right));
        } finally {
            (globalThis as { __csszyx?: unknown }).__csszyx = undefined;
        }
    });

    it.each([
        [
            'throws',
            () => {
                throw new Error('boom');
            },
        ],
        ['returns a number', () => 42],
        ['returns an object', () => ({})],
    ] as const)('matches szcn when decode %s', (_label, decode) => {
        (globalThis as { __csszyx?: unknown }).__csszyx = { decode };
        try {
            expect(_szMerge('q3', 'q7')).toBe(szcn('q3', 'q7'));
        } finally {
            (globalThis as { __csszyx?: unknown }).__csszyx = undefined;
        }
    });
});
