/**
 * The native availability probe answers "unavailable" only for a missing
 * addon. An engine from another release is an error the build reports, never
 * a reason to fall back to the wasm build in silence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({
    identity: (): unknown => null,
    platform: '@csszyx/core-linux-x64-gnu' as string | null,
    // `@csszyx/core` from before 0.18 has no `engineIdentity` export at all.
    exportsIdentity: true,
}));

vi.mock('../src/engine-identity.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../src/engine-identity.js')>()),
    EXPECTED_ENGINE: { version: '0.18.0', digest: 'aaaaaaaaaaaaaaaa' },
}));

vi.mock('@csszyx/core/native', async importOriginal => ({
    ...(await importOriginal<typeof import('@csszyx/core/native')>()),
    get engineIdentity() {
        return engine.exportsIdentity ? () => engine.identity() : undefined;
    },
    getNativePackageName: () => engine.platform,
    transformBatch: () => [{ issues: [] }],
}));

beforeEach(() => {
    vi.resetModules();
});

describe('the native availability probe', () => {
    it('reports an engine from another release instead of falling back', async () => {
        engine.identity = () => ({ version: '0.17.2', digest: 'bbbbbbbbbbbbbbbb' });
        const { isRustTransformAvailable } = await import('../src/transform-rust.js');
        const { EngineVersionSkewError } = await import('../src/engine-identity.js');
        expect(isRustTransformAvailable).toThrow(EngineVersionSkewError);
        // Not remembered as unavailable: every call reports it.
        expect(isRustTransformAvailable).toThrow(EngineVersionSkewError);
    });

    it('says when no platform package covers the host', async () => {
        engine.identity = () => ({ version: '0.17.2', digest: 'bbbbbbbbbbbbbbbb' });
        engine.platform = null;
        const { isRustTransformAvailable } = await import('../src/transform-rust.js');
        expect(isRustTransformAvailable).toThrow('the native (no platform package) engine 0.17.2');
        engine.platform = '@csszyx/core-linux-x64-gnu';
    });

    it('answers false for a missing addon', async () => {
        const { CsszyxNativeUnavailableError } = await import('@csszyx/core/native');
        engine.identity = () => {
            throw new CsszyxNativeUnavailableError('no binary', null);
        };
        const { isRustTransformAvailable } = await import('../src/transform-rust.js');
        expect(isRustTransformAvailable()).toBe(false);
    });

    it('passes the engine it was built against', async () => {
        engine.identity = () => ({ version: '0.18.0', digest: 'aaaaaaaaaaaaaaaa' });
        const { isRustTransformAvailable } = await import('../src/transform-rust.js');
        expect(isRustTransformAvailable()).toBe(true);
    });

    it('refuses an engine that does not export its identity, from before 0.18', async () => {
        engine.exportsIdentity = false;
        const { isRustTransformAvailable } = await import('../src/transform-rust.js');
        expect(isRustTransformAvailable).toThrow(
            'the native (@csszyx/core-linux-x64-gnu) engine, from a release before 0.18',
        );
        engine.exportsIdentity = true;
    });
});
