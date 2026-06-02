/**
 * Rust extracted corpus measurement.
 *
 * This scans existing compiler tests for simple source snippets containing
 * `sz` / `szRecover`, then compares the native Rust engine against the current
 * oxc-JS baseline. It is the Rust-side equivalent of the Phase D extracted
 * corpus and gives the default-flip decision a broader regression signal than
 * the curated parity fixtures alone.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { getNativePackageName, loadNativeBinding } from '@csszyx/core/native';
import { beforeAll, describe, expect, it } from 'vitest';

import { compareRustVsOxc, type RustParityComparison } from './transform-rust-harness.js';

type RustCorpusCategory =
    | 'parity'
    | 'rust-ahead'
    | 'code-divergence'
    | 'class-divergence'
    | 'metadata-divergence'
    | 'rust-unavailable';

interface ExtractedSnippet {
    file: string;
    index: number;
    source: string;
}

const EXPECTED_SUMMARY: Record<RustCorpusCategory, number> = {
    parity: 128,
    'rust-ahead': 4,
    'code-divergence': 2,
    'class-divergence': 0,
    'metadata-divergence': 0,
    'rust-unavailable': 0,
};

describe('Rust native engine — extracted compiler corpus', () => {
    beforeAll(() => {
        loadNativeBinding(getNativePackageName());
    });

    const snippets = extractCorpusSnippets();
    const summary = summarise(snippets);

    it('extracts a stable source corpus from existing compiler tests', () => {
        expect(snippets).toHaveLength(134);
    });

    it('matches the current Rust-vs-oxc category summary', () => {
        expect(summary.counts).toEqual(EXPECTED_SUMMARY);
    });

    it('prints extracted Rust corpus summary', () => {
        console.log(`\n  Rust extracted corpus (${snippets.length} snippets)`);
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

        expect(summary.counts.parity + summary.counts['rust-ahead']).toBeGreaterThan(0);
    });
});

function extractCorpusSnippets(): ExtractedSnippet[] {
    const testsDir = path.resolve(__dirname);
    const snippets: ExtractedSnippet[] = [];

    for (const file of fs.readdirSync(testsDir).sort()) {
        if (!file.endsWith('.test.ts') || file.startsWith('oxc-')) {
            continue;
        }
        const content = fs.readFileSync(path.join(testsDir, file), 'utf-8');
        const re = /const\s+(?:source|src)\s*=\s*(['"`])([\s\S]*?)\1\s*;/g;
        let index = 0;
        for (const match of content.matchAll(re)) {
            const source = decodeLiteral(match[1], match[2]);
            if (!source || !/\bsz(?:Recover)?\s*=/.test(source)) {
                continue;
            }
            snippets.push({ file, index, source });
            index++;
        }
    }

    return snippets;
}

function decodeLiteral(quote: string, raw: string): string | null {
    if (quote === '`') {
        return raw.includes('${') ? null : raw;
    }
    try {
        return Function(`return ${quote}${raw}${quote}`)() as string;
    } catch {
        return null;
    }
}

function summarise(snippets: readonly ExtractedSnippet[]): {
    counts: Record<RustCorpusCategory, number>;
    examples: Record<RustCorpusCategory, string[]>;
} {
    const counts = emptyCategoryMap<number>(0);
    const examples = emptyCategoryMap<string[]>([]);

    for (const snippet of snippets) {
        const comparison = compareRustVsOxc(snippet.source, `${snippet.file}-${snippet.index}.tsx`);
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

function emptyCategoryMap<T>(value: T): Record<RustCorpusCategory, T> {
    return {
        parity: cloneValue(value),
        'rust-ahead': cloneValue(value),
        'code-divergence': cloneValue(value),
        'class-divergence': cloneValue(value),
        'metadata-divergence': cloneValue(value),
        'rust-unavailable': cloneValue(value),
    };
}

function cloneValue<T>(value: T): T {
    return Array.isArray(value) ? ([...value] as T) : value;
}

function categorise(comparison: RustParityComparison): RustCorpusCategory {
    if (comparison.rustIsUnavailable) {
        return 'rust-unavailable';
    }
    if (!comparison.classesEqual) {
        if (comparison.rust && isSuperset([...comparison.rust.classes], comparison.oxc.classes)) {
            return 'rust-ahead';
        }
        return 'class-divergence';
    }
    if (!comparison.transformedEqual) {
        return 'metadata-divergence';
    }
    return comparison.codeEqual ? 'parity' : 'code-divergence';
}

function isSuperset(a: readonly string[], b: readonly string[]): boolean {
    const seen = new Set(a);
    return b.every(item => seen.has(item));
}

function formatSummary(counts: Record<RustCorpusCategory, number>): string {
    return (Object.entries(counts) as Array<[RustCorpusCategory, number]>)
        .filter(([, count]) => count > 0)
        .map(([category, count]) => `${category}: ${count}`)
        .join(', ');
}
