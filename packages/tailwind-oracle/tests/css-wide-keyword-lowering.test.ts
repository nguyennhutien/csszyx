/**
 * A CSS-wide keyword (`inherit`, `initial`, `unset`, `revert`, `revert-layer`)
 * is valid CSS on every property, but Tailwind serves it by name on only a few
 * prefixes. Every lane lowered `{ p: 'inherit' }` to `p-inherit`, a class with
 * no CSS; the arbitrary form `p-[inherit]` compiles.
 *
 * Which keys take the bracket is the `w` column of the capability table,
 * which `gen-sz-capabilities.mjs` measures against the installed Tailwind
 * (`pnpm gen:sz-capabilities:check` fails when it is stale). What this asks,
 * per test:
 * - for every key with the column and every keyword, each lane writes a class
 *   Tailwind serves;
 * - outside the column, each lane brackets exactly the keys pinned below.
 *
 * `sz-capability-differential.test.ts` asks the same of every key, and counts
 * a bracket as served only where a property reads the keyword.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    SZ_CAP_CSS_WIDE_BRACKET,
    SZ_CAPABILITIES,
} from '../../compiler/src/sz-capabilities.generated.js';
import { CSS_WIDE_KEYWORDS, PROPERTY_MAP, transform } from '../../compiler/src/transform-core.js';
import { captureWarnings, ENGINES } from '../../compiler/tests/engine-parity-harness.js';
import { createEmittedClassOracle } from '../src/index.js';

const REPO = path.resolve(import.meta.dirname, '../../..');

describe('a CSS-wide keyword on a key whose arbitrary form is its own property', async () => {
    const oracle = await createEmittedClassOracle({
        resolveFrom: REPO,
        css: '@import "tailwindcss";',
        cssBase: REPO,
    });
    if (!oracle.ok) throw new Error(`expected a ready oracle, got: ${oracle.reason}`);
    const prefixOf = PROPERTY_MAP as Record<string, string>;
    const bracketed = (key: string): boolean =>
        SZ_CAPABILITIES[key]?.includes(SZ_CAP_CSS_WIDE_BRACKET) === true;
    const cases = Object.keys(prefixOf)
        .filter(bracketed)
        .flatMap(key => [...CSS_WIDE_KEYWORDS].map(keyword => [key, keyword] as const));

    it('covers the keys with the column', () => {
        expect(cases.length).toBeGreaterThan(600);
    });

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
        // Outside the column the bracket would set another property, so the
        // keyword rule leaves those keys alone. These keys bracket through a
        // path of their own (`content-[unset]`), or a filter function
        // (`brightness-[unset]`), which the differential suite counts as
        // unserved. `bgSize` writes `bg-[length:unset]`, the type hint every v4
        // serves, so it is not a bare bracket and is not listed. `textOverflow`
        // writes `text-[unset]`, a colour, on the runtime only; that
        // divergence predates the keyword rule. Pinned so a new bracket shows
        // up here.
        const others = Object.entries(prefixOf)
            .filter(([, prefix]) => /^[a-z]+(?:-[a-z]+)*$/.test(prefix))
            .filter(([key]) => !bracketed(key))
            .filter(([key]) => lower(key, 'unset').includes('[unset]'))
            .map(([key]) => key);
        const runtimeOnly = _name === 'runtime' ? ['textOverflow'] : [];
        expect([...others].sort((a, b) => a.localeCompare(b))).toEqual(
            [
                'content',
                'brightness',
                'contrast',
                'saturate',
                'backdropBrightness',
                'backdropContrast',
                'backdropSaturate',
                ...runtimeOnly,
            ].sort((a, b) => a.localeCompare(b)),
        );
    });
});
