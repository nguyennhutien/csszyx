export const A = ({ c }) => (
    <div
        sz={{
            borderColor: { color: c ? 'red-700' : 'charcoal', op: 18 },
            group: { hover: { bg: c ? 'red-500' : 'blue-500' } },
        }}
    />
);
