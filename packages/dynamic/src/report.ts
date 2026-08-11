/**
 * Did the build-time manifest pay for itself on THIS app?
 *
 * `csszyx-manifest.json` is a wager: transfer the whole class census once, so
 * `dynamic()` can skip injecting rules the built CSS already has. Whether that
 * wins depends on how much of an app runs through `dynamic()`, and no build-time
 * analysis can answer it — `dynamic()` exists for values unknown at build time,
 * so a static count is a lower bound that reads like an answer, and it is most
 * wrong for exactly the apps that use `dynamic()` most.
 *
 * Measured at runtime it is exact, and both halves are already tracked: the
 * manifest records which classes it answered, the injector records which ones it
 * had to generate. This weighs them.
 *
 * The rules for spared classes are generated only when the report is asked for,
 * which is the work the manifest avoided — so the measurement costs what it
 * measures, once, on request, and nothing in production.
 *
 * @module report
 */

import { generateCSSRule } from './css-generator.js';
import { injectedClasses } from './injector.js';
import { manifestSavings } from './manifest.js';

/** The manifest's cost and benefit for one session. */
export interface DynamicReport {
    /** Distinct classes `dynamic()` resolved: manifest hits plus injections. */
    asked: number;
    /** Classes answered from the manifest — injections it spared. */
    manifestHits: number;
    /** Classes the manifest could not answer, so a rule was injected. */
    injected: number;
    /**
     * Manifest transfer size in bytes, uncompressed, as received.
     *
     * Zero when no manifest was loaded. Re-serialized rather than read from a
     * response header, so treat it as within a few bytes rather than exact.
     */
    manifestBytes: number;
    /** Bytes of CSS the manifest spared, uncompressed. */
    sparedBytes: number;
    /** Bytes of CSS actually injected, uncompressed. */
    injectedBytes: number;
    /**
     * What the evidence supports.
     *
     * `'drop-manifest'` — it cost more than it spared here.
     * `'keep-manifest'` — it spared more than it cost.
     * `'no-manifest'` — none was loaded; `sparedBytes` is what one could have
     * saved at best, against a file whose size this session cannot know.
     * `'not-measured'` — `dynamic()` never ran, so there is nothing to weigh.
     */
    verdict: 'drop-manifest' | 'keep-manifest' | 'no-manifest' | 'not-measured';
    /** One sentence naming the next action, or why there is none. */
    summary: string;
}

/**
 * Total bytes of the CSS rules a class list would produce.
 *
 * @param classes - Class names.
 * @returns Byte length of their concatenated rules.
 */
function ruleBytes(classes: readonly string[]): number {
    let total = 0;
    for (const className of classes) total += generateCSSRule(className).length;
    return total;
}

/**
 * Weigh the manifest's transfer cost against the injections it spared.
 *
 * Call it after the app has exercised the paths that matter — the numbers cover
 * the classes `dynamic()` actually resolved, not the ones it might on a route
 * nobody visited.
 *
 * @returns The session's manifest accounting.
 *
 * @example
 * ```ts
 * import { dynamicReport } from '@csszyx/dynamic';
 * console.log(dynamicReport().summary);
 * ```
 */
export function dynamicReport(): DynamicReport {
    const { hits, bytes } = manifestSavings();
    const injected = injectedClasses();
    const sparedBytes = ruleBytes(hits);
    const injectedBytes = ruleBytes(injected);
    const asked = hits.length + injected.length;

    if (asked === 0) {
        return {
            asked: 0,
            manifestHits: 0,
            injected: 0,
            manifestBytes: bytes,
            sparedBytes: 0,
            injectedBytes: 0,
            verdict: 'not-measured',
            summary:
                'dynamic() has not resolved any class yet — exercise the app first, then ' +
                'call this again.',
        };
    }

    if (bytes === 0) {
        return {
            asked,
            manifestHits: hits.length,
            injected: injected.length,
            manifestBytes: 0,
            sparedBytes,
            injectedBytes,
            verdict: 'no-manifest',
            summary:
                `No manifest loaded. dynamic() injected ${injected.length} class(es), ` +
                `${injectedBytes} B of CSS. A manifest could have spared that, and would be ` +
                'worth it only if the file transfers for less — enable ' +
                'build.emitManifest and measure again to compare.',
        };
    }

    // Injections that happened DESPITE a loaded manifest are the tell for an
    // unawaited preload: the fetch is async and dynamic() is not, so a first
    // render can inject classes the manifest would have answered moments later.
    // The build then pays both costs, which is the worst of the three shapes.
    const lateArrival = hits.length > 0 && injected.length > 0;
    const worthIt = sparedBytes > bytes;
    const lateNote = lateArrival
        ? ` ${injected.length} class(es) were injected anyway, which usually means the first ` +
          'render ran before the manifest arrived — await preloadManifest() to get its full value.'
        : '';

    return {
        asked,
        manifestHits: hits.length,
        injected: injected.length,
        manifestBytes: bytes,
        sparedBytes,
        injectedBytes,
        verdict: worthIt ? 'keep-manifest' : 'drop-manifest',
        summary: worthIt
            ? `Manifest cost ${bytes} B and spared ${sparedBytes} B of injected CSS — keep ` +
              `build.emitManifest on.${lateNote}`
            : `Manifest cost ${bytes} B and spared only ${sparedBytes} B of injected CSS — set ` +
              `build.emitManifest to false.${lateNote}`,
    };
}
