import { Demo } from '../Demo.tsx';

// Base button style shared across all cursor variants
const btnBase = { px: 3, py: 1.5, bg: 'indigo-950', border: true, borderColor: 'indigo-700', rounded: 'md', text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium', color: 'indigo-300' } as const;
// Disabled overlay — used as conditional array element
const btnDisabled = { opacity: 50 } as const;

export function CursorVariants() {
    return (
        <Demo label="cursor variants — hover each to see the cursor change">
            {/* static array: cellBase + inline cursor */}
            <button sz={[btnBase, { cursor: 'pointer' }]}>pointer</button>
            {/* static array with three elements: base + disabled overlay + inline cursor */}
            <button sz={[btnBase, btnDisabled, { cursor: 'not-allowed' }]}>not-allowed</button>
            <button sz={[btnBase, { cursor: 'grab' }]}>grab</button>
            <button sz={[btnBase, { cursor: 'move' }]}>move</button>
        </Demo>
    );
}

export function UserSelect() {
    // selectActive / selectPassive — ternary with variable branches resolved at build time
    const selectActive = { px: 3, py: 2, bg: 'indigo-950', border: true, borderColor: 'indigo-700', rounded: 'md', select: 'none', text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium', color: 'indigo-300' } as const;
    // zinc-800 replaces zinc-900 (which is invisible against the panel bg)
    const selectPassive = { px: 3, py: 2, bg: 'zinc-800', border: true, borderColor: 'zinc-600', rounded: 'md', select: 'text', text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium', color: 'zinc-400' } as const;
    return (
        <Demo label="user-select — none vs text (try selecting the text)">
            <div sz={selectActive}>select-none (not selectable)</div>
            <div sz={selectPassive}>select-text (selectable)</div>
        </Demo>
    );
}

export function ResizeTextarea() {
    return (
        <Demo label="{ resize: 'y' } — vertically resizable textarea">
            <textarea
                sz={{ resize: 'y', border: true, borderColor: 'zinc-700', rounded: 'md', p: 2, text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium', color: 'zinc-300', bg: 'zinc-800', w: 48, h: 16 }}
                defaultValue="Drag the corner to resize vertically."
                readOnly
            />
        </Demo>
    );
}
