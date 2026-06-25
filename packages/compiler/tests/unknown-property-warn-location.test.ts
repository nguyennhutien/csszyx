import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { transformOxc, transformSourceCode } from '../src/index.js';
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

    const src = 'export const A = () => (\n  <div sz={{ xyzzy: 4, p: 2 }} />\n);';

    it('oxc attaches relativePath:line for the sz prop', () => {
        transformOxc(src, '/proj/src/components/Foo.tsx', { rootDir: '/proj' });
        const messages = warn.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('Unknown property "xyzzy"'))).toBe(true);
        expect(messages.some(m => m.includes('at src/components/Foo.tsx:2.'))).toBe(true);
        // The relativized path must not contain the absolute root prefix.
        expect(messages.every(m => !m.includes('/proj/src'))).toBe(true);
    });

    it('babel attaches relativePath:line for the sz prop', () => {
        transformSourceCode(src, '/proj/src/components/Bar.tsx', { rootDir: '/proj' });
        const messages = warn.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('at src/components/Bar.tsx:2.'))).toBe(true);
    });

    it('falls back to the raw filename when no rootDir is given', () => {
        transformOxc(src, 'standalone/Baz.tsx');
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
        transformOxc(src, '/proj/src/components/Foo.tsx', { rootDir: '/proj' });
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
