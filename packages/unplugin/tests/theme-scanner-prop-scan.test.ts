import { describe, expect, it } from 'vitest';

import { scanCustomPropertyNames } from '../src/theme-scanner.js';

/**
 * The custom-property name extractor was rewritten from a quadratic-by-search
 * regex to a linear scan. This suite pins it against the exact regex it
 * replaced by running both over a corpus of `@theme` bodies.
 */
/**
 * The original regex extractor, kept as the oracle.
 *
 * @param block - A `@theme` block body.
 * @returns The declared property names.
 */
function legacyPropertyNames(block: string): string[] {
    const propPattern = /--([a-z][a-z0-9-]*)(?:\s*:[^;]+)?;/g;
    return [...block.matchAll(propPattern)].map(m => m[1]);
}

const FIXTURES = [
    '--color-brand: #fff;',
    '--color-brand: #fff; --spacing-xl: 4rem;',
    '--radius-button;',
    '--text-huge: clamp(1rem, 2vw, 3rem);',
    '  --font-display : "Inter" ;',
    '--color-a: #f00;\n  --color-b: #0f0;\n',
    '--valid: 1; not-a-prop: 2; --also-valid: 3;',
    '--empty:;',
    '--no-terminator: 1',
    '--UPPER: 1;',
    '---triple: 1;',
    '--color-brand: var(--other); --x: url(a.png);',
    '--a: 1; /* --commented: 2; */ --b: 3;',
    'color: var(--used-not-declared);',
    '--nested-fn: calc(var(--x) + 1px);',
    '',
    '--dash-name-here: 1;',
    '--1number: 1;',
    '--0: 1;',
];

describe('scanCustomPropertyNames equivalence with the legacy regex', () => {
    it('matches the legacy regex on every fixture', () => {
        for (const fixture of FIXTURES) {
            expect(scanCustomPropertyNames(fixture), fixture).toEqual(legacyPropertyNames(fixture));
        }
    });

    it('stays linear on a semicolon-less adversarial block', () => {
        const hostile = `--x${'a'.repeat(200_000)}`;
        const start = Date.now();
        expect(scanCustomPropertyNames(hostile)).toEqual([]);
        expect(Date.now() - start).toBeLessThan(500);
    });
});
