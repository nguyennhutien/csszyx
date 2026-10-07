import { describe, expect, it } from 'vitest';

import { migrateSource as transformSource } from '../src/migrate.js';

/**
 * TRANSITIONAL (0.9.10 → 0.10.0): `migrate --keys-only` normalizes legacy sz-prop
 * keys to their single-way canonical and leaves every `className` 100% untouched —
 * the upgrade path for projects already on sz that do not want a Tailwind className
 * migration. (Remove with the normalizer at v1.)
 */
describe('migrate --keys-only', () => {
    // A className-only element next to an sz element carrying legacy keys.
    const SRC =
        'const App = () => (<><div className="p-4" /><span sz={{ fontWeight: \'bold\', padding: 2 }} /></>);';

    it('normalizes sz keys and leaves className byte-for-byte unchanged', () => {
        const out = transformSource(SRC, 'test.tsx', { keysOnly: true });
        expect(out.code).toBe(
            'const App = () => (<><div className="p-4" /><span sz={{ weight: \'bold\', p: 2 }} /></>);',
        );
        expect(out.code).toContain('className="p-4"'); // not converted, not removed
        expect(out.stats.szKeysNormalized).toBe(2);
        expect(out.stats.classNamesTransformed).toBe(0);
        expect(out.changed).toBe(true);
    });

    it('without the flag, the standalone className is also converted to sz', () => {
        const out = transformSource(SRC, 'test.tsx');
        expect(out.code).not.toContain('className=');
        expect(out.stats.classNamesTransformed).toBe(1);
        expect(out.stats.szKeysNormalized).toBe(2);
    });

    it('is a no-op on a className-only file (nothing to normalize)', () => {
        const src = 'const App = () => <div className="p-4 flex" />;';
        const out = transformSource(src, 'test.tsx', { keysOnly: true });
        expect(out.changed).toBe(false);
        expect(out.code).toBe(src);
    });

    describe('font-variant-numeric keys (0.18.0)', () => {
        const run = (sz: string) =>
            transformSource(`const A = ({ c }) => <p sz={${sz}} />;`, 'a.tsx', { keysOnly: true })
                .code;

        it('moves each old flag onto its group key', () => {
            expect(run('{ tabularNums: true, ordinal: true, slashedZero: true }')).toBe(
                "const A = ({ c }) => <p sz={{ numSpacing: 'tabular', numOrdinal: true, numSlashedZero: true }} />;",
            );
        });

        it('keeps a ternary a ternary, with each literal branch spelled for the new key', () => {
            expect(run('{ tabularNums: c ? true : false }')).toBe(
                "const A = ({ c }) => <p sz={{ numSpacing: c ? 'tabular' : undefined }} />;",
            );
            expect(run('{ flex: c ? undefined : true }')).toBe(
                "const A = ({ c }) => <p sz={{ display: c ? undefined : 'flex' }} />;",
            );
        });

        it('leaves a ternary with a runtime branch for the build to report', () => {
            expect(run('{ tabularNums: c ? true : v }')).toBe(
                'const A = ({ c }) => <p sz={{ tabularNums: c ? true : v }} />;',
            );
        });

        it('keeps only the later of two keys that became one, as the object did', () => {
            expect(run('{ liningNums: true, p: 2, oldstyleNums: true }')).toBe(
                "const A = ({ c }) => <p sz={{ p: 2, numFigure: 'oldstyle' }} />;",
            );
            expect(run('{ block: true, flex: true }')).toBe(
                "const A = ({ c }) => <p sz={{ display: 'flex' }} />;",
            );
        });

        it('reads a fontVariant value as the class it named', () => {
            expect(run("{ fontVariant: 'tabular-nums', md: { fontVariant: 'ordinal' } }")).toBe(
                "const A = ({ c }) => <p sz={{ numSpacing: 'tabular', md: { numOrdinal: true } }} />;",
            );
        });
    });

    describe('touch values that moved to a group key (0.18.0)', () => {
        const run = (sz: string) =>
            transformSource(`const A = () => <p sz={${sz}} />;`, 'a.tsx', { keysOnly: true }).code;

        it('moves each onto its group key', () => {
            expect(run("{ touch: 'pan-x', md: { touch: 'pinch-zoom' } }")).toBe(
                "const A = () => <p sz={{ touchPanX: 'x', md: { touchPinchZoom: true } }} />;",
            );
            expect(run("{ touch: 'none' }")).toBe("const A = () => <p sz={{ touch: 'none' }} />;");
        });

        it('moves a ternary of literals with its branches, in every variant and object branch', () => {
            expect(run("{ touch: m ? 'pan-x' : 'pan-left' }")).toBe(
                "const A = () => <p sz={{ touchPanX: m ? 'x' : 'left' }} />;",
            );
            expect(run("{ touch: m ? 'pan-x' : 'pan-y' }")).toBe(
                "const A = () => <p sz={{ touchPanX: m ? 'x' : undefined, touchPanY: m ? undefined : 'y' }} />;",
            );
            expect(
                run(
                    "{ group: { hover: { touch: 'pan-x' } }, data: { open: { touch: 'pinch-zoom' } } }",
                ),
            ).toBe(
                "const A = () => <p sz={{ group: { hover: { touchPanX: 'x' } }, data: { open: { touchPinchZoom: true } } }} />;",
            );
            expect(run("m ? { touch: 'pan-x' } : { md: { touch: m ? 'pan-up' : null } }")).toBe(
                "const A = () => <p sz={m ? { touchPanX: 'x' } : { md: { touchPanY: m ? 'up' : null } }} />;",
            );
        });

        it('reaches the group key from an alias in one pass', () => {
            expect(run("{ touchAction: 'pan-x' }")).toBe(
                "const A = () => <p sz={{ touchPanX: 'x' }} />;",
            );
        });

        it('leaves a ternary that would split across a stand-alone keyword for the build', () => {
            expect(run("{ touch: m ? 'pan-x' : 'auto' }")).toBe(
                "const A = () => <p sz={{ touch: m ? 'pan-x' : 'auto' }} />;",
            );
        });
    });

    describe('two old keys of one family keep what 0.17 rendered', () => {
        const run = (sz: string) =>
            transformSource(`const A = () => <p sz={${sz}} />;`, 'a.tsx', { keysOnly: true }).code;

        // Before 0.18 both classes shipped and Tailwind's stylesheet order
        // decided; `migrate-stylesheet-order.test.ts` pins that order.
        it.each([
            ['{ tabularNums: true, proportionalNums: true }', "{ numSpacing: 'tabular' }"],
            ['{ oldstyleNums: true, liningNums: true }', "{ numFigure: 'oldstyle' }"],
            ['{ stackedFractions: true, diagonalFractions: true }', "{ numFraction: 'stacked' }"],
            ["{ fontVariant: 'normal-nums', tabularNums: true }", "{ nums: 'normal' }"],
            ["{ touch: 'none', touchAction: 'pan-x' }", "{ touch: 'none' }"],
        ])('%s', (sz, expected) => {
            expect(run(sz)).toBe(`const A = () => <p sz={${expected}} />;`);
        });
    });

    describe('a stand-alone keyword beside its group in one className', () => {
        // Tailwind's sort decides between the classes (the stand-alone one
        // comes after its groups, so it renders), while an sz object decides by
        // the order written. Migrate keeps both classes as written, as it does
        // for two classes fighting over one property, so the page renders as
        // before without depending on how Tailwind sorts.
        it.each([
            ['touch-pan-x touch-none'],
            ['contain-strict contain-paint'],
            ['tabular-nums normal-nums'],
        ])('keeps %s in className', classes => {
            const out = transformSource(
                `const A = () => <p className="${classes} p-4" />;`,
                'a.tsx',
            ).code;
            expect(out).toBe(`const A = () => <p className="${classes}" sz={{ p: 4 }} />;`);
        });
    });
});
