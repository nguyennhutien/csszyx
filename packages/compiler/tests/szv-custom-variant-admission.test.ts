/**
 * A variant key the static tables cannot name, inside an szv branch.
 *
 * The precompiler refused any key it could not find in a table, whatever the
 * value was. That took out two shapes a design system is built from:
 *
 *     base: { px: 2, tablet: { px: 4 } }            → disqualified at `base.tablet`
 *     variants: { d: { l: { 'data-[active]': {…} }}} → disqualified at that key
 *
 * Neither is unreadable. The ordinary sz lowering compiles both — `tablet:px-4`,
 * `data-[active]:p-4` — because a custom breakpoint comes from the project's
 * `@theme` and an attribute variant is written inline, so neither can appear in
 * a table the compiler ships. Only the szv qualification treated "not in a
 * table" as "not understood", and the cost fell on responsive variants, which is
 * most of what a variant system holds.
 *
 * The distinction that makes admitting them safe is the VALUE, not the key. The
 * refusal exists so the overlap detector can trust canonical names: an unknown
 * key with a SCALAR value lowers to `key-value` and could collide with another
 * key's target invisibly, so it still disqualifies. An unknown key with an
 * OBJECT value is a variant prefix — it composes into the path rather than
 * aliasing one, so `base.px` and `base.tablet.px` stay distinct exactly as
 * `md` already did.
 */
import { describe, expect, it } from 'vitest';

import { qualifyStaticSzvConfig } from '../src/szv-precompile.js';
import { ENGINES } from './engine-parity-harness.js';

const IMPORT = "import { szv, szr } from '@csszyx/runtime';\n";

/**
 * Compile one szv config and report whether it precompiled.
 *
 * @param engine - Engine entry under test.
 * @param config - The szv config source.
 * @param selection - The factory call's argument.
 * @returns The diagnostics, empty when the config precompiled.
 */
function refusals(
    engine: (source: string, filename?: string) => { diagnostics?: string[] },
    config: string,
    selection = '{}',
): string[] {
    const source = `${IMPORT}const t = szv(${config});\nexport const a = szr(t(${selection}));`;
    return (
        (engine(source, '/p/t.tsx').diagnostics ?? [])
            .map(String)
            // Only the precompile verdict; an unknown key also draws the ordinary
            // unknown-property warning, which is a different question.
            .filter(message => message.includes('did not precompile'))
    );
}

describe.each(ENGINES)('a custom breakpoint inside a branch (%s)', (_name, engine) => {
    it('precompiles in base, like the built-in breakpoint beside it', () => {
        expect(refusals(engine, '{ base: { px: 2, tablet: { px: 4 } } }')).toEqual([]);
    });

    it('precompiles in a variant value', () => {
        expect(
            refusals(
                engine,
                "{ variants: { size: { lg: { px: 2, 'desktop-sm': { px: 4 } } } } }",
                "{ size: 'lg' }",
            ),
        ).toEqual([]);
    });

    it('emits the prefixed class, not just a quiet pass', () => {
        // Admitting the key without composing its prefix would drop the
        // responsive half while reporting success — worse than refusing.
        const source = `${IMPORT}const t = szv({ base: { px: 2, tablet: { px: 4 } } });\nexport const a = szr(t({}));`;
        const classes = [
            ...((engine as (s: string, f?: string) => { classes?: Iterable<string> })(
                source,
                '/p/t.tsx',
            ).classes ?? []),
        ];

        expect(classes).toContain('px-2');
        expect(classes).toContain('tablet:px-4');
    });
});

describe.each(ENGINES)('an attribute variant inside a branch (%s)', (_name, engine) => {
    it('precompiles a data attribute variant', () => {
        expect(
            refusals(
                engine,
                "{ variants: { dir: { left: { p: 2, 'data-[active]': { p: 4 } } } } }",
                "{ dir: 'left' }",
            ),
        ).toEqual([]);
    });

    it('precompiles an aria attribute variant', () => {
        expect(refusals(engine, "{ base: { p: 2, 'aria-[expanded=true]': { p: 4 } } }")).toEqual(
            [],
        );
    });
});

describe.each(ENGINES)('what must still disqualify (%s)', (_name, engine) => {
    it('refuses an unknown key carrying a SCALAR', () => {
        // `nonsenseKey: 'x'` lowers to `nonsenseKey-x`, a name the overlap
        // detector cannot place — that is what the refusal is for.
        const refused = refusals(engine, "{ base: { nonsenseKey: 'x' } }");

        expect(refused).toHaveLength(1);
        expect(refused[0]).toContain('base.nonsenseKey');
    });

    it('refuses a bare op, which fuses rather than composes', () => {
        const refused = refusals(engine, '{ base: { op: 50 } }');

        expect(refused).toHaveLength(1);
        expect(refused[0]).toContain('base.op');
    });

    it('still catches an overlap through a custom variant', () => {
        // Admitting the key must not blind the detector inside it: two
        // dimensions setting the same property under the same breakpoint still
        // conflict.
        const refused = refusals(
            engine,
            '{ variants: { a: { x: { tablet: { p: 2 } } }, b: { y: { tablet: { p: 4 } } } } }',
            "{ a: 'x', b: 'y' }",
        );

        expect(refused).toHaveLength(1);
        expect(refused[0]).toContain('variants.b.y.tablet.p');
    });

    it('keeps a custom variant distinct from the bare property', () => {
        // The mirror of the case above: `px` and `tablet.px` are different
        // media contexts and must NOT read as a conflict.
        expect(
            refusals(
                engine,
                '{ base: { px: 2 }, variants: { s: { lg: { tablet: { px: 4 } } } } }',
                "{ s: 'lg' }",
            ),
        ).toEqual([]);
    });
});

describe('the value decides, not the key', () => {
    it('admits an unknown key holding an object and refuses one holding a scalar', () => {
        // The registry extractor qualifies a config before recording it, so
        // this predicate is what decides whether an imported factory can be
        // precompiled at all. An unknown key with an OBJECT value is a variant
        // prefix and composes into the path; the same key with a SCALAR lowers
        // to `key-value`, which may be another key's class under a name this
        // walk cannot recognise, so it still refuses.
        const nested = qualifyStaticSzvConfig({
            base: { px: 2, 'data-[active]': { px: 4 } },
            variants: { s: { lg: { m: 2 } } },
        });
        expect(nested).not.toBeNull();

        const scalar = qualifyStaticSzvConfig({
            base: { px: 2 },
            variants: { s: { lg: { nonsenseKey: 'x' } } },
        });
        expect(scalar).toBeNull();
    });
});
