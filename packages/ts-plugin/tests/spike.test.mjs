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
    return computeSzEntries(ts, ls, fileName, marker).map(e => e.name);
}

let pass = 0;
const check = (label, fn) => {
    fn();
    pass++;
    console.log(`  ok  ${label}`);
};

// 1. Inside a szv variant object — the type-blind case.
check('szv innermost variant object offers sz keys', () => {
    const names = entriesAtMarker(
        'const s = szv({ variants: { size: { sm: { /*|*/ } } } });',
    );
    for (const key of ['bg', 'p', 'gap', 'hover', 'truncate']) {
        assert.ok(names.includes(key), `expected sz key "${key}"; got ${names.length} entries`);
    }
});

// 2. Inside a JSX sz={{ }} attribute object.
check('sz={{ }} JSX attribute offers sz keys', () => {
    const names = entriesAtMarker('const A = () => <div sz={{ /*|*/ }} />;');
    assert.ok(names.includes('color'));
    assert.ok(names.includes('rounded'));
});

// 3. A plain, non-sz object gets nothing from the plugin.
check('a plain object literal is left untouched', () => {
    const names = entriesAtMarker('const config = { /*|*/ };');
    assert.strictEqual(names.length, 0);
});

// 4. Value position (after a colon) is not a key slot.
check('value position offers no sz keys', () => {
    const names = entriesAtMarker('const A = () => <div sz={{ bg: /*|*/ }} />;');
    assert.strictEqual(names.length, 0);
});

console.log(`\n${pass}/4 spike checks passed`);
