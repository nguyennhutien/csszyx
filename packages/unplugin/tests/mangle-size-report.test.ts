/**
 * Unit net for the build-end mangle size accounting.
 *
 * The advisory exists to contradict an assumption ("mangling shrinks my
 * bundle"), so it has to be right about the sign and quiet when it has nothing
 * to add. These tests pin both.
 */
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
    computeMangleSizeVerdict,
    createMangleSizeAccount,
    gzipBytes,
    type MangleSizeAccount,
    mangleSizeMessage,
    recordCssPair,
} from '../src/mangle-size-report.js';

/**
 * Build an account with the given gzipped CSS totals and channels.
 *
 * @param before - Gzipped bytes before mangling.
 * @param after - Gzipped bytes after mangling.
 * @param channels - Channels that shipped the map.
 * @returns Prepared account.
 */
function account(
    before: number,
    after: number,
    channels: Array<'html' | 'bundle'> = ['html'],
): MangleSizeAccount {
    return { cssGzBefore: before, cssGzAfter: after, channels: new Set(channels) };
}

describe('gzipBytes', () => {
    it('measures real gzip output', () => {
        const text = 'bg-red-500 '.repeat(200);
        expect(gzipBytes(text)).toBe(gzipSync(Buffer.from(text, 'utf8')).length);
    });

    it('treats empty input as free', () => {
        // An empty asset must not be charged the ~20 B gzip envelope, or a
        // build with several empty CSS chunks would drift off a real zero.
        expect(gzipBytes('')).toBe(0);
    });
});

describe('recordCssPair', () => {
    it('accumulates across multiple assets', () => {
        const acc = createMangleSizeAccount();
        recordCssPair(acc, '.aaaaaaaa{color:red}', '.z{color:red}');
        const afterFirst = { before: acc.cssGzBefore, after: acc.cssGzAfter };
        recordCssPair(acc, '.bbbbbbbb{color:blue}', '.y{color:blue}');

        expect(acc.cssGzBefore).toBeGreaterThan(afterFirst.before);
        expect(acc.cssGzAfter).toBeGreaterThan(afterFirst.after);
    });

    it('counts an unchanged asset identically on both sides', () => {
        // A skipped asset (nothing matched, or a syntax error bailed the pass)
        // must contribute zero delta rather than noise in either direction.
        const acc = createMangleSizeAccount();
        const css = '.untouched{color:red}';
        recordCssPair(acc, css, css);

        expect(acc.cssGzBefore).toBe(acc.cssGzAfter);
        expect(acc.cssGzBefore).toBeGreaterThan(0);
    });

    it('records a negative delta when mangling grew the CSS', () => {
        // Measured on real builds: short high-entropy tokens can compress worse
        // than the repetitive names they replaced, so `after` may exceed
        // `before` even though the raw text got shorter.
        const acc = createMangleSizeAccount();
        const before = Array.from({ length: 60 }, (_, i) => `.bg-red-${i}00{color:red}`).join('');
        const after = Array.from({ length: 60 }, (_, i) => `.q${i}x{color:red}`).join('');
        recordCssPair(acc, before, after);

        expect(before.length).toBeGreaterThan(after.length);
        const verdict = computeMangleSizeVerdict(acc, '{}');
        expect(verdict.cssSaving).toBeLessThan(before.length - after.length);
    });
});

describe('computeMangleSizeVerdict', () => {
    it('charges the map once per channel that shipped it', () => {
        const payload = JSON.stringify({ 'bg-red-500': 'z', 'text-sm': 'y' });
        const one = computeMangleSizeVerdict(account(1000, 900, ['html']), payload);
        const two = computeMangleSizeVerdict(account(1000, 900, ['html', 'bundle']), payload);

        expect(two.mapCost).toBe(one.mapCost * 2);
        expect(two.net).toBeGreaterThan(one.net);
    });

    it('reports channels sorted and deduplicated', () => {
        const verdict = computeMangleSizeVerdict(account(10, 10, ['html', 'bundle']), '{}');
        expect(verdict.channels).toEqual(['bundle', 'html']);
    });

    it('nets the map cost against the CSS saving', () => {
        const verdict = computeMangleSizeVerdict(account(5000, 4000, ['html']), '{}');
        expect(verdict.cssSaving).toBe(1000);
        expect(verdict.net).toBe(verdict.mapCost - 1000);
    });
});

describe('mangleSizeMessage', () => {
    const bigPayload = JSON.stringify(
        Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`utility-name-${i}`, `t${i}`])),
    );

    it('warns with the measured numbers when mangling costs bytes', () => {
        const verdict = computeMangleSizeVerdict(account(5000, 4990, ['html']), bigPayload);
        const message = mangleSizeMessage(verdict);

        expect(message).toContain('BIGGER');
        expect(message).toContain(`+${verdict.net} B gzipped`);
        expect(message).toContain(`${verdict.mapCost} B`);
        expect(message).toContain('production.mangle: false');
    });

    it('stays silent when mangling broke even or won', () => {
        // Saving exactly equals the cost → net 0 → nothing to advise.
        const verdict = computeMangleSizeVerdict(account(5000, 4000, ['html']), '{}');
        const breakEven = { ...verdict, net: 0 };
        expect(mangleSizeMessage(breakEven)).toBeNull();
        expect(mangleSizeMessage({ ...verdict, net: -50 })).toBeNull();
    });

    it('stays silent when no channel shipped a map', () => {
        // Mangling off, or a lane that delivers no map at all: there is no cost
        // to report even though the accumulator may hold CSS sizes.
        const verdict = computeMangleSizeVerdict(account(5000, 4990, []), bigPayload);
        expect(verdict.mapCost).toBe(0);
        expect(mangleSizeMessage(verdict)).toBeNull();
    });

    it('names the CSS as a cost when mangling grew it', () => {
        const verdict = computeMangleSizeVerdict(account(4000, 4200, ['html']), bigPayload);
        const message = mangleSizeMessage(verdict);

        expect(message).toContain('the mangled CSS COSTS 200 B');
        expect(message).toContain('compress worse');
    });

    it('spells out both channels when the map shipped twice', () => {
        const verdict = computeMangleSizeVerdict(
            account(5000, 4990, ['html', 'bundle']),
            bigPayload,
        );
        expect(mangleSizeMessage(verdict)).toContain('bundle + html (2 copies)');
    });

    it('points at the delivery knob as the cheaper fix', () => {
        const verdict = computeMangleSizeVerdict(
            account(5000, 4990, ['html', 'bundle']),
            bigPayload,
        );
        expect(mangleSizeMessage(verdict)).toContain('mangleMapDelivery');
    });
});
