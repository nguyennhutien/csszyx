import assert from 'node:assert';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { completionDetails, DATA_OWNER } = require('../dist/completions.js');
const { DEFAULT_CONFIG, parseConfig } = require('../dist/config.js');
const { mergeCompletions } = require('../dist/merge.js');

test('configuration, merging, and completion details contracts', () => {
assert.strictEqual(parseConfig(null).maxEntries, DEFAULT_CONFIG.maxEntries);
assert.deepStrictEqual(parseConfig({ maxEntries: Number.POSITIVE_INFINITY }), DEFAULT_CONFIG);
assert.strictEqual(parseConfig({ maxEntries: 99_999 }).maxEntries, 2_000);
assert.strictEqual(parseConfig({ deadlineMs: -10 }).deadlineMs, 1);
assert.ok(Object.isFrozen(parseConfig({})));

const baseEntry = { name: 'bg', kind: 'var', kindModifiers: '', sortText: '1' };
const base = {
    isGlobalCompletion: false,
    isMemberCompletion: true,
    isNewIdentifierLocation: true,
    entries: [baseEntry],
};
assert.strictEqual(mergeCompletions(base, [], 10), base);
assert.strictEqual(mergeCompletions(base, [{ ...baseEntry, sortText: '0' }], 10), base);
const merged = mergeCompletions(
    base,
    [{ name: 'hover', kind: 'var', kindModifiers: '', sortText: '0' }],
    10,
);
assert.deepStrictEqual(base.entries, [baseEntry]);
assert.deepStrictEqual(merged?.entries.map(entry => entry.name), ['bg', 'hover']);
assert.deepStrictEqual(
    mergeCompletions(undefined, [{ name: 'p', kind: 'var', kindModifiers: '', sortText: '0' }], 10),
    {
        isGlobalCompletion: false,
        isMemberCompletion: true,
        isNewIdentifierLocation: true,
        entries: [{ name: 'p', kind: 'var', kindModifiers: '', sortText: '0' }],
    },
);

assert.strictEqual(completionDetails(ts, 'bg', undefined), undefined);
assert.strictEqual(
    completionDetails(ts, 'bg', { get owner() { throw new Error('getter executed'); } }),
    undefined,
);
assert.strictEqual(
    completionDetails(ts, 'bg', { owner: DATA_OWNER, schema: 1, group: 'key' })?.name,
    'bg',
);

console.log('contract checks passed');
});
