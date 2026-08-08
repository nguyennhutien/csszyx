import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    extractDocumentedMessages,
    extractSourceLiterals,
    findMissingMessages,
    isFullyComposed,
    normalizeMessage,
} from './validate-warning-docs.mjs';

/**
 * The gate compares prose that two languages spell differently, so almost all
 * of its risk lives in the normalizer: too strict and it reports drift that is
 * not there until someone silences the gate, too loose and it passes a message
 * that no longer exists. These cases pin the exact spellings measured in the
 * repo rather than hypothetical ones.
 */

test('collapses TypeScript interpolation and its Rust positional twin', () => {
    const ts = normalizeMessage('"${key}: \'${color}\'" is not a recognized color value');
    const rust = normalizeMessage('"{}: \'{}\'" is not a recognized color value');
    assert.equal(ts, rust);
});

test('collapses named Rust placeholders against the doc spelling', () => {
    // The Rust source says `{column}`; warnings.mdx says `{col}`. Same message.
    const rust = normalizeMessage('unresolvable sz spread at {line}:{column}: falls back');
    const doc = normalizeMessage('unresolvable sz spread at {line}:{col}: falls back');
    assert.equal(rust, doc);
});

test('joins a TypeScript message split across concatenated literals', () => {
    const split = normalizeMessage(
        "`[csszyx] fontStyle: '${value}' is not supported — Tailwind only models ` +\n" +
            "            `'italic' and 'normal'.`",
    );
    assert.match(split, /is not supported/);
    assert.match(split, /tailwind only models/);
    // The glue itself must not survive into the compared text.
    assert.doesNotMatch(split, /\+/);
});

test('joins a Rust message split by a backslash line continuation', () => {
    const continued = normalizeMessage(
        '"[csszyx] AST budget exceeded in {}: the IR walk stopped mid-file, so the file was \\\n            left unchanged."',
    );
    // Words only, so the hyphen in "mid-file" is a separator like any other.
    assert.match(continued, /stopped mid file/);
    assert.match(continued, /left unchanged/);
});

test('treats the [csszyx] prefix as optional', () => {
    // Runtime warnings omit it at the call site; devWarn adds it.
    assert.equal(
        normalizeMessage('[csszyx] szv(): unknown variant'),
        normalizeMessage('szv(): unknown variant'),
    );
});

test('unescapes the MDX pipe a table cell has to escape', () => {
    const doc = normalizeMessage('only string-literal values ("csr" \\| "dev-only") are supported');
    const source = normalizeMessage(
        'only string-literal values ("csr" | "dev-only") are supported',
    );
    assert.equal(doc, source);
});

test('collapses the doubled braces Rust needs to print one', () => {
    const rust = normalizeMessage('Use array form: sz={{[x, {{ ... }}]}}.');
    const doc = normalizeMessage('Use array form: sz={[x, { ... }]}.');
    assert.equal(rust, doc);
});

test('keeps wording differences visible', () => {
    // The whole point: a reworded message must NOT normalize equal.
    assert.notEqual(
        normalizeMessage('is not a recognized color value and will be ignored'),
        normalizeMessage('is not a recognized color value and is dropped'),
    );
});

test('extracts inline code spans that carry a message', () => {
    const mdx = [
        '| Message | Class |',
        '| --- | --- |',
        '| `[csszyx] Unknown property "{key}" in sz prop. Check for typos.` | nudge |',
    ].join('\n');
    const found = extractDocumentedMessages(mdx);
    assert.equal(found.length, 1);
    assert.match(found[0].text, /Unknown property/);
});

test('extracts a message from a text fence', () => {
    const mdx = [
        '```text',
        '[csszyx] szv() returned an sz OBJECT that was used as a string.',
        '```',
    ].join('\n');
    const found = extractDocumentedMessages(mdx);
    assert.equal(found.length, 1);
    assert.match(found[0].text, /returned an sz OBJECT/);
});

test('ignores spans too short to be a message', () => {
    // `[csszyx]` alone is documentation about the prefix, not a message.
    const found = extractDocumentedMessages(
        'The prefix is `[csszyx]` and `quiet: true` silences it.',
    );
    assert.deepEqual(found, []);
});

test('reports a documented message that no source file contains', () => {
    const missing = findMissingMessages(
        [{ text: 'this message was deleted from the source', line: 7 }],
        normalizeMessage('a totally unrelated message body that is long enough'),
    );
    assert.equal(missing.length, 1);
    assert.equal(missing[0].line, 7);
});

test('accepts a documented message the source still contains', () => {
    const haystack = normalizeMessage(
        "`[csszyx] fontStyle: '${value}' is not supported — Tailwind only models 'italic'.`",
    );
    const missing = findMissingMessages(
        [
            {
                text: "fontStyle: '{value}' is not supported — Tailwind only models 'italic'.",
                line: 1,
            },
        ],
        haystack,
    );
    assert.deepEqual(missing, []);
});

/**
 * Literal extraction has to be a scanner, not a regex: an apostrophe in a
 * comment or a Rust lifetime opens a quote that never closes, and everything
 * after it is read as string content. Measured before these cases existed —
 * whole function bodies were being collected as "messages", which made the gate
 * report every documented line as missing.
 */

test('does not let an apostrophe in a line comment open a string', () => {
    const literals = extractSourceLiterals(
        ["// Tailwind's scale doesn't include this.", 'const m = "the real message here";'].join(
            '\n',
        ),
    );
    assert.deepEqual(literals, ['the real message here']);
});

test('does not let an apostrophe in a block comment open a string', () => {
    const literals = extractSourceLiterals(
        [
            '/* the compiler cannot read a caller-supplied value */',
            'const m = "the real message";',
        ].join('\n'),
    );
    assert.deepEqual(literals, ['the real message']);
});

test('does not read a Rust lifetime as a string', () => {
    const literals = extractSourceLiterals(
        "fn f<'a>(s: &'a str) -> &'a str { \"the real message\" }",
        { rust: true },
    );
    assert.deepEqual(literals, ['the real message']);
});

test('reads a Rust raw string', () => {
    const literals = extractSourceLiterals('let m = r#"a raw message with "quotes" inside"#;', {
        rust: true,
    });
    assert.equal(literals.length, 1);
    assert.match(literals[0], /a raw message with quotes inside/);
});

test('merges literals a plus sign joins across lines', () => {
    const literals = extractSourceLiterals(
        ['const m =', '    `the first half ` +', '        `and the second half`;'].join('\n'),
    );
    assert.deepEqual(literals, ['the first half and the second half']);
});

test('keeps two unrelated literals apart', () => {
    const literals = extractSourceLiterals(
        'const a = "first message"; const b = "second message";',
    );
    assert.deepEqual(literals, ['first message', 'second message']);
});

test('skips a URL that is not a comment', () => {
    const literals = extractSourceLiterals('const u = "https://csszyx.com/docs/monorepo";');
    assert.deepEqual(literals, ['https csszyx com docs monorepo']);
});

test('skips a Rust char literal that holds a quote character', () => {
    // A lexer compares against `'"'` and `'\''`; reading either as a string
    // delimiter leaves an unmatched quote and desynchronizes the rest of the
    // file. Measured: 17 such literals in the engine, and they were enough to
    // make the scanner return function bodies instead of messages.
    const literals = extractSourceLiterals(
        ["if matches!(c, '\"' | '\\'' | '`') {", '    report("the real message");', '}'].join('\n'),
        { rust: true },
    );
    assert.deepEqual(literals, ['the real message']);
});

test('does not let a quote inside a regex literal open a string', () => {
    // Measured on the plugin source: `/([,(]|&&)(\s*)"([^"]+)"/g` desynchronized
    // the scanner, and every message declared after it went unseen — the gate
    // then reported those documented lines as missing.
    const literals = extractSourceLiterals(
        [
            'const out = s.replace(/([,(]|&&)(\\s*)"([^"]+)"/g, f);',
            'report("the real message");',
        ].join('\n'),
    );
    assert.deepEqual(literals, ['the real message']);
});

test('still treats a division slash as division', () => {
    const literals = extractSourceLiterals(
        ['const ratio = total / count;', 'log("after division");'].join('\n'),
    );
    assert.deepEqual(literals, ['after division']);
});

/**
 * The verdict rule. An earlier version accepted a message when any long enough
 * run of it survived, and that was measurably too weak: rewording the middle of
 * a long message left other runs intact and the gate stayed green through a real
 * two-file edit. Every word has to be accounted for instead.
 */

test('accepts a message assembled from two source fragments', () => {
    // Printed as `active parser: ${detail}`, so no literal holds the whole line.
    const haystack = ['active parser', 'rust native engine'].join('\n');
    assert.equal(isFullyComposed('active parser rust native engine', haystack), true);
});

test('rejects a message whose tail was reworded', () => {
    const haystack = 'is not a recognized color value and will be ignored';
    assert.equal(
        isFullyComposed('is not a recognized color value and is dropped', haystack),
        false,
    );
});

test('rejects a reworded middle even when the rest still matches', () => {
    const haystack = 'the class is still emitted so it styles nothing check for typos';
    assert.equal(
        isFullyComposed(
            'the class is never emitted so it styles nothing check for typos',
            haystack,
        ),
        false,
    );
});

test('rejects a message nothing in source resembles', () => {
    assert.equal(
        isFullyComposed('a message that was never implemented', 'unrelated source text'),
        false,
    );
});

test('reports the longest surviving run so the diff is findable', () => {
    const missing = findMissingMessages(
        [{ text: 'the class is never emitted so it styles nothing', line: 12 }],
        'the class is still emitted so it styles nothing',
    );
    assert.equal(missing.length, 1);
    assert.equal(missing[0].line, 12);
    // "so it styles nothing" survived; the count points at how much did.
    assert.ok(missing[0].anchor > 0, 'expected a partial run to be reported');
});

test('extracts an unprefixed span long enough to be a quoted message', () => {
    // The fallback table splits a message into reason and suggestion cells,
    // neither of which carries the prefix.
    const found = extractDocumentedMessages(
        '| `identifier {detail} could not be resolved to a static value` | nudge |',
    );
    assert.equal(found.length, 1);
});

test('ignores a short unprefixed span that is only prose', () => {
    const found = extractDocumentedMessages('Set `build.parser` to silence it.');
    assert.deepEqual(found, []);
});

test('ignores a fence line that is only illustration', () => {
    // The filename header and the indented detail lines are example data.
    const found = extractDocumentedMessages(
        ['```text', '[csszyx] /src/components/Card.tsx', '  sz object was {"p":4}', '```'].join(
            '\n',
        ),
    );
    assert.deepEqual(found, []);
});
