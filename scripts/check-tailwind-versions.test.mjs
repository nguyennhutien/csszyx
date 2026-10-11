// The multi-version gate decides which differences between Tailwind versions
// fail CI, so those decisions are pinned here on hand-made answers, without a
// Tailwind install or the network.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
    compareVersions,
    compareWithBaseline,
    deadBeyondPin,
    readBaseline,
    regressions,
    renderBaseline,
    servedCases,
    spellingFindings,
    TAILWIND_VERSIONS,
    tableFindings,
    verifyIntegrity,
} from './check-tailwind-versions.mjs';

test('lists each version once, in order, each with the integrity it is pinned to', () => {
    const versions = TAILWIND_VERSIONS.map(([version]) => version);

    assert.deepEqual(versions, [...new Set(versions)].sort(compareVersions));
    assert.ok(versions.every(version => /^4\.\d+\.\d+$/.test(version)));
    assert.ok(TAILWIND_VERSIONS.every(([, integrity]) => /^sha512-[\w+/]+=*$/.test(integrity)));
    assert.equal(compareVersions('4.0.17', '4.1.0') < 0, true);
    assert.equal(compareVersions('4.10.0', '4.9.9') > 0, true);
});

test('refuses a tarball whose bytes are not the pinned ones', () => {
    const bytes = Buffer.from('tailwindcss');
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

    assert.doesNotThrow(() => verifyIntegrity(bytes, integrity, '4.0.0'));
    assert.throws(
        () => verifyIntegrity(Buffer.from('tampered'), integrity, '4.0.0'),
        /tailwindcss@4\.0\.0: the tarball is not the pinned one/,
    );
});

test('a case is served only when every lane wrote something Tailwind serves', () => {
    const cases = [
        { id: 'p|number', outputs: ['p-4'] },
        { id: 'p|var', outputs: ['p-(--v)', 'p-[var(--v)]'] },
        { id: 'p|none', outputs: [''] },
    ];
    const alive = new Set(['p-4', 'p-(--v)']);

    assert.deepEqual([...servedCases(cases, token => alive.has(token))], ['p|number']);
});

test('reports a case a later Tailwind stopped serving, once, at the version it died', () => {
    const versions = ['4.0.0', '4.1.0', '4.2.0'];
    const served = new Map([
        ['4.0.0', new Set(['a', 'b'])],
        ['4.1.0', new Set(['b'])],
        ['4.2.0', new Set(['c'])],
    ]);

    assert.deepEqual(Object.fromEntries(regressions(versions, served)), {
        '4.0.0': [],
        '4.1.0': ['a'],
        '4.2.0': ['b'],
    });
});

test('names what an older Tailwind does not serve that the pin does', () => {
    const served = new Map([
        ['4.0.0', new Set(['a'])],
        ['4.3.3', new Set(['a', 'b', 'c'])],
    ]);
    const written = ['a', 'b', 'c', 'd'];

    assert.deepEqual(deadBeyondPin(written, served.get('4.0.0'), served.get('4.3.3')), ['b', 'c']);
});

test('flags a table spelling that is dead where the plain value is served', () => {
    const map = { mt: 'mt', insetS: 'inset-s', cursor: 'cursor' };
    const pinned = { mt: 'n', insetS: 'n', cursor: 'w' };
    // 4.0: `-mt-2` dead though `mt-2` is served; `inset-s` has no utility at
    // all, so its spelling is not a convention problem; `cursor` holds.
    const alive = new Set(['mt-2', 'cursor-[inherit]', 'cursor-4']);

    assert.deepEqual(
        spellingFindings(map, pinned, token => alive.has(token)),
        ['mt: -mt-2 is dead, mt-2 is served'],
    );
});

test('flags a table row that disagrees where the utility exists', () => {
    const map = { col: 'col', insetS: 'inset-s', mt: 'mt' };
    const pinned = { col: 'nw', insetS: 'nfw', mt: 'n' };
    const measured = new Map([
        ['col', 'w'],
        ['insetS', ''],
        ['mt', 'n'],
    ]);

    assert.deepEqual(
        tableFindings(map, pinned, measured, prefix => prefix !== 'inset-s'),
        ["col: pinned 'nw', measured 'w'"],
    );
});

test('fails on growth and on a stale entry, so the baseline only shrinks by hand', () => {
    const baseline = { dead: ['a', 'b'], regressed: [] };

    assert.deepEqual(compareWithBaseline({ dead: ['a', 'b'], regressed: [] }, baseline), []);
    assert.deepEqual(compareWithBaseline({ dead: ['a', 'c'], regressed: ['x'] }, baseline), [
        'regressed: x (not in the baseline)',
        'dead: c (not in the baseline)',
        'dead: b no longer found — remove it from the baseline',
    ]);
    assert.deepEqual(compareWithBaseline({ dead: [] }, undefined), []);
    assert.deepEqual(compareWithBaseline({ dead: ['a'] }, undefined), [
        'dead: a (not in the baseline)',
    ]);
});

test('writes the baseline so a regenerated file is already the formatted one', () => {
    const found = { '4.0.0': { regressed: [], dead: ['p|var'], spelling: [], table: [] } };
    const text = renderBaseline('4.3.3', found);

    // One key per line: the formatter leaves an object written that way alone.
    assert.match(text, /\n {12}"dead": \{\n {16}"p\|var": true\n {12}\}/);
    assert.deepEqual(readBaseline(text).versions, found);
});
