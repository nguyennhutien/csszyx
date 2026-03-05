import { Demo } from '../Demo.tsx';

export function CursorVariants() {
    return (
        <Demo label="cursor variants — hover each to see the cursor change">
            <button sz={{ px: 3, py: 1.5, bg: '--ds-primary-faint', border: true, borderColor: '--ds-primary-light', rounded: 'sm', cursor: 'pointer', text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>
                pointer
            </button>
            <button sz={{ px: 3, py: 1.5, bg: '--ds-primary-faint', border: true, borderColor: '--ds-primary-light', rounded: 'sm', cursor: 'not-allowed', opacity: 50, text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>
                not-allowed
            </button>
            <button sz={{ px: 3, py: 1.5, bg: '--ds-primary-faint', border: true, borderColor: '--ds-primary-light', rounded: 'sm', cursor: 'grab', text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>
                grab
            </button>
            <button sz={{ px: 3, py: 1.5, bg: '--ds-primary-faint', border: true, borderColor: '--ds-primary-light', rounded: 'sm', cursor: 'move', text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>
                move
            </button>
        </Demo>
    );
}

export function UserSelect() {
    return (
        <Demo label="user-select — none vs text (try selecting the text)">
            <div sz={{ px: 3, py: 2, bg: '--ds-primary-faint', border: true, borderColor: '--ds-primary-light', rounded: 'sm', select: 'none', text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>
                select-none (not selectable)
            </div>
            <div sz={{ px: 3, py: 2, bg: 'sky-50', border: true, borderColor: 'sky-200', rounded: 'sm', select: 'text', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700' }}>
                select-text (selectable)
            </div>
        </Demo>
    );
}

export function ResizeTextarea() {
    return (
        <Demo label="{ resize: 'y' } — vertically resizable textarea">
            <textarea
                sz={{ resize: 'y', border: true, borderColor: '--ds-border', rounded: 'sm', p: 2, text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-text', w: 48, h: 16 }}
                defaultValue="Drag the corner to resize vertically."
                readOnly
            />
        </Demo>
    );
}
