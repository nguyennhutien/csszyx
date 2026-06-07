// Broad-glob Turbopack fixture — a component with sz AND a className+sz merge.
// The merge forces the transform to inject `_szMerge` from `@csszyx/runtime`,
// which is what exercised the production-only runtime-resolution blocker.
export function Card({ title }: { title: string }) {
    return (
        <div
            className="rounded-card"
            sz={{
                display: 'flex',
                p: 4,
                gap: 2,
                rounded: 'lg',
                bg: { color: 'white', op: 90 },
                borderColor: { color: 'black', op: 5 },
            }}
        >
            <span sz={{ text: 'sm', fontWeight: 'semibold' }}>{title}</span>
        </div>
    );
}
