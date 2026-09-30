/**
 * `csszyx migrate` reads a mask utility onto the key that owns its variable.
 *
 * ADR 0013 split mask by CSS variable: `mask` is a direct mask-image only, and
 * the gradient layers are `maskLinear` / `maskRadial` / `maskConic`, whose
 * angle, sides and stops are members. Migrate kept writing every `mask-*`
 * class to `mask`, which the engine refuses for a layer and lowers to nothing
 * — 2,125 of Tailwind's mask utilities migrated to no class at all.
 *
 * The last cases ask Tailwind itself for every mask, touch-action and
 * contain utility it serves, so a spelling nobody wrote down here is covered
 * too.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { type SzObject, transform } from '../../compiler/src/transform-core.js';
import { classNameToSzObject, parseClass } from '../src/migrate.js';

const REPO = path.resolve(import.meta.dirname, '../../..');

describe('migrate — mask utilities', () => {
    it.each([
        ['mask-linear-45', { prop: 'maskLinear', value: { angle: 45 } }],
        ['-mask-linear-45', { prop: 'maskLinear', value: { angle: -45 } }],
        ['mask-conic-90', { prop: 'maskConic', value: { angle: 90 } }],
        ['mask-linear-(--a)', { prop: 'maskLinear', value: { angle: '--a' } }],
        ['mask-linear-from-20%', { prop: 'maskLinear', value: { from: '20%' } }],
        ['mask-radial-to-4', { prop: 'maskRadial', value: { to: 4 } }],
        ['mask-conic-from-red-500', { prop: 'maskConic', value: { from: { color: 'red-500' } } }],
        ['mask-b-from-20%', { prop: 'maskLinear', value: { b: { from: '20%' } } }],
        [
            'mask-b-from-red-500/30',
            { prop: 'maskLinear', value: { b: { from: { color: 'red-500', op: 30 } } } },
        ],
        ['mask-x-to-(--c)', { prop: 'maskLinear', value: { x: { to: { at: '--c' } } } }],
        [
            'mask-t-from-(color:--c)',
            { prop: 'maskLinear', value: { t: { from: { color: '--c' } } } },
        ],
        ['mask-radial-at-center', { prop: 'maskRadial', value: { at: 'center' } }],
        ['mask-radial-closest-side', { prop: 'maskRadial', value: { size: 'closest-side' } }],
        ['mask-circle', { prop: 'maskRadial', value: { shape: 'circle' } }],
        ['mask-add', { prop: 'maskComposite', value: 'add' }],
        ['mask-alpha', { prop: 'maskMode', value: 'alpha' }],
        ['mask-match', { prop: 'maskMode', value: 'match-source' }],
        ['mask-auto', { prop: 'maskSize', value: 'auto' }],
        ['mask-bottom-left', { prop: 'maskPos', value: 'bottom-left' }],
        ['mask-none', { prop: 'mask', value: 'none' }],
        ['mask-(--my-mask)', { prop: 'mask', value: '--my-mask' }],
    ])('%s', (className, expected) => {
        expect(parseClass(className)).toMatchObject(expected);
    });

    it('gathers the utilities of one layer into its object', () => {
        const { szObject, unrecognized } = classNameToSzObject(
            'mask-b-from-20% mask-b-to-80% mask-t-from-black mask-linear-from-10% mask-radial-at-top mask-circle',
        );

        expect(unrecognized).toEqual([]);
        expect(szObject).toEqual({
            maskLinear: {
                b: { from: '20%', to: '80%' },
                t: { from: { color: 'black' } },
                from: '10%',
            },
            maskRadial: { at: 'top', shape: 'circle' },
        });
    });

    describe('every mask utility Tailwind serves', () => {
        let classes: string[] = [];
        beforeAll(async () => {
            const require = createRequire(path.join(REPO, 'package.json'));
            const tailwind = require('tailwindcss');
            const design = await tailwind.__unstable__loadDesignSystem(
                readFileSync(require.resolve('tailwindcss/index.css'), 'utf8'),
                { base: REPO },
            );
            classes = design
                .getClassList()
                .map(([name]: [string]) => name)
                .filter((name: string) => /^-?mask-/.test(name));
        });

        it('migrates to the key that owns it, and back to the same class', () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const wrong: string[] = [];
            for (const className of classes) {
                const parsed = parseClass(className);
                if (parsed === null) continue;
                const lowered = transform({ [parsed.prop]: parsed.value } as SzObject).className;
                const direct = /^mask-(none|\[.*\]|\(.*\))$/.test(className);
                // `-mask-linear-0` is `mask-linear-0`: a negative zero is zero.
                const same =
                    lowered === className ||
                    (className.endsWith('-0') && `-${lowered}` === className);
                if (!same || (parsed.prop === 'mask' && !direct)) {
                    wrong.push(`${className} → ${JSON.stringify(parsed)} → ${lowered}`);
                }
            }
            vi.restoreAllMocks();

            expect(classes.length).toBeGreaterThan(6000);
            expect(wrong.slice(0, 10)).toEqual([]);
        });
    });
});

describe('migrate — every touch-action and contain utility Tailwind serves', () => {
    let classes: string[] = [];
    beforeAll(async () => {
        const require = createRequire(path.join(REPO, 'package.json'));
        const tailwind = require('tailwindcss');
        const design = await tailwind.__unstable__loadDesignSystem(
            readFileSync(require.resolve('tailwindcss/index.css'), 'utf8'),
            { base: REPO },
        );
        classes = design
            .getClassList()
            .map(([name]: [string]) => name)
            .filter((name: string) => /^(touch|contain)-/.test(name));
    });

    it('migrates to a group key or the stand-alone key, and back to the same class', () => {
        const owners = new Set([
            'touch',
            'touchPanX',
            'touchPanY',
            'touchPinchZoom',
            'contain',
            'containSize',
            'containLayout',
            'containPaint',
            'containStyle',
        ]);
        const wrong: string[] = [];
        for (const className of classes) {
            const parsed = parseClass(className);
            const lowered = parsed
                ? transform({ [parsed.prop]: parsed.value } as SzObject).className
                : '(unparsed)';
            if (lowered !== className || !owners.has(parsed?.prop ?? '')) {
                wrong.push(`${className} → ${JSON.stringify(parsed)} → ${lowered}`);
            }
        }

        expect(classes).toHaveLength(18);
        expect(wrong).toEqual([]);
    });
});
