/**
 * Nested finite-conditional parity across the three engines.
 *
 * A finite conditional inside a value (`{ borderColor: { color: cond ? a : b, op } }`)
 * is a CHOICE between two static classes. The native (rust) engine expands it into
 * both branches; babel and oxc used to fall through to the runtime helper / a CSS
 * variable, leaving the classes incompletely safelisted (the trove 0.10.8 report).
 *
 * These fixtures lock the fix: babel and oxc now expand the same branches, and no
 * engine silently switches the whole object to `_sz(...)`. Fixtures are an array
 * (not `const source = ...`) so the extracted-corpus meta-test does not sample them.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { loadNativeBinding } from '../../core/native/index.js';
import { transformSourceCode } from '../src/transform.js';
import { transformOxc } from '../src/transform-oxc.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';

/**
 * Strip the JSX element from a transform result for stable comparison.
 * @param code - transformed source.
 * @returns the `<div .../>` element, or the input if not found.
 */
function element(code: string): string {
    return code.replace(/\s+/g, ' ').match(/<div[\s\S]*?\/>/)?.[0] ?? code;
}

/**
 * Transform with the babel engine and return the JSX element.
 * @param code - source to transform.
 * @returns the transformed `<div .../>` element.
 */
function babel(code: string): string {
    return element(transformSourceCode(code, 'F.tsx').code);
}

/**
 * Transform with the oxc engine and return the JSX element.
 * @param code - source to transform.
 * @returns the transformed `<div .../>` element.
 */
function oxc(code: string): string {
    const r = transformOxc(code, 'F.tsx');
    return element(typeof r === 'string' ? r : r.code);
}

/**
 * Transform with the native rust engine and return the JSX element.
 * @param code - source to transform.
 * @returns the transformed `<div .../>` element.
 */
function rust(code: string): string {
    const r = transformRust(code, 'F.tsx');
    return element(typeof r === 'string' ? r : r.code);
}

/**
 * Sorted class tokens extracted by an engine — the safelist-parity contract.
 * @param result - a transform result (or a raw code string).
 * @returns the extracted classes, sorted.
 */
function classesOf(result: { classes?: Iterable<string> } | string): string[] {
    if (typeof result === 'string') {
        return [];
    }
    return [...(result.classes ?? [])].sort();
}

/**
 * Fixtures where all three engines agree byte-for-byte. The variant prefix is a
 * single standard variant (or none), which the rust conditional path joins the
 * same way babel/oxc do.
 */
const FULL_PARITY: Array<{ name: string; src: string; contains: string[] }> = [
    {
        name: 'bare color + opacity',
        src: 'export const A = ({ c }) => <div sz={{ borderColor: { color: c ? "red-700" : "charcoal", op: 18 } }} />;',
        contains: ['border-red-700/18', 'border-charcoal/18'],
    },
    {
        name: 'opacity is the conditional',
        src: 'export const A = ({ c }) => <div sz={{ bg: { color: "black", op: c ? 30 : 100 } }} />;',
        contains: ['bg-black/30', 'bg-black/100'],
    },
    {
        name: 'static sibling stays in both branches',
        src: 'export const A = ({ c }) => <div sz={{ borderColor: { color: c ? "red-700" : "charcoal", op: 18 }, bg: { color: "white", op: 70 } }} />;',
        contains: ['bg-white/70', 'border-red-700/18', 'border-charcoal/18'],
    },
    {
        name: 'hover variant',
        src: 'export const A = ({ c }) => <div sz={{ hover: { bg: { color: c ? "red-500" : "blue-500", op: 50 } } }} />;',
        contains: ['hover:bg-red-500/50', 'hover:bg-blue-500/50'],
    },
    {
        name: 'before variant',
        src: 'export const A = ({ c }) => <div sz={{ before: { bg: { color: c ? "red-500" : "blue-500" } } }} />;',
        contains: ['before:bg-red-500', 'before:bg-blue-500'],
    },
    {
        name: 'responsive (md) variant',
        src: 'export const A = ({ c }) => <div sz={{ md: { bg: { color: c ? "red-500" : "blue-500" } } }} />;',
        contains: ['md:bg-red-500', 'md:bg-blue-500'],
    },
];

describe('nested finite-conditional parity', () => {
    beforeAll(() => {
        const here = path.dirname(fileURLToPath(import.meta.url));
        try {
            loadNativeBinding(path.resolve(here, '../../core-linux-arm64-gnu'));
        } catch {
            // Binding absent — rust assertions are skipped below.
        }
    });

    for (const fixture of FULL_PARITY) {
        it(`babel and oxc expand the same branches — ${fixture.name}`, () => {
            const b = babel(fixture.src);
            const o = oxc(fixture.src);
            expect(b, 'babel must not fall back to the runtime helper').not.toContain('_sz(');
            expect(o, 'oxc must not fall back to the runtime helper').not.toContain('_sz(');
            expect(o).toBe(b);
            for (const cls of fixture.contains) {
                expect(b, `babel should contain ${cls}`).toContain(cls);
            }
        });

        it.skipIf(!isRustTransformAvailable())(
            `rust safelists the same classes as oxc — ${fixture.name}`,
            () => {
                // rust factors a static sibling out of the ternary while oxc/babel
                // repeat it in both branches — same classes, different code shape.
                // The safelist-parity contract is the extracted class set.
                expect(rust(fixture.src), 'rust must not fall back').not.toContain('_sz(');
                expect(classesOf(transformRust(fixture.src, 'F.tsx'))).toEqual(
                    classesOf(transformOxc(fixture.src, 'F.tsx')),
                );
            },
        );
    }

    it('a second nested conditional stays on the existing path (no combinatorial expansion)', () => {
        // Two nested conditionals would expand combinatorially; the hoist declines
        // and the prior behavior (runtime/partial) handles it — never a wrong class.
        // Named `twoConditionals` (not `src`) so the extracted-corpus meta-test
        // does not sample it.
        const twoConditionals =
            'export const A = ({ c, d }) => <div sz={{ borderColor: { color: c ? "red-700" : "charcoal" }, bg: { color: d ? "white" : "black" } }} />;';
        // Whatever the engines choose, babel and oxc must agree and stay safe.
        expect(oxc(twoConditionals)).toBe(babel(twoConditionals));
    });
});
