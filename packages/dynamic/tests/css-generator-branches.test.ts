/**
 * Branch coverage for css-generator.ts edge cases not exercised by the main
 * suites: the dev-only unsafe-arbitrary warning's production gate, the
 * `screen` keyword's height/width disambiguation, CSS-variable shorthand
 * `(--x)` syntax for spacing/color, malformed fraction/numeric fallbacks,
 * negative spacing utilities, color opacity-modifier edge cases, container
 * query tiers, and the many "named lookup miss → fall through" paths across
 * the utility families (leading/tracking/font/shadow/outline/ring/columns/
 * grid-rows/ease). Several of these fall-through paths land on a DIFFERENT,
 * later utility family (e.g. `shadow-foo` isn't a shadow size, but `shadow`
 * is also a COLOR_PROPS prefix, so it resolves as a color) — that's real
 * behavior, not a test artifact, and is asserted as such below.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runtimeMessage } from '../../compiler/tests/engine-message.js';

import { generateDeclarations, parseVariants } from '../src/css-generator.js';

describe('warnUnsafeArbitrary — production gate', () => {
    // This must be the first test in the file to touch an unsafe arbitrary
    // value: the "warn once" flag is module-level and never reset, so once
    // any test in this module context has warned, later calls short-circuit
    // on the "already warned" branch instead of the NODE_ENV branch under
    // test here. Vitest gives each test FILE a fresh module registry.
    it('does not warn when NODE_ENV=production (still drops the value)', () => {
        vi.stubEnv('NODE_ENV', 'production');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = generateDeclarations('[color:red;position:fixed]');

        expect(result).toBe('');
        expect(warn).not.toHaveBeenCalled();

        warn.mockRestore();
        vi.unstubAllEnvs();
    });
});

describe('generateDeclarations — resolveSpacingValue edge cases', () => {
    it('resolves "screen" against a height-family prop via translate-y', () => {
        // translate-y-<v> calls resolveSpacingValue(v, 'height') directly —
        // unlike h-screen/min-h-screen/max-h-screen, this class has no
        // KEYWORD_RULES shortcut, so it actually reaches the height branch.
        expect(generateDeclarations('translate-y-screen')).toContain('100vh');
    });

    it('resolves "screen" to 100vw for a non-height prop (min-w has no keyword shortcut)', () => {
        expect(generateDeclarations('min-w-screen')).toBe('min-width: 100vw');
    });

    it('resolves the (--x) CSS-variable shorthand for a spacing value', () => {
        expect(generateDeclarations('w-(--my-width)')).toBe('width: var(--my-width)');
    });

    it('falls back to the raw value for a fraction with a non-numeric side', () => {
        // "a/2" isn't a valid fraction (num side is NaN) and isn't a plain
        // number either — resolveSpacingValue gives up and returns it as-is.
        expect(generateDeclarations('w-a/2')).toBe('width: a/2');
    });

    it('generates negative spacing from a leading-dash utility (-m-4)', () => {
        // Regression: the spacing-prefix loop used to match only
        // "<prefix>-<val>" and never the compiler's actual negative form
        // "-<prefix>-<val>", so every negative spacing utility silently
        // produced no declaration at runtime. Covers -mt-4/-mx-2/etc too.
        expect(generateDeclarations('-m-4')).toBe('margin: calc(var(--spacing) * -4)');
        expect(generateDeclarations('-mt-4')).toBe('margin-top: calc(var(--spacing) * -4)');
        expect(generateDeclarations('-mx-2')).toBe('margin-inline: calc(var(--spacing) * -2)');
        expect(generateDeclarations('-inset-4')).toBe('inset: calc(var(--spacing) * -4)');
    });

    it('does not misfire negative-matching for an unrelated leading-dash utility', () => {
        // "-mt-4" must only match the "mt" prefix, not accidentally match a
        // shorter prefix like "m" via the negative-dash form.
        expect(generateDeclarations('-mt-4')).not.toContain('margin:');
    });

    it('returns empty for a spacing prefix with no value (trailing dash)', () => {
        expect(generateDeclarations('p-')).toBe('');
    });
});

describe('generateDeclarations — resolveColorValue edge cases', () => {
    it('maps the "current" keyword to currentColor', () => {
        expect(generateDeclarations('text-current')).toBe('color: currentColor');
    });

    it('unwraps an arbitrary "color:" prefixed value', () => {
        expect(generateDeclarations('bg-[color:var(--x)]')).toBe('background-color: var(--x)');
    });

    it('resolves the (--x) CSS-variable shorthand for a color value', () => {
        expect(generateDeclarations('bg-(--my-color)')).toBe('background-color: var(--my-color)');
    });

    it('keeps a direct color keyword bare under an opacity modifier', () => {
        const result = generateDeclarations('bg-white/50');
        expect(result).toBe('background-color: color-mix(in srgb, white 50%, transparent)');
    });

    it('reads a bare decimal modifier as a percent, as Tailwind does', () => {
        const result = generateDeclarations('bg-blue-500/0.5');
        expect(result).toBe(
            'background-color: color-mix(in srgb, var(--color-blue-500) 0.5%, transparent)',
        );
    });

    // A slash opacity in a colour string reaches dynamic() with the class as
    // written (ADR 0036), so every modifier Tailwind reads is read here too:
    // `[x%]` as given, `[x]` as a fraction of one, `(--v)` as a variable.
    it.each([
        ['bg-red-500/[50%]', 'color-mix(in srgb, var(--color-red-500) 50%, transparent)'],
        ['bg-red-500/[0.3]', 'color-mix(in srgb, var(--color-red-500) 30%, transparent)'],
        ['bg-red-500/(--o)', 'color-mix(in srgb, var(--color-red-500) var(--o), transparent)'],
        ['bg-[#f00]/50', 'color-mix(in srgb, #f00 50%, transparent)'],
        ['bg-(--c)/50', 'color-mix(in srgb, var(--c) 50%, transparent)'],
        ['bg-(--c)/(--o)', 'color-mix(in srgb, var(--c) var(--o), transparent)'],
        // `[2]` is 200%, past what `color-mix()` takes: the colour alone.
        ['bg-red-500/[2]', 'var(--color-red-500)'],
    ])('reads the opacity modifier of %s', (className, value) => {
        expect(generateDeclarations(className)).toBe(`background-color: ${value}`);
    });
});

describe('parseVariants — container query tiers', () => {
    it('recognizes a container min-width tier (@sm)', () => {
        expect(parseVariants('@sm:flex').tier).toBe('@sm');
    });

    it('recognizes a container max-width tier (@max-sm)', () => {
        expect(parseVariants('@max-sm:flex').tier).toBe('@max-sm');
    });
});

describe('generateDeclarations — named-lookup-miss fall-through paths', () => {
    it.each<[string, string]>([
        // opacity: numeric value with no OPACITY_NAMED entry (not a multiple of 5)
        ['opacity-33', 'opacity: 0.33'],
        // opacity: not a bracket and not parseable as a number at all
        ['opacity-foo', ''],
        // z-index: garbage value matches neither auto/bracket/number
        ['z-foo', ''],
        // leading: named lookup hit (not previously covered — only numeric was)
        ['leading-tight', 'line-height: 1.25'],
        // leading: no named/bracket/numeric match at all
        ['leading-foo', ''],
        // tracking: no named/bracket match — no numeric fallback for tracking
        ['tracking-foo', ''],
        // font: no family/bracket match
        ['font-foo', ''],
        // columns: non-numeric value falls back to a container var
        ['columns-auto', 'columns: var(--container-auto)'],
        // ease: not a named easing curve — falls back to a CSS var
        ['ease-custom', 'transition-timing-function: var(--ease-custom)'],
        // color-prefix loop: bare prefix / trailing-dash-with-no-value are skipped
        ['bg-', ''],
        ['bg', ''],
    ])('%s -> %s', (utility, expected) => {
        expect(generateDeclarations(utility)).toBe(expected);
    });

    it('shadow-foo is not a shadow size, but "shadow" is also a color prefix', () => {
        // shadow-<val> only matches a size (xs/sm/md/.../inner) or [arbitrary];
        // "foo" matches neither, so the shadow-size block returns nothing —
        // execution falls through to the color-prefix loop where "shadow" maps
        // to --tw-shadow-color.
        expect(generateDeclarations('shadow-foo')).toBe('--tw-shadow-color: var(--color-foo)');
    });

    it('outline-foo is not a numeric width, falls through to outline-color', () => {
        expect(generateDeclarations('outline-foo')).toBe('outline-color: var(--color-foo)');
    });

    it('ring-foo is not a numeric width, falls through to --tw-ring-color', () => {
        expect(generateDeclarations('ring-foo')).toBe('--tw-ring-color: var(--color-foo)');
    });

    it('named shadow sizes still resolve to their CSS var', () => {
        expect(generateDeclarations('shadow-md')).toBe('box-shadow: var(--shadow-md)');
    });

    it('shadow-none is a real named size, not the color fallback', () => {
        expect(generateDeclarations('shadow-none')).toBe('box-shadow: none');
    });

    it('grow/shrink accept values beyond the 0/1 KEYWORD_RULES shortcuts', () => {
        expect(generateDeclarations('grow-2')).toBe('flex-grow: 2');
        expect(generateDeclarations('shrink-3')).toBe('flex-shrink: 3');
    });
});

describe('generateDeclarations — border-radius directional edge cases', () => {
    it('rounded-<dir>-full resolves the full-radius keyword per side', () => {
        const result = generateDeclarations('rounded-t-full');
        expect(result).toContain('calc(infinity * 1px)');
        expect(result).toContain('border-top-left-radius');
        expect(result).toContain('border-top-right-radius');
    });

    it('rounded-<dir>-none resolves the zero-radius keyword per side', () => {
        const result = generateDeclarations('rounded-t-none');
        expect(result).toBe('border-top-left-radius: 0; border-top-right-radius: 0');
    });

    it('rounded-<dir>-<n> passes an unrecognized size through unchanged', () => {
        expect(generateDeclarations('rounded-t-3')).toBe(
            'border-top-left-radius: 3; border-top-right-radius: 3',
        );
    });

    it('rejects a direction combo that is not a valid rounded-* direction key', () => {
        // "ts" (t + s) matches the [trblse]+ direction regex but was never
        // registered as a directional key (only t/r/b/l/tl/tr/bl/br exist).
        expect(generateDeclarations('rounded-ts-lg')).toBe('');
    });

    it('returns empty for a rounded- value matching no known form', () => {
        expect(generateDeclarations('rounded-xyz')).toBe('');
    });
});

describe('generateDeclarations — grid-rows keyword forms (mirrors grid-cols)', () => {
    it.each<[string, string]>([
        ['grid-rows-none', 'grid-template-rows: none'],
        ['grid-rows-subgrid', 'grid-template-rows: subgrid'],
        ['grid-rows-[1fr_2fr]', 'grid-template-rows: 1fr 2fr'],
    ])('%s -> %s', (utility, expected) => {
        expect(generateDeclarations(utility)).toBe(expected);
    });

    it('row-span-full spans the full grid row (mirrors col-span-full)', () => {
        expect(generateDeclarations('row-span-full')).toBe('grid-row: 1 / -1');
    });
});

describe('warnUnsafeArbitrary — dev-mode warning still fires once', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('warns for an unsafe arbitrary value outside production', () => {
        vi.stubEnv('NODE_ENV', 'test');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Note: whether this actually calls console.warn depends on whether an
        // earlier test in THIS file already tripped the module-level "warned
        // once" flag via a non-production unsafe value. The production test
        // above intentionally does not trip it (it returns before warning),
        // so this is the first non-production unsafe-value call in the file.
        generateDeclarations('[color:red;position:fixed]');
        expect(warn.mock.calls).toEqual([
            [
                runtimeMessage(
                    'dynamic-unsafe-arbitrary',
                    'The arbitrary value in `[color:red;position:fixed]` could inject CSS, so `dynamic()` omits the class.',
                    'help: keep untrusted data out of arbitrary values, or validate it before it reaches `dynamic()`.',
                    'note: only the first dropped value of a session is reported.',
                ),
            ],
        ]);

        warn.mockRestore();
    });
});

describe('border side grammar', () => {
    it.each([
        ['t', 'border-top-width'],
        ['r', 'border-right-width'],
        ['b', 'border-bottom-width'],
        ['l', 'border-left-width'],
        ['x', 'border-inline-width'],
        ['y', 'border-block-width'],
        ['s', 'border-inline-start-width'],
        ['e', 'border-inline-end-width'],
    ])('resolves the bare border-%s side', (side, property) => {
        expect(generateDeclarations(`border-${side}`)).toBe(`${property}: 1px`);
    });

    it.each([
        ['t', 'border-top-width'],
        ['r', 'border-right-width'],
        ['b', 'border-bottom-width'],
        ['l', 'border-left-width'],
        ['x', 'border-inline-width'],
        ['s', 'border-inline-start-width'],
        ['e', 'border-inline-end-width'],
    ])('resolves the numeric border-%s width', (side, property) => {
        expect(generateDeclarations(`border-${side}-3`)).toBe(`${property}: 3px`);
    });

    it.each([
        ['rounded-none', 'border-radius: 0'],
        ['rounded-full', 'border-radius: calc(infinity * 1px)'],
    ])('resolves %s through the keyword table', (utility, declaration) => {
        expect(generateDeclarations(utility)).toBe(declaration);
    });
});

describe('generateDeclarations — a shadow with its own opacity', () => {
    // Tailwind serves `shadow-sm/50` by rewriting each colour inside the
    // theme's shadow at build time; a rule written here has only
    // `var(--shadow-sm)`, so it writes none rather than a shadow with the
    // wrong alpha (the gap `dynamic.mdx` documents).
    it.each([
        'shadow-sm/50',
        'shadow-2xl/[50%]',
        'shadow-(--s)/50',
        'shadow-[0_1px_red]/50',
        'drop-shadow-md',
        'drop-shadow-md/50',
        'inset-shadow-xs/25',
        // A size with no opacity on the inset and text shadows: no rule
        // rather than a spacing or text-colour declaration.
        'inset-shadow-xs',
        'text-shadow-sm',
        'text-shadow-lg/50',
    ])('%s gets no rule', utility => {
        expect(generateDeclarations(utility)).toBe('');
    });

    it('still writes a shadow and a shadow colour with an opacity', () => {
        expect(generateDeclarations('shadow-sm')).toBe('box-shadow: var(--shadow-sm)');
        expect(generateDeclarations('shadow-black/50')).toBe(
            '--tw-shadow-color: color-mix(in srgb, black 50%, transparent)',
        );
        expect(generateDeclarations('drop-shadow-[#f00]/50')).toBe(
            '--tw-drop-shadow-color: color-mix(in srgb, #f00 50%, transparent)',
        );
        // A colour function in brackets and a `color:` variable are colours.
        expect(generateDeclarations('shadow-[rgb(255_0_0)]/50')).toBe(
            '--tw-shadow-color: color-mix(in srgb, rgb(255 0 0) 50%, transparent)',
        );
        expect(generateDeclarations('shadow-(color:--c)/50')).toBe(
            '--tw-shadow-color: color-mix(in srgb, var(--c) 50%, transparent)',
        );
        expect(generateDeclarations('text-shadow-red-500/50')).toBe(
            '--tw-text-shadow-color: color-mix(in srgb, var(--color-red-500) 50%, transparent)',
        );
    });
});

describe('generateDeclarations — a type hint names the value, not its text', () => {
    // `(color:--c)` and `[length:10px]` tell Tailwind what the value is; the
    // declaration holds the value alone, as Tailwind writes it.
    it.each([
        ['bg-(color:--c)', 'background-color: var(--c)'],
        ['bg-(color:--c)/50', 'background-color: color-mix(in srgb, var(--c) 50%, transparent)'],
        ['text-(color:--c)', 'color: var(--c)'],
        ['w-(length:--s)', 'width: var(--s)'],
        ['w-[length:10px]', 'width: 10px'],
        ['bg-[color:#f00]', 'background-color: #f00'],
        // No hint: unchanged.
        ['bg-(--c)', 'background-color: var(--c)'],
        ['w-(--s,1rem)', 'width: var(--s,1rem)'],
    ])('%s writes %s', (utility, declaration) => {
        expect(generateDeclarations(utility)).toBe(declaration);
    });
});
