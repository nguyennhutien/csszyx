import type { ReactNode } from 'react';
import { dynamic } from '@csszyx/dynamic';
import { SzToken } from './PropTable.tsx';
import { segmentDemoLabel } from '../utils/segment-demo-label.js';

// Prescan anchor — all content-area classes in one const so Tailwind generates CSS for them.
// Also covers the default bg; callers may override bg with any value they've added to the safelist.
const _DEMO_CONTENT = { p: 8, display: 'flex', gap: 6, flexWrap: 'wrap', items: 'center', justify: 'center', minH: 40, bg: 'zinc-900' } as const;

interface DemoProps {
    children: ReactNode;
    label?: string;
    hint?: string;
    /** Override content area background. Default: zinc-900 (dark panel). */
    bg?: string;
}

/**
 * Live preview container styled as a macOS-style dark panel.
 * Traffic-light dots on left, label on right, dark content area below.
 */
export function Demo({ children, label, hint, bg = 'zinc-900' }: DemoProps) {
    const segments = label ? segmentDemoLabel(label) : [];

    return (
        <figure className="not-content" sz={{ mt: 6, rounded: 'xl', border: true, borderColor: 'zinc-800', overflow: 'hidden', shadow: 'xl' }}>
            {/* macOS-style titlebar */}
            <div sz={{ px: 4, h: 9, display: 'flex', items: 'center', justify: 'between', borderB: true, borderColor: 'zinc-800', bg: 'zinc-950' }}>
                {/* Traffic lights — exact macOS colors */}
                <div sz={{ display: 'flex', items: 'center', gap: 1.5 }}>
                    <span className="demo-dot" sz={{ bg: '#ff5f57' }} />
                    <span className="demo-dot" sz={{ bg: '#ffbd2e' }} />
                    <span className="demo-dot" sz={{ bg: '#28c840' }} />
                </div>
                {/* Label — monospace, dimmed */}
                {label && (
                    <div sz={{ fontFamily: '--ds-font-ui', text: 'xs', display: 'flex', items: 'center', gap: 1, flexWrap: 'wrap', justify: 'end', color: 'zinc-400' }}>
                        {segments.map((seg, i) =>
                            seg.type === 'sz'
                                ? <SzToken key={i} value={seg.value} />
                                : <span key={i}>{seg.value}</span>
                        )}
                    </div>
                )}
            </div>
            {/* Content area — dynamic() ensures SSR mangle map is applied for all classes.
                Pass _DEMO_CONTENT directly for the default case so prescan can follow the
                reference and discover min-h-40; spread only when bg is overridden. */}
            <div className={`demo-preview ${bg === 'zinc-900' ? dynamic(_DEMO_CONTENT) : dynamic({ ..._DEMO_CONTENT, bg })}`}>
                {children}
            </div>
            {/* Optional footnote */}
            {hint && (
                <div sz={{ px: 4, py: 2, borderT: true, borderColor: 'zinc-800', fontFamily: '--ds-font-ui', text: 'xs', textAlign: 'center', bg: 'zinc-950', color: 'zinc-500' }}>
                    {hint}
                </div>
            )}
        </figure>
    );
}
