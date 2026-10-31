/**
 * One SHA-256 per text a process holds.
 *
 * The prescan and the transform hash the same source for the transform
 * cache, the diagnostic limiter, the authored-class memo and the source-hook
 * memo. The digest is a function of the text alone, so it is kept by the text
 * itself, never by path or modification time, and every reader gets the bytes
 * `createHash` would give.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { keptTexts, sha256Of } from '../src/content-digest.js';

describe('sha256Of', () => {
    it('gives the digest createHash gives, in both encodings', () => {
        for (const text of ['', 'export const A = 1;\n', 'é \u{1F389} \uD800']) {
            const expected = createHash('sha256').update(text).digest();
            expect(sha256Of(text).hex).toBe(expected.toString('hex'));
            expect(sha256Of(text).base64).toBe(expected.toString('base64'));
        }
    });

    it('answers a text it has seen from memory, and a changed text afresh', () => {
        const first = sha256Of('const a = 1;');
        expect(sha256Of('const a = 1;')).toBe(first);
        expect(sha256Of('const a = 2;').hex).not.toBe(first.hex);
    });

    it('keeps at most two generations however often the texts it has are asked again', () => {
        const texts = Array.from({ length: 12_000 }, (_, index) => `const k${index} = ${index};`);
        for (let round = 0; round < 3; round++) for (const text of texts) sha256Of(text);
        expect(keptTexts().texts).toBeLessThanOrEqual(2 * 8192);
    });

    it('keeps at most two generations of source by length, however few texts it holds', () => {
        const large = 'x'.repeat(1 << 20);
        for (let index = 0; index < 64; index++) sha256Of(`${index}${large}`);
        // A generation closes once it reaches its length, so it may pass it by
        // the one text that reached it.
        expect(keptTexts().characters).toBeLessThanOrEqual(2 * (16 << 20) + large.length + 2);
    });

    it('still answers right after more texts than it keeps', () => {
        const texts = Array.from({ length: 20_000 }, (_, index) => `const v${index} = ${index};`);
        for (const text of texts) sha256Of(text);
        for (const text of [texts[0] as string, texts[19_999] as string]) {
            expect(sha256Of(text).hex).toBe(createHash('sha256').update(text).digest('hex'));
        }
    });
});
