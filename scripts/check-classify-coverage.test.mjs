/**
 * The gate's own tests. `evaluate` is separated from the Tailwind oracle so the
 * counting logic can be driven with a fake — including the case the floor
 * exists for, where the oracle answers "not served" to everything and the run
 * checks nothing while looking clean.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXPECTED_SERVED, evaluate, readCorpora, verdict } from './check-classify-coverage.mjs';

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

test('a silent oracle produces no gaps, which is why the count is checked', () => {
    const { served, gaps } = evaluate(corpora, servesNone, () => undefined);
    assert.equal(served, 0);
    assert.deepEqual(gaps, []);
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

test('a run that checked nothing exits non-zero even though it found no gaps', () => {
    const { exitCode, err } = verdict({ served: 12, classified: 12, gaps: [] });
    assert.equal(exitCode, 1);
    assert.match(err.join('\n'), /do not read it as a pass/);
});

test('a run with an unclassified served utility exits non-zero', () => {
    const clean = { served: EXPECTED_SERVED, classified: EXPECTED_SERVED - 1 };
    const { exitCode, err } = verdict({ ...clean, gaps: [{ token: 'x-1', file: 'a.txt' }] });
    assert.equal(exitCode, 1);
    assert.match(err.join('\n'), /x-1/);
});

test('a clean run exits zero', () => {
    const { exitCode, err } = verdict({
        served: EXPECTED_SERVED,
        classified: EXPECTED_SERVED,
        gaps: [],
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(err, []);
});

test('reports the count it expected, so a corpus edit says what to update', () => {
    const { err } = verdict({ served: 3, classified: 3, gaps: [] }, 9);
    assert.match(err.join('\n'), /3/);
    assert.match(err.join('\n'), /9/);
});

test('a blind run is reported as blind rather than as clean', () => {
    // A run whose oracle stopped answering has no gaps BECAUSE it checked
    // nothing, so the gap test alone would call it a pass. Order matters.
    const { err } = verdict({ served: 0, classified: 0, gaps: [] });
    assert.match(err.join('\n'), /do not read it as a pass/);
});
