/**
 * The availability probe runs the binding once per process when it answers.
 *
 * `ensureRustTransformAvailable` guards every module transform on the explicit
 * `rust` lane, and the probe it runs is a real one-module transform. A binding
 * cannot turn stale mid-process, so after one good answer the probe has nothing
 * left to learn; a failure is not remembered, so the error keeps its detail.
 */
import { beforeEach, expect, it, vi } from 'vitest';

const binding = vi.hoisted(() => ({ calls: 0, fail: false }));

class FakeUnavailable extends Error {
    detail = 'stale';
}

vi.mock('@csszyx/core/native', () => ({
    CsszyxNativeUnavailableError: FakeUnavailable,
    transformBatch: () => {
        binding.calls++;
        if (binding.fail) throw new FakeUnavailable('stale');
        return [];
    },
    scanModuleLinks: () => [],
}));

beforeEach(() => {
    vi.resetModules();
    binding.calls = 0;
    binding.fail = false;
});

it('probes the binding once after it answers', async () => {
    const { ensureRustTransformAvailable } = await import('../src/transform-rust.js');
    ensureRustTransformAvailable();
    ensureRustTransformAvailable();
    ensureRustTransformAvailable();
    expect(binding.calls).toBe(1);
});

it('probes again after a failure, so each call reports it', async () => {
    binding.fail = true;
    const { ensureRustTransformAvailable, OxcRustNotImplementedError } = await import(
        '../src/transform-rust.js'
    );
    expect(() => ensureRustTransformAvailable()).toThrow(OxcRustNotImplementedError);
    expect(() => ensureRustTransformAvailable()).toThrow(OxcRustNotImplementedError);
    expect(binding.calls).toBe(2);
});
