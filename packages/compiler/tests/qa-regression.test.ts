/**
 * Regression locks for behaviors a real-project integration depended on.
 *
 * Each block pins a behavior that previously surprised a consuming team, so a
 * future change that re-breaks it fails loudly instead of shipping silently.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform-core.js';
import { transformOxc } from '../src/transform-oxc.js';

function warnsSpread(source: string): boolean {
    return transformOxc(source, 'App.tsx').diagnostics.some(d =>
        d.includes('unresolvable sz spread'),
    );
}

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

describe('opacity sub-property compiles to a Tailwind modifier', () => {
    // A static { color, op } resolves to the `bg-<color>/<op>` modifier class
    // (the form Tailwind generates color-mix for), not a dead `bg:op-N`.
    it.each([
        [{ bg: { color: 'black', op: 30 } }, 'bg-black/30'],
        [{ bg: { color: 'red-500', op: 50 } }, 'bg-red-500/50'],
    ] as const)('%o → %s', (sz, expected) => {
        expect(transform(sz).className).toBe(expected);
    });
});

describe('a finite ternary in a value sub-property expands into both branches', () => {
    // A finite conditional inside a value (`op: cond ? 30 : 100`) is a CHOICE
    // between two static classes, so the transform expands it into a class-level
    // ternary — matching the native engine — instead of routing the whole object
    // to the runtime helper (which left the classes incompletely safelisted).
    const source =
        'const X = ({ c }) => <div sz={{ bg: { color: "black", op: c ? 30 : 100 } }} />;';

    it('never emits the dead bg:op-N modifier', () => {
        const { code } = transformOxc(source, 'App.tsx');
        expect(code).not.toContain('bg:op-');
    });

    it('expands statically — no runtime fallback', () => {
        const { code } = transformOxc(source, 'App.tsx');
        expect(code).not.toContain('_sz(');
        expect(code).toContain('c ? "bg-black/30" : "bg-black/100"');
    });

    it('matches the babel engine (parity)', () => {
        const oxc = transformOxc(source, 'App.tsx').code;
        const babel = transform({ bg: { color: 'black', op: 30 } }); // sanity: branch is real
        expect(babel.className).toBe('bg-black/30');
        expect(oxc).toContain('bg-black/30');
        expect(oxc).toContain('bg-black/100');
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

describe('an unresolvable sz spread warns, other fallbacks stay quiet', () => {
    it('a top-level spread the parser cannot resolve is flagged', () => {
        expect(warnsSpread('const X = ({ props }) => <div sz={{ ...props }} />;')).toBe(true);
    });

    it.each([
        // dynamic value-object sub-field — falls back to runtime, no top-level spread
        'const X = ({ v }) => <div sz={{ bg: { color: "black", op: v } }} />;',
        // dynamic value — resolves via the CSS-var path, not a fallback
        'const X = ({ c }) => <div sz={{ bg: c }} />;',
        // fully static
        'const X = () => <div sz={{ p: 4 }} />;',
    ])('does not flag %s', source => {
        expect(warnsSpread(source)).toBe(false);
    });
});
