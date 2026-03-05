interface PropTableRow {
    sz: string;
    tw: string;
}

interface PropTableProps {
    rows: PropTableRow[];
}

/**
 * Two-column sz → Tailwind mapping table for props reference pages.
 */
export function PropTable({ rows }: PropTableProps) {
    return (
        <div
            sz={{
                overflowX: 'auto',
                overflow: 'hidden',
                border: true,
                borderColor: '--ds-border',
                rounded: 'md',
                my: 6,
            }}
        >
            <table sz={{ w: 'full', text: 'sm', borderCollapse: 'collapse' }}>
                <thead>
                    <tr sz={{ borderB: true, borderColor: '--ds-border' }}>
                        <th
                            sz={{
                                px: 4,
                                py: 2,
                                textAlign: 'left',
                                fontFamily: '--ds-font-ui',
                                text: 'xs',
                                tracking: 'wide',
                                uppercase: true,
                                color: '--ds-text-muted',
                                bg: '--ds-bg-alt',
                                w: '1/2',
                            }}
                        >
                            sz prop
                        </th>
                        <th
                            sz={{
                                px: 4,
                                py: 2,
                                textAlign: 'left',
                                fontFamily: '--ds-font-ui',
                                text: 'xs',
                                tracking: 'wide',
                                uppercase: true,
                                color: '--ds-text-muted',
                                bg: '--ds-bg-alt',
                                w: '1/2',
                            }}
                        >
                            Tailwind class
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr
                            key={i}
                            sz={{ borderB: true, borderColor: '--ds-border' }}
                        >
                            <td
                                sz={{
                                    px: 4,
                                    py: 2,
                                    fontFamily: '--ds-font-ui',
                                    bg: '--ds-primary-faint',
                                    color: '--ds-primary-dark',
                                    text: 'xs',
                                }}
                            >
                                {row.sz}
                            </td>
                            <td
                                sz={{
                                    px: 4,
                                    py: 2,
                                    fontFamily: '--ds-font-ui',
                                    color: '--ds-text',
                                    text: 'xs',
                                }}
                            >
                                {row.tw}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
