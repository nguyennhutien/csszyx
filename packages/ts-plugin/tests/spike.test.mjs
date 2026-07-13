// PoC verification for @csszyx/ts-plugin: build a real ts.LanguageService over an
// in-memory source and assert computeSzEntries offers sz keys at an sz key slot
// (including inside szv, where the loose SzObject type gives no completion) and
// nothing at a plain object. Run: node tests/spike.test.mjs
import assert from 'node:assert';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { computeSzEntries } = require('../dist/core.js');

function entriesAtMarker(source) {
    const marker = source.indexOf('/*|*/');
    assert.ok(marker >= 0, 'source must contain the /*|*/ marker');
    const clean = source.replace('/*|*/', '');
    const fileName = '/virtual/test.tsx';
    const files = { [fileName]: clean };
    const host = {
        getScriptFileNames: () => [fileName],
        getScriptVersion: () => '1',
        getScriptSnapshot: f => {
            const content = files[f] ?? (ts.sys.fileExists(f) ? ts.sys.readFile(f) : undefined);
            return content !== undefined ? ts.ScriptSnapshot.fromString(content) : undefined;
        },
        getCurrentDirectory: () => '/virtual',
        getCompilationSettings: () => ({ jsx: ts.JsxEmit.ReactJSX, allowJs: true, strict: false }),
        getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
        fileExists: f => f in files || ts.sys.fileExists(f),
        readFile: f => files[f] ?? ts.sys.readFile(f),
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
    };
    const ls = ts.createLanguageService(host);
    return computeSzEntries(
        ts,
        ls,
        fileName,
        marker,
        { enabled: true, values: true, maxEntries: 512, deadlineMs: 20, failureThreshold: 3 },
        Number.POSITIVE_INFINITY,
    );
}

const namesAtMarker = source => entriesAtMarker(source).map(entry => entry.name);

// 1. Inside a szv variant object — the type-blind case.
test('szv innermost variant object offers sz keys', () => {
    const names = namesAtMarker(
        "import { szv } from 'csszyx'; const s = szv({ variants: { size: { sm: { /*|*/ } } } });",
    );
    for (const key of ['bg', 'p', 'gap', 'hover', 'truncate']) {
        assert.ok(names.includes(key), `expected sz key "${key}"; got ${names.length} entries`);
    }
});

// 2. Inside a JSX sz={{ }} attribute object.
test('sz={{ }} JSX attribute offers sz keys', () => {
    const names = namesAtMarker('const A = () => <div sz={{ /*|*/ }} />;');
    assert.ok(names.includes('color'));
    assert.ok(names.includes('rounded'));
});

// 3. A plain, non-sz object gets nothing from the plugin.
test('a plain object literal is left untouched', () => {
    const names = namesAtMarker('const config = { /*|*/ };');
    assert.strictEqual(names.length, 0);
});

// 4. Value position (after a colon) is not a key slot.
test('unquoted value completion inserts a valid string literal', () => {
    const entries = entriesAtMarker('const A = () => <div sz={{ bg: /*|*/ }} />;');
    const red = entries.find(entry => entry.name === 'red-500');
    assert.strictEqual(red?.insertText, "'red-500'");
    assert.strictEqual(red?.replacementSpan.length, 0);
});

test('same-spelled unrelated call is rejected', () => {
    const names = namesAtMarker('const szv = (x) => x; szv({ variants: { x: { y: { /*|*/ } } } });');
    assert.strictEqual(names.length, 0);
});

test('szs offers keys inside a slot but not at the slot-name level', () => {
    assert.strictEqual(namesAtMarker('const A = () => <Card szs={{ /*|*/ }} />;').length, 0);
    assert.ok(namesAtMarker('const A = () => <Card szs={{ header: { /*|*/ } }} />;').includes('bg'));
});

test('szv compound variant sz object offers keys', () => {
    const names = namesAtMarker(
        "import { szv } from 'csszyx'; szv({ compoundVariants: [{ tone: 'x', sz: { /*|*/ } }] });",
    );
    assert.ok(names.includes('p'));
});

test('an imported function shadowed by a parameter is rejected', () => {
    const names = namesAtMarker(
        "import { szv } from 'csszyx'; function f(szv) { return szv({ variants: { x: { y: { /*|*/ } } } }); }",
    );
    assert.strictEqual(names.length, 0);
});

test('aliased and namespace csszyx imports retain provenance', () => {
    assert.ok(
        namesAtMarker(
            "import { szv as variants } from 'csszyx'; variants({ base: { /*|*/ } });",
        ).includes('bg'),
    );
    assert.ok(
        namesAtMarker(
            "import * as csszyx from '@csszyx/runtime'; csszyx.szr({ hover: { /*|*/ } });",
        ).includes('bg'),
    );
});

test('named import receivers cannot spoof namespace provenance', () => {
    const names = namesAtMarker(
        "import { theme } from 'csszyx'; theme.szv({ base: { /*|*/ } });",
    );
    assert.strictEqual(names.length, 0);
});

test('conditional JSX sz branches retain context', () => {
    assert.ok(
        namesAtMarker('const A = ({ ok }) => <div sz={ok ? { /*|*/ } : { p: 2 }} />;').includes(
            'bg',
        ),
    );
});

test('quoted value replaces only the typed prefix', () => {
    const entries = entriesAtMarker("const A = () => <div sz={{ bg: 'red-/*|*/' }} />;");
    const red = entries.find(entry => entry.name === 'red-500');
    assert.strictEqual(red?.insertText, 'red-500');
    assert.strictEqual(red?.replacementSpan.length, 4);
});

test('numeric values insert as numbers for VS Code parity', () => {
    const entries = entriesAtMarker('const A = () => <div sz={{ p: /*|*/ }} />;');
    assert.strictEqual(entries.find(entry => entry.name === '4')?.insertText, '4');
});

// Regression: a typed value prefix (the state after EVERY value keystroke) must
// stay a value slot. This previously fell through to 401 key entries, so
// accepting one rewrote `bg: re` into `bg: rounded`.
test('a typed value prefix stays a value slot, never keys', () => {
    const entries = entriesAtMarker('const A = () => <div sz={{ bg: re/*|*/ }} />;');
    const names = entries.map(entry => entry.name);
    assert.ok(names.includes('red-500'), 'offers color values');
    assert.ok(!names.includes('rounded'), 'must not offer sz keys at a value slot');
    assert.strictEqual(
        entries.find(entry => entry.name === 'red-500')?.replacementSpan.length,
        2,
        'replaces only the typed prefix "re"',
    );
});

// A freshly typed quote at a value slot must offer bare-text values: `'` and
// `"` are tsserver trigger characters, so in editors where letter-typing does
// not auto-open suggestions (e.g. Copilot inline-suggest suppression,
// microsoft/vscode#315373) this is the natural entry point for value completion.
test('a fresh quote at a value slot offers unquoted value text', () => {
    for (const source of [
        "const A = () => <div sz={{ bg: '/*|*/", // unterminated, end of file
        "const A = () => <div sz={{ bg: '/*|*/' }} />;", // auto-paired quotes
        "const X = () => <Card szs={{ header: { color: '/*|*/' } }} />;", // szs slot value
    ]) {
        const red = entriesAtMarker(source).find(entry => entry.name === 'red-500');
        assert.strictEqual(red?.insertText, 'red-500', `bare insert for: ${source}`);
    }
});

// Regression: a mid-word key prefix must offer keys and replace the typed text.
test('a mid-word key prefix offers keys covering the prefix', () => {
    const entries = entriesAtMarker('const A = () => <div sz={{ b/*|*/ }} />;');
    assert.ok(entries.map(entry => entry.name).includes('bg'));
    assert.strictEqual(
        entries.find(entry => entry.name === 'bg')?.replacementSpan.length,
        1,
        'replaces the typed "b"',
    );
});

// A nested object under a NON-color utility property is not sz syntax (the
// compiler lowers `p: { bg }` to a garbage class), and the `css` escape hatch
// takes arbitrary CSS properties no finite list can assist — silence for both.
test('nested objects under non-form properties and css get no suggestions', () => {
    const cases = [
        'const A = () => <div sz={{ p: { /*|*/ } }} />;',
        'const A = () => <div sz={{ hover: { p: { /*|*/ } } }} />;',
        "import { szv } from 'csszyx'; szv({ variants: { size: { sm: { p: { /*|*/ } } } } });",
        "import { szr } from 'csszyx'; szr({ p: { /*|*/ } });",
        'const A = () => <Card szs={{ header: { p: { /*|*/ } } }} />;',
        'const A = () => <div sz={{ css: { /*|*/ } }} />;',
        // deeper nesting inside a structured form is equally invalid
        'const A = () => <div sz={{ bg: { color: { /*|*/ } } }} />;',
    ];
    for (const source of cases) {
        assert.strictEqual(namesAtMarker(source).length, 0, `expected silence: ${source}`);
    }
    // Variant and unknown (arbitrary/custom) parents keep the benefit of the doubt.
    assert.ok(namesAtMarker('const A = () => <div sz={{ hover: { /*|*/ } }} />;').includes('bg'));
    assert.ok(
        namesAtMarker('const A = () => <div sz={{ customVariant: { /*|*/ } }} />;').includes('bg'),
    );
});

// A COLOR property's object value is the documented `{ color, op }` form — the
// only way to express opacity — so suggestions are limited to exactly those
// members, chain into their curated values, and respect sibling exclusion.
test('a color property object offers exactly its { color, op } members', () => {
    const names = namesAtMarker('const A = () => <div sz={{ bg: { /*|*/ } }} />;');
    assert.deepStrictEqual([...names].sort(), ['color', 'op']);
    const afterColor = namesAtMarker(
        "const A = () => <div sz={{ borderColor: { color: 'red-500', /*|*/ } }} />;",
    );
    assert.deepStrictEqual(afterColor, ['op'], 'assigned member drops, op remains');
    const colorValues = entriesAtMarker(
        "const A = () => <div sz={{ bg: { color: 're/*|*/' } }} />;",
    );
    assert.ok(colorValues.some(entry => entry.name === 'red-500'));
    const opValues = entriesAtMarker('const A = () => <div sz={{ bg: { op: /*|*/ } }} />;');
    assert.strictEqual(opValues.find(entry => entry.name === '50')?.insertText, '50');
});

// bgImg's gradient object form (spec BgImgGradient): gradient/dir/in members.
test('bgImg offers its gradient form members and values', () => {
    const names = namesAtMarker('const A = () => <div sz={{ bgImg: { /*|*/ } }} />;');
    assert.deepStrictEqual([...names].sort(), ['dir', 'gradient', 'in']);
    const gradient = namesAtMarker(
        'const A = () => <div sz={{ bgImg: { gradient: /*|*/ } }} />;',
    );
    assert.deepStrictEqual([...gradient].sort(), ['conic', 'linear', 'radial']);
    const names2 = namesAtMarker(
        "const A = () => <div sz={{ bgImg: { gradient: 'linear', dir: /*|*/ } }} />;",
    );
    assert.ok(names2.includes('to-r'));
    const interpolation = namesAtMarker(
        "const A = () => <div sz={{ bgImg: { gradient: 'linear', in: /*|*/ } }} />;",
    );
    assert.ok(interpolation.includes('oklch'));
});

// Tier-1 decoration: a base entry colliding with a csszyx key gains the
// Tailwind hint on a CLONE — base semantics (kind, sortText) stay authoritative
// and the original objects are never mutated.
test('merge decorates colliding base entries without mutating them', () => {
    const { mergeCompletions } = require('../dist/merge.js');
    const { buildSzKeyEntries } = require('../dist/completions.js');
    const baseEntry = Object.freeze({
        name: 'bg',
        kind: 'property',
        kindModifiers: 'optional',
        sortText: '12',
    });
    const prior = Object.freeze({
        isGlobalCompletion: false,
        isMemberCompletion: true,
        isNewIdentifierLocation: false,
        entries: Object.freeze([baseEntry]),
    });
    const additions = buildSzKeyEntries(ts, 512, { start: 0, length: 0 });
    const merged = mergeCompletions(prior, additions, 2048);
    const bg = merged.entries.find(entry => entry.name === 'bg' && entry.sortText === '12');
    assert.ok(bg, 'base entry survives with its own sortText');
    assert.strictEqual(bg.labelDetails?.description, '→ bg-*', 'clone gains the hint');
    assert.strictEqual(bg.kind, 'property');
    assert.strictEqual(bg.data, undefined, 'no csszyx data — details stay base-resolved');
    assert.strictEqual(baseEntry.labelDetails, undefined, 'original entry untouched');
    assert.strictEqual(
        merged.entries.filter(entry => entry.name === 'bg').length,
        1,
        'no duplicate bg',
    );
    // An existing base description is never overwritten.
    const described = {
        ...prior,
        entries: [{ ...baseEntry, labelDetails: { description: 'from types' } }],
    };
    const merged2 = mergeCompletions(described, additions, 2048);
    const bg2 = merged2.entries.find(entry => entry.name === 'bg' && entry.sortText === '12');
    assert.strictEqual(bg2.labelDetails.description, 'from types');
});

// Preselection: the curated top value carries isRecommended so Tab lands on an
// sz value even when the unquoted expression position mixes in identifiers.
test('the first value suggestion is marked recommended', () => {
    const entries = entriesAtMarker('const A = () => <div sz={{ bg: /*|*/ }} />;');
    assert.strictEqual(entries[0]?.isRecommended, true);
    assert.strictEqual(
        entries.filter(entry => entry.isRecommended).length,
        1,
        'exactly one recommended entry',
    );
});

// Sibling exclusion: a key already assigned in the object is never useful to
// suggest again (a duplicate silently overrides), while the key being typed or
// edited must never exclude itself, and invisible spreads change nothing.
test('assigned sibling keys disappear from key suggestions', () => {
    const names = namesAtMarker("const A = () => <div sz={{ color: 'red-500', c/*|*/ }} />;");
    assert.ok(!names.includes('color'), 'assigned sibling is excluded');
    assert.ok(names.includes('caption'), 'other keys stay');
});

test('the key being typed or edited never excludes itself', () => {
    assert.ok(namesAtMarker('const A = () => <div sz={{ c/*|*/ }} />;').includes('color'));
    assert.ok(
        namesAtMarker("const A = () => <div sz={{ col/*|*/or: 'red-500' }} />;").includes('color'),
    );
});

test('spreads exclude nothing and shorthands exclude themselves', () => {
    assert.ok(namesAtMarker('const A = () => <div sz={{ ...base, /*|*/ }} />;').includes('p'));
    const names = namesAtMarker('const A = () => <div sz={{ truncate, /*|*/ }} />;');
    assert.ok(!names.includes('truncate'));
    assert.ok(names.includes('p'));
});

test('sibling exclusion applies inside szv option objects', () => {
    const names = namesAtMarker(
        "import { szv } from 'csszyx'; szv({ variants: { size: { sm: { color: 'red-500', /*|*/ } } } });",
    );
    assert.ok(!names.includes('color'));
    assert.ok(names.includes('bg'));
});

// The szv value slot behind a fresh/auto-paired quote — the field report said
// this stayed dark; lock that values flow inside variant option objects.
test('szv option values complete behind a quote', () => {
    const entries = entriesAtMarker(
        "import { szv } from 'csszyx'; szv({ variants: { size: { sm: { bg: '/*|*/' } } } });",
    );
    assert.strictEqual(
        entries.find(entry => entry.name === 'red-500')?.insertText,
        'red-500',
    );
});
