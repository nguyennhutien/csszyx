/**
 * Build-end accounting for what class mangling actually costs a build.
 *
 * Mangling is an obfuscation feature, but it is easy to enable expecting a
 * smaller payload. Over a compressed response it usually is not: utility class
 * names repeat and share long prefixes, which is exactly the redundancy the
 * compressor exploits, while the mangle map is a list of unique pairs that
 * barely compresses at all. Shortening the names therefore trades cheap bytes
 * for expensive ones. This module measures that trade on the parts the build
 * can weigh exactly — the emitted CSS and the map payload — so the build can
 * say so instead of leaving the assumption unchallenged.
 *
 * @module mangle-size-report
 */

import { gzipSync } from 'node:zlib';
import { sortStrings } from './sort.js';

/** Channels that actually carried the mangle map in a finished build. */
export type MangleMapChannel = 'html' | 'bundle';

/** Running totals accumulated while output assets are rewritten. */
export interface MangleSizeAccount {
    /** Gzipped bytes of every CSS asset before class mangling. */
    cssGzBefore: number;
    /** Gzipped bytes of the same assets after class mangling. */
    cssGzAfter: number;
    /** Channels observed to have shipped the map. */
    channels: Set<MangleMapChannel>;
}

/**
 * Create an empty accumulator.
 *
 * @returns Zeroed size account.
 */
export function createMangleSizeAccount(): MangleSizeAccount {
    return { cssGzBefore: 0, cssGzAfter: 0, channels: new Set() };
}

/**
 * Zero an accumulator in place, keeping its identity.
 *
 * A watch rebuild starts a fresh output pass over the same closure-held
 * account; without the reset the CSS totals accumulate monotonically across
 * rebuilds, driving the verdict negative and silencing the advisory from the
 * second rebuild on.
 *
 * @param account - The account to zero.
 */
export function resetMangleSizeAccount(account: MangleSizeAccount): void {
    account.cssGzBefore = 0;
    account.cssGzAfter = 0;
    account.channels.clear();
}

/**
 * Gzipped size of a string, at the level a CDN would realistically serve.
 *
 * Level 6 (zlib's default) rather than 9: the verdict is a comparison between
 * two sides measured the same way, and level 9 costs build time for a ratio
 * that barely moves.
 *
 * @param text - Content to weigh.
 * @returns Gzipped byte length.
 */
export function gzipBytes(text: string): number {
    if (text.length === 0) return 0;
    return gzipSync(Buffer.from(text, 'utf8')).length;
}

/**
 * Record one CSS asset's before/after pair.
 *
 * @param account - Accumulator to update.
 * @param before - CSS before class mangling.
 * @param after - CSS after class mangling.
 */
export function recordCssPair(account: MangleSizeAccount, before: string, after: string): void {
    // Identical strings mean the pass made no change (nothing matched, or the
    // asset was skipped after a syntax error) — weigh it once and count it on
    // both sides so it cannot skew the delta.
    if (before === after) {
        const bytes = gzipBytes(before);
        account.cssGzBefore += bytes;
        account.cssGzAfter += bytes;
        return;
    }
    account.cssGzBefore += gzipBytes(before);
    account.cssGzAfter += gzipBytes(after);
}

/** Verdict describing what mangling cost or saved on the measurable surfaces. */
export interface MangleSizeVerdict {
    /** Gzipped bytes the map added, summed over the channels that shipped it. */
    mapCost: number;
    /** Gzipped bytes the mangled CSS saved. Negative when mangling grew the CSS. */
    cssSaving: number;
    /** `mapCost - cssSaving`. Positive means mangling made the build bigger. */
    net: number;
    /** Channels the map shipped through. */
    channels: MangleMapChannel[];
}

/**
 * Weigh the map against the CSS it bought.
 *
 * @param account - Accumulated CSS sizes and observed channels.
 * @param mapPayload - Serialized map exactly as delivered to the browser.
 * @returns The measured trade.
 */
export function computeMangleSizeVerdict(
    account: MangleSizeAccount,
    mapPayload: string,
): MangleSizeVerdict {
    const channels = sortStrings(account.channels);
    const mapCost = gzipBytes(mapPayload) * channels.length;
    const cssSaving = account.cssGzBefore - account.cssGzAfter;
    return { mapCost, cssSaving, net: mapCost - cssSaving, channels };
}

/**
 * Build the advisory shown when mangling made the build bigger.
 *
 * Returns null when mangling broke even or came out ahead — a build that got
 * what it paid for needs no advice. Silent when nothing was mangled at all.
 *
 * @param verdict - Measured trade from {@link computeMangleSizeVerdict}.
 * @returns Warning text, or null when there is nothing worth saying.
 */
export function mangleSizeMessage(verdict: MangleSizeVerdict): string | null {
    if (verdict.channels.length === 0) return null;
    if (verdict.net <= 0) return null;
    const cssPart =
        verdict.cssSaving >= 0
            ? `the mangled CSS saves ${verdict.cssSaving} B`
            : `the mangled CSS COSTS ${-verdict.cssSaving} B (short tokens compress worse than the names they replaced)`;
    const channelPart =
        verdict.channels.length > 1
            ? `${verdict.channels.join(' + ')} (${verdict.channels.length} copies)`
            : verdict.channels[0];
    return (
        `[csszyx] production.mangle is making this build BIGGER: +${verdict.net} B gzipped. ` +
        `The runtime mangle map costs ${verdict.mapCost} B via ${channelPart}, while ${cssPart}. ` +
        'Mangling is a name-obfuscation feature; over a compressed response it does not reduce ' +
        'payload, because utility class names compress far better than the map they need. ' +
        'If you enabled it for size, set `production.mangle: false`. If you enabled it to hide ' +
        'class names, this is the expected price and you can ignore this. ' +
        'Narrowing `production.mangleMapDelivery` removes a map copy when only one channel is needed. ' +
        '(Measured on CSS and the map; class shortening inside JS chunks is not counted, so the ' +
        'real net is slightly better than this figure.)'
    );
}
