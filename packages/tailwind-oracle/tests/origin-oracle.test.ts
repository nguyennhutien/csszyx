/**
 * Which classes are Tailwind's own, and which the project wrote.
 *
 * A merge may remove a class only when Tailwind itself serves it and the
 * project's CSS does not select it: a class the project declared with
 * `@utility`, registered through a plugin, or names in a selector of its own is
 * often a hook for script or for another rule, and its signature — the CSS of
 * its own rule — says nothing about that.
 */
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
    createEmittedClassOracle,
    defaultTailwindLoader,
    type TailwindLoader,
} from '../src/emitted-class-oracle.js';
import {
    classesInSelectors,
    declareUtilitiesIn,
    isDeclared,
    noDeclaredUtilities,
    stripCustomUtilities,
    withoutRegisteredClasses,
} from '../src/origin-oracle.js';

const REPO = path.resolve(import.meta.dirname, '../../..');
const dirs: string[] = [];

afterAll(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A directory holding the given files, removed after the run.
 *
 * @param files - Relative path to content.
 * @returns The directory.
 */
function project(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-origin-'));
    dirs.push(dir);
    for (const [name, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), content);
    }
    return dir;
}

/**
 * The origin answer for a stylesheet, failing the test when it is unavailable.
 *
 * @param css - The root stylesheet.
 * @param files - Files beside it.
 * @returns A function naming each candidate's origin.
 */
async function originsOf(css: string, files: Record<string, string> = {}) {
    const dir = project(files);
    const oracle = await createEmittedClassOracle({ resolveFrom: REPO, css, cssBase: dir });
    if (!oracle.ok) throw new Error(`expected a ready oracle, got skip: ${oracle.reason}`);
    const origins = await oracle.loadOriginOracle();
    if (!origins.ok) throw new Error(`expected origins, got: ${origins.reason}`);
    return (candidate: string) => origins.origin(candidate);
}

const PLUGIN = `export default {
    handler({ addUtilities, matchUtilities, addVariant }) {
        addUtilities({ '.hook': { opacity: '0' } });
        matchUtilities({ fx: value => ({ opacity: value }) }, { values: { a: '0.5' } });
        addVariant('hocus', ['&:hover', '&:focus']);
    },
};
`;

describe('the origin of a class', () => {
    it('is Tailwind for a core utility, with a project theme value or a variant', async () => {
        const origin = await originsOf(
            '@import "tailwindcss";\n@theme { --spacing-brand: 3px; --color-brand: #123; }',
        );
        for (const candidate of ['p-4', 'p-brand', 'bg-brand', 'hover:p-4', 'md:p-[3px]']) {
            expect(origin(candidate), candidate).toBe('tailwind');
        }
    });

    it('is custom for an @utility, static or functional, under any variant', async () => {
        const origin = await originsOf(
            '@import "tailwindcss";\n@utility reveal { opacity: 0; }\n' +
                '@utility tabby-* { tab-size: --value(integer); }',
        );
        expect(origin('reveal')).toBe('custom');
        expect(origin('md:reveal')).toBe('custom');
        expect(origin('tabby-4')).toBe('custom');
        expect(origin('opacity-100')).toBe('tailwind');
    });

    it('is custom for an @utility in a stylesheet the root imports', async () => {
        const origin = await originsOf('@import "tailwindcss";\n@import "./parts/hooks.css";', {
            'parts/hooks.css': '@utility reveal { opacity: 0; }',
        });
        expect(origin('reveal')).toBe('custom');
    });

    it('is custom for a class a plugin registers, and keeps the variants it adds', async () => {
        const origin = await originsOf('@import "tailwindcss";\n@plugin "./plug.mjs";', {
            'plug.mjs': PLUGIN,
        });
        expect(origin('hook')).toBe('custom');
        expect(origin('fx-a')).toBe('custom');
        expect(origin('hocus:p-4')).toBe('tailwind');
    });

    // Removing the `@plugin` line would leave this one registered: the config
    // file carries the plugin in its own `plugins` list.
    it('is custom for a class a plugin registers through @config', async () => {
        const origin = await originsOf('@import "tailwindcss";\n@config "./cfg.mjs";', {
            'plug.mjs': PLUGIN,
            'cfg.mjs': 'import plug from "./plug.mjs";\nexport default { plugins: [plug] };\n',
        });
        expect(origin('hook')).toBe('custom');
        expect(origin('p-4')).toBe('tailwind');
    });

    // `@apply reveal` would not compile once `@utility reveal` is gone.
    it('reads a stylesheet that applies its own utility', async () => {
        const origin = await originsOf(
            '@import "tailwindcss";\n@utility reveal { opacity: 0; }\n.card { @apply reveal p-4; }',
        );
        expect(origin('reveal')).toBe('custom');
        expect(origin('p-4')).toBe('tailwind');
    });

    it('is a hook for a Tailwind class the project selects in its own rule', async () => {
        const origin = await originsOf(
            '@import "tailwindcss";\n.card.shadow-md { outline: 1px solid; }',
        );
        expect(origin('shadow-md')).toBe('hook');
        expect(origin('shadow-lg')).toBe('tailwind');
    });

    it('is a hook for a prefixed class the project selects with its escape', async () => {
        const origin = await originsOf(
            '@import "tailwindcss" prefix(tw);\n.card .tw\\:shadow-md { outline: 1px solid; }',
        );
        expect(origin('tw:shadow-md')).toBe('hook');
        expect(origin('tw:shadow-lg')).toBe('tailwind');
    });
});

describe('what telling the classes apart costs', () => {
    /**
     * How many design systems one oracle and its origins compile.
     *
     * @param css - The root stylesheet.
     * @returns The number of `loadDesignSystem` calls.
     */
    async function compiles(css: string): Promise<number> {
        let calls = 0;
        const loader: TailwindLoader = async from => {
            const tailwind = await defaultTailwindLoader(from);
            if (tailwind === null) return null;
            const load = tailwind.loadDesignSystem as (...args: unknown[]) => Promise<unknown>;
            return {
                ...tailwind,
                loadDesignSystem: async (...args: unknown[]) => {
                    calls += 1;
                    return load(...args);
                },
            };
        };
        const oracle = await createEmittedClassOracle(
            { resolveFrom: REPO, css, cssBase: REPO },
            loader,
        );
        if (!oracle.ok) throw new Error(oracle.reason);
        await oracle.loadOriginOracle();
        await oracle.loadOriginOracle();
        return calls;
    }

    // Most projects: the docs app declares nothing of its own and pays one
    // compile, as before; one that does pays one more, once.
    it('is no second compile for a project that declares nothing of its own', async () => {
        expect(await compiles('@import "tailwindcss";\n.card.shadow-md { outline: 0; }')).toBe(1);
    });

    it('is one second compile, cached, for a project that does', async () => {
        expect(await compiles('@import "tailwindcss";\n@utility reveal { opacity: 0; }')).toBe(2);
    });
});

describe('what a council review of the scanner found', () => {
    // A minified stylesheet keeps an unquoted url on the same line as what
    // follows it; an apostrophe inside it is not a string.
    it('reads past an unquoted url holding a quote', async () => {
        const origin = await originsOf(
            '@import "tailwindcss";\n.a{background:url(it\'s.png)}@utility reveal{opacity:0}.card .shadow-md{outline:0}',
        );
        expect(origin('reveal')).toBe('custom');
        expect(origin('shadow-md')).toBe('hook');
    });

    it('reads a code point no character has as the replacement character, and goes on', async () => {
        const origin = await originsOf(
            '@import "tailwindcss";\n.a\\110000 .shadow-md { color: red }',
        );
        expect(origin('shadow-md')).toBe('hook');
    });

    it('is a hook for a class a parenthesised @custom-variant selects', async () => {
        const origin = await originsOf(
            '@import "tailwindcss";\n@custom-variant open (&.shadow-md);',
        );
        expect(origin('shadow-md')).toBe('hook');
    });

    // The stripped design system still serves the core rule of the same name,
    // so being served there does not make the project's own declaration Tailwind's.
    it('is custom for an @utility that reuses a Tailwind name, static or functional', async () => {
        const origin = await originsOf(
            '@import "tailwindcss";\n@utility flex { outline: 1px solid; }\n' +
                '@utility shadow-* { --hook: --value(integer); }',
        );
        expect(origin('flex')).toBe('custom');
        expect(origin('md:flex')).toBe('custom');
        expect(origin('shadow-4')).toBe('custom');
        expect(origin('shadow-lg')).toBe('custom');
        expect(origin('block')).toBe('tailwind');
    });

    it('is custom for a class a plugin registers under a Tailwind name', async () => {
        const origin = await originsOf('@import "tailwindcss";\n@plugin "./plug.mjs";', {
            'plug.mjs':
                'export default { handler({ addUtilities, matchUtilities }) {\n' +
                "    addUtilities({ '.shadow-md:hover': { opacity: '0' } });\n" +
                "    matchUtilities({ rounded: value => ({ '--r': value }) }, { values: { x: '1' } });\n" +
                '} };\n',
        });
        expect(origin('shadow-md')).toBe('custom');
        expect(origin('rounded-lg')).toBe('custom');
        expect(origin('p-4')).toBe('tailwind');
    });
});

describe('a class an attribute selector matches', () => {
    it.each([
        ['[class~="shadow-md"]', 'shadow-md', 'hook'],
        ['[class="card shadow-md"]', 'shadow-md', 'hook'],
        ["[class*='shadow']", 'shadow-lg', 'hook'],
        ['[class^=shadow]', 'hover:shadow-lg', 'hook'],
        ['[class$="MD" i]', 'shadow-md', 'hook'],
        ['[class^="shadow-md-card"]', 'shadow-md', 'hook'],
        ['[data-x~="shadow-md"]', 'shadow-md', 'tailwind'],
        ['[class~="shadow-md"]', 'shadow-lg', 'tailwind'],
    ])('%s makes %s a %s', async (selector, candidate, expected) => {
        const origin = await originsOf(`@import "tailwindcss";\n.card ${selector} { outline: 0; }`);
        expect(origin(candidate)).toBe(expected);
    });
});

describe('when the classes cannot be told apart', () => {
    it.each([
        ['an error', new Error('boom')],
        ['any other value', 'boom'],
    ])('reports why when the compile throws %s, and never throws', async (_, thrown) => {
        let calls = 0;
        const loader: TailwindLoader = async from => {
            const tailwind = await defaultTailwindLoader(from);
            if (tailwind === null) return null;
            const load = tailwind.loadDesignSystem as (...args: unknown[]) => Promise<unknown>;
            return {
                ...tailwind,
                // The first compile is the project's; the second is the one
                // that tells the classes apart.
                loadDesignSystem: async (...args: unknown[]) => {
                    calls += 1;
                    if (calls > 1) throw thrown;
                    return load(...args);
                },
            };
        };
        const oracle = await createEmittedClassOracle(
            {
                resolveFrom: REPO,
                css: '@import "tailwindcss";\n@utility reveal { opacity: 0; }',
                cssBase: REPO,
            },
            loader,
        );
        if (!oracle.ok) throw new Error(oracle.reason);
        const origins = await oracle.loadOriginOracle();
        expect(origins).toEqual({ ok: false, reason: expect.stringContaining('boom') });
    });
});

describe('stripCustomUtilities', () => {
    it('removes every @utility block and @apply statement, and nothing else', () => {
        const css =
            '@import "tailwindcss";\n@utility a { &:hover { opacity: 0; } }\n' +
            '.b { color: red; @apply a p-4; }\n@utility c-* { --x: "}"; }\n/* @utility d {} */\n';
        expect(stripCustomUtilities(css)).toBe(
            '@import "tailwindcss";\n\n.b { color: red;  }\n\n/* @utility d {} */\n',
        );
    });

    it('leaves a stylesheet with neither untouched', () => {
        const css = '@import "tailwindcss";\n@theme { --color-x: red; }\n.a { content: "@apply"; }';
        expect(stripCustomUtilities(css)).toBe(css);
    });

    it('is idempotent', () => {
        const css = '@utility a { opacity: 0 } .b { @apply a; }';
        expect(stripCustomUtilities(stripCustomUtilities(css))).toBe(stripCustomUtilities(css));
    });
});

describe('stylesheet text the scanner must not misread', () => {
    it.each([
        ['an unterminated comment', '.a {} /* @utility b {', '.a {} /* @utility b {'],
        [
            'an escaped quote inside a string',
            '.a { content: "\\"@apply b;"; }',
            '.a { content: "\\"@apply b;"; }',
        ],
        ['an unterminated string', '.a { content: "@apply b', '.a { content: "@apply b'],
        ['an @apply its block closes without a semicolon', '.a { @apply b }', '.a { }'],
        ['an @utility never closed', '.a {}\n@utility b { color: red', '.a {}\n'],
        [
            'a function that only ends in url',
            '.a { x: myurl(b) }\n@utility c {}',
            '.a { x: myurl(b) }\n',
        ],
        ['a quoted url', '.a { x: url( "b)" ) }@utility c {}', '.a { x: url( "b)" ) }'],
        [
            'an escaped paren inside a url',
            ".a { x: url(b\\)'c) }@utility d {}",
            ".a { x: url(b\\)'c) }",
        ],
        ['a url never closed', '.a { x: url(b', '.a { x: url(b'],
    ])('strips %s correctly', (_, css, stripped) => {
        expect(stripCustomUtilities(css)).toBe(stripped);
    });

    it.each([
        ['a six-digit escape, then more characters', '.\\0000414 { }', ['A4']],
        ['a hex escape with no terminating space', '.\\31m { }', ['1m']],
        ['a dash with nothing after it', '.- { } .-a { }', ['-a']],
    ])('reads %s', (_, css, classes) => {
        expect(classesInSelectors(css)).toEqual(classes);
    });

    it('leaves a module that is not a plugin as it is', () => {
        expect(withoutRegisteredClasses(null)).toBeNull();
        expect(withoutRegisteredClasses(5)).toBe(5);
    });
});

describe('classesInSelectors, at the edges a review measured', () => {
    it('ends a hex escape at a tab or a line break as at a space', () => {
        expect(classesInSelectors('.\\31\t0 {} .\\31\r\n0 {}')).toEqual(['10', '10']);
    });

    it('reads a selector list of any length', () => {
        const list = Array.from({ length: 250_000 }, (_, index) => `.c${index}`);
        const css = `${list.join(',')}{}`;
        expect(classesInSelectors(css)).toHaveLength(250_000);
    });
});

describe('classesInSelectors', () => {
    it('reads classes from every selector, unescaped, and none from values or strings', () => {
        const css =
            '.a.b > .c:is(.d, .e) { margin: .5rem; background: url(x.png); }\n' +
            '[data-x=".f"] .tw\\:g { content: ".h"; }\n@media (min-width: 40.5rem) { .i { } }\n' +
            '@utility j { &.k { } }\n/* .l */\n.\\31 m { }';
        expect(classesInSelectors(css).sort()).toEqual(
            ['1m', 'a', 'b', 'c', 'd', 'e', 'i', 'k', 'tw:g'].sort(),
        );
    });
});

describe('isDeclared', () => {
    const declared = noDeclaredUtilities();
    declareUtilitiesIn('@utility flex { gap: 0 }\n@utility tab-* { tab-size: 1 }', declared);

    it.each([
        ['flex', true],
        ['md:[&.x]:flex', true],
        ['-flex!', true],
        ['!flex', true],
        ['tab-4', true],
        ['tab', true],
        ['tab-[3]/50', true],
        ['bg-[url(/a:b)]', false],
        ['flex-col', false],
        ['table', false],
    ])('reads %s as declared: %s', (candidate, expected) => {
        expect(isDeclared(declared, candidate)).toBe(expected);
    });
});

describe('withoutRegisteredClasses', () => {
    it('silences the class registrars and keeps every other call', () => {
        const calls: string[] = [];
        const api = {
            addUtilities: () => calls.push('addUtilities'),
            addComponents: () => calls.push('addComponents'),
            addVariant: () => calls.push('addVariant'),
        };
        const plugin = withoutRegisteredClasses({
            handler(given: typeof api) {
                given.addUtilities();
                given.addComponents();
                given.addVariant();
            },
        }) as { handler(given: typeof api): void };
        plugin.handler(api);
        expect(calls).toEqual(['addVariant']);
    });

    it('records the names a silenced registrar was given, in every argument shape', () => {
        const declared = noDeclaredUtilities();
        const api = { addUtilities: () => undefined, matchComponents: () => undefined };
        const plugin = withoutRegisteredClasses(
            (given: {
                addUtilities(utilities: unknown): void;
                matchComponents(utilities: unknown): void;
            }) => {
                given.addUtilities([{ '.a:hover, .b': {} }, null]);
                given.addUtilities('not an object');
                given.matchComponents({ card: () => ({}) });
            },
            declared,
        ) as (given: typeof api) => void;
        plugin(api);
        expect([...declared.names].sort()).toEqual(['a', 'b']);
        expect([...declared.roots]).toEqual(['card']);
    });

    it('follows plugin functions, options functions, and config plugins and presets', () => {
        const calls: string[] = [];
        const api = { addUtilities: () => calls.push('u'), addBase: () => calls.push('b') };
        const fn = (given: typeof api) => {
            given.addUtilities();
            given.addBase();
        };
        const withOptions = Object.assign(() => ({ handler: fn }), { __isOptionsFunction: true });
        const config = withoutRegisteredClasses({
            plugins: [fn],
            presets: [{ plugins: [withOptions] }],
        }) as {
            plugins: Array<(given: typeof api) => void>;
            presets: Array<{
                plugins: Array<(() => { handler(given: typeof api): void }) & object>;
            }>;
        };
        config.plugins[0]?.(api);
        const options = config.presets[0]?.plugins[0];
        expect((options as { __isOptionsFunction?: boolean }).__isOptionsFunction).toBe(true);
        options?.().handler(api);
        expect(calls).toEqual(['b', 'b']);
    });
});
