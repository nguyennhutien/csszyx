import path from 'node:path';

import { createEmittedClassOracle } from '@csszyx/tailwind-oracle';
import { describe, expect, it } from 'vitest';

import { measureMergeBaseline, signatureFromCss } from './merge-signature-harness.js';

const REPO = path.resolve(import.meta.dirname, '../../..');

function evenlySpaced<T>(values: readonly T[], size: number): T[] {
    if (size >= values.length) return [...values];
    return Array.from({ length: size }, (_, index) => {
        const sourceIndex = Math.floor((index * (values.length - 1)) / (size - 1));
        return values[sourceIndex] as T;
    });
}

async function signaturesFor(requested?: readonly string[]) {
    const oracle = await createEmittedClassOracle({
        resolveFrom: REPO,
        css: '@import "tailwindcss";',
        cssBase: REPO,
    });
    if (!oracle.ok) throw new Error(`expected a ready oracle, got skip: ${oracle.reason}`);
    const candidates = requested === undefined ? oracle.candidates() : [...requested];
    const emitted = oracle.cssFor(candidates);
    return candidates.flatMap((candidate, index) => {
        const signature = signatureFromCss(candidate, emitted[index] ?? null);
        return signature === null ? [] : [signature];
    });
}

describe('merge signature baseline', () => {
    it('distinguishes the three known genuine false-delete families', async () => {
        const candidates = [
            'text-2xl',
            'text-[0.8rem]',
            'transition',
            'transition-none',
            'outline-hidden',
            'outline-none',
        ] as const;
        const signatures = await signaturesFor(candidates);
        const byCandidate = new Map(signatures.map(signature => [signature.candidate, signature]));
        const pairs = [
            ['text-2xl', 'text-[0.8rem]'],
            ['transition', 'transition-none'],
            ['outline-hidden', 'outline-none'],
        ] as const;

        for (const [previous, later] of pairs) {
            const previousSignature = byCandidate.get(previous);
            const laterSignature = byCandidate.get(later);
            if (previousSignature === undefined || laterSignature === undefined) {
                throw new Error(`missing signature for ${previous} → ${later}`);
            }
            const result = measureMergeBaseline([previousSignature, laterSignature]);
            expect(result.falseDeletes, `${previous} → ${later}`).toBeGreaterThan(0);
        }
    });

    it('keeps missing signatures fail-safe and reads nested declaration contexts', () => {
        expect(signatureFromCss('unknown', null)).toBeNull();
        expect(
            signatureFromCss(
                'outline-hidden',
                '.outline-hidden { outline-style: none; @media (forced-colors: active) { outline: 2px solid transparent; outline-offset: 2px; } }',
            ),
        ).toEqual({
            candidate: 'outline-hidden',
            properties: ['outline-color', 'outline-offset', 'outline-style', 'outline-width'],
        });
    });

    it('separates horizontal equivalence from writing-mode safety', () => {
        const result = measureMergeBaseline([
            { candidate: 'bottom-0', properties: ['bottom'] },
            {
                candidate: 'inset-y-0',
                properties: ['inset-block-end', 'inset-block-start'],
            },
        ]);
        expect(result.falseDeletes).toBe(0);
        expect(result.writingModeOnlyDeletes).toBe(1);
    });

    it('is deterministic and total at three corpus sizes', async () => {
        const signatures = await signaturesFor();
        const baselines = [];
        for (const size of [64, 256, 1024]) {
            const sample = evenlySpaced(signatures, size);
            const first = measureMergeBaseline(sample);
            baselines.push(first);
            expect(first.orderedPairs).toBe(sample.length ** 2);
        }
        expect(measureMergeBaseline(evenlySpaced(signatures, 64))).toEqual(baselines[0]);
        expect(
            baselines.map(
                ({ falseDeleteExamples: _false, missExamples: _miss, ...counts }) => counts,
            ),
        ).toMatchInlineSnapshot(`
          [
            {
              "candidates": 64,
              "falseDeletes": 5,
              "misses": 31,
              "orderedPairs": 4096,
              "writingModeOnlyDeletes": 2,
            },
            {
              "candidates": 256,
              "falseDeletes": 167,
              "misses": 413,
              "orderedPairs": 65536,
              "writingModeOnlyDeletes": 52,
            },
            {
              "candidates": 1024,
              "falseDeletes": 2585,
              "misses": 6531,
              "orderedPairs": 1048576,
              "writingModeOnlyDeletes": 663,
            },
          ]
        `);
    });
});
