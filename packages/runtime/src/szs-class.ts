/**
 * Narrow a compiled `szs` slot to the class string it becomes after build.
 *
 * A `Szs` slot is AUTHORED as an sz value (`szs={{ title: { text: 'lg' } }}`),
 * but the compiler rewrites every slot to its class string before the component
 * ever runs — so at runtime `szs?.title` IS a string, while its TYPE is still
 * `SzPropValue`. Forwarding a slot into a `className?: string` prop therefore
 * needed an `as string` cast in every compound component. This helper does that
 * narrowing once, typed, and fail-safe: if a slot somehow reaches runtime
 * uncompiled (a misconfigured build, or a dynamic value the v1 contract
 * rejects), it returns `undefined` instead of letting an object coerce into
 * `class="[object Object]"`.
 *
 * @param slot - One slot value from an `szs` prop.
 * @returns The compiled class string, or `undefined` when the slot is absent or
 *   was not compiled to a string.
 *
 * @example
 * ```tsx
 * function Card({ szs }: { szs?: Szs<'title' | 'body'> }) {
 *     return <Box className={szcn('font-medium', szsClass(szs?.title))} />;
 * }
 * ```
 *
 * @module @csszyx/runtime/szs-class
 */
export function szsClass(slot: unknown): string | undefined {
    return typeof slot === 'string' ? slot : undefined;
}
