/**
 * A CSS-wide keyword (`inherit`, `initial`, `unset`, `revert`, `revert-layer`)
 * is valid CSS on every property, but Tailwind serves it by name on only a few
 * prefixes. Every lane lowered `{ p: 'inherit' }` to `p-inherit`, a class with
 * no CSS; the arbitrary form `p-[inherit]` compiles.
 *
 * What this asks the installed Tailwind, per test:
 * - every prefix in the engine's `CSS_WIDE_BRACKET_PREFIXES` reads its
 *   bracketed keyword as the property it sets with a value, so the list holds
 *   no prefix whose bracket would style something else;
 * - for every key on a listed prefix and every keyword, each lane writes a
 *   class Tailwind serves;
 * - outside the list, each lane brackets exactly the keys pinned below.
 *
 * The keys under test come from the engine's own list, so a prefix the list
 * misses is not checked here: such a key keeps writing a bare keyword class
 * (`cursor-inherit`) and every test still passes.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    CSS_WIDE_BRACKET_PREFIXES,
    CSS_WIDE_KEYWORDS,
    PROPERTY_MAP,
    transform,
} from '../../compiler/src/transform-core.js';
import { captureWarnings, ENGINES } from '../../compiler/tests/engine-parity-harness.js';
import { createEmittedClassOracle } from '../src/index.js';

const REPO = path.resolve(import.meta.dirname, '../../..');

/**
 * The CSS properties a class sets, custom properties left out.
 *
 * @param css - The CSS Tailwind generated for one class.
 * @returns The property names, sorted.
 */
function propertiesOf(css: string): string {
    return [...css.matchAll(/^[ \t]*([a-z-]+)[ \t]*:/gm)]
        .map(match => match[1] as string)
        .filter(property => !property.startsWith('--'))
        .filter(property => !['inherits', 'initial-value', 'syntax'].includes(property))
        .sort((a, b) => a.localeCompare(b))
        .join(',');
}

describe('a CSS-wide keyword on a key whose arbitrary form is its own property', async () => {
    const oracle = await createEmittedClassOracle({
        resolveFrom: REPO,
        css: '@import "tailwindcss";',
        cssBase: REPO,
    });
    if (!oracle.ok) throw new Error(`expected a ready oracle, got: ${oracle.reason}`);
    const cssOf = (cls: string): string => oracle.cssFor([cls])[0] ?? '';
    const prefixOf = PROPERTY_MAP as Record<string, string>;
    const cases = Object.entries(prefixOf)
        .filter(([, prefix]) => CSS_WIDE_BRACKET_PREFIXES.has(prefix))
        .flatMap(([key]) => [...CSS_WIDE_KEYWORDS].map(keyword => [key, keyword] as const));

    it('covers the listed prefixes', () => {
        expect(cases.length).toBeGreaterThan(300);
    });

    it.each([...CSS_WIDE_BRACKET_PREFIXES])(
        '%s sets the same property bracketed as with a value',
        prefix => {
            // The list is only right while Tailwind reads the bracket as the
            // property the key controls; a release that changes that fails here.
            const own = propertiesOf(cssOf(`${prefix}-4`) || cssOf(`${prefix}-[4px]`));
            expect(own).not.toBe('');
            expect(propertiesOf(cssOf(`${prefix}-[inherit]`))).toBe(own);
        },
    );

    const lanes: ReadonlyArray<readonly [string, (key: string, keyword: string) => string]> = [
        ['runtime', (key, keyword) => transform({ [key]: keyword } as never).className],
        ...ENGINES.map(
            ([name, engine]) =>
                [
                    name,
                    (key: string, keyword: string) =>
                        captureWarnings(
                            engine,
                            `export const A = () => <p sz={{ ${key}: '${keyword}' }} />;`,
                            '/p/src/Keyword.jsx',
                        ).className ?? '',
                ] as const,
        ),
    ];

    it.each(lanes)('lowers to a class Tailwind serves on the %s lane', (_name, lower) => {
        const dead = cases.filter(([key, keyword]) => {
            const className = lower(key, keyword);
            return !className || oracle.findDead([className]).length > 0;
        });
        expect(dead).toEqual([]);
    });

    it.each(lanes)('brackets no other key than it did on the %s lane', (_name, lower) => {
        // Outside the list the bracket would set another property, so the
        // keyword rule leaves those keys alone. These keys bracket through a
        // path of their own, most under a prefix of their own
        // (`bg-size-[unset]`); `textOverflow` writes `text-[unset]`, a colour,
        // which is tracked separately. Pinned so a new bracket shows up here.
        const bracketed = Object.entries(prefixOf)
            .filter(([, prefix]) => /^[a-z]+(?:-[a-z]+)*$/.test(prefix))
            .filter(([, prefix]) => !CSS_WIDE_BRACKET_PREFIXES.has(prefix))
            .filter(([key]) => lower(key, 'unset').includes('[unset]'))
            .map(([key]) => key);
        // The runtime also brackets `textOverflow` and `willChange`, which
        // the engine leaves bare; that divergence predates the keyword rule.
        const runtimeOnly = _name === 'runtime' ? ['textOverflow', 'willChange'] : [];
        expect([...bracketed].sort((a, b) => a.localeCompare(b))).toEqual(
            [
                'bgSize',
                'fontStretch',
                'content',
                'list',
                'brightness',
                'contrast',
                'saturate',
                'backdropBrightness',
                'backdropContrast',
                'backdropSaturate',
                'perspectiveOrigin',
                'maskSize',
                'maskPos',
                ...runtimeOnly,
            ].sort((a, b) => a.localeCompare(b)),
        );
    });
});
