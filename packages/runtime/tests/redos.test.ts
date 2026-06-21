import { describe, expect, it } from 'vitest';
import { classify, has, splitBox } from '../src/split-box.js';

/**
 * ReDoS tripwire for the request-time-reachable className parsing. `splitBox`/
 * `classify`/`has` run the variant-prefix scan on attacker-influenceable strings
 * (a JSON-driven className), so their scan must stay linear. These assert a
 * pathological 100k-char token completes well under a budget — a regression
 * trap if someone swaps the linear scan for a backtracking regex.
 *
 * The budget is deliberately generous: it catches CATASTROPHIC backtracking
 * (exponential — seconds to an effective hang on these inputs), not micro-perf,
 * so it never flakes on a loaded/slow machine while a real ReDoS still trips it
 * by orders of magnitude.
 */
describe('className parsing stays linear (ReDoS tripwire)', () => {
    const BUDGET_MS = 2000;

    it('splitBox handles a 100k-char pathological token quickly', () => {
        const evil = `${'a'.repeat(50_000)}:${'['.repeat(50_000)}`;
        const start = performance.now();
        splitBox(evil);
        splitBox(`${'hover:'.repeat(10_000)}px-2`);
        expect(performance.now() - start).toBeLessThan(BUDGET_MS);
    });

    it('classify / has stay linear on a long token', () => {
        const evil = `${'@max-['.repeat(20_000)}px-2`;
        const start = performance.now();
        classify(evil);
        has(`${'x'.repeat(100_000)} px-2`, 'padding');
        expect(performance.now() - start).toBeLessThan(BUDGET_MS);
    });
});
