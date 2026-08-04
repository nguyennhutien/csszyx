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

function entriesAtMarker(source, { forceUnresolvedSymbols = false, tsModule = ts } = {}) {
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
    let service = ls;
    if (forceUnresolvedSymbols) {
        const program = ls.getProgram();
        assert.ok(program, 'language service must expose its program');
        const checker = Object.create(program.getTypeChecker());
        checker.getSymbolAtLocation = () => undefined;
        const programWithoutSymbols = Object.create(program);
        programWithoutSymbols.getTypeChecker = () => checker;
        service = Object.create(ls);
        service.getProgram = () => programWithoutSymbols;
    }
    return computeSzEntries(
        tsModule,
        service,
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

test('a cursor with no object ancestry is left untouched', () => {
    assert.strictEqual(namesAtMarker('const value = 1 + /*|*/2;').length, 0);
});

test('unsupported scanner hosts fail open without whole-file fallback', () => {
    const tsWithoutTokenScanner = Object.create(ts);
    Object.defineProperty(tsWithoutTokenScanner, 'getTokenAtPosition', { value: undefined });
    assert.strictEqual(
        entriesAtMarker('const A = () => <div sz={{ /*|*/ }} />;', {
            tsModule: tsWithoutTokenScanner,
        }).length,
        0,
    );
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

test('incomplete checker falls back only to proven csszyx import spellings', () => {
    const fallbackNames = source =>
        entriesAtMarker(source, { forceUnresolvedSymbols: true }).map(entry => entry.name);

    assert.ok(
        fallbackNames(
            "import { szv as variants } from 'csszyx'; variants({ base: { /*|*/ } });",
        ).includes('bg'),
    );
    assert.ok(
        fallbackNames(
            "import * as runtime from '@csszyx/runtime'; runtime.szr({ hover: { /*|*/ } });",
        ).includes('p'),
    );
    assert.strictEqual(
        fallbackNames("import { szv } from 'unrelated'; szv({ base: { /*|*/ } });").length,
        0,
    );
    assert.strictEqual(
        fallbackNames(
            "import csszyx from 'csszyx'; csszyx.szv({ base: { /*|*/ } });",
        ).length,
        0,
    );
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

// The same slot, one key per line — the layout anyone writing more than two
// props uses. Every fixture above happened to keep the quote at end of file or
// with text after it on the same line, and both of those reach the value slot
// by a different route than an unterminated quote at end of LINE does. A JS
// string cannot cross a newline, so this shape is unreachable single-line and
// the whole family went untested.
test('a fresh quote offers values when the object spans several lines', () => {
    for (const source of [
        // Top level, and the reported spelling.
        "const A = () => (\n    <div\n        sz={{\n            p: 4,\n            bg: '/*|*/\n        }}\n    />\n);",
        // Nested variant.
        "const A = () => (\n    <div\n        sz={{\n            hover: {\n                bg: '/*|*/\n            },\n        }}\n    />\n);",
        // Object value form.
        "const A = () => (\n    <div\n        sz={{\n            bg: {\n                color: '/*|*/\n            },\n        }}\n    />\n);",
        // Slot map.
        "const X = () => (\n    <Card\n        szs={{\n            header: {\n                color: '/*|*/\n            },\n        }}\n    />\n);",
        // Double quotes, and a typed prefix after the quote.
        'const A = () => (\n    <div\n        sz={{\n            p: 4,\n            bg: "/*|*/\n        }}\n    />\n);',
        "const A = () => (\n    <div\n        sz={{\n            p: 4,\n            bg: 'red-/*|*/\n        }}\n    />\n);",
    ]) {
        const red = entriesAtMarker(source).find(entry => entry.name === 'red-500');
        assert.strictEqual(red?.insertText, 'red-500', `bare insert for: ${source}`);
    }
});

// The key slot was never affected — it lands on `{` or `,`, which the scan
// already recognized. Pinned so a fix aimed at values cannot regress it.
test('keys still complete when the object spans several lines', () => {
    const entries = entriesAtMarker(
        "const A = () => (\n    <div\n        sz={{\n            p: 4,\n            /*|*/\n        }}\n    />\n);",
    );
    assert.ok(entries.map(entry => entry.name).includes('bg'));
    // Nothing to repair, so the entry inserts its label and nothing else.
    assert.strictEqual(entries.find(entry => entry.name === 'bg')?.insertText, undefined);
});

// A key slot whose previous property has no comma yet. Invalid JS, and the
// state anyone typing a multi-line object passes through — the dropdown used to
// stay shut until the author remembered the comma unaided.
test('a key slot with no preceding comma completes and supplies the comma', () => {
    const entries = entriesAtMarker(
        "const A = () => (\n    <div\n        sz={{\n            p: 4\n            /*|*/\n        }}\n    />\n);",
    );
    const bg = entries.find(entry => entry.name === 'bg');
    // The author's own indentation, verbatim, after the comma the object needed.
    assert.strictEqual(bg?.insertText, ',\n            bg');
    // The replacement covers exactly the gap after the previous value, so
    // accepting the entry rewrites it rather than duplicating it.
    assert.strictEqual(bg?.replacementSpan.length, '\n            '.length);
});

test('the same repair works one line, mid-word, and inside an object value', () => {
    // Single line: the missing comma is not a multi-line phenomenon.
    const single = entriesAtMarker('const A = () => <div sz={{ p: 4 /*|*/ }} />;');
    assert.strictEqual(single.find(entry => entry.name === 'bg')?.insertText, ', bg');
    // A typed prefix is replaced along with the gap, not appended to it.
    const typed = entriesAtMarker('const A = () => <div sz={{ p: 4 b/*|*/ }} />;');
    assert.strictEqual(typed.find(entry => entry.name === 'bg')?.insertText, ', bg');
    // Structured object values take the same repair.
    const form = entriesAtMarker(
        "const A = () => <div sz={{ bg: { color: 'red-500' /*|*/ } }} />;",
    );
    assert.strictEqual(form.find(entry => entry.name === 'op')?.insertText, ', op');
});

// A cursor that is NOT after a finished value must stay unanswered: offering
// keys mid-expression would insert a comma into the middle of one.
test('an unfinished value does not turn into a key slot', () => {
    for (const source of [
        'const A = () => <div sz={{ p: 4 + /*|*/ }} />;',
        'const A = () => <div sz={{ p: /*|*/ }} />;',
    ]) {
        const entries = entriesAtMarker(source);
        assert.ok(
            !entries.some(entry => entry.insertText?.startsWith(',')),
            `no comma repair for: ${source}`,
        );
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

test('computed variant keys are not treated as static style ancestry', () => {
    assert.strictEqual(
        namesAtMarker("const key = 'hover'; const A = () => <div sz={{ [key]: { /*|*/ } }} />;")
            .length,
        0,
    );
});

test('pathological call ancestry stops at the traversal bound', () => {
    let nested = '{ /*|*/ }';
    for (let depth = 0; depth < 40; depth += 1) nested = `{ level${depth}: ${nested} }`;
    assert.strictEqual(
        namesAtMarker(`import { szr } from 'csszyx'; szr(${nested});`).length,
        0,
    );
});

test('incomplete value slots tolerate bounded whitespace before the colon', () => {
    const entries = entriesAtMarker('const A = () => <div sz={{ bg   : re/*|*/ }} />;');
    assert.ok(entries.some(entry => entry.name === 'red-500'));
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

// Mask layers are the first structured value that nests more than one level:
// a layer holds sides, a side holds stops, a stop splits position from colour.
// Assistance that stopped at the first level would go quiet exactly where the
// shape is least guessable.
test('mask layer keys offer their own members, not sz keys', () => {
    const names = namesAtMarker('const A = () => <div sz={{ maskLinear: { /*|*/ } }} />;');
    for (const member of ['angle', 'from', 'to', 't', 'r', 'b', 'l', 'x', 'y']) {
        assert.ok(names.includes(member), `expected maskLinear member "${member}"`);
    }
    // Crucially NOT sz keys — the layer is a structured value, not a variant.
    assert.ok(!names.includes('bg'), 'maskLinear must not offer sz keys');
    assert.ok(!names.includes('p'), 'maskLinear must not offer sz keys');
});

test('a mask side offers its stops', () => {
    const names = namesAtMarker(
        'const A = () => <div sz={{ maskLinear: { b: { /*|*/ } } }} />;',
    );
    assert.deepStrictEqual([...names].sort(), ['from', 'to']);
});

test('a mask stop offers position, colour and opacity', () => {
    const names = namesAtMarker(
        'const A = () => <div sz={{ maskLinear: { b: { from: { /*|*/ } } } }} />;',
    );
    assert.deepStrictEqual([...names].sort(), ['at', 'color', 'op']);
});

test('the radial and conic layers offer their own members', () => {
    const radial = namesAtMarker('const A = () => <div sz={{ maskRadial: { /*|*/ } }} />;');
    for (const member of ['at', 'size', 'shape', 'from', 'to']) {
        assert.ok(radial.includes(member), `expected maskRadial member "${member}"`);
    }
    const conic = namesAtMarker('const A = () => <div sz={{ maskConic: { /*|*/ } }} />;');
    assert.deepStrictEqual([...conic].sort(), ['angle', 'from', 'to']);
});

test('nesting below a scalar member stays silent', () => {
    // `angle` holds a number, so an object under it is invalid sz structure.
    assert.strictEqual(
        namesAtMarker('const A = () => <div sz={{ maskLinear: { angle: { /*|*/ } } }} />;').length,
        0,
    );
});

test('mask layer keys appear in the top-level sz key list', () => {
    // They carry no PROPERTY_MAP prefix, so every completion source that builds
    // its key list from that map alone would omit them.
    const names = namesAtMarker('const A = () => <div sz={{ /*|*/ }} />;');
    for (const key of ['maskLinear', 'maskRadial', 'maskConic']) {
        assert.ok(names.includes(key), `expected sz key "${key}"`);
    }
});
