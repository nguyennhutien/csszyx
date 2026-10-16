/**
 * The helpers only the csszyx packages use live on `@csszyx/compiler/internal`,
 * not on the root: a root export is a public API, and the adapters' markup
 * reader and template lane change shape with the adapters.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import * as root from '../src/index.js';
import * as internal from '../src/internal.js';

const INTERNAL_ONLY = [
    'braceGroupEnd',
    'findEmittedClassName',
    'isOpeningTag',
    'isParserMode',
    'markupResume',
    'rawTextEnd',
    'readMarkup',
    'reportTemplateSzDiagnostics',
    'resolveParserMode',
    'rewriteTemplateSz',
    'transformTemplateFile',
];

describe('@csszyx/compiler/internal', () => {
    it.each(INTERNAL_ONLY)('exports %s there and not on the root', name => {
        expect(internal).toHaveProperty(name);
        expect(root).not.toHaveProperty(name);
    });

    it('is a subpath of the published package', () => {
        const manifest = JSON.parse(
            readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
        ) as { exports: Record<string, { import: { default: string } }> };
        expect(manifest.exports['./internal'].import.default).toBe('./dist/internal.mjs');
    });
});
