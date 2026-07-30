/**
 * Phase D3 extracted corpus measurement.
 *
 * This test scans the existing compiler test sources for simple
 * `const source/src = "..."` snippets that contain JSX `sz` or `szRecover`
 * attributes, then runs each snippet through Babel and oxc. It is a live
 * corpus signal: as transformOxc gains coverage, update the expected summary.
 */

import { describe, expect, it } from 'vitest';

import { extractCorpusSnippets } from './extracted-corpus.js';
import { compareImpls, type ParityComparison } from './oxc-parity-harness.js';

type CorpusCategory =
    | 'parity'
    | 'surgical-parity'
    | 'oxc-throws'
    | 'class-divergence'
    | 'diagnostics-divergence'
    | 'metadata-divergence';

const EXPECTED_SUMMARY: Record<CorpusCategory, number> = {
    // 8 → 10 when the sz-fallback-matrix suite landed: its two `const source`
    // snippets qualify for extraction and both compare equal across engines.
    parity: 11,
    'surgical-parity': 133,
    'oxc-throws': 0,
    // Was 1: the `bg:{ color, op: cond ? 30 : 100 }` snippet — oxc used to diverge
    // (incomplete safelist) and now expands the finite conditional like babel.
    'class-divergence': 0,
    'diagnostics-divergence': 0,
    'metadata-divergence': 0,
};

describe('Phase D3 — extracted compiler corpus categories', () => {
    const snippets = extractCorpusSnippets();
    const summary = summarise(snippets);

    it('extracts a stable source corpus from existing compiler tests', () => {
        expect(snippets).toHaveLength(144);
    });

    it('matches the current Babel-vs-oxc category summary', () => {
        expect(summary.counts).toEqual(EXPECTED_SUMMARY);
    });

    it('prints extracted corpus summary', () => {
        console.log(`\n  Phase D3 extracted corpus (${snippets.length} snippets)`);
        console.log(`  ${formatSummary(summary.counts)}\n`);

        for (const [category, examples] of Object.entries(summary.examples)) {
            if (examples.length === 0) {
                continue;
            }
            console.log(`  ${category}:`);
            for (const example of examples) {
                console.log(`    - ${example}`);
            }
        }

        expect(summary.counts['surgical-parity']).toBeGreaterThan(0);
    });
});

function summarise(snippets: readonly ExtractedSnippet[]): {
    counts: Record<CorpusCategory, number>;
    examples: Record<CorpusCategory, string[]>;
} {
    const counts = emptyCategoryMap<number>(0);
    const examples = emptyCategoryMap<string[]>([]);

    for (const snippet of snippets) {
        const comparison = compareImpls(snippet.source, `${snippet.file}-${snippet.index}.tsx`);
        const category = categorise(comparison);
        counts[category]++;
        if (examples[category].length < 5) {
            examples[category].push(
                `${snippet.file}#${snippet.index}: ${snippet.source
                    .replace(/\s+/g, ' ')
                    .slice(0, 110)}`,
            );
        }
    }

    return { counts, examples };
}

function emptyCategoryMap<T>(value: T): Record<CorpusCategory, T> {
    return {
        parity: cloneValue(value),
        'surgical-parity': cloneValue(value),
        'oxc-throws': cloneValue(value),
        'class-divergence': cloneValue(value),
        'diagnostics-divergence': cloneValue(value),
        'metadata-divergence': cloneValue(value),
    };
}

function cloneValue<T>(value: T): T {
    return Array.isArray(value) ? ([...value] as T) : value;
}

function categorise(comparison: ParityComparison): CorpusCategory {
    if (comparison.oxcError) {
        return 'oxc-throws';
    }
    if (!comparison.classesEqual) {
        return 'class-divergence';
    }
    if (!comparison.diagnosticsEqual) {
        return 'diagnostics-divergence';
    }
    if (!comparison.transformedEqual) {
        return 'metadata-divergence';
    }
    return comparison.codeEqual ? 'parity' : 'surgical-parity';
}

function formatSummary(counts: Record<CorpusCategory, number>): string {
    return (Object.entries(counts) as Array<[CorpusCategory, number]>)
        .filter(([, count]) => count > 0)
        .map(([category, count]) => `${category}: ${count}`)
        .join(', ');
}
