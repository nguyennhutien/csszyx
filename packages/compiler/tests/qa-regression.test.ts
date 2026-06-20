/**
 * Regression locks for behaviors a real-project integration depended on.
 *
 * Each block pins a behavior that previously surprised a consuming team, so a
 * future change that re-breaks it fails loudly instead of shipping silently.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform-core.js';

/** Read a sibling workspace package manifest. */
function manifest(pkg: string): { peerDependencies?: Record<string, string> } {
    return JSON.parse(readFileSync(new URL(`../../${pkg}/package.json`, import.meta.url), 'utf8'));
}

describe('value-keyed canonical forms are the only spelling', () => {
    it.each([
        [{ position: 'absolute' }, 'absolute'],
        [{ display: 'flex' }, 'flex'],
        [{ display: 'inline-block' }, 'inline-block'],
        [{ visibility: 'hidden' }, 'invisible'],
        [{ decoration: 'underline' }, 'underline'],
    ] as const)('%o → %s', (sz, expected) => {
        expect(transform(sz).className).toBe(expected);
    });

    it.each([{ absolute: true }, { flex: true }, { underline: true }, { italic: true }] as const)(
        'removed boolean sugar %o emits nothing',
        sz => {
            expect(transform(sz).className).toBe('');
        },
    );
});

describe('CSS-property-name keys resolve to real Tailwind utilities', () => {
    it.each([
        [{ fontStyle: 'italic' }, 'italic'],
        [{ fontSmoothing: 'grayscale' }, 'antialiased'],
        [{ fontSmoothing: 'subpixel' }, 'subpixel-antialiased'],
        [{ textTransform: 'uppercase' }, 'uppercase'],
        [{ textTransform: 'none' }, 'normal-case'],
        [{ borderStyle: 'dashed' }, 'border-dashed'],
        [{ listPos: 'inside' }, 'list-inside'],
    ] as const)('%o → %s', (sz, expected) => {
        expect(transform(sz).className).toBe(expected);
    });
});

describe('decoration value keys (parity with the Rust lowering)', () => {
    // The Rust lowering (packages/core/src/transform/lower.rs) emits the same
    // classes; the parity corpus gates that equivalence. These pin the TS side.
    it.each([
        [{ decoration: 'none' }, 'no-underline'],
        [{ decoration: 'underline' }, 'underline'],
        [{ decoration: 'overline' }, 'overline'],
        [{ decoration: 'line-through' }, 'line-through'],
    ] as const)('%o → %s', (sz, expected) => {
        expect(transform(sz).className).toBe(expected);
    });
});

describe('unknown sz keys fall through to a kebab class', () => {
    // Current documented behavior: an unrecognized key (e.g. a legacy `bgColor`
    // instead of the canonical `bg`) is kebab-cased and emitted, plus a
    // dev-mode console warning. Whether to suppress the dead class or surface a
    // build-time warning instead is a tracked product decision; this test locks
    // the present behavior so any change to it is deliberate.
    it('emits the kebab fallback for a legacy key name', () => {
        expect(transform({ bgColor: 'red' }).className).toBe('bg-color-red');
    });
});

describe('React 17 peer support', () => {
    it('the opt-in runtime packages accept React 17', () => {
        expect(manifest('dynamic').peerDependencies?.react).toBe('>=17.0.0');
        expect(manifest('vars').peerDependencies?.react).toBe('>=17.0.0');
    });

    it('the default runtime declares no React peer', () => {
        expect(manifest('runtime').peerDependencies?.react).toBeUndefined();
    });
});
