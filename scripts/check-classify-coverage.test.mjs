/**
 * The gate's own tests. `evaluate` is separated from the Tailwind oracle so the
 * counting logic can be driven with a fake — including the case the floor
 * exists for, where the oracle answers "not served" to everything and the run
 * checks nothing while looking clean.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, MIN_SERVED, readCorpora } from './check-classify-coverage.mjs';

const corpora = new Map([['fake.txt', ['p-4', 'and', 'placeholder-gray-400']]]);
const servesAll = () => true;
const servesNone = () => false;
const knowsPadding = t => (t === 'p-4' ? { role: 'inner' } : undefined);

test('reports a served utility nothing classified as a gap', () => {
    const { served, classified, gaps } = evaluate(corpora, servesAll, knowsPadding);
    assert.equal(served, 3);
    assert.equal(classified, 1);
    assert.deepEqual(
        gaps.map(g => g.token),
        ['and', 'placeholder-gray-400'],
    );
});

test('does not count a token Tailwind does not serve', () => {
    const oracle = t => t !== 'and';
    const { served, gaps } = evaluate(corpora, oracle, knowsPadding);
    assert.equal(served, 2);
    assert.deepEqual(
        gaps.map(g => g.token),
        ['placeholder-gray-400'],
    );
});

test('a silent oracle produces no gaps, which is why the floor exists', () => {
    const { served, gaps } = evaluate(corpora, servesNone, () => undefined);
    assert.equal(served, 0);
    assert.deepEqual(gaps, []);
    assert.ok(served < MIN_SERVED, 'a run that checked nothing must fall under the floor');
});

test('names the corpus file a gap came from', () => {
    const { gaps } = evaluate(corpora, servesAll, knowsPadding);
    assert.equal(gaps[0].file, 'fake.txt');
});

test('reads the pinned corpora as one list per file', () => {
    const real = readCorpora();
    assert.ok(real.size >= 5, `expected the five pinned corpora, got ${real.size}`);
    for (const lines of real.values()) {
        assert.ok(!lines.some(l => l.startsWith('#')), 'comments must not reach the oracle');
    }
});
