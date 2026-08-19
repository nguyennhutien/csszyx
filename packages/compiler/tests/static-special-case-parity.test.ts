import { describe, expect, it } from 'vitest';

import { transformRust, transformSource, transformWasm } from '../src/index.js';

type Transform = typeof transformSource;

const engines: ReadonlyArray<[string, Transform]> = [
    ['auto', transformSource],
    ['wasm', transformWasm],
    ['rust', transformRust],
];

function expectClasses(source: string, expected: readonly string[]): void {
    for (const [name, transform] of engines) {
        const result = transform(source, 'special-case.tsx');
        expect([...result.classes].sort(), name).toEqual([...expected].sort());
    }
}

describe('static special-case parser parity', () => {
    it('merges static text size and line height utilities', () => {
        expectClasses(`const View = () => <span sz={{ text: 'xs', leading: 'none' }} />;`, [
            'text-xs/none',
        ]);
    });

    it('lowers structured properties inside runtime fallback branches', () => {
        expectClasses(
            `const View = ({ active }) => (
                <div sz={active ? { bgImg: { gradient: 'linear', dir: 'to-br' } } : getStyles()} />
            );`,
            ['bg-linear-to-br'],
        );
    });

    it('preserves nested variant chains inside runtime fallback branches', () => {
        expectClasses(
            `const View = ({ active }) => (
                <div sz={active ? { hover: { focus: { p: 4 } } } : getStyles()} />
            );`,
            ['hover:focus:p-4'],
        );
    });

    it('fully compiles static array elements', () => {
        const source = `
            const layout = { p: 4 };
            const paint = { bgImg: { gradient: 'linear', dir: 'to-br' } };
            const View = () => <div sz={[layout, paint]} />;
        `;
        expectClasses(source, ['p-4', 'bg-linear-to-br']);
        for (const [name, transform] of engines) {
            const result = transform(source, 'static-array.tsx');
            expect(result.code, name).not.toContain('_sz(');
            expect(result.code, name).toContain('p-4 bg-linear-to-br');
        }
    });

    it('precompiles static objects in conditional arrays', () => {
        const source = `
            const layout = { p: 4 };
            const View = ({ active }) => <div sz={[layout, active && { m: 2 }]} />;
        `;
        expectClasses(source, ['p-4', 'm-2']);
        for (const [name, transform] of engines) {
            const result = transform(source, 'conditional-array.tsx');
            expect(result.code, name).toContain('szcn("p-4", active && "m-2")');
            expect(result.code, name).not.toContain('_sz([layout');
        }
    });

    it('collects szv catalogs without a secondary parser pass', () => {
        expectClasses(
            `
                import { szv } from '@csszyx/runtime';
                const button = szv({
                    base: { text: 'xs', leading: 'none' },
                    variants: {
                        size: {
                            sm: { p: 4 },
                            lg: { p: 8 },
                        },
                    },
                });
            `,
            ['text-xs/none', 'p-4', 'p-8'],
        );
    });

    it('precompiles a static const spread alongside one conditional prop', () => {
        // The static spread (gradient + custom-var easing) must stay build-time;
        // only the conditional `scale` is runtime. Regression: rust/oxc used to
        // punt the whole object to `_sz(...)` at runtime, breaking the background.
        // Named `tsx` (not `source`) so the extracted-corpus meta-test does not
        // sample this targeted case — rust is intentionally build-time-ahead of
        // oxc here, which would otherwise shift that corpus's divergence count.
        const tsx = `
            const BOX = { p: 4, bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'rose-400', to: 'pink-500', transition: 'transform', ease: '--custom-backinout' };
            const View = ({ shrunk }) => <div sz={{ ...BOX, scale: shrunk ? 75 : 100 }} />;
        `;
        // Catalog parity holds for every engine.
        expectClasses(tsx, [
            'p-4',
            'bg-linear-to-br',
            'from-rose-400',
            'to-pink-500',
            'transition-transform',
            'ease-(--custom-backinout)',
            'scale-75',
            'scale-100',
        ]);
        // Every engine resolves it at build time: static classes stay literal
        // and only the conditional becomes a runtime ternary — no `_sz(...)`.
        for (const [name, transform] of engines) {
            const result = transform(tsx, 'spread-conditional.tsx');
            expect(result.code, name).not.toContain('_sz(');
            expect(result.code, name).toContain('shrunk ? "scale-75" : "scale-100"');
            expect(result.code, name).toContain('ease-(--custom-backinout)');
        }
    });

    it('collects static dynamic objects with structured values', () => {
        expectClasses(
            `
                import { dynamic } from '@csszyx/dynamic';
                const paint = { bgImg: { gradient: 'linear', dir: 'to-br' } };
                const View = () => <div className={dynamic(paint)} />;
            `,
            ['bg-linear-to-br'],
        );
    });
});
