/**
 * Per-sz-key, both-direction matrix derived from docs/specs/snippets.
 *
 * Cases live in generated/sz-key-cases.json (run `pnpm gen:key-tests` to refresh;
 * CI guards staleness via `pnpm gen:key-tests:check`). Each key gets its own
 * describe block so a single key's tests can be run in isolation, e.g.:
 *
 *   pnpm --filter @csszyx/cli test -- -t "sz key: text"
 *
 *   forward:  transform(<documented sz>)        === <Tailwind class>
 *   reverse:  transform(classNameToSzObject(c)) === c   (migrate is exact inverse)
 */
import { describe, expect, it } from 'vitest';

import { type SzObject, transform } from '../../compiler/src/transform-core.js';
import { classNameToSzObject } from '../src/migrate.js';
import cases from './generated/sz-key-cases.json' with { type: 'json' };

interface ForwardCase {
    sz: Record<string, unknown>;
    class: string;
}
interface KeyCases {
    forward: ForwardCase[];
    reverse: string[];
}

const keyEntries = Object.entries(cases.keys as Record<string, KeyCases>);

/**
 * Round-trip a Tailwind class through the migrate reverse-parser and the compiler.
 * @param twClass - The Tailwind class string.
 * @returns The recompiled className.
 */
function roundTrip(twClass: string): string {
    const { szObject } = classNameToSzObject(twClass);
    return transform(szObject as SzObject).className;
}

describe('sz key matrix (snippets-derived)', () => {
    it('has cases to run', () => {
        expect(keyEntries.length).toBeGreaterThan(0);
    });

    for (const [key, { forward, reverse }] of keyEntries) {
        describe(`sz key: ${key}`, () => {
            if (forward.length > 0) {
                it.each(forward)('forward $class', ({ sz, class: cls }) => {
                    expect(transform(sz as SzObject).className).toBe(cls);
                });
            }
            if (reverse.length > 0) {
                it.each(reverse)('reverse %s', cls => {
                    expect(roundTrip(cls)).toBe(cls);
                });
            }
        });
    }
});
