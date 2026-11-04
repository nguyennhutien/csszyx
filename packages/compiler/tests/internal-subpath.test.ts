/**
 * The helpers only the csszyx packages use live on `@csszyx/compiler/internal`,
 * not on the root: a root export is a public API, and the adapters' markup
 * reader and template lane change shape with the adapters. What only a
 * template adapter uses lives on `@csszyx/compiler/template`, so a build with
 * no template file never loads it, nor the source-map writer it needs.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import * as root from '../src/index.js';
import * as internal from '../src/internal.js';
import * as template from '../src/template.js';

const INTERNAL_ONLY = ['findEmittedClassName', 'isParserMode', 'resolveParserMode'];

const TEMPLATE_ONLY = [
    'mayHoldSzAttribute',
    'placeTemplateDiagnostic',
    'reportTemplateSzDiagnostics',
    'requirePeer',
    'rewriteTemplateSz',
    'transformTemplateFile',
];

/** The published package's export map. */
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    exports: Record<string, { default: string }>;
};

describe('@csszyx/compiler/internal', () => {
    it.each(INTERNAL_ONLY)('exports %s there and not on the root', name => {
        expect(internal).toHaveProperty(name);
        expect(root).not.toHaveProperty(name);
    });

    it('is a subpath of the published package', () => {
        expect(manifest.exports['./internal'].default).toBe('./dist/internal.mjs');
    });
});

describe('@csszyx/compiler/template', () => {
    it.each(TEMPLATE_ONLY)('exports %s there, and not on internal or the root', name => {
        expect(template).toHaveProperty(name);
        expect(internal).not.toHaveProperty(name);
        expect(root).not.toHaveProperty(name);
    });

    it('is a subpath of the published package', () => {
        expect(manifest.exports['./template'].default).toBe('./dist/template.mjs');
    });
});
