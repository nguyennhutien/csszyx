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
    /** Gzipped bytes of every code asset before class mangling. */
    codeGzBefore: number;
    /** Gzipped bytes of the same code assets after class mangling. */
    codeGzAfter: number;
    /** Channels observed to have shipped the map. */
    channels: Set<MangleMapChannel>;
}

/**
 * Create an empty accumulator.
 *
 * @returns Zeroed size account.
 */
export function createMangleSizeAccount(): MangleSizeAccount {
    return { cssGzBefore: 0, cssGzAfter: 0, codeGzBefore: 0, codeGzAfter: 0, channels: new Set() };
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
    account.codeGzBefore = 0;
    account.codeGzAfter = 0;
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

/**
 * Record one code asset's before/after pair.
 *
 * Shortening class strings inside JS chunks is a real saving that this report
 * used to disclaim instead of measure — the note that "the real net is slightly
 * better" was carrying too much weight. Measured on a consumer's build the
 * uncounted share was about 1.3 kB of a 3.4 kB verdict, so the advice to turn
 * the feature off was argued from a cost roughly 39% larger than the real one.
 *
 * Both sides must arrive with the mangle-map placeholder already substituted:
 * the map's bytes are charged once as `mapCost`, and letting them differ across
 * the pair would bill the same payload twice.
 *
 * @param account - Accumulator to update.
 * @param before - Code before class mangling, map substituted.
 * @param after - Code after class mangling, map substituted.
 */
export function recordCodePair(account: MangleSizeAccount, before: string, after: string): void {
    // Same reasoning as the CSS pair: an unchanged asset is weighed once and
    // counted on both sides so it cannot skew the delta.
    if (before === after) {
        const bytes = gzipBytes(before);
        account.codeGzBefore += bytes;
        account.codeGzAfter += bytes;
        return;
    }
    account.codeGzBefore += gzipBytes(before);
    account.codeGzAfter += gzipBytes(after);
}

/** Verdict describing what mangling cost or saved on the measurable surfaces. */
export interface MangleSizeVerdict {
    /** Gzipped bytes the map added, summed over the channels that shipped it. */
    mapCost: number;
    /** Gzipped bytes the mangled CSS saved. Negative when mangling grew the CSS. */
    cssSaving: number;
    /** Gzipped bytes the shortened classes in code assets saved. */
    codeSaving: number;
    /** `mapCost - cssSaving - codeSaving`. Positive means mangling made the build bigger. */
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
    const codeSaving = account.codeGzBefore - account.codeGzAfter;
    return { mapCost, cssSaving, codeSaving, net: mapCost - cssSaving - codeSaving, channels };
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
    const codePart =
        verdict.codeSaving >= 0
            ? `the shortened classes in code save ${verdict.codeSaving} B`
            : `the shortened classes in code COST ${-verdict.codeSaving} B`;
    const channelPart =
        verdict.channels.length > 1
            ? `${verdict.channels.join(' + ')} (${verdict.channels.length} copies)`
            : verdict.channels[0];
    return (
        `[csszyx] production.mangle is making this build BIGGER: +${verdict.net} B gzipped. ` +
        `The runtime mangle map costs ${verdict.mapCost} B via ${channelPart}, while ${cssPart} ` +
        `and ${codePart}. ` +
        'Mangling is a name-obfuscation feature; over a compressed response it does not reduce ' +
        'payload, because utility class names compress far better than the map they need. ' +
        'If you enabled it for size, set `production.mangle: false`. If you enabled it to hide ' +
        'class names, this is the expected price and you can ignore this. ' +
        'Two copies is not a misconfiguration: the bundle carries the map the runtime reads, and ' +
        'the HTML carries the same census for the hydration checksum.'
    );
}
