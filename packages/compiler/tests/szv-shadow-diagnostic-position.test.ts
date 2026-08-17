/**
 * Where a refused szv config points when two branches set the same property.
 *
 * The refusal itself is load-bearing and stays: the precompiled table stores one
 * class string per branch and a selection CONCATENATES them, so a base and a
 * variant that both set `color` would emit `text-main text-sub` where the
 * runtime's deep merge emits `text-sub`. Two same-property utilities in one
 * attribute are decided by stylesheet order, not attribute order, so the
 * concatenation is not the object the author wrote. `szcn` cannot rescue it
 * either — `text-*` is ambiguous between colour and size, so it deliberately
 * keeps both.
 *
 * What was wrong is the position. It named the overriding branch, which reads
 * as correct in isolation and says nothing about why it was refused. Worse, when
 * several variants shadow the same base key it named the first one, so fixing
 * that branch surfaced the next — the author walks the dimensions one refusal at
 * a time while the shared cause sits in `base`.
 *
 * So a base conflict names the base property: one position, one fix, however
 * many variants shadow it. A conflict between two dimensions has no shared
 * cause, so it keeps naming the second branch in declaration order — where a
 * reader going top to bottom meets it — now down to the property.
 */
import { describe, expect, it } from 'vitest';

import { ENGINES } from './tri-engine-harness.js';

const IMPORT = "import { szv, szr } from '@csszyx/runtime';\n";

/**
 * The disqualifying position one config reports.
 *
 * @param engine - Engine entry under test.
 * @param config - The szv config source, without the surrounding call.
 * @returns The backtick-quoted path from the diagnostic.
 */
function disqualifiedAt(
    engine: (source: string, filename?: string) => { diagnostics?: string[] },
    config: string,
): string {
    const source = `${IMPORT}const t = szv(${config});\nexport const a = szr(t({}));`;
    const [message = ''] = (engine(source, '/p/t.tsx').diagnostics ?? []).map(String);
    return /disqualified at `([^`]+)`/.exec(message)?.[1] ?? message;
}

describe.each(ENGINES)('a base key a variant shadows (%s)', (_name, engine) => {
    it('names the base property, not the variant that overrode it', () => {
        const at = disqualifiedAt(
            engine,
            "{ base: { color: 'main' }, variants: { sev: { info: { color: 'sub' } } } }",
        );

        expect(at).toBe('base.color');
    });

    it('names the same base property however many variants shadow it', () => {
        // The failure this replaces: naming the first shadowing variant meant
        // fixing it revealed the second, and the shared cause was never named.
        const at = disqualifiedAt(
            engine,
            "{ base: { color: 'main' }, variants: " +
                "{ sev: { info: { color: 'sub' } }, size: { lg: { color: 'alt' } } } }",
        );

        expect(at).toBe('base.color');
    });

    it('names a nested base property in full', () => {
        const at = disqualifiedAt(
            engine,
            "{ base: { hover: { color: 'main' } }, variants: { sev: { info: { hover: { color: 'sub' } } } } }",
        );

        expect(at).toBe('base.hover.color');
    });
});

describe.each(ENGINES)('two dimensions setting one property (%s)', (_name, engine) => {
    it('names the second branch down to the property', () => {
        // No shared cause here — neither dimension is applied first — so the
        // declaration-order rule stands. What was missing is which key.
        const at = disqualifiedAt(
            engine,
            "{ variants: { sev: { info: { color: 'sub' } }, size: { lg: { color: 'alt' } } } }",
        );

        expect(at).toBe('variants.size.lg.color');
    });
});

describe.each(ENGINES)('what the position must keep reporting (%s)', (_name, engine) => {
    it('still names a key it cannot canonicalize at the key itself', () => {
        const at = disqualifiedAt(engine, "{ variants: { c: { blue: { nonsenseKey: 'x' } } } }");

        expect(at).toBe('variants.c.blue.nonsenseKey');
    });

    it('still names a nested breakpoint object at the breakpoint', () => {
        const at = disqualifiedAt(
            engine,
            "{ variants: { c: { blue: { 'desktop-sm': { p: 4 } } } } }",
        );

        expect(at).toBe('variants.c.blue.desktop-sm');
    });

    it('stays silent when nothing overlaps', () => {
        const source =
            `${IMPORT}const t = szv({ base: { mt: 1 }, variants: { sev: { info: { color: 'sub' } } } });\n` +
            'export const a = szr(t({}));';

        expect(engine(source, '/p/t.tsx').diagnostics ?? []).toEqual([]);
    });
});
