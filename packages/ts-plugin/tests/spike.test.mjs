// PoC verification for @csszyx/ts-plugin: build a real ts.LanguageService over an
// in-memory source and assert computeSzEntries offers sz keys at an sz key slot
// (including inside szv, where the loose SzObject type gives no completion) and
// nothing at a plain object. Run: node tests/spike.test.mjs
import assert from 'node:assert';
import { createRequire } from 'node:module';

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

let pass = 0;
const check = (label, fn) => {
    fn();
    pass++;
    console.log(`  ok  ${label}`);
};

// 1. Inside a szv variant object — the type-blind case.
check('szv innermost variant object offers sz keys', () => {
    const names = namesAtMarker(
        "import { szv } from 'csszyx'; const s = szv({ variants: { size: { sm: { /*|*/ } } } });",
    );
    for (const key of ['bg', 'p', 'gap', 'hover', 'truncate']) {
        assert.ok(names.includes(key), `expected sz key "${key}"; got ${names.length} entries`);
    }
});

// 2. Inside a JSX sz={{ }} attribute object.
check('sz={{ }} JSX attribute offers sz keys', () => {
    const names = namesAtMarker('const A = () => <div sz={{ /*|*/ }} />;');
    assert.ok(names.includes('color'));
    assert.ok(names.includes('rounded'));
});

// 3. A plain, non-sz object gets nothing from the plugin.
check('a plain object literal is left untouched', () => {
    const names = namesAtMarker('const config = { /*|*/ };');
    assert.strictEqual(names.length, 0);
});

// 4. Value position (after a colon) is not a key slot.
check('unquoted value completion inserts a valid string literal', () => {
    const entries = entriesAtMarker('const A = () => <div sz={{ bg: /*|*/ }} />;');
    const red = entries.find(entry => entry.name === 'red-500');
    assert.strictEqual(red?.insertText, "'red-500'");
    assert.strictEqual(red?.replacementSpan.length, 0);
});

check('same-spelled unrelated call is rejected', () => {
    const names = namesAtMarker('const szv = (x) => x; szv({ variants: { x: { y: { /*|*/ } } } });');
    assert.strictEqual(names.length, 0);
});

check('szs offers keys inside a slot but not at the slot-name level', () => {
    assert.strictEqual(namesAtMarker('const A = () => <Card szs={{ /*|*/ }} />;').length, 0);
    assert.ok(namesAtMarker('const A = () => <Card szs={{ header: { /*|*/ } }} />;').includes('bg'));
});

check('szv compound variant sz object offers keys', () => {
    const names = namesAtMarker(
        "import { szv } from 'csszyx'; szv({ compoundVariants: [{ tone: 'x', sz: { /*|*/ } }] });",
    );
    assert.ok(names.includes('p'));
});

check('an imported function shadowed by a parameter is rejected', () => {
    const names = namesAtMarker(
        "import { szv } from 'csszyx'; function f(szv) { return szv({ variants: { x: { y: { /*|*/ } } } }); }",
    );
    assert.strictEqual(names.length, 0);
});

check('aliased and namespace csszyx imports retain provenance', () => {
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

check('named import receivers cannot spoof namespace provenance', () => {
    const names = namesAtMarker(
        "import { theme } from 'csszyx'; theme.szv({ base: { /*|*/ } });",
    );
    assert.strictEqual(names.length, 0);
});

check('conditional JSX sz branches retain context', () => {
    assert.ok(
        namesAtMarker('const A = ({ ok }) => <div sz={ok ? { /*|*/ } : { p: 2 }} />;').includes(
            'bg',
        ),
    );
});

check('quoted value replaces only the typed prefix', () => {
    const entries = entriesAtMarker("const A = () => <div sz={{ bg: 'red-/*|*/' }} />;");
    const red = entries.find(entry => entry.name === 'red-500');
    assert.strictEqual(red?.insertText, 'red-500');
    assert.strictEqual(red?.replacementSpan.length, 4);
});

check('numeric values insert as numbers for VS Code parity', () => {
    const entries = entriesAtMarker('const A = () => <div sz={{ p: /*|*/ }} />;');
    assert.strictEqual(entries.find(entry => entry.name === '4')?.insertText, '4');
});

// Regression: a typed value prefix (the state after EVERY value keystroke) must
// stay a value slot. This previously fell through to 401 key entries, so
// accepting one rewrote `bg: re` into `bg: rounded`.
check('a typed value prefix stays a value slot, never keys', () => {
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

// Regression: a mid-word key prefix must offer keys and replace the typed text.
check('a mid-word key prefix offers keys covering the prefix', () => {
    const entries = entriesAtMarker('const A = () => <div sz={{ b/*|*/ }} />;');
    assert.ok(entries.map(entry => entry.name).includes('bg'));
    assert.strictEqual(
        entries.find(entry => entry.name === 'bg')?.replacementSpan.length,
        1,
        'replaces the typed "b"',
    );
});

console.log(`\n${pass} spike checks passed`);
