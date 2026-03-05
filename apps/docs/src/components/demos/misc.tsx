import { Demo } from '../Demo.tsx';

export function TableBorderCollapse() {
    return (
        <Demo label="table with border-collapse — collapsed borders between cells">
            <table sz={{ borderCollapse: 'collapse', text: 'xs', fontFamily: '--ds-font-ui' }}>
                <thead>
                    <tr>
                        <th sz={{ border: true, borderColor: 'sky-300', px: 3, py: 1.5, bg: 'sky-100', color: 'sky-800', textAlign: 'left' }}>Name</th>
                        <th sz={{ border: true, borderColor: 'sky-300', px: 3, py: 1.5, bg: 'sky-100', color: 'sky-800', textAlign: 'right' }}>Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td sz={{ border: true, borderColor: 'sky-200', px: 3, py: 1.5, color: '--ds-text' }}>alpha</td>
                        <td sz={{ border: true, borderColor: 'sky-200', px: 3, py: 1.5, color: '--ds-text', textAlign: 'right' }}>1</td>
                    </tr>
                    <tr>
                        <td sz={{ border: true, borderColor: 'sky-200', px: 3, py: 1.5, color: '--ds-text' }}>beta</td>
                        <td sz={{ border: true, borderColor: 'sky-200', px: 3, py: 1.5, color: '--ds-text', textAlign: 'right' }}>2</td>
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
                <circle sz={{ fill: 'sky-400' }} cx="20" cy="20" r="18" />
            </svg>
            <svg sz={{ size: 10 }} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
                <circle sz={{ fill: '--ds-primary' }} cx="20" cy="20" r="18" />
            </svg>
            <svg sz={{ size: 10 }} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
                <circle sz={{ fill: 'none', stroke: 'sky-400', strokeWidth: 2 }} cx="20" cy="20" r="17" />
            </svg>
        </Demo>
    );
}

export function TwoColumnLayout() {
    return (
        <Demo label="{ columns: 2 } — two-column text layout">
            <div sz={{ columns: 2, gap: 4, w: 64, text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-text' }}>
                <p sz={{ mb: 2 }}>First paragraph of content in a newspaper-style multi-column layout.</p>
                <p sz={{ mb: 2 }}>Second paragraph that flows naturally into the next column when needed.</p>
                <p>Third paragraph continuing the layout.</p>
            </div>
        </Demo>
    );
}

export function SrOnly() {
    return (
        <Demo label="{ srOnly: true } — visually hidden but accessible to screen readers">
            <div sz={{ relative: true, flex: true, items: 'center', gap: 2 }}>
                <button sz={{ size: 8, bg: '--ds-primary', rounded: 'md', flex: true, items: 'center', justify: 'center' }}>
                    <span sz={{ srOnly: true }}>Close dialog</span>
                    <span sz={{ text: 'sm', color: 'white', fontFamily: '--ds-font-ui' }}>×</span>
                </button>
                <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-text-muted' }}>sr-only text hidden visually, read by screen readers</span>
            </div>
        </Demo>
    );
}
