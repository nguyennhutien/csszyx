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
});
