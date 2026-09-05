/**
 * When the census earns its place in the document, and when it does not.
 *
 * The census maps every original class name to the token that replaced it. On
 * a build that renames nothing it maps nothing: the markup already carries the
 * readable names, and the tag is an inline `<script>` element in every page for
 * a lookup that would answer with an empty object. Organisations that inventory
 * script elements were carrying that item for a feature they had not turned on.
 *
 * So it follows the feature. And for the narrow case that does mangle and still
 * cannot ship the tag — an inventory process it must not appear in — there is a
 * switch, which is the only way to be rid of it while keeping mangling.
 */
import { describe, expect, it } from 'vitest';
import { injectHydrationData } from '../src/html-transformer.js';

const PAGE = '<!doctype html><html><head></head><body></body></html>';
const MAP = { 'p-4': 'z' };

describe('the census in the built document', () => {
    it('ships when the build renamed something', () => {
        const html = injectHydrationData(PAGE, MAP, 'sum');
        expect(html).toContain('__CSSZYX_MANGLE_MAP__');
        expect(html).toContain('data-sz-checksum="sum"');
    });

    // The checksum attribute stays either way: it is what the bundle is
    // compared against, and that guard does not read the census at all.
    it('does not ship when the caller says the build renamed nothing', () => {
        const html = injectHydrationData(PAGE, {}, 'sum', { census: false });
        expect(html).not.toContain('__CSSZYX_MANGLE_MAP__');
        expect(html).toContain('data-sz-checksum="sum"');
    });
});

/**
 * Variable mangling is its own switch, and the dev server keeps it while it
 * turns class mangling off — dev CSS carries readable class names, so a class
 * map would encode to tokens no dev rule matches, but `--_sz-p` really does
 * become `--cz` in the served CSS. A census gated on class mangling alone
 * therefore disappeared from a page whose variables WERE renamed, and the
 * lookup that reads it back had nothing to answer with.
 *
 * So the question is not which feature is on. It is whether this build renamed
 * anything at all.
 */
describe('the census follows the renaming, not one feature', () => {
    it('ships for a build that renamed only variables', () => {
        const html = injectHydrationData(PAGE, {}, 'sum', {
            varMangleMap: { '--_sz-p': '--cz' },
        });
        expect(html).toContain('__CSSZYX_MANGLE_MAP__');
        expect(html).toContain('--cz');
    });
});
