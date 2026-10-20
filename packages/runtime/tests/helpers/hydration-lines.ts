/**
 * The lines the hydration and integrity checks print in development, spelled
 * out from the registry's words so a suite pins the bytes the user reads.
 *
 * NOT a `.test.ts` file on purpose: vitest must not collect it as a suite.
 */
import { runtimeMessage } from '../../../compiler/tests/engine-message.js';

/** The advice the page-integrity lines share. */
const SERVE_AS_BUILT = 'serve the HTML as the build wrote it';

/**
 * `mangle-checksum-mismatch`: a map that hashes to another checksum.
 *
 * @param computed - What the map hashes to.
 * @param expected - The checksum it was built with.
 * @returns The line.
 */
export function checksumMismatchLine(computed: string, expected: string): string {
    return runtimeMessage(
        'mangle-checksum-mismatch',
        `The mangle map on this page hashes to \`${computed}\`, and the checksum it was built with is \`${expected}\`, so the check fails.`,
        'help: deploy the HTML and the bundle from one build.',
        'note: this detects a damaged or stale page, not an attacker; the checksum is not signed.',
    );
}

/**
 * `mangle-map-unavailable`: a checksum with no map to recompute it from.
 *
 * @param checksum - The checksum the page carries.
 * @returns The line.
 */
export function mapUnavailableLine(checksum: string): string {
    return runtimeMessage(
        'mangle-map-unavailable',
        `This page carries the checksum \`${checksum}\` but neither a census nor a bundled mangle map to recompute it from, so nothing was verified.`,
        'help: turn `production.hydrationCensus` on when the build sets `production.mangleVars` without `production.mangle`, which ships no map; otherwise, load the bundle that registers the map on this page.',
    );
}

/** `mangle-census-unreadable`: a census the page carries but nothing can read. */
export const CENSUS_UNREADABLE_LINE = runtimeMessage(
    'mangle-census-unreadable',
    'The mangle census on this page is not a valid map, so nothing was verified.',
    `help: ${SERVE_AS_BUILT}; a census that does not read means the page was changed or cut short after the build.`,
);

/** `web-crypto-unavailable`: no Web Crypto, so nothing was verified. */
export const WEB_CRYPTO_LINE = runtimeMessage(
    'web-crypto-unavailable',
    'Web Crypto is unavailable, so the mangle checksum cannot be recomputed and nothing was verified.',
    'help: serve the page over HTTPS, or from `localhost`.',
    'note: `crypto.subtle` exists only in a secure context.',
);

/**
 * `mangle-map-unreadable`: a map on the page that is not a plain map.
 *
 * @param error - The parser's message, for the JSON form; absent for the schema form.
 * @returns The line.
 */
export function mangleMapUnreadableLine(error?: string): string {
    const help = `help: ${SERVE_AS_BUILT}; a map that does not read means the page was changed or cut short after the build.`;
    return error === undefined
        ? runtimeMessage(
              'mangle-map-unreadable',
              'The mangle map on this page is not a plain map of class names to class names, so it is ignored.',
              help,
          )
        : runtimeMessage(
              'mangle-map-unreadable',
              'The mangle map on this page is not valid JSON, so it is ignored.',
              help,
              `note: the browser reported: ${error}.`,
          );
}

/**
 * `recovery-manifest-unreadable`, JSON form: a manifest that does not parse.
 *
 * @param error - The parser's message.
 * @returns The line.
 */
export function manifestUnreadableLine(error: string): string {
    return runtimeMessage(
        'recovery-manifest-unreadable',
        'The recovery manifest on this page is not valid JSON, so it is ignored.',
        `help: ${SERVE_AS_BUILT}; the manifest is the \`__SZ_RECOVERY_MANIFEST__\` script the build adds to the page.`,
        `note: the browser reported: ${error}.`,
    );
}

/**
 * The message `JSON.parse` throws for a text, as the lines quote it.
 *
 * @param text - Text that does not parse.
 * @returns The parser's message.
 */
export function jsonErrorOf(text: string): string {
    try {
        JSON.parse(text);
    } catch (error) {
        return (error as Error).message;
    }
    throw new Error(`${JSON.stringify(text)} parses`);
}
