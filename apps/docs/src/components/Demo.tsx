import type { ReactNode } from 'react';

interface DemoProps {
    children: ReactNode;
    /**
     * Optional sz snippet label shown above the preview area.
     * Maps 1-to-1 with compiler unit tests: `"{ p: 4 }"` ↔ `expect(t({ p: 4 })).toBe('p-4')`.
     */
    label?: string;
}

/**
 * Live preview container for sz prop demos.
 * Place after a PropTable section to show the rendered output.
 *
 * The Vite plugin compiles sz props in children at build time — the preview
 * renders actual Tailwind classes, not inline styles.
 */
export function Demo({ children, label }: DemoProps) {
    return (
        <figure
            sz={{
                border: true,
                borderColor: '--ds-border',
                rounded: 'sm',
                overflow: 'hidden',
                my: 6,
                not: { firstChild: { mt: 0 } },
            }}
        >
            {label && (
                <figcaption
                    sz={{
                        px: 3,
                        py: 1.5,
                        borderB: true,
                        borderColor: '--ds-border',
                        bg: '--ds-bg',
                        fontFamily: '--ds-font-ui',
                        text: 'xs',
                        color: '--ds-primary',
                        tracking: 'wide',
                    }}
                >
                    {label}
                </figcaption>
            )}
            <div
                sz={{
                    p: 6,
                    flex: true,
                    gap: 4,
                    flexWrap: 'wrap',
                    items: 'center',
                    justify: 'center',
                    bg: '--ds-bg-alt',
                    minH: 20,
                }}
            >
                {children}
            </div>
        </figure>
    );
}
