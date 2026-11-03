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
assert.strictEqual(DEFAULT_CONFIG.themeValues, false);
assert.strictEqual(parseConfig({ themeValues: true }).themeValues, true);
assert.strictEqual(parseConfig({ themeValues: 'yes' }).themeValues, false);
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

test('completion limits, cancellation, and owned value details', () => {
    const { buildSzKeyEntries, buildSzValueEntries, buildMemberValueEntries } = require('../dist/completions.js');
    const options = { tsMod: ts, limit: 2, replacementSpan: { start: 0, length: 0 } };
    assert.strictEqual(buildSzKeyEntries(options).length, 2);
    assert.deepStrictEqual(buildSzValueEntries({ ...options, property: 'p', quoted: false, shouldStop: () => true }), []);
    assert.deepStrictEqual(buildMemberValueEntries({ ...options, member: { name: 'at', values: ['10', '20'] }, quoted: false, shouldStop: () => true }), []);
    const value = completionDetails(ts, '4', { owner: DATA_OWNER, schema: 1, group: 'value' });
    assert.strictEqual(value.documentation[0].text, 'csszyx value completion');
    const base = { entries: [{ name: 'existing', kind: 'var', sortText: '1' }] };
    assert.strictEqual(mergeCompletions(base, [{ name: 'extra', kind: 'var', sortText: '2' }], 1), base);
});

test('an unknown metadata schema disables every completion builder', () => {
    const Module = require('node:module');
    const original = Module._load;
    const target = require.resolve('../dist/completions.js');
    const cached = require.cache[target];
    delete require.cache[target];
    try {
        Module._load = function(id, ...rest) {
            const result = original.call(this, id, ...rest);
            return id === '@csszyx/tooling-metadata' ? { ...result, METADATA_SCHEMA_VERSION: 2 } : result;
        };
        const future = require(target);
        const options = { tsMod: ts, limit: 10, replacementSpan: { start: 0, length: 0 }, form: {members: []}, member: {values: []}, property: 'p', quoted: false };
        for (const build of [future.buildSzKeyEntries, future.buildFormKeyEntries, future.buildMemberValueEntries, future.buildSzValueEntries]) assert.deepStrictEqual(build(options), []);
    } finally {
        Module._load = original;
        require.cache[target] = cached;
    }
});
