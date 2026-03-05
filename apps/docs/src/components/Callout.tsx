import type { ReactNode } from 'react';

interface CalloutProps {
    label?: string;
    children: ReactNode;
}

/**
 * Callout box with left accent border. Use `label` for a category header.
 */
export function Callout({ label, children }: CalloutProps) {
    return (
        <div
            sz={{ border: true, borderColor: '--ds-border', rounded: 'sm', p: 4, bg: '--ds-bg-alt', my: 6 }}
            style={{ borderLeftWidth: '3px', borderLeftColor: 'var(--ds-primary)' }}
        >
            {label && (
                <p
                    sz={{
                        fontFamily: '--ds-font-ui',
                        text: 'xs',
                        tracking: 'widest',
                        uppercase: true,
                        color: '--ds-primary',
                        mb: 2,
                    }}
                >
                    {label}
                </p>
            )}
            <div sz={{ text: 'sm', color: '--ds-text-muted' }}>{children}</div>
        </div>
    );
}
