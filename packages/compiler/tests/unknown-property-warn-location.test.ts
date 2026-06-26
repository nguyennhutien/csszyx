import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    isRustTransformAvailable,
    transformOxc,
    transformRust,
    transformSourceCode,
} from '../src/index.js';
import { setSzWarnLocation, transform } from '../src/transform-core.js';

/**
 * The dev-mode "Unknown property" warning must point at the offending sz prop —
 * relative to the project root, with a line — so it is findable in a large
 * codebase. The build engines (oxc + babel) attach the location; the runtime
 * path (no source file) keeps the location-free message; and the location must
 * never leak from a build transform to an unrelated later call.
 */
describe('unknown-property warning — source location', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warn.mockRestore();
        setSzWarnLocation(undefined);
    });

    const fixtureSrc = 'export const A = () => (\n  <div sz={{ xyzzy: 4, p: 2 }} />\n);';

    it('oxc attaches relativePath:line for the sz prop', () => {
        transformOxc(fixtureSrc, '/proj/src/components/Foo.tsx', { rootDir: '/proj' });
        const messages = warn.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('Unknown property "xyzzy"'))).toBe(true);
        expect(messages.some(m => m.includes('at src/components/Foo.tsx:2.'))).toBe(true);
        // The relativized path must not contain the absolute root prefix.
        expect(messages.every(m => !m.includes('/proj/src'))).toBe(true);
    });

    it('babel attaches relativePath:line for the sz prop', () => {
        transformSourceCode(fixtureSrc, '/proj/src/components/Bar.tsx', { rootDir: '/proj' });
        const messages = warn.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('at src/components/Bar.tsx:2.'))).toBe(true);
    });

    it('falls back to the raw filename when no rootDir is given', () => {
        transformOxc(fixtureSrc, 'standalone/Baz.tsx');
        const messages = warn.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('at standalone/Baz.tsx:2.'))).toBe(true);
    });

    it('runtime path (no source file) keeps the location-free message', () => {
        // The browser/runtime `transform()` never sets a location.
        transform({ xyzzy: 4 });
        const messages = warn.mock.calls.map(c => String(c[0]));
        expect(
            messages.some(
                m =>
                    m ===
                    '[csszyx] Unknown property "xyzzy" in sz prop. This will be ignored. Check for typos.',
            ),
        ).toBe(true);
    });

    it('does not leak a build location into a later runtime transform', () => {
        transformOxc(fixtureSrc, '/proj/src/components/Foo.tsx', { rootDir: '/proj' });
        warn.mockClear();
        transform({ qqq: 9 });
        const messages = warn.mock.calls.map(c => String(c[0]));
        // The runtime warning must NOT carry Foo.tsx (the post-loop clear ran).
        expect(messages.some(m => m.includes('Unknown property "qqq"'))).toBe(true);
        expect(messages.every(m => !m.includes('Foo.tsx'))).toBe(true);
    });

    it('a suggestion warning is also located', () => {
        // `op` is a removed/aliased key that triggers the suggestion branch.
        const opSrc = 'export const A = () => <div sz={{ op: 50 }} />;';
        transformOxc(opSrc, '/proj/src/X.tsx', { rootDir: '/proj' });
        const messages = warn.mock.calls.map(c => String(c[0]));
        // Whichever canonical-key/unknown branch fires, it must carry the location.
        expect(messages.some(m => m.includes('at src/X.tsx'))).toBe(true);
    });
});

/**
 * The native (Rust) engine emits the same warning via `result.diagnostics`. The
 * hard safety invariant is that it must NEVER over-warn — flag a key the oxc
 * engine considers valid (that would be a false typo warning on real code). It
 * MAY under-warn on value-dependent edge cases (a missed dev nudge is harmless).
 * This is the drift gate: a new special-cased key in the Rust lowering that is
 * not taught to `is_known_sz_key` would fail here. Skips when no native binary is
 * installed (the diagnostic can only be exercised through the real addon).
 */
describe('unknown-property warning — Rust engine parity (no over-warn)', () => {
    const rustAvailable = isRustTransformAvailable();
    const runOr = rustAvailable ? it : it.skip;

    const oxcWarns = (key: string, value: string): boolean => {
        const calls: string[] = [];
        const spy = vi.spyOn(console, 'warn').mockImplementation(m => {
            calls.push(String(m));
        });
        transformOxc(`export const A = () => <div sz={{ ${key}: ${value} }} />;`, '/p/F.tsx', {
            rootDir: '/p',
        });
        spy.mockRestore();
        return calls.some(m => m.includes('Unknown property'));
    };

    const rustWarns = (key: string, value: string): boolean =>
        transformRust(`export const A = () => <div sz={{ ${key}: ${value} }} />;`, '/p/F.tsx', {
            rootDir: '/p',
        }).diagnostics.some(m => m.includes('Unknown property'));

    runOr('emits a located, root-relative diagnostic for a typo', () => {
        const result = transformRust(
            'export const A = () => (\n  <div sz={{ xyzzy: 4 }} />\n);',
            '/proj/src/components/Foo.tsx',
            { rootDir: '/proj' },
        );
        expect(
            result.diagnostics.some(
                m =>
                    m.includes('Unknown property "xyzzy"') &&
                    m.includes('at src/components/Foo.tsx:2'),
            ),
        ).toBe(true);
    });

    runOr('never over-warns relative to oxc across a broad key/value matrix', () => {
        const keys = [
            // valid: real props, variants, special-cased keys, removed sugar
            'm',
            'p',
            'gap',
            'bg',
            'flexDir',
            'hover',
            'md',
            'data',
            'aria',
            'group',
            'min',
            'fromPos',
            'alignContent',
            'backgroundRepeat',
            'listStyle',
            'maskComposite',
            'maskMode',
            'maskType',
            'ordinal',
            'snapStrictness',
            'snapAlign',
            'content',
            'display',
            'isolation',
            'visibility',
            'textTransform',
            'fontStyle',
            'decoration',
            'list',
            'bgImg',
            'grid',
            'flex',
            'block',
            'italic',
            'underline',
            // typos
            'xyzzy',
            'pading',
            'colour',
            'fooBar',
            'wibble',
            'zzz',
        ];
        const overWarns: string[] = [];
        for (const key of keys) {
            for (const value of ['"x"', '4', 'true']) {
                if (rustWarns(key, value) && !oxcWarns(key, value)) {
                    overWarns.push(`${key}:${value}`);
                }
            }
        }
        expect(overWarns).toEqual([]);
    });
});
