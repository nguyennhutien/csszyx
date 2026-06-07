// Broad-glob Turbopack fixture — a component with NO sz prop. Under the broad
// `*.tsx` rule the loader must pass it through unchanged (de-facto "exclude")
// and the build must not break on it.
export function Plain({ label }: { label: string }) {
    return <p className="plain-note">{label}</p>;
}
