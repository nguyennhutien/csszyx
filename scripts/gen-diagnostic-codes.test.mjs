/**
 * The registry's rules, checked on small registries built for each rule, and
 * the generated files checked against the registry they come from.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import * as registry from './diagnostics/registry.mjs';
import {
    placeholdersOf,
    publicData,
    renderRegistryModule,
    renderRust,
    renderTypeScript,
    settableIds,
    validateRegistry,
    variantName,
} from './gen-diagnostic-codes.mjs';

/**
 * A registry holding one group and the given entries.
 *
 * @param {object[]} diagnostics - Entries.
 * @param {object[]} [removed] - Tombstones.
 * @returns {object} A registry module shape.
 */
function registryOf(diagnostics, removed = []) {
    return {
        REGISTRY_FORMAT: 1,
        GROUPS: [{ id: 'sz-diagnostic', summary: 'Engine diagnostics.' }],
        DIAGNOSTICS: diagnostics,
        REMOVED: removed,
    };
}

/**
 * A valid engine entry, with overrides.
 *
 * @param {object} [overrides] - Fields to replace.
 * @returns {object} The entry.
 */
function entry(overrides = {}) {
    return {
        id: 'unknown-key',
        summary: 'A key no sz table knows.',
        surfaces: { engine: {} },
        position: 'site',
        args: { key: { type: 'string' } },
        sources: ['packages/core/src/transform/engine.rs:1'],
        ...overrides,
    };
}

test('the committed registry keeps every rule', () => {
    assert.deepEqual(validateRegistry(registry), []);
});

test('a placeholder is a camelCase name in braces; every other brace is text', () => {
    assert.deepEqual(placeholdersOf("Use { {canonical}: '{value}' } instead"), [
        'canonical',
        'value',
    ]);
    assert.deepEqual(placeholdersOf('sz={{ p: 4 }} and ${x} and {Key} and {1}'), []);
});

test('an id must be kebab and unique across groups, codes and tombstones', () => {
    assert.match(
        validateRegistry(registryOf([entry({ id: 'Unknown_Key' })])).join('\n'),
        /not a kebab id/,
    );
    assert.match(
        validateRegistry(registryOf([entry(), entry()])).join('\n'),
        /"unknown-key" is defined twice/,
    );
    assert.match(
        validateRegistry(
            registryOf(
                [entry()],
                [{ id: 'unknown-key', since: '0.18.0', was: 'check-kind', reason: 'x' }],
            ),
        ).join('\n'),
        /defined twice/,
    );
    assert.match(
        validateRegistry(registryOf([entry({ id: 'sz-diagnostic' })])).join('\n'),
        /defined twice/,
    );
    // A pass's own kind shares the pass id, once.
    const passKind = entry({
        id: 'sz-diagnostic',
        surfaces: { check: { group: 'sz-diagnostic' } },
    });
    assert.deepEqual(validateRegistry(registryOf([passKind])), []);
    assert.match(validateRegistry(registryOf([passKind, passKind])).join('\n'), /defined twice/);
});

test('a removed error code may predate the kebab grammar', () => {
    const removed = {
        id: 'CSSZYX_NATIVE_UNAVAILABLE',
        since: '0.10.0',
        replacedBy: 'unknown-key',
        was: 'error-code',
        reason: 'x',
    };
    assert.deepEqual(validateRegistry(registryOf([entry()], [removed])), []);
    assert.match(
        validateRegistry(registryOf([entry()], [{ ...removed, was: 'check-kind' }])).join('\n'),
        /not a kebab id/,
    );
    assert.match(
        validateRegistry(registryOf([entry()], [{ ...removed, replacedBy: 'gone' }])).join('\n'),
        /is not live/,
    );
});

test('surfaces, groups, levels and positions are checked', () => {
    assert.match(validateRegistry(registryOf([entry({ surfaces: {} })])).join('\n'), /no surface/);
    assert.match(
        validateRegistry(registryOf([entry({ surfaces: { lint: {} } })])).join('\n'),
        /unknown surface/,
    );
    assert.match(
        validateRegistry(registryOf([entry({ surfaces: { check: { group: 'nope' } } })])).join(
            '\n',
        ),
        /not a group id/,
    );
    assert.match(
        validateRegistry(
            registryOf([
                entry({
                    surfaces: { runtime: { production: false } },
                    defaults: { recommended: 'info', atomic: 'warn' },
                }),
            ]),
        ).join('\n'),
        /no level can be set/,
    );
    assert.match(
        validateRegistry(
            registryOf([entry({ defaults: { recommended: 'loud', atomic: 'warn' } })]),
        ).join('\n'),
        /default level for recommended/,
    );
    assert.match(
        validateRegistry(registryOf([entry({ position: 'line' })])).join('\n'),
        /position must be/,
    );
    assert.match(
        validateRegistry(registryOf([entry({ summary: 'one\ntwo' })])).join('\n'),
        /more than one line/,
    );
});

test('arguments, forms and gaps are checked', () => {
    assert.match(
        validateRegistry(registryOf([entry({ args: { Key: { type: 'string' } } })])).join('\n'),
        /camelCase/,
    );
    assert.match(
        validateRegistry(registryOf([entry({ args: { key: { type: 'object' } } })])).join('\n'),
        /unknown type/,
    );
    assert.match(
        validateRegistry(
            registryOf([entry({ args: { key: { type: 'string', joiner: ', ' } } })]),
        ).join('\n'),
        /joiner but is not a list/,
    );
    assert.match(
        validateRegistry(
            registryOf([entry({ forms: ['a', 'b'], args: { form: { type: ['enum', 'a'] } } })]),
        ).join('\n'),
        /forms must equal/,
    );
    assert.deepEqual(
        validateRegistry(
            registryOf([
                entry({ forms: ['a', 'b'], args: { form: { type: ['enum', 'b', 'a'] } } }),
            ]),
        ),
        [],
    );
    assert.match(
        validateRegistry(registryOf([entry({ gaps: ['engine'] })])).join('\n'),
        /both a surface and a gap/,
    );
});

test('templates may only name arguments, and every required argument is used', () => {
    assert.match(
        validateRegistry(registryOf([entry({ text: 'Unknown "{key}" at {where}' })])).join('\n'),
        /names \{where\}, which is not an argument/,
    );
    assert.match(
        validateRegistry(
            registryOf([
                entry({
                    args: { key: { type: 'string' }, hint: { type: 'string' } },
                    text: 'Unknown "{key}"',
                }),
            ]),
        ).join('\n'),
        /required argument hint is used by no template/,
    );
    assert.deepEqual(
        validateRegistry(
            registryOf([
                entry({
                    args: { key: { type: 'string' }, hint: { type: 'string', optional: true } },
                    text: 'Unknown "{key}" in { p: 4 }',
                    help: 'Did you mean "{hint}"?',
                }),
            ]),
        ),
        [],
    );
    assert.match(
        validateRegistry(
            registryOf([
                entry({
                    forms: ['a'],
                    args: { key: { type: 'string' }, form: { type: ['enum', 'a'] } },
                    text: { b: '{key}' },
                }),
            ]),
        ).join('\n'),
        /text for b, which is not one of its forms/,
    );
});

test('the Rust enum carries only what the engine emits', () => {
    const input = registryOf([
        entry(),
        entry({ id: 'theme-collision', surfaces: { check: { group: 'sz-diagnostic' } }, args: {} }),
    ]);
    const rust = renderRust(input);
    assert.match(rust, /UnknownKey,/);
    assert.doesNotMatch(rust, /ThemeCollision/);
    assert.match(rust, /\[DiagnosticCode; 1\]/);
    assert.equal(variantName('mangle-vars-hoist-skipped'), 'MangleVarsHoistSkipped');
});

test('the TypeScript ids follow the registry', () => {
    const input = registryOf(
        [
            entry({ defaults: { recommended: 'info', atomic: 'warn' } }),
            entry({
                id: 'web-crypto-unavailable',
                surfaces: { runtime: { production: true }, error: {} },
                args: {},
            }),
        ],
        [{ id: 'other', since: '0.18.0', was: 'check-kind', reason: 'x' }],
    );
    const ts = renderTypeScript(input);
    assert.match(ts, /'unknown-key': \['info', 'warn'\]/);
    assert.match(ts, /'other': undefined/);
    assert.deepEqual(settableIds(input), ['sz-diagnostic', 'unknown-key']);
    assert.match(
        ts,
        /export type SzDiagnosticId =\n {4}\| 'unknown-key'\n {4}\| 'web-crypto-unavailable';/,
    );
});

test('the Node registry module carries the public data and no review metadata', () => {
    const input = registryOf([entry()]);
    const data = publicData(input);
    assert.equal(data.diagnostics[0].sources, undefined);
    assert.ok(renderRegistryModule(input).includes(JSON.stringify(data.diagnostics, null, 4)));
});
