/**
 * A framework's parser is loaded from the adapter that needs it, once, and a
 * missing install is named with what to install; any other failure of the
 * peer is its own and passes through.
 */
import { describe, expect, it } from 'vitest';

import { requirePeer } from '../src/peer-module.js';

const from = new URL('./fixtures/peer/', import.meta.url).href;
const peer = (request: string) =>
    requirePeer<{ loads: number }>({
        from,
        request,
        requiredBy: '@csszyx/test-adapter',
        install: 'framework@5',
    });

describe('requirePeer', () => {
    it('names the package to install when the request does not resolve', () => {
        expect(() => peer('no-such-framework/compiler')).toThrow(
            '[csszyx] @csszyx/test-adapter reads templates with `no-such-framework/compiler`, which does not resolve from it\nhelp: install framework@5 in the project',
        );
    });

    it("passes the peer's own failure through", () => {
        expect(() => peer('./broken.cjs')).toThrow(/does-not-exist\.cjs/);
    });

    it('loads a peer once', () => {
        expect(peer('./counter.cjs')).toBe(peer('./counter.cjs'));
        expect(peer('./counter.cjs').loads).toBe(1);
    });
});
