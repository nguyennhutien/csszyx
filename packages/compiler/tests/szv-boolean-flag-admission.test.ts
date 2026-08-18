/**
 * A canonical boolean flag inside an szv branch.
 *
 * `{ srOnly: true }` is not shorthand for anything — Tailwind has no value form
 * for `sr-only`, so the boolean IS the canonical spelling, and the snippets
 * write it that way. The precompiler refused it anyway, because the overlap
 * detector's vocabulary was the property map plus known variants plus four
 * hand-probed extras, and the flag utilities were never probed. The author saw
 * their config disqualified at a key they had written exactly as documented.
 *
 * Admitting them is safe for the same reason the four extras were: the detector
 * only needs a key's NAME to identify its lowering target. Measured merged vs
 * separate across 7194 pairs — every flag against every property key and against
 * every other flag — no pair lowers into a composite the way `text` + `leading`
 * does, so a flag's own name is a trustworthy canonical path.
 *
 * The admission is on the VALUE, not the key, exactly like the custom-variant
 * one beside it. A boolean lowers to a fixed class; a scalar on the same key
 * lowers to `key-value` (`{ srOnly: 'weird' }` → `sr-only-weird`), which is the
 * aliasing shape the refusal exists for and still disqualifies.
 */
import { describe, expect, it } from 'vitest';

import { qualifyStaticSzvConfig } from '../src/szv-precompile.js';
import { ENGINES } from './tri-engine-harness.js';

const IMPORT = "import { szv, szr } from '@csszyx/runtime';\n";

/**
 * Compile one szv config and report whether it precompiled.
 *
 * @param engine - Engine entry under test.
 * @param config - The szv config source.
 * @param selection - The factory call's argument.
 * @returns The precompile refusals, empty when the config precompiled.
 */
function refusals(
    engine: (source: string, filename?: string) => { diagnostics?: string[] },
    config: string,
    selection = '{}',
): string[] {
    const source = `${IMPORT}const t = szv(${config});\nexport const a = szr(t(${selection}));`;
    return (engine(source, '/p/t.tsx').diagnostics ?? [])
        .map(String)
        .filter(message => message.includes('did not precompile'));
}

describe.each(ENGINES)('a canonical boolean flag inside a branch (%s)', (_name, engine) => {
    it('precompiles in base', () => {
        expect(
            refusals(engine, '{ base: { srOnly: true }, variants: { pad: { sm: { p: 2 } } } }'),
        ).toEqual([]);
    });

    it('precompiles in a variant value', () => {
        expect(
            refusals(engine, '{ variants: { reader: { only: { srOnly: true }, all: { p: 2 } } } }'),
        ).toEqual([]);
    });

    it('precompiles a flag whose class name differs from the key', () => {
        expect(
            refusals(
                engine,
                '{ base: { tabularNums: true }, variants: { pad: { sm: { p: 2 } } } }',
            ),
        ).toEqual([]);
    });

    it('precompiles a flag nested under a variant', () => {
        expect(
            refusals(
                engine,
                '{ base: { hover: { textEllipsis: true } }, variants: { pad: { sm: { p: 2 } } } }',
            ),
        ).toEqual([]);
    });

    it('still refuses a SCALAR on the same key, which lowers to key-value', () => {
        const messages = refusals(
            engine,
            "{ base: { srOnly: 'weird' }, variants: { pad: { sm: { p: 2 } } } }",
        );
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain('base.srOnly');
    });
});

describe('the qualification unit', () => {
    const qualifies = (config: unknown): boolean => qualifyStaticSzvConfig(config) !== null;

    it('admits a boolean flag and refuses a scalar on the same key', () => {
        expect(qualifies({ base: { srOnly: true }, variants: { p: { s: { p: 2 } } } })).toBe(true);
        expect(qualifies({ base: { srOnly: 'weird' }, variants: { p: { s: { p: 2 } } } })).toBe(
            false,
        );
    });

    it('still catches the same flag set by two co-occurring branches', () => {
        // Deep merge replaces, so the object yields one value; concatenating
        // per-branch classes would emit `sr-only` for a branch that turned it
        // off. Equal canonical paths, so the detector bails — admitting the key
        // must not cost that.
        expect(
            qualifies({
                base: { srOnly: true },
                variants: { reader: { off: { srOnly: false } } },
            }),
        ).toBe(false);
    });
});
