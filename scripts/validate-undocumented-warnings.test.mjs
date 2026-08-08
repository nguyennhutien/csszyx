import assert from 'node:assert/strict';
import { test } from 'node:test';

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
