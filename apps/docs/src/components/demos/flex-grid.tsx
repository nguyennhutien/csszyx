import { Demo } from '../Demo.tsx';

// Shared cell base — combined with tier styles as array elements
const cellBase = { p: 2, rounded: 'md', text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium' } as const;
// zinc-700→zinc-800 gradient replaces zinc-900 (which is invisible against the panel bg)
const cellNeutral = { bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'zinc-700', to: 'zinc-800', color: 'white' } as const;
const cellAccent = { bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'indigo-700', to: 'violet-700', color: 'white' } as const;
const cellPrimary = { bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'violet-500', to: 'fuchsia-500', color: 'white' } as const;
const cellCenter = { textAlign: 'center' } as const;
const labelInline = { text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium', color: 'zinc-500', self: 'center', ml: 1 } as const;
// Flex row container for justify demos — subtle dark container, not a content block
const rowWrap = { flex: true, gap: 1, bg: 'zinc-950', border: true, borderColor: 'zinc-800', rounded: 'md', p: 1 } as const;
// Chip styles for justify demos — gradient variant for consistency
const chipActive = { p: 1.5, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'violet-500', to: 'fuchsia-500', rounded: 'sm', text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium', color: 'white' } as const;
const chipPassive = { p: 1.5, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'zinc-700', to: 'zinc-800', rounded: 'sm', text: 'sm', fontFamily: '--ds-font-ui', fontWeight: 'medium', color: 'white' } as const;

export function FlexDirection() {
    return (
        <Demo label="flex direction — row vs col">
            <div sz={{ flex: true, flexDir: 'row', gap: 2 }}>
                {/* static array — two variable items merged at build time */}
                <div sz={[cellBase, cellNeutral]}>A</div>
                <div sz={[cellBase, cellAccent]}>B</div>
                <div sz={[cellBase, cellPrimary]}>C</div>
            </div>
            <div sz={{ flex: true, flexDir: 'col', gap: 1 }}>
                <div sz={[cellBase, cellAccent]}>A</div>
                <div sz={[cellBase, cellAccent]}>B</div>
                <div sz={[cellBase, cellAccent]}>C</div>
            </div>
        </Demo>
    );
}

export function JustifyVariants() {
    return (
        <Demo label="justify — start, center, end, between">
            <div sz={{ flex: true, flexDir: 'col', gap: 2, w: 56 }}>
                <div sz={{ ...rowWrap, justify: 'start' }}>
                    <div sz={chipActive}>start</div>
                    <div sz={chipPassive}>B</div>
                </div>
                <div sz={{ ...rowWrap, justify: 'center' }}>
                    <div sz={chipActive}>center</div>
                    <div sz={chipPassive}>B</div>
                </div>
                <div sz={{ ...rowWrap, justify: 'end' }}>
                    <div sz={chipActive}>end</div>
                    <div sz={chipPassive}>B</div>
                </div>
                <div sz={{ ...rowWrap, justify: 'between' }}>
                    <div sz={chipActive}>between</div>
                    <div sz={chipPassive}>B</div>
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
                    <div sz={[cellBase, cellNeutral]}>A</div>
                    <div sz={[cellBase, cellNeutral]}>B</div>
                    <div sz={[cellBase, cellNeutral]}>C</div>
                    <span sz={labelInline}>gap-1</span>
                </div>
                <div sz={{ flex: true, gap: 4 }}>
                    <div sz={[cellBase, cellAccent]}>A</div>
                    <div sz={[cellBase, cellAccent]}>B</div>
                    <div sz={[cellBase, cellAccent]}>C</div>
                    <span sz={labelInline}>gap-4</span>
                </div>
                <div sz={{ flex: true, gap: 8 }}>
                    <div sz={[cellBase, cellPrimary]}>A</div>
                    <div sz={[cellBase, cellPrimary]}>B</div>
                    <div sz={[cellBase, cellPrimary]}>C</div>
                    <span sz={labelInline}>gap-8</span>
                </div>
            </div>
        </Demo>
    );
}

export function GridThreeCols() {
    return (
        <Demo label="{ grid: true, gridCols: 3, gap: 2 } — 3-column grid with 6 cells">
            <div sz={{ grid: true, gridCols: 3, gap: 2, w: 48 }}>
                {([1, 2, 3, 4, 5, 6] as const).map((n) => (
                    <div key={n} sz={[cellBase, cellAccent, cellCenter]}>{n}</div>
                ))}
            </div>
        </Demo>
    );
}

export function ColSpan() {
    return (
        <Demo label="{ colSpan: 2 } — wide cell spanning two columns">
            <div sz={{ grid: true, gridCols: 3, gap: 2, w: 48 }}>
                {/* conditional array: cellPrimary only when spanning */}
                <div sz={[cellBase, cellPrimary, cellCenter, { colSpan: 2 }]}>col-span-2</div>
                <div sz={[cellBase, cellNeutral, cellCenter]}>3</div>
                <div sz={[cellBase, cellNeutral, cellCenter]}>4</div>
                <div sz={[cellBase, cellNeutral, cellCenter]}>5</div>
                <div sz={[cellBase, cellNeutral, cellCenter]}>6</div>
            </div>
        </Demo>
    );
}
