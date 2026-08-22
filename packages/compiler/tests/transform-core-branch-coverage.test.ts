/**
 * Branch-coverage suite for transform-core.ts. Each test feeds a concrete sz
 * object (or a directly-exported helper) and asserts the REAL emitted className,
 * exercising the specific decision branches the main suites leave uncovered:
 * opacity formatting, the group/peer/has/not/data/aria/supports helpers, the
 * container-query lowering, the long string-property handler chain, and the
 * warn-location formatter. console.warn is spied so the intentional dev warnings
 * don't pollute the reporter — the assertions are on output, never on the spy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    __resetSzWarnDedupForTests,
    formatSzWarnLocation,
    type SzObject,
    setSzWarnLocation,
    transform,
} from '../src/transform-core.js';

/**
 * className for an sz object (the piece every assertion checks).
 * @param sz - The sz style object to compile.
 * @param prefix - Optional variant prefix applied to every key.
 * @returns The compiled className string.
 */
const cls = (sz: SzObject, prefix = ''): string => transform(sz, prefix).className;

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    // Every warning in here dedupes per token per process, so without this a
    // "stays silent" assertion passes because an EARLIER test already spent
    // the one warning that token gets — not because the code stayed silent.
    __resetSzWarnDedupForTests();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    setSzWarnLocation(undefined);
});

describe('formatOpacity via bg color object', () => {
    it('emits a bare integer opacity', () => {
        expect(cls({ bg: { color: 'red-500', op: 50 } })).toBe('bg-red-500/50');
    });
    it('emits a bare half-step decimal opacity', () => {
        expect(cls({ bg: { color: 'red-500', op: 0.5 } })).toBe('bg-red-500/0.5');
    });
    it('wraps a fraction-scale decimal opacity in brackets', () => {
        expect(cls({ bg: { color: 'red-500', op: 0.05 } })).toBe('bg-red-500/[0.05]');
    });
    it('wraps a CSS-variable opacity in parentheses', () => {
        expect(cls({ bg: { color: 'red-500', op: '--o' } })).toBe('bg-red-500/(--o)');
    });
    it('wraps an arbitrary string opacity in brackets', () => {
        expect(cls({ bg: { color: 'red-500', op: 'var(--o)' } })).toBe('bg-red-500/[var(--o)]');
    });
    it('lowers a color object with no opacity', () => {
        expect(cls({ bg: { color: 'red-500' } })).toBe('bg-red-500');
    });
    it('stays silent off-browser for a custom token with an opacity modifier', () => {
        // Tailwind v4 wraps the modifier in color-mix(), which dims any valid
        // color — the old token-text heuristic here flagged six WORKING rules
        // in a field user's otherwise-clean run. Off the browser there is no
        // stylesheet to ask, and `csszyx check` owns the exact verdict, so
        // the lowering says nothing.
        expect(cls({ bg: { color: 'brand', op: 35 } })).toBe('bg-brand/35');
        const messages = warnSpy.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('opacity'))).toBe(false);
    });

    describe('opacity advisory in a browser, where the var chain is readable', () => {
        /**
         * Fake enough DOM for the advisory's computed-style probe.
         * @param value - What `--color-brand` computes to on the fake page.
         * @param run - Assertions to run while the fake DOM is installed.
         */
        function withComputedValue(value: string, run: () => void): void {
            const globals = globalThis as {
                document?: unknown;
                getComputedStyle?: unknown;
            };
            globals.document = { documentElement: {} };
            globals.getComputedStyle = () => ({
                getPropertyValue: (name: string) => (name === '--color-brand' ? value : ''),
            });
            try {
                run();
            } finally {
                delete globals.document;
                delete globals.getComputedStyle;
            }
        }

        it('warns when the token resolves to a bare comma triplet', () => {
            withComputedValue('17, 119, 224', () => {
                expect(cls({ bg: { color: 'brand', op: 35 } })).toBe('bg-brand/35');
            });
            const messages = warnSpy.mock.calls.map(c => String(c[0]));
            expect(messages.some(m => m.includes('17, 119, 224'))).toBe(true);
            expect(messages.some(m => m.includes('bg-brand/35'))).toBe(true);
        });

        it('stays silent for a token that resolves to a real color', () => {
            withComputedValue('oklch(0.6 0.1 250)', () => {
                expect(cls({ bg: { color: 'brand', op: 35 } })).toBe('bg-brand/35');
            });
            expect(warnSpy.mock.calls.map(c => String(c[0])).some(m => m.includes('opacity'))).toBe(
                false,
            );
        });

        it('stays silent for a token the page does not define', () => {
            withComputedValue('', () => {
                expect(cls({ bg: { color: 'brand', op: 35 } })).toBe('bg-brand/35');
            });
            expect(warnSpy.mock.calls.map(c => String(c[0])).some(m => m.includes('opacity'))).toBe(
                false,
            );
        });

        it('lowers normally when reading computed style throws', () => {
            // A detached document, a hardened environment, a stubbed DOM: the
            // probe is advisory, so a host that refuses to answer must cost the
            // class nothing.
            const globals = globalThis as { document?: unknown; getComputedStyle?: unknown };
            globals.document = { documentElement: {} };
            globals.getComputedStyle = () => {
                throw new Error('detached document');
            };
            try {
                expect(cls({ bg: { color: 'brand', op: 35 } })).toBe('bg-brand/35');
            } finally {
                delete globals.document;
                delete globals.getComputedStyle;
            }
            expect(warnSpy.mock.calls.map(c => String(c[0])).some(m => m.includes('opacity'))).toBe(
                false,
            );
        });
    });
    it('brackets a CSS-var color with a function and a build-time function color', () => {
        expect(cls({ bg: { color: 'var(--x)' } })).toBe('bg-[var(--x)]');
        expect(cls({ bg: { color: '--spacing(4)' } })).toBe('bg-[--spacing(4)]');
        expect(cls({ bg: { color: '--brand' } })).toBe('bg-(--brand)');
        expect(cls({ bg: { color: '#ff0000' } })).toBe('bg-[#ff0000]');
    });
});

describe('handleGroupPeer', () => {
    it('lowers group-has with real and empty/false selector values', () => {
        expect(cls({ group: { has: { img: { p: 4 } } } })).toBe('group-has-[img]:p-4');
        expect(cls({ group: { has: { img: {} } } })).toBe('');
        expect(cls({ group: { has: { img: false } } })).toBe('');
    });
    it('lowers group-data with real and empty/false values', () => {
        expect(cls({ group: { data: { active: { p: 4 } } } })).toBe('group-data-[active]:p-4');
        expect(cls({ group: { data: { active: {} } } })).toBe('');
        expect(cls({ group: { data: { active: false } } })).toBe('');
    });
    it('lowers group-aria for known-state and arbitrary attributes', () => {
        expect(cls({ group: { aria: { checked: { p: 4 } } } })).toBe('group-aria-checked:p-4');
        expect(cls({ group: { aria: { 'x=1': { p: 4 } } } })).toBe('group-aria-[x=1]:p-4');
        expect(cls({ group: { aria: { checked: {} } } })).toBe('');
        expect(cls({ group: { aria: { checked: false } } })).toBe('');
    });
    it('lowers an arbitrary-selector group variant', () => {
        expect(cls({ group: { '.foo': { p: 4 } } })).toBe('group-[.foo]:p-4');
        expect(cls({ group: { '.foo': {} } })).toBe('');
    });
    it('lowers a known-variant group and drops an empty one', () => {
        expect(cls({ group: { hover: { p: 4 } } })).toBe('group-hover:p-4');
        expect(cls({ group: { hover: {} } })).toBe('');
    });
    it('lowers a NAMED group with a plain state', () => {
        expect(cls({ group: { card: { hover: { p: 4 } } } })).toBe('group-hover/card:p-4');
        expect(cls({ group: { card: { hover: {} } } })).toBe('');
        expect(cls({ group: { card: { hover: false } } })).toBe('');
    });
    it('lowers data inside a named group', () => {
        expect(cls({ group: { card: { data: { active: { p: 4 } } } } })).toBe(
            'group-data-[active]/card:p-4',
        );
        expect(cls({ group: { card: { data: { active: {} } } } })).toBe('');
        expect(cls({ group: { card: { data: { active: false } } } })).toBe('');
    });
    it('lowers aria inside a named group for known-state and arbitrary attrs', () => {
        expect(cls({ group: { card: { aria: { checked: { p: 4 } } } } })).toBe(
            'group-aria-checked/card:p-4',
        );
        expect(cls({ group: { card: { aria: { 'x=1': { p: 4 } } } } })).toBe(
            'group-aria-[x=1]/card:p-4',
        );
        expect(cls({ group: { card: { aria: { checked: {} } } } })).toBe('');
        expect(cls({ group: { card: { aria: { checked: false } } } })).toBe('');
    });
    it('skips a false/null nested group entry', () => {
        expect(cls({ group: { hover: false } })).toBe('');
        expect(cls({ group: { hover: null as unknown as SzObject } })).toBe('');
    });
    it('supports peer as well as group', () => {
        expect(cls({ peer: { hover: { p: 4 } } })).toBe('peer-hover:p-4');
        expect(cls({ peer: 'nav' })).toBe('peer/nav');
        expect(cls({ group: 'nav' })).toBe('group/nav');
    });
});

describe('handleHas / handleNot / handleData / handleAria / handleSupports', () => {
    it('handleHas: colon-prefixed, known-variant, and bare selectors', () => {
        expect(cls({ has: { ':checked': { p: 4 } } })).toBe('has-[:checked]:p-4');
        expect(cls({ has: { hover: { p: 4 } } })).toBe('has-[:hover]:p-4');
        expect(cls({ has: { img: { p: 4 } } })).toBe('has-[img]:p-4');
        expect(cls({ has: { img: {} } })).toBe('');
        expect(cls({ has: { img: false } })).toBe('');
    });
    it('handleNot: nested supports and simple variant, plus empties', () => {
        expect(cls({ not: { supports: { 'display:grid': { p: 4 } } } })).toBe(
            'not-supports-[display:grid]:p-4',
        );
        expect(cls({ not: { supports: { 'display:grid': {} } } })).toBe('');
        expect(cls({ not: { hover: { p: 4 } } })).toBe('not-hover:p-4');
        expect(cls({ not: { hover: {} } })).toBe('');
        expect(cls({ not: { hover: false } })).toBe('');
    });
    it('handleData: attribute variant and empties', () => {
        expect(cls({ data: { active: { p: 4 } } })).toBe('data-[active]:p-4');
        expect(cls({ data: { active: {} } })).toBe('');
        expect(cls({ data: { active: false } })).toBe('');
    });
    it('handleAria: known-state, arbitrary attribute and empties', () => {
        expect(cls({ aria: { checked: { p: 4 } } })).toBe('aria-checked:p-4');
        expect(cls({ aria: { 'busy=true': { p: 4 } } })).toBe('aria-[busy=true]:p-4');
        expect(cls({ aria: { checked: {} } })).toBe('');
        expect(cls({ aria: { checked: false } })).toBe('');
    });
    it('handleSupports: condition variant and empty', () => {
        expect(cls({ supports: { 'display:grid': { p: 4 } } })).toBe('supports-[display:grid]:p-4');
        expect(cls({ supports: { 'display:grid': {} } })).toBe('');
        expect(cls({ supports: { 'display:grid': false } })).toBe('');
    });
});

describe('min/max breakpoints and @ container queries', () => {
    it('min: named, bare-arbitrary and pre-bracketed breakpoints', () => {
        expect(cls({ min: { md: { p: 4 } } })).toBe('min-md:p-4');
        expect(cls({ min: { '320px': { p: 4 } } })).toBe('min-[320px]:p-4');
        expect(cls({ min: { '[320px]': { p: 4 } } })).toBe('min-[320px]:p-4');
        expect(cls({ min: { md: {} } })).toBe('');
        expect(cls({ min: { md: false } })).toBe('');
        expect(cls({ max: { lg: { p: 4 } } })).toBe('max-lg:p-4');
    });
    it('@container string shorthand', () => {
        expect(cls({ '@container': 'sidebar' })).toBe('@container/sidebar');
    });
    it('@ query: direct property, named container, bracket and auto-bracket keys', () => {
        expect(cls({ '@md': { p: 4 } })).toBe('@md:p-4');
        expect(cls({ '@md': { sidebar: { p: 4 } } })).toBe('@md/sidebar:p-4');
        expect(cls({ '@md': { sidebar: {} } })).toBe('');
        expect(cls({ '@md': { '[475px]': { p: 4 } } })).toBe('@md-[475px]:p-4');
        expect(cls({ '@md': { '[475px]': {} } })).toBe('');
        expect(cls({ '@min': { '475px': { p: 4 } } })).toBe('@min-[475px]:p-4');
        expect(cls({ '@min': { '475px': {} } })).toBe('');
        expect(cls({ '@md': { x: null } })).toBe('');
    });
    it('@ query: fallback treats a variant-shortcut string as a property', () => {
        expect(cls({ '@md': { hover: 'bg-red-500' } })).toBe('@md:hover:bg-red-500');
        // Non-variant string still routes through the property fallback.
        expect(cls({ '@md': { nope: 'bar' } })).toBe('@md:nope-bar');
        // Fallback whose inner transform yields nothing (numeric key is skipped).
        expect(cls({ '@md': { 5: 'x' } as unknown as SzObject })).toBe('');
    });
    it('arbitrary variant key', () => {
        expect(cls({ '[&_p]': { p: 4 } })).toBe('[&_p]:p-4');
        expect(cls({ '[&_p]': {} })).toBe('');
        expect(cls({ '[& > span]': { p: 4 } })).toBe('[&>span]:p-4');
    });
    it('standard variant nesting, empty and non-empty', () => {
        expect(cls({ hover: { p: 4 } })).toBe('hover:p-4');
        expect(cls({ hover: {} })).toBe('');
    });
});

describe('css escape hatch, @ string, and named group/peer strings', () => {
    it('css object lowers each declaration and skips null/undefined', () => {
        expect(cls({ css: { writingMode: 'vertical-lr', '--my-color': 'red', bad: null } })).toBe(
            '[writing-mode:vertical-lr] [--my-color:red]',
        );
    });
    it('css with a non-object value emits nothing', () => {
        expect(cls({ css: 'nope' })).toBe('');
        expect(cls({ css: ['a'] as unknown as SzObject })).toBe('');
    });
});

describe('bgImg object gradient syntax', () => {
    it('drops an object with no gradient type', () => {
        expect(cls({ bgImg: { dir: 'to-r' } })).toBe('');
    });
    it('linear: numeric, negative-numeric, var, to-, and arbitrary directions', () => {
        expect(cls({ bgImg: { gradient: 'linear', dir: 45 } })).toBe('bg-linear-45');
        expect(cls({ bgImg: { gradient: 'linear', dir: -45 } })).toBe('-bg-linear-45');
        expect(cls({ bgImg: { gradient: 'linear', dir: '--a' } })).toBe('bg-linear-(--a)');
        expect(cls({ bgImg: { gradient: 'linear', dir: 'to-tr' } })).toBe('bg-linear-to-tr');
        expect(cls({ bgImg: { gradient: 'linear', dir: '45deg in oklab' } })).toBe(
            'bg-linear-[45deg_in_oklab]',
        );
    });
    it('linear default direction plus color-interpolation suffix', () => {
        expect(cls({ bgImg: { gradient: 'linear', dir: 'to-r', in: 'oklch' } })).toBe(
            'bg-linear-to-r/oklch',
        );
    });
    it('radial: default, var, arbitrary; numeric dir yields nothing', () => {
        expect(cls({ bgImg: { gradient: 'radial' } })).toBe('bg-radial');
        expect(cls({ bgImg: { gradient: 'radial', dir: '--a' } })).toBe('bg-radial-(--a)');
        expect(cls({ bgImg: { gradient: 'radial', dir: 'circle' } })).toBe('bg-radial-[circle]');
        expect(cls({ bgImg: { gradient: 'radial', dir: 5 } })).toBe('');
    });
    it('conic: default, numeric, negative-numeric, var, arbitrary', () => {
        expect(cls({ bgImg: { gradient: 'conic' } })).toBe('bg-conic');
        expect(cls({ bgImg: { gradient: 'conic', dir: 45 } })).toBe('bg-conic-45');
        expect(cls({ bgImg: { gradient: 'conic', dir: -45 } })).toBe('-bg-conic-45');
        expect(cls({ bgImg: { gradient: 'conic', dir: '--a' } })).toBe('bg-conic-(--a)');
        expect(cls({ bgImg: { gradient: 'conic', dir: 'from 45deg' } })).toBe(
            'bg-conic-[from_45deg]',
        );
    });
});

describe('bgImg string syntax and repeats', () => {
    it('none / gradient prefixes / negative / v3 gradient-to / repeating', () => {
        expect(cls({ bgImg: 'none' })).toBe('bg-none');
        expect(cls({ bgImg: 'linear-to-r' })).toBe('bg-linear-to-r');
        expect(cls({ bgImg: '-linear-45' })).toBe('-bg-linear-45');
        expect(cls({ bgImg: 'gradient-to-r' })).toBe('bg-linear-to-r');
        expect(cls({ bgImg: 'repeating-linear-gradient(45deg,red,blue)' })).toContain('bg-[');
    });
    it('css variable, url() and bare url', () => {
        expect(cls({ bgImg: '--hero' })).toBe('bg-(image:--hero)');
        expect(cls({ bgImg: 'url(/a.png)' })).toBe('bg-[url(/a.png)]');
        expect(cls({ bgImg: '/a.png' })).toBe('bg-[url(/a.png)]');
    });
    it('bgRepeat and maskRepeat repeat/no-repeat/suffix', () => {
        expect(cls({ bgRepeat: 'repeat' })).toBe('bg-repeat');
        expect(cls({ bgRepeat: 'no-repeat' })).toBe('bg-no-repeat');
        expect(cls({ bgRepeat: 'x' })).toBe('bg-repeat-x');
        expect(cls({ bgRepeat: 'repeat-y' })).toBe('bg-repeat-y');
        expect(cls({ maskRepeat: 'repeat' })).toBe('mask-repeat');
        expect(cls({ maskRepeat: 'no-repeat' })).toBe('mask-no-repeat');
        // Tailwind keeps the `mask-repeat-` prefix for space/round; only
        // repeat/no-repeat/repeat-x/repeat-y are bare, so `mask-round` was a
        // class it never served.
        expect(cls({ maskRepeat: 'round' })).toBe('mask-repeat-round');
        expect(cls({ maskRepeat: 'space' })).toBe('mask-repeat-space');
    });
    it('bgPos and bgSize', () => {
        expect(cls({ bgPos: 'center' })).toBe('bg-center');
        expect(cls({ bgPos: '--p' })).toBe('bg-(--p)');
        expect(cls({ bgPos: 'center top 1rem' })).toBe('bg-[center_top_1rem]');
        expect(cls({ bgSize: 'cover' })).toBe('bg-cover');
        expect(cls({ bgSize: '--s' })).toBe('bg-size-(--s)');
        expect(cls({ bgSize: '200px 100px' })).toBe('bg-size-[200px_100px]');
    });
});

describe('string property handler chain', () => {
    it('display / position / visibility / isolation', () => {
        expect(cls({ display: 'none' })).toBe('hidden');
        expect(cls({ display: 'flex' })).toBe('flex');
        expect(cls({ position: 'absolute' })).toBe('absolute');
        expect(cls({ visibility: 'hidden' })).toBe('invisible');
        expect(cls({ visibility: 'visible' })).toBe('visible');
        expect(cls({ isolation: 'isolate' })).toBe('isolate');
        expect(cls({ isolation: 'auto' })).toBe('isolation-auto');
    });
    it('willChange keyword / var / arbitrary', () => {
        expect(cls({ willChange: 'transform' })).toBe('will-change-transform');
        expect(cls({ willChange: '--w' })).toBe('will-change-(--w)');
        expect(cls({ willChange: 'left top' })).toBe('will-change-[left_top]');
    });
    it('decoration / textTransform / fontStyle / fontSmoothing / fontVariant', () => {
        expect(cls({ decoration: 'underline' })).toBe('underline');
        expect(cls({ decoration: 'none' })).toBe('no-underline');
        expect(cls({ textTransform: 'uppercase' })).toBe('uppercase');
        expect(cls({ textTransform: 'none' })).toBe('normal-case');
        expect(cls({ textTransform: 'normal-case' })).toBe('normal-case');
        expect(cls({ fontStyle: 'italic' })).toBe('italic');
        expect(cls({ fontStyle: 'normal' })).toBe('not-italic');
        expect(cls({ fontStyle: 'oblique' })).toBe('');
        expect(cls({ fontSmoothing: 'grayscale' })).toBe('antialiased');
        expect(cls({ fontSmoothing: 'subpixel' })).toBe('subpixel-antialiased');
        expect(cls({ fontSmoothing: 'bad' })).toBe('');
        expect(cls({ fontVariant: 'ordinal' })).toBe('ordinal');
    });
    it('textWrap / break / wrap / textOverflow', () => {
        expect(cls({ textWrap: 'balance' })).toBe('text-balance');
        expect(cls({ break: 'all' })).toBe('break-all');
        expect(cls({ break: 'anywhere' })).toBe('break-anywhere');
        expect(cls({ wrap: 'normal' })).toBe('wrap-normal');
        expect(cls({ wrap: 'balance' })).toBe('wrap-balance');
        expect(cls({ textOverflow: 'ellipsis' })).toBe('text-ellipsis');
        expect(cls({ textOverflow: 'fade' })).toBe('text-[fade]');
    });
    it('lineClamp none / var / integer / decimal', () => {
        expect(cls({ lineClamp: 'none' })).toBe('line-clamp-none');
        expect(cls({ lineClamp: '--v' })).toBe('line-clamp-(--v)');
        expect(cls({ lineClamp: '3' })).toBe('line-clamp-3');
        expect(cls({ lineClamp: '2.5' })).toBe('line-clamp-[2.5]');
    });
    it('list / listPos / divideStyle / decoration* families', () => {
        expect(cls({ list: '--l' })).toBe('list-(--l)');
        expect(cls({ list: 'disc' })).toBe('list-disc');
        expect(cls({ list: 'georgian' })).toBe('list-[georgian]');
        expect(cls({ listPos: 'inside' })).toBe('list-inside');
        expect(cls({ divideStyle: 'dashed' })).toBe('divide-dashed');
        expect(cls({ decorationStyle: 'wavy' })).toBe('decoration-wavy');
        expect(cls({ decorationColor: 'red-500' })).toBe('decoration-red-500');
        expect(cls({ decorationThickness: '2' })).toBe('decoration-2');
        expect(cls({ decorationThickness: '3px' })).toBe('decoration-[3px]');
        expect(cls({ decorationThickness: '--t' })).toBe('decoration-(--t)');
    });
    it('fontStretch keyword / var / integer% / decimal% / arbitrary', () => {
        expect(cls({ fontStretch: 'condensed' })).toBe('font-stretch-condensed');
        expect(cls({ fontStretch: '--f' })).toBe('font-stretch-(--f)');
        expect(cls({ fontStretch: '50%' })).toBe('font-stretch-50%');
        expect(cls({ fontStretch: '50.5%' })).toBe('font-stretch-[50.5%]');
        expect(cls({ fontStretch: 'wide' })).toBe('font-stretch-[wide]');
    });
    it('maxW container sugar / shadowColor / insetShadowColor', () => {
        expect(cls({ maxW: 'container' })).toBe('container');
        expect(cls({ shadowColor: 'red-500' })).toBe('shadow-red-500');
        expect(cls({ shadowColor: '--s' })).toBe('shadow-(color:--s)');
        expect(cls({ insetShadowColor: 'red-500' })).toBe('inset-shadow-red-500');
        expect(cls({ insetShadowColor: '--s' })).toBe('inset-shadow-(color:--s)');
    });
    it('brightness/scale/backdrop* string handling', () => {
        expect(cls({ scale: '3d' })).toBe('scale-3d');
        expect(cls({ brightness: '--b' })).toBe('brightness-(--b)');
        expect(cls({ brightness: '1.5' })).toBe('brightness-[1.5]');
        expect(cls({ backdropBrightness: '50' })).toBe('backdrop-brightness-[50]');
        expect(cls({ backdropSaturate: '150' })).toBe('backdrop-saturate-[150]');
    });
    it('textShadow / textShadowColor', () => {
        expect(cls({ textShadow: 'none' })).toBe('text-shadow-none');
        expect(cls({ textShadow: '' })).toBe('text-shadow');
        expect(cls({ textShadow: 'sm' })).toBe('text-shadow-sm');
        expect(cls({ textShadow: '2px 2px black' })).toBe('text-shadow-[2px_2px_black]');
        expect(cls({ textShadowColor: 'blue-500' })).toBe('text-shadow-blue-500');
    });
    it('fromPos/viaPos/toPos strings and numbers', () => {
        expect(cls({ fromPos: 50 })).toBe('from-50%');
        expect(cls({ viaPos: 30 })).toBe('via-30%');
        expect(cls({ toPos: '--p' })).toBe('to-(--p)');
        expect(cls({ fromPos: '15%' })).toBe('from-15%');
        expect(cls({ fromPos: '13.5%' })).toBe('from-[13.5%]');
    });
    it('dropShadowColor and arbitrary origin/ease/filter families', () => {
        expect(cls({ dropShadowColor: 'red-500' })).toBe('drop-shadow-red-500');
        expect(cls({ dropShadowColor: '--d' })).toBe('drop-shadow-(color:--d)');
        expect(cls({ ease: 'cubic-bezier(0.4,0,0.2,1)' })).toBe('ease-[cubic-bezier(0.4,0,0.2,1)]');
        expect(cls({ filter: 'blur(4px)' })).toBe('filter-[blur(4px)]');
    });
    it('perspective / perspectiveOrigin / transformStyle / backface / transitionBehavior', () => {
        expect(cls({ perspective: 'dramatic' })).toBe('perspective-dramatic');
        expect(cls({ perspective: '--p' })).toBe('perspective-(--p)');
        expect(cls({ perspective: '500px' })).toBe('perspective-[500px]');
        expect(cls({ perspective: 'foo' })).toBe('perspective-foo');
        expect(cls({ perspectiveOrigin: 'center' })).toBe('perspective-origin-center');
        expect(cls({ perspectiveOrigin: '33% 75%' })).toBe('perspective-origin-[33%_75%]');
        expect(cls({ transformStyle: '3d' })).toBe('transform-3d');
        expect(cls({ backface: 'hidden' })).toBe('backface-hidden');
        expect(cls({ transitionBehavior: 'discrete' })).toBe('transition-discrete');
    });
    it('mask family passthrough and border-*Color longhands', () => {
        expect(cls({ maskPos: 'center' })).toBe('mask-center');
        expect(cls({ maskSize: 'cover' })).toBe('mask-cover');
        expect(cls({ maskRadial: { shape: 'circle' } })).toBe('mask-circle');
        expect(cls({ maskComposite: 'add' })).toBe('mask-add');
        expect(cls({ borderXColor: 'red-500' })).toBe('border-x-red-500');
        expect(cls({ borderYColor: 'blue-500' })).toBe('border-y-blue-500');
    });
});

describe('color-string validation and snap/variant shortcuts', () => {
    it('warns and drops a string slash-opacity color', () => {
        expect(cls({ color: 'red-500/50' })).toBe('');
    });
    it('warns and drops an unrecognized color string', () => {
        expect(cls({ color: 'definitely not a color!!!' })).toBe('');
    });
    it('keeps a valid string color', () => {
        expect(cls({ color: 'red-500' })).toBe('text-red-500');
    });
    it('snap direct maps: mapped and unmapped values', () => {
        expect(cls({ snapAlign: 'start' })).toBe('snap-start');
        expect(cls({ snapType: 'x' })).toBe('snap-x');
        // Unmapped value falls through to the generic handler (snapAlign → snap).
        expect(cls({ snapAlign: 'weird' })).toBe('snap-weird');
    });
    it('string value that is a known-variant shortcut', () => {
        expect(cls({ hover: 'bg-sky-700' })).toBe('hover:bg-sky-700');
    });
    it('custom property declaration and container property', () => {
        expect(cls({ '--my-var': '10px' })).toBe('[--my-var:10px]');
        expect(cls({ container: true })).toBe('container');
        expect(cls({ container: 'sidebar' })).toBe('@container/sidebar');
    });
});

describe('numeric, boolean-sugar, and finalValue classification', () => {
    it('negative numeric with allowed key, plain numeric', () => {
        expect(cls({ mt: -4 })).toBe('-mt-4');
        expect(cls({ p: 4 })).toBe('p-4');
        expect(cls({ z: 10 })).toBe('z-10');
    });
    it('animationDelay number and string', () => {
        expect(cls({ animationDelay: 150 })).toBe('[animation-delay:150ms]');
        expect(cls({ animationDelay: '0.5s' })).toBe('[animation-delay:0.5s]');
    });
    it('var(), unsupported and supported fractions, aspect', () => {
        expect(cls({ p: 'var(--x)' })).toBe('p-[var(--x)]');
        expect(cls({ col: '3/4' })).toBe('col-[3/4]');
        expect(cls({ w: '1/2' })).toBe('w-1/2');
        expect(cls({ aspect: '16/9' })).toBe('aspect-16/9');
        expect(cls({ aspect: '16.5/9' })).toBe('aspect-[16.5/9]');
    });
    it('build-time function and malformed --var()', () => {
        expect(cls({ p: '--spacing(4)' })).toBe('p-[--spacing(4)]');
        expect(cls({ p: '--foo(' })).toBe('p-[--foo(]');
        expect(cls({ p: '--brand' })).toBe('p-(--brand)');
        expect(cls({ fontFamily: '--brand' })).toBe('font-(family-name:--brand)');
    });
    it('negative string value with allowed key', () => {
        expect(cls({ mt: '-1/2' })).toBe('-mt-1/2');
    });
    it('important modifier', () => {
        expect(cls({ p: '4!' })).toBe('p-4!');
    });
    it('removed boolean sugar warns and emits nothing (dev on)', () => {
        expect(cls({ block: true })).toBe('');
    });
    it('numeric key is skipped', () => {
        expect(cls({ 50: 100 } as unknown as SzObject)).toBe('');
    });
    it('unknown property warns but a string value still falls through to the generic handler', () => {
        // Only numeric keys are hard-skipped; an unknown camelCase key with a
        // string value is kebab-cased by the generic fallback.
        expect(cls({ notARealProperty: 'x' } as unknown as SzObject)).toBe('not-areal-property-x');
    });
});

describe('text-size + leading merge post-processing', () => {
    it('merges a matching text-size and leading pair', () => {
        // Number = spacing-scale leading (a numeric STRING would be the
        // unitless ratio and merge bracketed: text-lg/[7]).
        expect(cls({ text: 'lg', leading: 7 })).toBe('text-lg/7');
    });
    it('does NOT merge when prefixes differ (removeIndices stays empty)', () => {
        // text-lg has no prefix; the leading sits under hover: — no merge.
        expect(cls({ text: 'lg', hover: { leading: 7 } })).toBe('text-lg hover:leading-7');
    });
    it('mangleMap rewrites the emitted classes', () => {
        expect(transform({ p: 4 }, '', { 'p-4': 'x' }).className).toBe('x');
    });
});

describe('input validation and quiet-mode gating', () => {
    it('non-object input returns empty result', () => {
        expect(transform(null as unknown as SzObject).className).toBe('');
        expect(transform('str' as unknown as SzObject).className).toBe('');
        expect(transform(undefined as unknown as SzObject).className).toBe('');
    });
    it('removed sugar still drops the class with warnings muted', () => {
        const prev = process.env.CSSZYX_QUIET_SZ_WARNINGS;
        process.env.CSSZYX_QUIET_SZ_WARNINGS = '1';
        try {
            expect(cls({ block: true })).toBe('');
            expect(cls({ fontStyle: 'oblique' })).toBe('');
            expect(cls({ notARealProperty: 'x' } as unknown as SzObject)).toBe(
                'not-areal-property-x',
            );
        } finally {
            if (prev === undefined) delete process.env.CSSZYX_QUIET_SZ_WARNINGS;
            else process.env.CSSZYX_QUIET_SZ_WARNINGS = prev;
        }
    });
    it('unknown-key warning carries the runtime shape/frame context', () => {
        cls({ notARealProperty: 'x' } as unknown as SzObject);
        const messages = warnSpy.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('Unknown property'))).toBe(true);
        expect(messages.some(m => m.includes('sz object was'))).toBe(true);
    });
    it('unknown-key warning uses the build location when one is set', () => {
        setSzWarnLocation('src/App.tsx:12');
        cls({ notARealProperty: 'x' } as unknown as SzObject);
        const messages = warnSpy.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('at src/App.tsx:12'))).toBe(true);
    });
    it('numeric-key warning names the array/spread cause', () => {
        cls({ 3: 5 } as unknown as SzObject);
        const messages = warnSpy.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('numeric key'))).toBe(true);
    });
    it('alias key warning suggests the canonical form', () => {
        cls({ padding: 4 } as unknown as SzObject);
        const messages = warnSpy.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('canonical key "p"'))).toBe(true);
    });
});

describe('formatSzWarnLocation', () => {
    it('returns file:line when file equals the (slash-stripped) root', () => {
        expect(formatSzWarnLocation('/root/proj', 5, '/root/proj/')).toBe('/root/proj:5');
    });
    it('relativizes a nested file against the root', () => {
        expect(formatSzWarnLocation('/root/proj/src/a.tsx', 3, '/root/proj')).toBe('src/a.tsx:3');
    });
    it('relativizes with a backslash separator', () => {
        expect(formatSzWarnLocation('/root/proj\\src\\a.tsx', 2, '/root/proj')).toBe(
            'src\\a.tsx:2',
        );
    });
    it('omits the line when it is undefined', () => {
        expect(formatSzWarnLocation('/root/proj/src/a.tsx', undefined, '/root/proj')).toBe(
            'src/a.tsx',
        );
    });
    it('keeps the raw file when it is outside the root', () => {
        expect(formatSzWarnLocation('/other/x.tsx', 1, '/root/proj')).toBe('/other/x.tsx:1');
    });
    it('keeps the raw file when no root is given', () => {
        expect(formatSzWarnLocation('/a/b.tsx', 4, undefined)).toBe('/a/b.tsx:4');
    });
});
