import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeMangleChecksumAsync, verifyMangleChecksumAsync } from '../src/hydration.js';

/**
 * The canonical form spelled out again, by hand, over Node's own SHA-256.
 *
 * Deliberately a second implementation rather than a call into the one under
 * test: it is only worth something as a check while it is written
 * independently. It sorts with plain `<`, so it agrees with the real thing on
 * every name inside the basic plane and is not used for the cases that leave
 * it — those compare against the Rust core instead.
 *
 * @param map - the mangle map to fingerprint.
 * @returns the 16-character checksum.
 */
function referenceChecksum(map: Record<string, string>): string {
    const canonical = Object.keys(map)
        .sort()
        .map(k => `${k.length}:${k}:${(map[k] as string).length}:${map[k]}`)
        .join('|');
    return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

describe('computeMangleChecksumAsync', () => {
    it('matches an independent SHA-256 implementation (byte parity)', async () => {
        const map = { 'bg-red-500': 'a', 'p-4': 'b', flex: 'c' };
        expect(await computeMangleChecksumAsync(map)).toBe(referenceChecksum(map));
    });

    it('reproduces the known Rust algorithm output for a fixed map', async () => {
        // SHA-256("1:a:1:b") → first 16 hex chars: each field carries its
        // length so a name holding a colon cannot be read two ways. Taken from
        // the Rust core, which is the side that defines the form.
        expect(await computeMangleChecksumAsync({ a: 'b' })).toBe('95dd1eb0a569dbd2');
    });

    it('is order-independent (entries are sorted by key)', async () => {
        const a = await computeMangleChecksumAsync({ x: '1', y: '2' });
        const b = await computeMangleChecksumAsync({ y: '2', x: '1' });
        expect(a).toBe(b);
    });

    it('changes when a mapping changes (detects drift)', async () => {
        const a = await computeMangleChecksumAsync({ 'p-4': 'a' });
        const b = await computeMangleChecksumAsync({ 'p-4': 'b' });
        expect(a).not.toBe(b);
    });
});

describe('key ordering, which has to match the Rust core byte for byte', () => {
    it('orders a key that is a prefix of another before it', async () => {
        // Exercises the tail of the byte comparison: the shared bytes run out
        // and length decides. `p` sorts before `p-4`, which sorts before `p-40`.
        const map = { 'p-40': 'c', p: 'a', 'p-4': 'b' };
        expect(await computeMangleChecksumAsync(map)).toBe(referenceChecksum(map));
    });

    it('orders by UTF-8 bytes, not UTF-16 units, once a key leaves the basic plane', async () => {
        // JavaScript's `<` puts the emoji first; UTF-8 bytes put U+E000 first,
        // and UTF-8 is what the Rust core compares. Hard-coded because the
        // JavaScript reference above sorts the way this case exists to reject;
        // the value is what the Rust core derives from these same two keys.
        const map = { 'after:content-["\u{1F389}"]': 'a', 'after:content-["\uE000"]': 'b' };
        expect(await computeMangleChecksumAsync(map)).toBe('5bc13806268685f8');
    });
});

describe('names that carry the characters the canonical form separates on', () => {
    it('tells a colon in a name apart from a colon in a value', async () => {
        // Every variant class is a name with a colon in it, so this is the
        // common shape rather than a contrived one.
        const nameHasIt = await computeMangleChecksumAsync({ 'a:b': 'c' });
        const valueHasIt = await computeMangleChecksumAsync({ a: 'b:c' });
        expect(nameHasIt).not.toBe(valueHasIt);
    });

    it('tells a pipe in a name apart from two entries', async () => {
        const nameHasIt = await computeMangleChecksumAsync({ 'a|b': 'c' });
        const twoEntries = await computeMangleChecksumAsync({ a: 'b', c: 'd' });
        expect(nameHasIt).not.toBe(twoEntries);
    });

    it('still fingerprints a real variant class, the same way twice', async () => {
        const map = { 'hover:bg-red-500': 'a', 'md:focus:ring-2': 'b' };
        const once = await computeMangleChecksumAsync(map);
        expect(once).toHaveLength(16);
        expect(await computeMangleChecksumAsync(map)).toBe(once);
    });
});

describe('verifyMangleChecksumAsync', () => {
    it('returns true for a matching checksum and false for a tampered map', async () => {
        const map = { 'p-4': 'a', 'm-2': 'b' };
        const good = await computeMangleChecksumAsync(map);
        expect(await verifyMangleChecksumAsync(good, map)).toBe(true);
        // An attacker edits the map but cannot leave the old checksum matching.
        const tampered = { ...map, 'm-2': 'evil' };
        expect(await verifyMangleChecksumAsync(good, tampered)).toBe(false);
    });

    it('returns false when no map is available', async () => {
        expect(await verifyMangleChecksumAsync('whatever')).toBe(false);
    });
});

/**
 * Web Crypto is a secure-context API: `crypto.subtle` is undefined over plain
 * HTTP on anything but localhost. An intranet deployment served that way is a
 * real place for this code to run, and an unguarded `crypto.subtle.digest`
 * there throws a TypeError that names nothing and reaches the caller as a
 * rejected promise rather than an answer.
 */
describe('without Web Crypto, which is what an insecure context looks like', () => {
    const MAP = { 'p-4': 'a' };

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each([
        ['crypto.subtle is missing', { subtle: undefined }],
        ['crypto itself is missing', undefined],
    ])('says why it cannot compute when %s', async (_label, stub) => {
        vi.stubGlobal('crypto', stub);

        await expect(computeMangleChecksumAsync(MAP)).rejects.toThrow(/secure context/i);
    });

    it('fails closed instead of rejecting, and says the check did not happen', async () => {
        vi.stubGlobal('crypto', { subtle: undefined });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        await expect(verifyMangleChecksumAsync('whatever', MAP)).resolves.toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toMatch(/secure context/i);
    });

    it('does not report a false match when the checksum would have been right', async () => {
        const real = await computeMangleChecksumAsync(MAP);
        vi.stubGlobal('crypto', { subtle: undefined });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        await expect(verifyMangleChecksumAsync(real, MAP)).resolves.toBe(false);
    });
});
