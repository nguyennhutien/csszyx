// szv catalogs declared in a plain `.ts` module (no JSX, no `sz=`), exported for
// import into a `.tsx` component. This is the code-splitting shape: variant
// definitions live in their own module. The build prescan scans `.ts` files too
// and qualifies this one by its `szv(` token, so its catalog is safelisted even
// though nothing here is `sz=` or JSX.
// NOTE: never write the produced class names as literal text — Tailwind's
// unscoped scan would pick them up and mask whether szv safelisting works.
import { szv } from '@csszyx/runtime';

// Arbitrary [Npx] + a couple of large off-scale enum numbers, to mirror the
// inline standalone fixture but sourced from a `.ts` module.
export const cardSz = szv({
    variants: {
        pad: {
            tight: { p: '[18px]' },
            loose: { p: '[64px]' },
        },
        size: {
            a: { w: '[220px]', h: '[140px]' },
            b: { w: 96, h: 72 },
        },
        radius: {
            big: { rounded: '[28px]' },
        },
    },
});

export const stackSz = szv({
    variants: {
        gap: {
            xl: { gap: '[44px]' },
            num: { gap: 50 },
        },
    },
});
