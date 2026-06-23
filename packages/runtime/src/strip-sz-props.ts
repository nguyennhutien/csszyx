/**
 * Drop the `sz` prop before a component spreads `...rest` onto a host element.
 *
 * The compiler rewrites `sz` to `className` at build time, so a compiled
 * component never carries a leftover `sz` prop. But when a file is NOT compiled
 * — e.g. a workspace package missing from `compileSources`, or any source the
 * bundler skipped — a hand-forwarded `sz` survives and React spreads it to the
 * DOM as `sz="[object Object]"`. `stripSzProps` removes `sz` from the forwarded
 * props so it never reaches the DOM, and in development warns once when the
 * leaked `sz` is a raw object, pointing at the real cause (an uncompiled file).
 *
 * Pure, framework-agnostic, no React/DOM import.
 *
 * @example
 * function Box({ sz, ...rest }: BoxProps) {
 *     return <div {...stripSzProps(rest)} />; // rest may still carry sz when uncompiled
 * }
 */

/** Messages already emitted, so a leaked `sz` warns once rather than per render. */
const warned = new Set<string>();

const RAW_SZ_WARNING =
    '[csszyx] A raw `sz` object reached the runtime and was dropped before it ' +
    'could leak to the DOM as sz="[object Object]".\n' +
    'This means the file was not compiled — its `sz` produces no CSS. If it ' +
    'lives in a workspace package, add that package directory to `compileSources`; ' +
    'otherwise check that the bundler is not skipping the file.';

/** Warn once (in dev) that a raw, uncompiled `sz` object reached the runtime. */
function warnRawSz(): void {
    if (warned.has(RAW_SZ_WARNING)) return;
    warned.add(RAW_SZ_WARNING);
    console.warn(RAW_SZ_WARNING);
}

/**
 * Return `props` without its `sz` key. When `sz` is absent the original object
 * is returned unchanged (no allocation); otherwise a shallow copy without `sz`
 * is returned. In development, a raw-object `sz` (the uncompiled-leak signature)
 * triggers a one-time warning.
 *
 * @param props - the props a component is about to forward to a host element.
 * @returns the same props without `sz`.
 */
export function stripSzProps<T extends Record<string, unknown>>(props: T): Omit<T, 'sz'> {
    if (props == null || typeof props !== 'object' || !('sz' in props)) {
        return props as Omit<T, 'sz'>;
    }

    const { sz, ...rest } = props;

    if (process.env.NODE_ENV !== 'production') {
        if (sz !== null && typeof sz === 'object') {
            warnRawSz();
        }
    }

    return rest as Omit<T, 'sz'>;
}

/** Reset the once-per-message warning guard. Test-only; not re-exported. */
export function __resetStripSzWarnings(): void {
    warned.clear();
}
