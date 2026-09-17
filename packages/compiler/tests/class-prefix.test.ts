/**
 * The project's Tailwind prefix through both artifacts of the engine.
 *
 * The emission rules are pinned by the Rust suite beside the engine; this asks
 * whether `classPrefix` crosses the napi and wasm boundaries and reaches both
 * the emitted code and the safelist.
 */
import { describe, expect, it } from 'vitest';

import { ENGINES } from './engine-parity-harness.js';

const SOURCE =
    'export const A = ({ on }) => <div className="card" sz={{ p: 4, hover: { bg: \'red-500\' }, m: on ? 2 : 4 }} />;';

describe.each(ENGINES)('the %s artifact', (_name, transform) => {
    it('writes the prefix before every class it lowers', () => {
        const result = transform(SOURCE, '/p/a.tsx', { classPrefix: 'tw' });

        expect(result.code).toContain('tw:p-4');
        expect(result.code).toContain('tw:hover:bg-red-500');
        expect(result.code).not.toMatch(/[\s"`]p-4/);
        expect([...(result.classes ?? [])].every(name => name.startsWith('tw:'))).toBe(true);
    });

    it('leaves the classes the author wrote as written', () => {
        const result = transform(SOURCE, '/p/a.tsx', { classPrefix: 'tw' });

        expect(result.code).toContain('_szMerge("card", `tw:p-4');
    });

    it('emits what it always emitted without a prefix', () => {
        const bare = transform(SOURCE, '/p/a.tsx');
        const none = transform(SOURCE, '/p/a.tsx', { classPrefix: null });

        expect(none.code).toBe(bare.code);
        expect(bare.code).toContain('_szMerge("card", `p-4');
    });
});
