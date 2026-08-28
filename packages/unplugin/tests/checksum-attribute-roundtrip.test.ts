// @vitest-environment jsdom
/**
 * The checksum attribute, written by the build and read by the runtime.
 *
 * A consumer reported that a mangled production build emits
 * `data-sz-cs` while every runtime read asks for `data-sz-checksum`. Both
 * halves had tests and both passed: the writer suite asserted the short name,
 * the runtime suite set the long one by hand. Nothing put the two together,
 * so the contract between them could drift with no test going red.
 *
 * These cases run the real writer, parse what it produced, and hand it to the
 * real reader. `minify` is on by default in production, so the short name is
 * the shipped path, not an exotic one.
 */

import { verifyMangleChecksum } from '@csszyx/runtime';
import { describe, expect, it } from 'vitest';
import { injectChecksum } from '../src/html-transformer.js';

const CHECKSUM = '4828a09e332125e0';
const BARE_HTML = '<html lang="en"><head></head><body></body></html>';

/**
 * Put the build's own output into the live document, attributes and all.
 *
 * @param html - HTML as the build emitted it.
 */
function loadIntoDocument(html: string): void {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    for (const attribute of Array.from(parsed.documentElement.attributes)) {
        document.documentElement.setAttribute(attribute.name, attribute.value);
    }
}

describe('checksum attribute round-trip', () => {
    it.each([
        ['minified, the production default', true],
        ['unminified', false],
    ])('the runtime reads what the build wrote — %s', (_label, minify) => {
        loadIntoDocument(injectChecksum(BARE_HTML, CHECKSUM, minify));

        expect(verifyMangleChecksum(CHECKSUM)).toBe(true);
        expect(verifyMangleChecksum('0000000000000000')).toBe(false);
    });
});
