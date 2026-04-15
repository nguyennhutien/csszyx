import { Demo } from '../Demo.tsx';

// Shared table cell base — direct variable reference for all cells
const TH_BASE = { border: true, borderColor: 'zinc-600', px: 3, py: 1.5, bg: 'zinc-800', color: 'zinc-200' } as const;
const TD_BASE = { border: true, borderColor: 'zinc-700', px: 3, py: 1.5, bg: 'zinc-900', color: 'zinc-300' } as const;

export function TableBorderCollapse() {
    return (
        <Demo label="table with border-collapse — collapsed borders between cells">
            <table sz={{ borderCollapse: 'collapse', text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium' }}>
                <thead>
                    <tr>
                        {/* direct variable reference */}
                        <th sz={{ ...TH_BASE, textAlign: 'left' }}>Name</th>
                        <th sz={{ ...TH_BASE, textAlign: 'right' }}>Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td sz={TD_BASE}>alpha</td>
                        <td sz={{ ...TD_BASE, textAlign: 'right' }}>1</td>
                    </tr>
                    <tr>
                        <td sz={TD_BASE}>beta</td>
                        <td sz={{ ...TD_BASE, textAlign: 'right' }}>2</td>
                    </tr>
                </tbody>
            </table>
        </Demo>
    );
}

export function SvgFill() {
    return (
        <Demo label="SVG fill — circles with different fill colors">
            <svg sz={{ size: 10 }} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
                <circle sz={{ fill: 'violet-400' }} cx="20" cy="20" r="18" />
            </svg>
            <svg sz={{ size: 10 }} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
                <circle sz={{ fill: 'indigo-500' }} cx="20" cy="20" r="18" />
            </svg>
            <svg sz={{ size: 10 }} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
                <circle sz={{ fill: 'none', stroke: 'violet-600', strokeWidth: 2 }} cx="20" cy="20" r="17" />
            </svg>
        </Demo>
    );
}

export function TwoColumnLayout() {
    return (
        <Demo label="{ columns: 2 } — two-column text layout">
            <div sz={{ columns: 2, gap: 4, w: 64, text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium', color: 'zinc-300' }}>
                <p sz={{ mb: 2 }}>First paragraph of content in a newspaper-style multi-column layout.</p>
                <p sz={{ mb: 2 }}>Second paragraph that flows naturally into the next column when needed.</p>
                <p>Third paragraph continuing the layout.</p>
            </div>
        </Demo>
    );
}

export function SrOnly() {
    const srLabel = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium', color: 'zinc-500' } as const;
    return (
        <Demo label="{ srOnly: true } — visually hidden but accessible to screen readers">
            <div sz={{ relative: true, flex: true, items: 'center', gap: 2 }}>
                <button sz={{ size: 8, bg: 'violet-600', rounded: 'md', flex: true, items: 'center', justify: 'center' }}>
                    <span sz={{ srOnly: true }}>Close dialog</span>
                    <span sz={{ text: 'sm', color: 'white', fontFamily: '--ds-font-ui' }}>×</span>
                </button>
                {/* direct variable reference */}
                <span sz={srLabel}>sr-only text hidden visually, read by screen readers</span>
            </div>
        </Demo>
    );
}
