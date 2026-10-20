import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as validator from './validate-undocumented-warnings.mjs';
import { extractSinkCallRegions, extractSinkMessages } from './validate-undocumented-warnings.mjs';

/**
 * The report finds messages by where they GO, not by which file declares them,
 * so the risk is in recognizing a sink call and capturing all of its argument
 * rather than the first line of it.
 */

test('captures an argument that spans several lines', () => {
    // Nearly every message here is a multi-line template or concatenation, so
    // stopping at the newline would capture only its opening fragment.
    const [region] = extractSinkCallRegions(
        ['console.warn(', '    `[csszyx] first half ` +', '        `second half`,', ');'].join(
            '\n',
        ),
    );
    assert.match(region, /first half/);
    assert.match(region, /second half/);
});

test('does not run past the end of the call', () => {
    const regions = extractSinkCallRegions('console.warn("inside"); const after = "outside";');
    assert.equal(regions.length, 1);
    assert.doesNotMatch(regions[0], /outside/);
});

test('handles a nested call inside the argument', () => {
    const [region] = extractSinkCallRegions('console.warn(format(name), "tail text");');
    assert.match(region, /tail text/);
});

test('finds messages behind the runtime warn helper', () => {
    // devWarn adds the prefix itself, so its call sites carry no marker to
    // search for — the sink name is what identifies them.
    const messages = extractSinkMessages(
        'devWarn(`szv()(selection): unknown variant "${key}" is not declared in the config`);',
    );
    assert.equal(messages.length, 1);
    assert.match(messages[0], /unknown variant/);
});

test('finds messages pushed onto the Rust diagnostics vector', () => {
    const messages = extractSinkMessages(
        'diagnostics.push(format!("[csszyx] {}: the walk stopped and no classes were collected", file));',
        true,
    );
    assert.equal(messages.length, 1);
    assert.match(messages[0], /no classes were collected/);
});

test('ignores a short argument that is not a message', () => {
    assert.deepEqual(extractSinkMessages('console.error("failed", err);'), []);
});

test('ignores a string that never reaches a sink', () => {
    assert.deepEqual(
        extractSinkMessages('const label = "a long constant string that is never warned about";'),
        [],
    );
});

test('finds a message handed to an injected warn callback', () => {
    // Helpers take the sink as a parameter so a caller can route it — the
    // safelist sweeper is called with `console.warn` — and the message inside
    // was invisible to a pattern that only knew the console.
    const messages = extractSinkMessages(
        'export function sweep(dir, warn) { warn("the legacy safelist was removed from this project, delete the @source line naming it"); }',
    );

    assert.equal(messages.length, 1);
    assert.match(messages[0], /legacy safelist was removed/);
});

test('finds a message a user only meets by hitting a thrown error', () => {
    const messages = extractSinkMessages(
        'throw new Error("production builds with turbopack need the csszyx safelist seeded first, run the prebuild command");',
    );

    assert.equal(messages.length, 1);
});

test('finds a message thrown as a type error', () => {
    const messages = extractSinkMessages(
        'throw new TypeError("splitBoxSz partitions sz objects, not raw class strings; use splitBox for a class string");',
    );

    assert.equal(messages.length, 1);
});

test('still ignores a short throw that is an internal invariant', () => {
    assert.deepEqual(extractSinkMessages('throw new Error("unreachable");'), []);
});

test('reads the code of a line the registry words, from the reporter and the compact form', () => {
    // Neither carries a sentence at the site: `szReport` names the registry
    // entry, and the production line is the code and its args.
    const codes = validator.extractSinkCodes(
        [
            "if (process.env.NODE_ENV !== 'production') szReport({ diagnostic: REMOVED_KEY, args, at });",
            'else console.warn(`[csszyx] removed-key: ${JSON.stringify(args)} https://csszyx.com/e/removed-key`);',
            "szReport({\n    diagnostic: CLOSED_ENUM_VALUE,\n    args: { form: 'dead', key, value },\n});",
            "console.error('[csszyx] mangle-map-unreadable: ' + JSON.stringify(args));",
            'console.warn(`[csszyx] Tip: run the scan`);',
        ].join('\n'),
    );

    assert.deepEqual(codes, [
        'removed-key',
        'removed-key',
        'closed-enum-value',
        'mangle-map-unreadable',
    ]);
});

test('a code no registry entry words is undocumented', () => {
    const diagnostics = [
        { id: 'removed-key', text: '`{key}` was removed.' },
        { id: 'unworded', summary: 'An id with no words yet.' },
    ];

    assert.deepEqual(
        validator.undocumentedCodes(['removed-key', 'unworded', 'made-up'], diagnostics),
        ['unworded', 'made-up'],
    );
});

test('reads no prose from the compact form, whose words are the registry entry', () => {
    assert.deepEqual(
        extractSinkMessages(
            'console.warn(`[csszyx] global-before-group: ${JSON.stringify(args)} https://csszyx.com/e/global-before-group`);\n' +
                "console.error('[csszyx] mangle-map-unreadable: ' + JSON.stringify(args) + ' https://csszyx.com/e/mangle-map-unreadable');",
        ),
        [],
    );
});

test('reads the code of a thrown csszyx error, whose words are the registry entry', () => {
    // A throw names its code, and its message is the registry's words in
    // development and the compact form in production: no prose at the site.
    const source = [
        'throw new CsszyxError({',
        "    code: 'lowering-not-loaded',",
        '    args,',
        "    message: process.env.NODE_ENV !== 'production'",
        '        ? szRender({ diagnostic: LOWERING_NOT_LOADED, args })',
        '        : `[csszyx] lowering-not-loaded: ${JSON.stringify(args)} https://csszyx.com/e/lowering-not-loaded`,',
        '});',
        'throw brandCsszyxError(new TypeError(szRender({ diagnostic: SPLIT_BOX_SZ_STRING, args })), {',
        "    code: 'split-box-sz-string',",
        '    args,',
        '});',
    ].join('\n');

    assert.deepEqual(
        new Set(validator.extractSinkCodes(source)),
        new Set(['lowering-not-loaded', 'split-box-sz-string']),
    );
    assert.deepEqual(extractSinkMessages(source), []);
});

test('reads a code field only from a thrown csszyx error', () => {
    // A diagnostics record pushed by the build has its own `code` field, which
    // names no registry entry.
    assert.deepEqual(
        validator.extractSinkCodes(
            "diagnostics.push({ code: 'registered-property', severity: 'error', name });",
        ),
        [],
    );
});

test('finds prose thrown through a csszyx error, which the registry does not word', () => {
    const messages = extractSinkMessages(
        "throw new CsszyxError({ code: 'lowering-not-loaded', args, message: 'the lowering module is not loaded so nothing can be lowered here' });",
    );

    assert.equal(messages.length, 1);
});
