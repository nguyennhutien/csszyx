import { join } from 'node:path';

import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { collectAuthoredClassNames } from '../src/authored-class-scanner.js';
import { escapeCSSClassName, unescapeTailwindClass } from '../src/css-mangler.js';
import { matchesAnyPattern, matchesPattern } from '../src/file-patterns.js';
import { scanGlobalVarCss } from '../src/global-var-css-scan.js';
import { buildScopeId, nodeLocation } from '../src/global-var-postcss.js';
import { injectChecksum } from '../src/html-transformer.js';
import { mangleSizeMessage } from '../src/mangle-size-report.js';
import { createNextCacheIdentity, stableStringify } from '../src/next-cache-identity.js';
import { resolveNextAppRoot } from '../src/next-root-resolver.js';

describe('source and generated-node boundaries', () => {
    it('splits encoded HTML whitespace without decoding non-whitespace entities', () => {
        const classes = collectAuthoredClassNames(
            '<div class="p-4&Tab;m-2&NewLine;gap-1&#x20;flex&#32;block&#65;" />',
        );
        expect([...classes]).toEqual(['p-4', 'm-2', 'gap-1', 'flex', 'block&#65;']);
    });

    it('matches an absolute literal and a singleton filter', () => {
        const root = process.cwd();
        const file = join(root, 'src/view.tsx');
        expect(matchesPattern(file, file, root)).toBe(true);
        expect(matchesPattern(file, join(root, 'src/other.tsx'), root)).toBe(false);
        expect(matchesAnyPattern(file, 'src/view.tsx', root)).toBe(true);
    });

    it('uses the first position for generated PostCSS nodes', () => {
        const declaration = postcss.decl({ prop: '--brand', value: 'red' });
        expect(nodeLocation(declaration, 'generated.css')).toEqual({
            filePath: 'generated.css',
            line: 1,
            column: 1,
        });
        const root = postcss.root({ nodes: [declaration] });
        expect(buildScopeId(declaration)).toBe('<root>');
        // A root inside a document still scopes as the root.
        postcss.document({ nodes: [root] });
        expect(buildScopeId(root as never)).toBe('<root>');
    });

    it('does not attach the checksum to a similarly named or unfinished tag', () => {
        expect(injectChecksum('<htmlish></htmlish><html>', 'abc')).toContain('<html data-');
        expect(injectChecksum('<html', 'abc')).toBe('<html');
        expect(injectChecksum('<html lang="en"', 'abc')).toBe('<html lang="en"');
    });

    it('reports a code-size increase as a cost', () => {
        expect(
            mangleSizeMessage({
                mapCost: 10,
                cssSaving: 0,
                codeSaving: -5,
                net: 15,
                channels: ['html'],
            }),
        ).toContain('shortened classes in code COST 5 B');
    });

    it('normalizes non-finite config values and ignores absent selected environment keys', () => {
        expect(
            stableStringify([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]),
        ).toBe('[null,null,null]');
        const input = {
            root: '/app',
            config: {},
            nextVersion: '16',
            csszyxVersion: '0.18',
            nativeVersion: '0.18',
            mode: 'development' as const,
        };
        expect(createNextCacheIdentity({ ...input, env: {}, envKeys: ['MISSING'] })).toEqual(
            createNextCacheIdentity({ ...input, env: {}, envKeys: [] }),
        );
    });

    it('uses the loader root without a loader context and cwd without hints', () => {
        const root = process.cwd();
        expect(resolveNextAppRoot({ loaderRootContext: root })).toEqual({
            root,
            source: 'loader-root-context',
        });
        expect(resolveNextAppRoot({})).toEqual({ root, source: 'cwd' });
    });
});

describe('unfinished CSS and markup', () => {
    it('drops a trailing CSS escape without losing preceding characters', () => {
        expect(unescapeTailwindClass('flex\\')).toBe('flex');
        expect(unescapeTailwindClass('a\\0 b')).toBe('ab');
    });

    it.each(['--custom', '-2xl', '-word', '😀'])('round-trips %s through CSS escaping', name => {
        expect(unescapeTailwindClass(escapeCSSClassName(name))).toBe(name);
    });

    it.each(['<', '<div class:', '<div class:active', '<div class:active '])(
        'does not invent classes for an unfinished directive: %s',
        source => {
            expect([...collectAuthoredClassNames(source)]).toEqual([]);
        },
    );
});

it('does not register @property names outside the custom-property namespace', () => {
    const scan = scanGlobalVarCss('@property color { syntax: "<color>"; } :root { --brand: red; }');
    expect(scan.definitions).toMatchObject([{ name: '--brand', registered: false }]);
});
