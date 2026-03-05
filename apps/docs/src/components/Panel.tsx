import type { ReactNode } from 'react';

interface PanelProps {
    children: ReactNode;
}

/**
 * Base panel component with corner markers rendered via ::before and ::after
 * pseudo-elements using sz props — compiles to mangled classes in production.
 */
export function Panel({ children }: PanelProps) {
    return (
        <div
            sz={{
                relative: true,
                border: true,
                borderColor: '--ds-border',
                rounded: 'sm',
                p: 6,
                bg: '--ds-bg',
                before: {
                    content: "''",
                    absolute: true,
                    top: '-1px',
                    left: '-1px',
                    w: 2,
                    h: 2,
                    borderT: 2,
                    borderL: 2,
                    borderColor: '--ds-primary',
                    borderStyle: 'solid',
                },
                after: {
                    content: "''",
                    absolute: true,
                    bottom: '-1px',
                    right: '-1px',
                    w: 2,
                    h: 2,
                    borderB: 2,
                    borderR: 2,
                    borderColor: '--ds-primary',
                    borderStyle: 'solid',
                },
            }}
        >
            {children}
        </div>
    );
}
