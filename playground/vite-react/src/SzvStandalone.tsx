// szv STANDALONE fixture — this file uses NO `sz=` JSX prop anywhere. It declares
// szv catalogs and resolves them via `szr` only. The build prescan qualifies the
// file by its `szv(` token (0.10.4+) AND collects its catalog even though the
// oxc/Rust engines report transformed=false for a no-`sz=` file (the fix in this
// change) — so the catalog, incl. the arbitrary [Npx] values and the large
// off-scale enum numbers below, is safelisted and Tailwind generates the CSS.
// IMPORTANT: do not write any of these class names as literal text/comments —
// Tailwind's unscoped scan would pick them up and mask whether szv safelisting
// actually works.
import { szr, szv } from '@csszyx/runtime';

// Arbitrary [Npx] values — pattern the design system uses for exact pixel sizes
// outside the Tailwind spacing scale.
const arbitrarySz = szv({
    variants: {
        margin: {
            a: { m: '[100px]' },
            b: { m: '[137px]' },
        },
        size: {
            square: { w: '[100px]', h: '[100px]' },
            wide: { w: '[250px]', h: '[80px]' }, //    → w-[250px] h-[80px]
        },
        gap: {
            px: { gap: '[100px]' },
        },
    },
});

// Large ENUM numbers outside the small default scale (m-50, p-100, gap-50, w-96).
const largeEnumSz = szv({
    variants: {
        pad: {
            50: { p: 50 },
            100: { p: 100 },
        },
        space: {
            50: { gap: 50 },
        },
        width: {
            96: { w: 96 },
        },
    },
});

export function SzvStandalone() {
    // No `sz=` here — only `szr(szv(...))`. The classes are resolved at runtime and
    // (because the catalog above is safelisted at build) styled by Tailwind.
    const arbitraryClass = szr(
        arbitrarySz({ margin: 'b' }),
        arbitrarySz({ size: 'square' }),
        arbitrarySz({ gap: 'px' }),
    );
    const largeEnumClass = szr(
        largeEnumSz({ pad: 100 }),
        largeEnumSz({ space: 50 }),
        largeEnumSz({ width: 96 }),
    );

    return (
        <section data-testid="szv-standalone" className="border border-gray-300">
            <div data-testid="szv-arbitrary" className={arbitraryClass}>
                arbitrary pixel sizes resolved via szv only
            </div>
            <div data-testid="szv-large-enum" className={largeEnumClass}>
                large off-scale enum numbers resolved via szv only
            </div>
        </section>
    );
}
