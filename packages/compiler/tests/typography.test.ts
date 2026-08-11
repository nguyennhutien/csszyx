import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform.js';
import { expectParity } from './tri-engine-harness.js';

const t = (sz: Parameters<typeof transform>[0]): string => transform(sz).className;

describe('typography — font family', () => {
    it('{ fontFamily: "sans" } → font-sans', () => {
        expect(t({ fontFamily: 'sans' })).toBe('font-sans');
    });

    it('{ fontFamily: "serif" } → font-serif', () => {
        expect(t({ fontFamily: 'serif' })).toBe('font-serif');
    });

    it('{ fontFamily: "mono" } → font-mono', () => {
        expect(t({ fontFamily: 'mono' })).toBe('font-mono');
    });

    it("{ fontFamily: \"'My Font'\" } → font-['My_Font'] (arbitrary)", () => {
        expect(t({ fontFamily: "'My Font'" })).toBe("font-['My_Font']");
    });

    it('{ fontFamily: "--f" } → font-(family-name:--f) (css variable)', () => {
        expect(t({ fontFamily: '--f' })).toBe('font-(family-name:--f)');
    });
});

describe('typography — font size', () => {
    it('{ text: "sm" } → text-sm', () => {
        expect(t({ text: 'sm' })).toBe('text-sm');
    });

    it('{ text: "16px" } → text-[16px]', () => {
        expect(t({ text: '16px' })).toBe('text-[16px]');
    });

    it('{ text: "1.5rem" } → text-[1.5rem] (arbitrary)', () => {
        expect(t({ text: '1.5rem' })).toBe('text-[1.5rem]');
    });

    it('{ text: "--size" } → text-(length:--size) (css variable)', () => {
        expect(t({ text: '--size' })).toBe('text-(length:--size)');
    });

    it('{ text: "--spacing(4)" } → text-[--spacing(4)] (Tailwind function)', () => {
        expect(t({ text: '--spacing(4)' })).toBe('text-[--spacing(4)]');
        expect(t({ text: '--spacing("🚀")' })).toBe('text-[--spacing("🚀")]');
    });

    it('handles nested calls, quoted parentheses, and escapes in linear time', () => {
        expect(t({ text: '--spacing(var(--step, "("))' })).toBe(
            'text-[--spacing(var(--step,_"("))]',
        );
        expect(t({ text: '--spacing(calc(2\\) + 2))' })).toBe('text-[--spacing(calc(2\\)_+_2))]');
    });

    it('does not classify an unbalanced call as a Tailwind function', () => {
        expect(t({ text: '--spacing(calc(2 + 2)' })).toBe('text-[--spacing(calc(2_+_2)]');
    });

    it('requires a valid first function-name character', () => {
        expect(t({ text: '--9(4)' })).toBe('text-[--9(4)]');
        expect(t({ text: '---x(4)' })).toBe('text-[---x(4)]');
        expect(t({ text: '--_x(4)' })).toBe('text-[--_x(4)]');
    });

    it('handles a long malformed function candidate without recursion', () => {
        const value = `--spacing(${'('.repeat(64 * 1024)}`;
        const className = t({ text: value });
        expect(className.startsWith('text-[--spacing(')).toBe(true);
        expect(className).toHaveLength(value.length + 'text-[]'.length);
    });
});

describe('typography — Tailwind build-time color functions', () => {
    it('keeps --alpha() arbitrary in color object syntax', () => {
        expect(t({ color: { color: '--alpha(var(--brand) / 50%)' } })).toBe(
            'text-[--alpha(var(--brand)_/_50%)]',
        );
    });
});

describe('typography — font weight', () => {
    it('{ weight: "bold" } → font-bold', () => {
        expect(t({ weight: 'bold' })).toBe('font-bold');
    });

    it('{ weight: 500 } → font-[500]', () => {
        expect(t({ weight: 500 })).toBe('font-[500]');
    });

    it('{ weight: "semibold" } → font-semibold (alias)', () => {
        expect(t({ weight: 'semibold' })).toBe('font-semibold');
    });

    it('{ weight: 550 } → font-[550] (arbitrary)', () => {
        expect(t({ weight: 550 })).toBe('font-[550]');
    });

    it('{ weight: "--w" } → font-(weight:--w) (css variable)', () => {
        expect(t({ weight: '--w' })).toBe('font-(weight:--w)');
    });
});

// Tailwind v4 spells font weights through the `--font-weight-*` theme
// namespace, so the utility is a NAME (`font-thin`) and never a number: stock
// Tailwind serves no `font-<number>` at all, and every numeric weight csszyx
// emitted styled nothing. The bracket form carries the literal the author
// wrote, which is what `{ weight: N }` means, and works with no theme setup.
describe('typography — a numeric font weight brackets on every engine', () => {
    it('{ weight: 100 } → font-[100]', () => {
        expectParity('{ weight: 100 }', 'font-[100]');
    });

    it('{ weight: 550 } → font-[550]', () => {
        expectParity('{ weight: 550 }', 'font-[550]');
    });

    it('{ weight: "thin" } stays a named utility', () => {
        expectParity("{ weight: 'thin' }", 'font-thin');
    });
});

describe('typography — font stretch', () => {
    it('{ fontStretch: "75%" } → font-stretch-75%', () => {
        expect(t({ fontStretch: '75%' })).toBe('font-stretch-75%');
    });

    it('{ fontStretch: "110%" } → font-stretch-110% (arbitrary)', () => {
        expect(t({ fontStretch: '110%' })).toBe('font-stretch-110%');
    });

    it('{ fontStretch: "--s" } → font-stretch-(--s) (css variable)', () => {
        expect(t({ fontStretch: '--s' })).toBe('font-stretch-(--s)');
    });
});

describe('typography — font variant numeric', () => {
    it('{ fontVariant: "slashed-zero" } → slashed-zero', () => {
        expect(t({ fontVariant: 'slashed-zero' })).toBe('slashed-zero');
    });

    it('{ slashedZero: true } → slashed-zero', () => {
        expect(t({ slashedZero: true })).toBe('slashed-zero');
    });

    it('{ ordinal: true } → ordinal', () => {
        expect(t({ ordinal: true })).toBe('ordinal');
    });
});

describe('typography — font features', () => {
    it('{ fontFeatures: "normal" } → font-features-[normal]', () => {
        // Tailwind's font-features utility is functional-only: the bare
        // keyword styles nothing while the bracketed form compiles.
        expect(t({ fontFeatures: 'normal' })).toBe('font-features-[normal]');
    });

    it('{ fontFeatures: \'"liga" 1\' } → font-features-["liga"_1] (arbitrary)', () => {
        expect(t({ fontFeatures: '"liga" 1' })).toBe('font-features-["liga"_1]');
    });
});

describe('typography — font style & smoothing', () => {
    it('{ fontStyle: "italic" } → italic', () => {
        expect(t({ fontStyle: 'italic' })).toBe('italic');
    });

    it('{ fontStyle: "normal" } → not-italic', () => {
        expect(t({ fontStyle: 'normal' })).toBe('not-italic');
    });

    it('{ fontSmoothing: "grayscale" } → antialiased', () => {
        expect(t({ fontSmoothing: 'grayscale' })).toBe('antialiased');
    });

    it('{ fontSmoothing: "subpixel" } → subpixel-antialiased', () => {
        expect(t({ fontSmoothing: 'subpixel' })).toBe('subpixel-antialiased');
    });
});

describe('typography — letter spacing (tracking)', () => {
    it('{ tracking: "tight" } → tracking-tight', () => {
        expect(t({ tracking: 'tight' })).toBe('tracking-tight');
    });

    it('{ tracking: ".25em" } → tracking-[.25em] (arbitrary)', () => {
        expect(t({ tracking: '.25em' })).toBe('tracking-[.25em]');
    });

    it('{ tracking: "--t" } → tracking-(--t) (css variable)', () => {
        expect(t({ tracking: '--t' })).toBe('tracking-(--t)');
    });
});

describe('typography — line height (leading)', () => {
    it('{ leading: "tight" } → leading-tight', () => {
        expect(t({ leading: 'tight' })).toBe('leading-tight');
    });

    it('{ leading: 5 } → leading-5', () => {
        expect(t({ leading: 5 })).toBe('leading-5');
    });

    it('{ leading: "3rem" } → leading-[3rem] (arbitrary)', () => {
        expect(t({ leading: '3rem' })).toBe('leading-[3rem]');
    });

    it('{ leading: "--l" } → leading-(--l) (css variable)', () => {
        expect(t({ leading: '--l' })).toBe('leading-(--l)');
    });

    // Numbers ride the spacing scale (a LENGTH: leading-1.5 = 0.375rem);
    // numeric strings are the unitless ratio and auto-bracket. Tailwind has
    // no bare class for non-quarter-step numbers, so those bracket too.
    it('{ leading: 1.5 } → leading-1.5 (spacing scale, quarter step)', () => {
        expect(t({ leading: 1.5 })).toBe('leading-1.5');
    });

    it('{ leading: "1.5" } → leading-[1.5] (numeric string = unitless ratio)', () => {
        expect(t({ leading: '1.5' })).toBe('leading-[1.5]');
    });

    it('{ leading: 1.4 } → leading-[1.4] (non-quarter-step number falls back to ratio)', () => {
        expect(t({ leading: 1.4 })).toBe('leading-[1.4]');
    });

    it('{ leading: "6" } → leading-[6] (integer string is still a ratio)', () => {
        expect(t({ leading: '6' })).toBe('leading-[6]');
    });
});

describe('typography — text/leading shorthand', () => {
    it('{ text: "lg", leading: 7 } → text-lg/7', () => {
        const result = t({ text: 'lg', leading: 7 });
        expect(result).toBe('text-lg/7');
    });

    it('{ text: "sm", leading: "tight" } → text-sm/tight', () => {
        const result = t({ text: 'sm', leading: 'tight' });
        expect(result).toBe('text-sm/tight');
    });

    it('{ text: "xl", leading: "1.5rem" } → text-xl/[1.5rem]', () => {
        const result = t({ text: 'xl', leading: '1.5rem' });
        expect(result).toBe('text-xl/[1.5rem]');
    });

    it('{ text: "sm", leading: "1.5" } → text-sm/[1.5] (ratio merges bracketed)', () => {
        expect(t({ text: 'sm', leading: '1.5' })).toBe('text-sm/[1.5]');
    });

    it('{ text: "sm", leading: 1.5 } → text-sm/1.5 (spacing scale merges bare)', () => {
        expect(t({ text: 'sm', leading: 1.5 })).toBe('text-sm/1.5');
    });

    it('{ text: "sm", leading: 1.4 } → text-sm/[1.4] (no bare class for 1.4)', () => {
        expect(t({ text: 'sm', leading: 1.4 })).toBe('text-sm/[1.4]');
    });
});

describe('typography — text align', () => {
    it('{ textAlign: "center" } → text-center', () => {
        expect(t({ textAlign: 'center' })).toBe('text-center');
    });

    it('{ textAlign: "justify" } → text-justify', () => {
        expect(t({ textAlign: 'justify' })).toBe('text-justify');
    });
});

describe('typography — text color', () => {
    it('{ color: "inherit" } → text-inherit', () => {
        expect(t({ color: 'inherit' })).toBe('text-inherit');
    });

    it('{ color: "slate-500" } → text-slate-500', () => {
        expect(t({ color: 'slate-500' })).toBe('text-slate-500');
    });

    it('{ color: { color: "blue-500", op: 50 } } → text-blue-500/50', () => {
        expect(t({ color: { color: 'blue-500', op: 50 } })).toBe('text-blue-500/50');
    });

    it('{ color: "#50d71e" } → text-[#50d71e] (arbitrary)', () => {
        expect(t({ color: '#50d71e' })).toBe('text-[#50d71e]');
    });

    it('{ color: "--c" } → text-(--c) (css variable)', () => {
        expect(t({ color: '--c' })).toBe('text-(--c)');
    });
});

describe('typography — text decoration', () => {
    it('{ decorationStyle: "dashed" } → decoration-dashed', () => {
        expect(t({ decorationStyle: 'dashed' })).toBe('decoration-dashed');
    });

    it('{ decorationThickness: 2 } → decoration-2', () => {
        expect(t({ decorationThickness: 2 })).toBe('decoration-2');
    });

    it('{ underlineOffset: 4 } → underline-offset-4', () => {
        expect(t({ underlineOffset: 4 })).toBe('underline-offset-4');
    });

    it('{ decorationColor: "blue-500" } → decoration-blue-500', () => {
        expect(t({ decorationColor: 'blue-500' })).toBe('decoration-blue-500');
    });

    it('{ decorationThickness: "3px" } → decoration-[3px] (arbitrary)', () => {
        expect(t({ decorationThickness: '3px' })).toBe('decoration-[3px]');
    });

    it('{ decorationThickness: "--v" } → decoration-(--v) (css variable)', () => {
        expect(t({ decorationThickness: '--v' })).toBe('decoration-(--v)');
    });

    it('{ decoration: "underline" } → underline', () => {
        expect(t({ decoration: 'underline' })).toBe('underline');
    });

    it('{ decoration: "overline" } → overline', () => {
        expect(t({ decoration: 'overline' })).toBe('overline');
    });

    it('{ decoration: "line-through" } → line-through', () => {
        expect(t({ decoration: 'line-through' })).toBe('line-through');
    });

    it('{ decoration: "none" } → no-underline', () => {
        expect(t({ decoration: 'none' })).toBe('no-underline');
    });
});

describe('typography — text transform', () => {
    it('{ textTransform: "uppercase" } → uppercase', () => {
        expect(t({ textTransform: 'uppercase' })).toBe('uppercase');
    });
});

describe('typography — text overflow & whitespace', () => {
    it('{ textOverflow: "ellipsis" } → text-ellipsis', () => {
        expect(t({ textOverflow: 'ellipsis' })).toBe('text-ellipsis');
    });

    it('supports the public boolean text-overflow spellings', () => {
        expect(t({ textEllipsis: true })).toBe('text-ellipsis');
        expect(t({ textClip: true })).toBe('text-clip');
        expect(t({ textEllipsis: false, textClip: false })).toBe('');
    });

    it('{ textWrap: "balance" } → text-balance', () => {
        expect(t({ textWrap: 'balance' })).toBe('text-balance');
    });

    it('{ indent: 4 } → indent-4', () => {
        expect(t({ indent: 4 })).toBe('indent-4');
    });

    it('{ indent: "50%" } → indent-[50%] (arbitrary)', () => {
        expect(t({ indent: '50%' })).toBe('indent-[50%]');
    });

    it('{ indent: "--i" } → indent-(--i) (css variable)', () => {
        expect(t({ indent: '--i' })).toBe('indent-(--i)');
    });

    it('{ align: "middle" } → align-middle', () => {
        expect(t({ align: 'middle' })).toBe('align-middle');
    });

    it('{ align: "4px" } → align-[4px] (arbitrary)', () => {
        expect(t({ align: '4px' })).toBe('align-[4px]');
    });

    it('{ align: "--v" } → align-(--v) (css variable)', () => {
        expect(t({ align: '--v' })).toBe('align-(--v)');
    });

    it('{ whitespace: "nowrap" } → whitespace-nowrap', () => {
        expect(t({ whitespace: 'nowrap' })).toBe('whitespace-nowrap');
    });

    it('{ break: "all" } → break-all', () => {
        expect(t({ break: 'all' })).toBe('break-all');
    });

    it('{ wrap: "anywhere" } → wrap-anywhere', () => {
        expect(t({ wrap: 'anywhere' })).toBe('wrap-anywhere');
    });

    it('{ hyphens: "auto" } → hyphens-auto', () => {
        expect(t({ hyphens: 'auto' })).toBe('hyphens-auto');
    });

    it('{ content: "none" } → content-none', () => {
        expect(t({ content: 'none' })).toBe('content-none');
    });

    it("{ content: \"'hello'\" } → content-['hello'] (arbitrary, single-quote CSS string)", () => {
        expect(t({ content: "'hello'" })).toBe("content-['hello']");
    });

    // Double-quote CSS string style is normalized to single-quote (Tailwind convention).
    // content: '""' → content-[''] so Tailwind JIT generates CSS for the class.
    it("{ content: '\"\"'  } → content-[''} (empty string — double-quote normalized to single-quote)", () => {
        expect(t({ content: '""' })).toBe("content-['']");
    });

    it("{ content: '\"hello\"' } → content-['hello'] (double-quote normalized to single-quote)", () => {
        expect(t({ content: '"hello"' })).toBe("content-['hello']");
    });

    it('{ content: "--c" } → content-(--c) (css variable)', () => {
        expect(t({ content: '--c' })).toBe('content-(--c)');
    });

    it('{ lineClamp: 3 } → line-clamp-3', () => {
        expect(t({ lineClamp: 3 })).toBe('line-clamp-3');
    });

    it('{ lineClamp: 7 } → line-clamp-7 (arbitrary)', () => {
        expect(t({ lineClamp: 7 })).toBe('line-clamp-7');
    });

    it('{ lineClamp: "--c" } → line-clamp-(--c) (css variable)', () => {
        expect(t({ lineClamp: '--c' })).toBe('line-clamp-(--c)');
    });
});

describe('typography — list style', () => {
    it('{ list: "disc" } → list-disc', () => {
        expect(t({ list: 'disc' })).toBe('list-disc');
    });

    it('{ list: "upper-roman" } → list-[upper-roman] (arbitrary)', () => {
        expect(t({ list: 'upper-roman' })).toBe('list-[upper-roman]');
    });

    it('{ list: "--t" } → list-(--t) (css variable)', () => {
        expect(t({ list: '--t' })).toBe('list-(--t)');
    });

    it('{ listPos: "inside" } → list-inside', () => {
        expect(t({ listPos: 'inside' })).toBe('list-inside');
    });

    it('{ listImg: "none" } → list-image-none', () => {
        expect(t({ listImg: 'none' })).toBe('list-image-none');
    });

    it("{ listImg: \"url('/img.png')\" } → list-image-[url('/img.png')] (arbitrary)", () => {
        expect(t({ listImg: "url('/img.png')" })).toBe("list-image-[url('/img.png')]");
    });

    it('{ listImg: "--i" } → list-image-(--i) (css variable)', () => {
        expect(t({ listImg: '--i' })).toBe('list-image-(--i)');
    });
});
