import type { ReactNode } from 'react';
import { Panel } from './Panel.tsx';

interface SpecCardProps {
    title: string;
    specId: string;
    icon?: string;
    children: ReactNode;
}

/**
 * Specification card with title, body, spec ID, and optional icon.
 */
export function SpecCard({ title, specId, icon, children }: SpecCardProps) {
    return (
        <Panel>
            {icon && (
                <span
                    sz={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        text: '2xl',
                        opacity: 20,
                    }}
                >
                    {icon}
                </span>
            )}
            <p
                sz={{
                    fontFamily: '--ds-font-ui',
                    text: 'lg',
                    fontWeight: 700,
                    color: '--ds-text',
                    mb: 2,
                }}
            >
                {title}
            </p>
            <div
                sz={{
                    text: 'sm',
                    color: '--ds-text-muted',
                    leading: 'relaxed',
                    mb: 4,
                }}
            >
                {children}
            </div>
            <p
                sz={{
                    fontFamily: '--ds-font-ui',
                    text: 'xs',
                    tracking: 'widest',
                    textTransform: 'uppercase',
                    color: '--ds-text-subtle',
                }}
            >
                SPEC_ID: {specId}
            </p>
        </Panel>
    );
}
