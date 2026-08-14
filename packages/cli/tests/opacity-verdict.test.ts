/**
 * Unit edges of the opacity-verdict parser.
 *
 * The check-level suite proves the verdict end to end through a real
 * Tailwind compile; these pin the by-index parser's odd inputs — shapes a
 * stylesheet CAN contain but the fixtures up there have no reason to — so a
 * refactor of the scanning loops cannot quietly change what they accept.
 */
import { describe, expect, it } from 'vitest';

import {
    brokenOpacityValue,
    collectCustomProperties,
    resolveCustomPropertyValue,
} from '../src/scanner/opacity-verdict.js';

describe('collectCustomProperties', () => {
    it('reads a declaration with whitespace before the colon', () => {
        expect(collectCustomProperties(':root { --a\t : 1, 2, 3; }').get('--a')).toBe('1, 2, 3');
    });

    it('ignores a dashed token in selector position', () => {
        const properties = collectCustomProperties('--weird { color: red; } :root { --b: 4; }');
        expect(properties.has('--weird')).toBe(false);
        expect(properties.get('--b')).toBe('4');
    });

    it('ignores a bare dash pair, wherever the text ends', () => {
        expect(collectCustomProperties('.a-- { color: red } .b-- rest').size).toBe(0);
        expect(collectCustomProperties('.b--').size).toBe(0);
    });

    it('finds nothing in a sheet without custom properties', () => {
        expect(collectCustomProperties('.plain { color: red; }').size).toBe(0);
    });

    it('ignores a dashed name whose block opens before any value ends', () => {
        // `--primary:hover` reads as name + colon, and the scan then meets
        // `{` before any `;` — a selector, not a declaration.
        const properties = collectCustomProperties(
            '.btn--primary:hover { color: red; } :root { --c: 5; }',
        );
        expect(properties.has('--primary')).toBe(false);
        expect(properties.get('--c')).toBe('5');
    });

    it('lets a later definition win, like the cascade', () => {
        expect(collectCustomProperties(':root { --a: 1; } .dark { --a: 2; }').get('--a')).toBe('2');
    });
});

describe('resolveCustomPropertyValue', () => {
    it('takes the fallback when the referenced property is not defined', () => {
        expect(resolveCustomPropertyValue('var(--missing, 7, 8, 9)', new Map())).toBe('7, 8, 9');
    });

    it('gives up on a reference cycle instead of proving anything', () => {
        const properties = new Map([
            ['--a', 'var(--b)'],
            ['--b', 'var(--a)'],
        ]);
        expect(resolveCustomPropertyValue('var(--a)', properties)).toBeNull();
    });

    it('rejects a malformed var reference by returning it as the final value', () => {
        expect(resolveCustomPropertyValue('var(--a b)', new Map())).toBe('var(--a b)');
        expect(resolveCustomPropertyValue('var(--a', new Map())).toBe('var(--a');
        expect(resolveCustomPropertyValue('var(--)', new Map())).toBe('var(--)');
    });
});

describe('brokenOpacityValue', () => {
    it('resolves through a var fallback inside the emitted rule', () => {
        const rule = '.x { color: color-mix(in oklab, var(--nope, 1, 2, 3) 30%, transparent); }';
        expect(brokenOpacityValue(rule, new Map())).toBe('1, 2, 3');
    });

    it('ignores a color-mix that is not the slash-modifier wrap', () => {
        const properties = new Map([['--t', '1, 2, 3']]);
        // Two colors, no transparent: an authored mix, not the modifier wrap.
        expect(
            brokenOpacityValue('.x { color: color-mix(in srgb, red, blue); }', properties),
        ).toBeNull();
        // Third part is a color, not transparent.
        expect(
            brokenOpacityValue(
                '.x { color: color-mix(in oklab, var(--t) 30%, blue); }',
                properties,
            ),
        ).toBeNull();
        // No percentage on the color part.
        expect(
            brokenOpacityValue(
                '.x { color: color-mix(in oklab, var(--t), transparent); }',
                properties,
            ),
        ).toBeNull();
    });
});
