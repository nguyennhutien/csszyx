import { Demo } from '../Demo.tsx';

export function FlexDirection() {
    return (
        <Demo label="flex direction — row vs col">
            <div sz={{ flex: true, flexDir: 'row', gap: 2 }}>
                <div sz={{ p: 2, bg: 'sky-200', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-800' }}>A</div>
                <div sz={{ p: 2, bg: 'sky-300', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900' }}>B</div>
                <div sz={{ p: 2, bg: 'sky-400', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>C</div>
            </div>
            <div sz={{ flex: true, flexDir: 'col', gap: 1 }}>
                <div sz={{ p: 2, bg: '--ds-primary-faint', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>A</div>
                <div sz={{ p: 2, bg: '--ds-primary-faint', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>B</div>
                <div sz={{ p: 2, bg: '--ds-primary-faint', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary' }}>C</div>
            </div>
        </Demo>
    );
}

export function JustifyVariants() {
    return (
        <Demo label="justify — start, center, end, between">
            <div sz={{ flex: true, flexDir: 'col', gap: 2, w: 56 }}>
                <div sz={{ flex: true, justify: 'start', gap: 1, bg: '--ds-primary-faint', rounded: 'sm', p: 1 }}>
                    <div sz={{ p: 1.5, bg: '--ds-primary', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>start</div>
                    <div sz={{ p: 1.5, bg: 'sky-300', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900' }}>B</div>
                </div>
                <div sz={{ flex: true, justify: 'center', gap: 1, bg: '--ds-primary-faint', rounded: 'sm', p: 1 }}>
                    <div sz={{ p: 1.5, bg: '--ds-primary', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>center</div>
                    <div sz={{ p: 1.5, bg: 'sky-300', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900' }}>B</div>
                </div>
                <div sz={{ flex: true, justify: 'end', gap: 1, bg: '--ds-primary-faint', rounded: 'sm', p: 1 }}>
                    <div sz={{ p: 1.5, bg: '--ds-primary', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>end</div>
                    <div sz={{ p: 1.5, bg: 'sky-300', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900' }}>B</div>
                </div>
                <div sz={{ flex: true, justify: 'between', bg: '--ds-primary-faint', rounded: 'sm', p: 1 }}>
                    <div sz={{ p: 1.5, bg: '--ds-primary', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>between</div>
                    <div sz={{ p: 1.5, bg: 'sky-300', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900' }}>B</div>
                </div>
            </div>
        </Demo>
    );
}

export function GapScale() {
    return (
        <Demo label="gap scale — gap-1, gap-4, gap-8">
            <div sz={{ flex: true, flexDir: 'col', gap: 2 }}>
                <div sz={{ flex: true, gap: 1 }}>
                    <div sz={{ p: 2, bg: 'sky-200', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-800' }}>A</div>
                    <div sz={{ p: 2, bg: 'sky-200', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-800' }}>B</div>
                    <div sz={{ p: 2, bg: 'sky-200', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-800' }}>C</div>
                    <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-text-muted', self: 'center', ml: 1 }}>gap-1</span>
                </div>
                <div sz={{ flex: true, gap: 4 }}>
                    <div sz={{ p: 2, bg: 'sky-300', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900' }}>A</div>
                    <div sz={{ p: 2, bg: 'sky-300', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900' }}>B</div>
                    <div sz={{ p: 2, bg: 'sky-300', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900' }}>C</div>
                    <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-text-muted', self: 'center', ml: 1 }}>gap-4</span>
                </div>
                <div sz={{ flex: true, gap: 8 }}>
                    <div sz={{ p: 2, bg: '--ds-primary', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>A</div>
                    <div sz={{ p: 2, bg: '--ds-primary', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>B</div>
                    <div sz={{ p: 2, bg: '--ds-primary', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'white' }}>C</div>
                    <span sz={{ text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-text-muted', self: 'center', ml: 1 }}>gap-8</span>
                </div>
            </div>
        </Demo>
    );
}

export function GridThreeCols() {
    return (
        <Demo label="{ grid: true, gridCols: 3, gap: 2 } — 3-column grid with 6 cells">
            <div sz={{ grid: true, gridCols: 3, gap: 2, w: 48 }}>
                <div sz={{ p: 2, bg: 'sky-100', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700', textAlign: 'center' }}>1</div>
                <div sz={{ p: 2, bg: 'sky-200', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-800', textAlign: 'center' }}>2</div>
                <div sz={{ p: 2, bg: 'sky-300', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-900', textAlign: 'center' }}>3</div>
                <div sz={{ p: 2, bg: '--ds-primary-faint', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary', textAlign: 'center' }}>4</div>
                <div sz={{ p: 2, bg: '--ds-primary-faint', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: '--ds-primary', textAlign: 'center' }}>5</div>
                <div sz={{ p: 2, bg: '--ds-primary', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'white', textAlign: 'center' }}>6</div>
            </div>
        </Demo>
    );
}

export function ColSpan() {
    return (
        <Demo label="{ colSpan: 2 } — wide cell spanning two columns">
            <div sz={{ grid: true, gridCols: 3, gap: 2, w: 48 }}>
                <div sz={{ p: 2, bg: '--ds-primary', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'white', textAlign: 'center', colSpan: 2 }}>col-span-2</div>
                <div sz={{ p: 2, bg: 'sky-200', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-800', textAlign: 'center' }}>3</div>
                <div sz={{ p: 2, bg: 'sky-100', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700', textAlign: 'center' }}>4</div>
                <div sz={{ p: 2, bg: 'sky-100', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700', textAlign: 'center' }}>5</div>
                <div sz={{ p: 2, bg: 'sky-100', rounded: 'sm', text: 'xs', fontFamily: '--ds-font-ui', color: 'sky-700', textAlign: 'center' }}>6</div>
            </div>
        </Demo>
    );
}
