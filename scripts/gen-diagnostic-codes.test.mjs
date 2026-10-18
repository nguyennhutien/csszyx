/**
 * The registry's rules, checked on small registries built for each rule, and
 * the generated files checked against the registry they come from.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import * as registry from './diagnostics/registry.mjs';
import {
    casingProblems,
    placeholdersOf,
    publicData,
    renderRegistryModule,
    renderRust,
    renderTypeScript,
    settableIds,
    snakeName,
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

test('a computed value counts the args it reads, and may not share an arg name', () => {
    const input = registryOf([
        entry({
            args: { key: { type: 'string' }, hint: { type: 'string' } },
            text: '{shown}.',
        }),
    ]);
    input.COMPUTED = { shown: { reads: ['key', 'hint'], summary: 'Both.' } };
    assert.deepEqual(validateRegistry(input), []);
    input.DIAGNOSTICS[0].args.shown = { type: 'string' };
    assert.match(
        validateRegistry(input).join('\n'),
        /\{shown\} is both an arg and a computed value/,
    );
});

test('an engine id has a place and declared args, and a list arg its joiner', () => {
    assert.match(
        validateRegistry(registryOf([entry({ position: 'none' })])).join('\n'),
        /never at no place/,
    );
    assert.match(
        validateRegistry(registryOf([entry({ args: undefined })])).join('\n'),
        /declares its args/,
    );
    assert.match(
        validateRegistry(registryOf([entry({ args: { keys: { type: 'string[]' } } })])).join('\n'),
        /list argument keys declares no joiner/,
    );
});

test('a template keyed by an arg other than form names that enum arg', () => {
    const base = {
        args: { site: { type: ['enum', 'sz', 'szr'] } },
        variesBy: 'site',
        text: { sz: 'One.', szr: 'Two.' },
    };
    assert.deepEqual(validateRegistry(registryOf([entry(base)])), []);
    assert.match(
        validateRegistry(registryOf([entry({ ...base, text: { szv: 'Three.' } })])).join('\n'),
        /has a text for szv, which is not a value of site/,
    );
    assert.match(
        validateRegistry(
            registryOf([entry({ ...base, args: { site: { type: 'string' } }, text: 'One.' })]),
        ).join('\n'),
        /varies by site, which is not one of its enum args/,
    );
});

test('templates may only name arguments, and every required argument is used', () => {
    assert.match(
        validateRegistry(registryOf([entry({ text: 'Unknown "{key}" at {where}' })])).join('\n'),
        /names \{where\}, which is neither an argument nor a computed value/,
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
                    text: 'Unknown "{key}" in { p: 4 }.',
                    help: 'did you mean "{hint}"?',
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
        /text for b, which is not a value of form/,
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

test('each engine form gets a constructor that names its args in registry order', () => {
    const input = registryOf([
        entry({
            id: 'mangle-vars-hoist-skipped',
            forms: ['a', 'b'],
            args: {
                form: { type: ['enum', 'a', 'b'] },
                name: { type: 'string' },
                usageCount: { type: 'number' },
                reason: { type: ['enum', 'no-lca', 'max-depth'] },
                maxDepth: { type: 'number', optional: true },
                parts: { type: 'string[]', joiner: ', ' },
            },
        }),
        entry({ id: 'style-override', args: {} }),
    ]);
    const rust = renderRust(input);
    assert.match(
        rust,
        /pub fn mangle_vars_hoist_skipped_a\(name: &str, usage_count: u64, reason: &'static str, max_depth: Option<u64>, parts: Vec<String>\)/,
    );
    assert.match(rust, /pub fn mangle_vars_hoist_skipped_b\(/);
    assert.match(
        rust,
        /Args::default\(\)\.text\("form", "a"\)\.text\("name", name\)\.count\("usageCount", usage_count\)/,
    );
    assert.match(rust, /debug_assert!\(\["no-lca", "max-depth"\]\.contains\(&reason\)\);/);
    assert.match(rust, /\.optional_count\("maxDepth", max_depth\)\.list\("parts", parts\)/);
    assert.match(
        rust,
        /pub fn style_override\(\) -> \(DiagnosticCode, Args\) \{\n\(DiagnosticCode::StyleOverride, Args::default\(\)\)/,
    );
    assert.equal(snakeName('usageCount'), 'usage_count');
    const ts = renderTypeScript(input);
    assert.match(
        ts,
        /'mangle-vars-hoist-skipped': \{ readonly form: 'a' \| 'b'; readonly name: string; readonly usageCount: number; readonly reason: 'no-lca' \| 'max-depth'; readonly maxDepth\?: number; readonly parts: readonly string\[\]; \};/,
    );
    assert.match(ts, /'style-override': \{ {2}\};/);
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
    assert.match(
        ts,
        /Readonly<Record<'other', string \| undefined>> = \{\n {4}'other': undefined,\n\};/,
    );
    const none = renderTypeScript(registryOf([entry()], []));
    assert.match(none, /Readonly<Record<never, string \| undefined>> = \{\n\};/);
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

test('a sentence starts upper-case or with a code span, and ends with a period', () => {
    assert.deepEqual(casingProblems('text', '`{key}` is not an sz property.'), []);
    assert.deepEqual(casingProblems('text', 'This `sz` value is unread.'), []);
    assert.deepEqual(casingProblems('text', '{reason}.', new Set(['reason'])), []);
    assert.match(casingProblems('text', 'csszyx could not parse it.').join('\n'), /upper-case/);
    assert.match(casingProblems('text', 'This is unread').join('\n'), /does not end with a period/);
    // An arg is third-party text: its casing is not the template's.
    assert.match(casingProblems('text', '{message}.').join('\n'), /upper-case/);
});

test('help and note are one lower-case clause, further advice after `;`', () => {
    const help = "check the spelling; for a custom utility, define it with Tailwind's `@utility`.";
    assert.deepEqual(casingProblems('help', help), []);
    assert.deepEqual(casingProblems('note', '`szs` is left unchanged.'), []);
    assert.deepEqual(casingProblems('help', '{hint}; or not.', new Set(['hint'])), []);
    // A period inside a code span or a number ends no sentence.
    assert.deepEqual(casingProblems('help', 'use `a. B` or `1.5`; in Vue JSX, `x`.'), []);
    assert.match(casingProblems('help', 'Check the spelling.').join('\n'), /lower-case/);
    // A proper noun may sit anywhere but at the start.
    assert.match(casingProblems('note', 'Vue JSX merges every class.').join('\n'), /lower-case/);
    assert.match(
        casingProblems('help', 'check the spelling. For a utility, use `@utility`.').join('\n'),
        /second sentence/,
    );
    assert.match(
        casingProblems('help', 'check the spelling. Tailwind serves it.').join('\n'),
        /second sentence/,
    );
    assert.match(
        casingProblems('help', 'check the spelling? Then rebuild.').join('\n'),
        /second sentence/,
    );
    assert.match(
        casingProblems('help', 'check the spelling; For a utility, use it.').join('\n'),
        /after `;`/,
    );
    assert.match(casingProblems('help', '{key} is wrong.').join('\n'), /lower-case/);
});

test('the registry check applies the casing rule to every field and form', () => {
    assert.match(
        validateRegistry(registryOf([entry({ text: 'unknown `{key}`.' })])).join('\n'),
        /diagnostic "unknown-key": text: starts/,
    );
    assert.match(
        validateRegistry(
            registryOf([
                entry({
                    forms: ['a', 'b'],
                    args: { key: { type: 'string' }, form: { type: ['enum', 'a', 'b'] } },
                    text: { a: 'Unknown `{key}`.', b: 'Unknown `{key}`.' },
                    note: { b: 'Fine. Then not.' },
                }),
            ]),
        ).join('\n'),
        /note \(b\): .*second sentence/,
    );
});
