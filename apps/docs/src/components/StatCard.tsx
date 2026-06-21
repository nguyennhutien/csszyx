import { Panel } from './Panel.tsx';

interface StatCardProps {
    label: string;
    value: string;
    subtitle?: string;
}

/**
 * Metric card with a large numeric value and label.
 */
export function StatCard({ label, value, subtitle }: StatCardProps) {
    return (
        <Panel>
            <p
                sz={{
                    fontFamily: '--ds-font-ui',
                    text: 'xs',
                    tracking: 'widest',
                    textTransform: 'uppercase',
                    color: '--ds-text-subtle',
                    mb: 1,
                }}
            >
                {label}
            </p>
            <p
                sz={{
                    fontFamily: '--ds-font-ui',
                    text: '4xl',
                    weight: 'bold',
                    color: '--ds-text',
                    leading: 'none',
                    my: 2,
                }}
            >
                {value}
            </p>
            {subtitle && (
                <p sz={{ text: 'xs', color: '--ds-text-muted' }}>{subtitle}</p>
            )}
        </Panel>
    );
}
