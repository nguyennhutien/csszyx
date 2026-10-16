/**
 * The wasm engine is checked like the native one: the first call refuses a
 * build of another release or another source, and passes this one.
 */
import { createRequire } from 'node:module';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const expected = vi.hoisted(() => ({ current: { version: '', digest: '' } }));

vi.mock('../src/engine-identity.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../src/engine-identity.js')>();
    return {
        ...actual,
        get EXPECTED_ENGINE() {
            return expected.current;
        },
    };
});

const wasm = createRequire(import.meta.url)('@csszyx/core/parser-wasm') as {
    version(): string;
    engine_digest(): string;
};
const built = { version: wasm.version(), digest: wasm.engine_digest() };

beforeEach(() => {
    vi.resetModules();
});

describe('the wasm engine identity', () => {
    it('passes the build this compiler expects', async () => {
        expected.current = built;
        const { transformWasm } = await import('../src/transform-wasm.js');
        expect(transformWasm('<div sz={{ p: 4 }} />', 'a.tsx').code).toContain('p-4');
    });

    it('refuses a build of another source', async () => {
        expected.current = { ...built, digest: '0000000000000000' };
        const { transformWasm } = await import('../src/transform-wasm.js');
        const { EngineVersionSkewError } = await import('../src/engine-identity.js');
        expect(() => transformWasm('<div />', 'a.tsx')).toThrow(EngineVersionSkewError);
    });
});
