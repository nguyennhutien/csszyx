import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeMangleChecksumAsync, verifyMangleChecksumAsync } from '../src/hydration.js';

/** Independent reference implementation of the Rust `compute_checksum_internal`. */
function referenceChecksum(map: Record<string, string>): string {
    const canonical = Object.keys(map)
        .sort()
        .map(k => `${k}:${map[k]}`)
        .join('|');
    return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

describe('computeMangleChecksumAsync', () => {
    it('matches an independent SHA-256 implementation (byte parity)', async () => {
        const map = { 'bg-red-500': 'a', 'p-4': 'b', flex: 'c' };
        expect(await computeMangleChecksumAsync(map)).toBe(referenceChecksum(map));
    });

    it('reproduces the known Rust algorithm output for a fixed map', async () => {
        // SHA-256("a:b") → first 16 hex chars, the documented Rust format.
        expect(await computeMangleChecksumAsync({ a: 'b' })).toBe('6783a31eabf68ccc');
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
