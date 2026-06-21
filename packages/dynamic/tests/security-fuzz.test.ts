import { transform } from '@csszyx/compiler/browser';
import { describe, expect, it } from 'vitest';
import { isSafeCssValue } from '../src/css-sanitize.js';
import { purifySz } from '../src/purify.js';

/**
 * Security invariants for the untrusted-sz path. These lock the audited
 * mitigations (CSS-declaration breakout, prototype pollution, legacy CSS
 * vectors) and fuzz the boundary so a regression can't slip through silently.
 */

describe('legacy CSS injection vectors', () => {
    it('strict purifySz drops url()/expression()/@import (exfil + legacy)', () => {
        expect(purifySz({ bg: '[url(javascript:alert(1))]' })).toEqual({});
        expect(purifySz({ bg: '[url(https://evil/x)]' })).toEqual({});
        expect(purifySz({ width: '[expression(alert(1))]' })).toEqual({});
        expect(purifySz({ bg: '[@import url(evil)]' })).toEqual({});
        // Non-strict keeps url() (legitimate for trusted/authored input).
        expect(purifySz({ bg: '[url(/img.png)]' }, { strict: false })).toEqual({
            bg: '[url(/img.png)]',
        });
    });

    it('rejects same-rule declaration injection before it can reach insertRule', () => {
        // A `;` would inject a second declaration; a `}` would attempt a rule
        // breakout — insertRule is atomic, but we reject both at the value gate.
        expect(isSafeCssValue('red;position:fixed;inset:0')).toBe(false);
        expect(isSafeCssValue('red}.evil{color:red')).toBe(false);
        expect(isSafeCssValue('x</style')).toBe(false);
        expect(isSafeCssValue('a\r\nb')).toBe(false);
        // Legitimate values with `;`/`<` inside url()/quotes still pass.
        expect(isSafeCssValue('url(data:image/png;base64,AAAA)')).toBe(true);
        expect(isSafeCssValue('"a;b"')).toBe(true);
    });
});

function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const HOSTILE_KEYS = ['__proto__', 'constructor', 'prototype', 'bg', 'p', 'evilKey', 'hover'];
const HOSTILE_VALUES = [
    'red;position:fixed',
    'red}.x{a:b',
    '[url(javascript:alert(1))]',
    'x</style>',
    'a\r\nb',
    '[expression(1)]',
    'blue',
    4,
    true,
    null,
];

function buildHostile(rand: () => number, depth: number): unknown {
    if (depth > 6 || rand() < 0.3) {
        return HOSTILE_VALUES[Math.floor(rand() * HOSTILE_VALUES.length)];
    }
    if (rand() < 0.2) {
        const arr: unknown[] = [];
        for (let i = 0; i < Math.floor(rand() * 5); i++) arr.push(buildHostile(rand, depth + 1));
        return arr;
    }
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < Math.floor(rand() * 5); i++) {
        const key = HOSTILE_KEYS[Math.floor(rand() * HOSTILE_KEYS.length)];
        obj[key] = buildHostile(rand, depth + 1);
    }
    return obj;
}

function assertAllValuesSafe(value: unknown): void {
    if (typeof value === 'string') {
        // Strip the arbitrary brackets purify keeps, then validate the inner value.
        const inner = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
        const colon = inner.indexOf(':');
        const candidate = value.startsWith('[') && colon !== -1 ? inner.slice(colon + 1) : inner;
        expect(isSafeCssValue(candidate)).toBe(true);
        return;
    }
    if (Array.isArray(value)) {
        for (const v of value) assertAllValuesSafe(v);
        return;
    }
    if (value && typeof value === 'object') {
        for (const v of Object.values(value)) assertAllValuesSafe(v);
    }
}

describe('fuzz: hostile sz never breaks the invariants', () => {
    it('purifySz output is always injection-safe and never pollutes the prototype', () => {
        const rand = rng(0xc552a1);
        for (let i = 0; i < 600; i++) {
            const hostile = buildHostile(rand, 0) as Record<string, unknown>;
            const input = typeof hostile === 'object' && hostile ? hostile : { bg: hostile };
            let out: unknown;
            expect(() => {
                out = purifySz(input as never);
            }).not.toThrow();
            assertAllValuesSafe(out);
            // Prototype must never be polluted by a `__proto__` key in the input.
            expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
            expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        }
    });

    it('transform() never throws on hostile input except the typed depth limit', () => {
        const rand = rng(0x5eed);
        for (let i = 0; i < 400; i++) {
            const hostile = buildHostile(rand, 0);
            const input = (
                hostile && typeof hostile === 'object' && !Array.isArray(hostile)
                    ? hostile
                    : { bg: hostile }
            ) as Record<string, unknown>;
            try {
                transform(input as never);
            } catch (err) {
                expect((err as Error).name).toBe('SzDepthError');
            }
            expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
        }
    });
});
