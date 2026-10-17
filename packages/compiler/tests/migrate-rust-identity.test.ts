/**
 * The native migrate passes the same engine check as the transform: an engine
 * from another release is an error, not "migrate is unavailable".
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/engine-identity.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../src/engine-identity.js')>()),
    EXPECTED_ENGINE: { version: '0.18.0', digest: 'aaaaaaaaaaaaaaaa' },
}));

vi.mock('@csszyx/core/native', async importOriginal => ({
    ...(await importOriginal<typeof import('@csszyx/core/native')>()),
    engineIdentity: () => ({ version: '0.17.2', digest: 'bbbbbbbbbbbbbbbb' }),
    getNativePackageName: () => '@csszyx/core-linux-x64-gnu',
    migrateBatch: () => [],
}));

describe('the native migrate on an engine from another release', () => {
    it('reports it instead of calling migrate unavailable', async () => {
        const { isRustMigrateAvailable } = await import('../src/migrate-rust.js');
        const { EngineVersionSkewError } = await import('../src/engine-identity.js');
        expect(isRustMigrateAvailable).toThrow(EngineVersionSkewError);
    });
});
