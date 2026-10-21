/**
 * The registry's rules, checked on small registries built for each rule, and
 * the generated files checked against the registry they come from.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { productionLookups, readLookupTables } from './diagnostics/docs-lookups.mjs';
import * as registry from './diagnostics/registry.mjs';
import * as generator from './gen-diagnostic-codes.mjs';
import {
    casingProblems,
    docsData,
    EDITOR_IDS,
    NATIVE_IDS,
    PLACEHOLDER_PATTERN,
    placeholdersOf,
    publicData,
    RENDER_FIELDS,
    renderEditorTemplates,
    renderNativeWordsModule,
    renderRegistryModule,
    renderRust,
    renderSpecModule,
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
    assert.deepEqual(validateRegistry(registry, generator.browserSourceFiles?.()), []);
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

test('a console line prints in production for all forms, none, or the forms it lists', () => {
    const runtime = production =>
        entry({
            surfaces: { runtime: { production, host: 'node' } },
            position: 'none',
            forms: ['a', 'b'],
            args: { form: { type: ['enum', 'a', 'b'] } },
        });
    assert.deepEqual(validateRegistry(registryOf([runtime(['b'])])), []);
    assert.match(
        validateRegistry(registryOf([runtime(['c'])])).join('\n'),
        /prints in production for form c, which is not one of its forms/,
    );
    assert.match(
        validateRegistry(registryOf([runtime([])])).join('\n'),
        /lists no production form; write `production: false`/,
    );
    assert.match(
        validateRegistry(registryOf([runtime('yes')])).join('\n'),
        /runtime production is true, false or a list of forms/,
    );
    assert.match(
        validateRegistry(
            registryOf([
                entry({
                    surfaces: { runtime: { production: ['a'], host: 'node' } },
                    position: 'none',
                }),
            ]),
        ).join('\n'),
        /prints in production for form a, which is not one of its forms/,
    );
});

test('a console line printed as an error says so; nothing else is a sink', () => {
    const runtime = console =>
        entry({
            surfaces: { runtime: { production: true, console, host: 'node' } },
            position: 'none',
        });
    assert.deepEqual(validateRegistry(registryOf([runtime('error')])), []);
    assert.deepEqual(validateRegistry(registryOf([runtime(undefined)])), []);
    assert.match(
        validateRegistry(registryOf([runtime('log')])).join('\n'),
        /runtime console is `error`, or absent for `console.warn`/,
    );
    // The ids whose line prints through `console.error` today say so.
    const errors = registry.DIAGNOSTICS.filter(({ surfaces }) => surfaces.runtime?.console)
        .map(({ id }) => id)
        .sort();
    assert.deepEqual(errors, [
        'hydration-aborted',
        'mangle-map-unreadable',
        'recovery-manifest-unreadable',
        'sz-attribute-syntax',
    ]);
});

test('a console line and a throw say where they run, and their sources agree', () => {
    const browserFiles = new Set(['packages/runtime/src/hydration.ts']);
    const at = (surfaces, sources) =>
        validateRegistry(
            registryOf([entry({ surfaces, sources, position: surfaces.engine ? 'site' : 'none' })]),
            browserFiles,
        ).join('\n');
    const RUNTIME = 'packages/runtime/src/hydration.ts:1';
    const NODE = 'packages/unplugin/src/unplugin.ts:1';
    assert.equal(at({ runtime: { production: true, host: 'browser' } }, [RUNTIME]), '');
    assert.equal(at({ runtime: { production: false, host: 'node' } }, [NODE]), '');
    assert.equal(at({ runtime: { production: true, host: 'both' } }, [RUNTIME, NODE]), '');
    // A throw in Node and a line in the browser make the pair both.
    assert.equal(
        at({ runtime: { production: true, host: 'browser' }, error: { host: 'node' } }, [
            RUNTIME,
            NODE,
        ]),
        '',
    );
    // An engine or check id renders in Node too.
    assert.equal(
        at({ engine: {}, runtime: { production: true, host: 'browser' } }, [
            'packages/core/src/transform/engine.rs:1',
            RUNTIME,
        ]),
        '',
    );
    assert.match(
        at({ runtime: { production: true } }, [RUNTIME]),
        /runtime host is browser, node or both/,
    );
    assert.match(at({ error: {} }, [RUNTIME]), /error host is browser, node or both/);
    assert.match(
        at({ runtime: { production: true, host: 'node' } }, [RUNTIME]),
        /runs in node by its surfaces, but its sources run in browser/,
    );
    assert.match(
        at({ runtime: { production: true, host: 'browser' } }, [RUNTIME, NODE]),
        /runs in browser by its surfaces, but its sources run in browser and node/,
    );
});

test('the browser files are the ones a browser entry reaches', () => {
    const files = generator.browserSourceFiles?.() ?? new Set();
    for (const file of [
        'packages/runtime/src/hydration.ts',
        'packages/dynamic/src/injector.ts',
        'packages/csszyx/src/browser.ts',
        'packages/csszyx/src/parse-sz-attribute.ts',
        'packages/compiler/src/transform-core.ts',
        'packages/compiler/src/bool-class.ts',
    ]) {
        assert.ok(files.has(file), file);
    }
    for (const file of [
        'packages/compiler/src/engine.ts',
        'packages/compiler/src/template-sz.ts',
        'packages/unplugin/src/unplugin.ts',
        'packages/compiler/src/diagnostic-registry.generated.ts',
    ]) {
        assert.ok(!files.has(file), file);
    }
});

test('the Node registry keeps the engine words; Node-only words have a module of their own', () => {
    const words = { text: 'It went.', help: 'do this.', note: 'it stays.' };
    const input = registryOf([
        entry({ id: 'engine-one', ...words }),
        entry({
            id: 'browser-one',
            surfaces: { runtime: { production: true, host: 'browser' } },
            position: 'none',
            ...words,
        }),
        entry({
            id: 'node-one',
            surfaces: { runtime: { production: false, host: 'node' } },
            position: 'none',
            ...words,
        }),
        entry({
            id: 'both-one',
            surfaces: { runtime: { production: true, host: 'both' } },
            position: 'none',
            ...words,
        }),
        entry({
            id: 'thrown-in-node',
            surfaces: { runtime: { production: true, host: 'browser' }, error: { host: 'node' } },
            position: 'none',
            ...words,
        }),
        entry({ id: 'checked', surfaces: { check: { group: 'sz-diagnostic' } }, ...words }),
    ]);
    const source = renderRegistryModule(input);
    const registryOfModule = JSON.parse(
        source
            .slice(
                source.indexOf('= [', source.indexOf('export const SZ_DIAGNOSTIC_RENDER_SPECS:')) +
                    2,
            )
            .replace(/;\s*$/, ''),
    );
    const worded = registryOfModule.filter(spec => spec.text !== undefined).map(spec => spec.id);
    // `./engine` loads this module and renders engine ids only.
    assert.deepEqual(worded, ['engine-one']);
    // The other ids Node renders: a check pass, a Node or both line, a Node throw.
    const nodeWords = generator.renderNodeWordsModule?.(input) ?? '';
    const listed = JSON.parse(
        nodeWords
            .slice(nodeWords.indexOf('= {', nodeWords.indexOf('SZ_NODE_DIAGNOSTIC_WORDS:')) + 2)
            .replace(/;\s*$/, '') || '{}',
    );
    assert.deepEqual(Object.keys(listed), ['node-one', 'both-one', 'thrown-in-node', 'checked']);
    assert.deepEqual(listed['node-one'], { text: 'It went.', help: 'do this.', note: 'it stays.' });
    // The renderer reads only what a line is rendered from; the full
    // specification, for tests and tools, keeps every id's metadata.
    const browser = registryOfModule.find(spec => spec.id === 'browser-one');
    assert.deepEqual(Object.keys(browser), ['id', 'position', 'args']);
    for (const spec of registryOfModule) {
        for (const field of Object.keys(spec)) assert.ok(RENDER_FIELDS.includes(field), field);
    }
    const full = renderSpecModule(input);
    const specOfModule = JSON.parse(
        full
            .slice(full.indexOf('= [', full.indexOf('export const SZ_DIAGNOSTIC_REGISTRY:')) + 2)
            .replace(/;\s*$/, ''),
    );
    assert.deepEqual(Object.keys(specOfModule.find(spec => spec.id === 'browser-one')), [
        'id',
        'summary',
        'surfaces',
        'position',
        'args',
    ]);
    assert.deepEqual(
        specOfModule.filter(spec => spec.text !== undefined).map(spec => spec.id),
        ['engine-one'],
    );
    // The docs keep every word: their data is built from the registry, not this module.
    assert.equal(publicData(input).diagnostics[1].text, 'It went.');
});

test('the report entry names every export: the reporter and each browser id', () => {
    const source = generator.renderReportEntry?.(registry) ?? '';
    assert.ok(!source.includes('export *'));
    assert.match(
        source,
        /export \{ type SzReportOptions, szRender, szReport \} from '\.\/diagnostic-report\.js';/,
    );
    assert.match(
        source,
        /export type \{ SzBrowserDiagnostic \} from '\.\/diagnostic-template\.js';/,
    );
    // The suggestion an unknown key's line names is computed on the
    // development branch only, so it ships from the development entry.
    assert.match(source, /export \{ suggestSzKey \} from '\.\/sz-key-suggestion\.js';/);
    const names = /export \{([^}]*)\} from '\.\/diagnostic-browser\.generated\.js';/
        .exec(source)?.[1]
        .split(',')
        .map(name => name.trim())
        .filter(Boolean);
    assert.deepEqual(
        [...names].sort(),
        generator
            .browserDiagnostics(registry)
            .map(({ id }) => generator.browserConstName(id))
            .sort(),
    );
});

test('a throw states whether a production build reaches it', () => {
    const thrown = error =>
        entry({ surfaces: { error: { host: 'node', ...error } }, position: 'none' });
    assert.deepEqual(validateRegistry(registryOf([thrown({ production: false })])), []);
    assert.deepEqual(validateRegistry(registryOf([thrown({})])), []);
    assert.match(
        validateRegistry(registryOf([thrown({ production: 'no' })])).join('\n'),
        /error production is true or false/,
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

test('every id declares its args, a runtime one too', () => {
    const runtime = {
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
    };
    assert.match(
        validateRegistry(registryOf([entry({ ...runtime, args: undefined })])).join('\n'),
        /declares its args/,
    );
    assert.deepEqual(validateRegistry(registryOf([entry({ ...runtime, args: {} })])), []);
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
    // A thrown error's `code`: the ids with an error surface, and only those.
    assert.match(ts, /export type SzErrorCode =\n {4}\| 'web-crypto-unavailable';/);
    assert.match(renderTypeScript(registryOf([entry()], [])), /export type SzErrorCode = never;/);
});

test('the spec module carries the public data and no review metadata', () => {
    const input = registryOf([entry()]);
    const data = publicData(input);
    assert.equal(data.diagnostics[0].sources, undefined);
    assert.ok(renderSpecModule(input).includes(JSON.stringify(data.diagnostics, null, 4)));
    // The render specs carry an arg's joiner alone, never its type.
    assert.ok(!renderRegistryModule(input).includes('"type"'));
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

test('the browser module names each worded console or thrown id as a constant', () => {
    assert.equal(generator.browserConstName?.('removed-key'), 'REMOVED_KEY');
    assert.equal(generator.browserConstName?.('csr-recovery-dev-only'), 'CSR_RECOVERY_DEV_ONLY');
    const ids = generator.browserDiagnostics?.(registry).map(({ id }) => id) ?? [];
    // A runtime id and an engine id the runtime also prints are in it; an
    // engine-only id is not.
    assert.ok(ids.includes('mangle-census-unreadable'));
    assert.ok(ids.includes('removed-key'));
    assert.ok(!ids.includes('runtime-value'));
    for (const entry of registry.DIAGNOSTICS) {
        const expected =
            (entry.surfaces.runtime !== undefined || entry.surfaces.error !== undefined) &&
            entry.text !== undefined;
        assert.equal(ids.includes(entry.id), expected, entry.id);
    }
});

test('a browser export is a plain literal holding what the dev renderer reads', () => {
    const input = {
        ...registryOf([
            entry({
                id: 'removed-key',
                surfaces: { engine: {}, runtime: { production: true, console: 'error' } },
                forms: ['a', 'b'],
                args: {
                    form: { type: ['enum', 'a', 'b'] },
                    key: { type: 'string' },
                    parts: { type: 'string[]', joiner: ', ', optional: true },
                },
                text: { a: '`{key}` went.', b: '`{key}` moved.' },
                help: 'write {parts}.',
            }),
            entry({
                id: 'mangle-census-unreadable',
                surfaces: { runtime: { production: true } },
                position: 'none',
                args: {},
                text: 'The census is unreadable.',
            }),
            entry({ id: 'runtime-value', text: 'Not here.' }),
        ]),
        CONSTANTS: { maxNestingDepth: { rust: 'X', type: 'usize', value: 64 } },
    };
    const source = generator.renderBrowserModule?.(input) ?? '';
    const removed =
        '/** `removed-key`: A key no sz table knows. */\n' +
        "export const REMOVED_KEY: SzBrowserDiagnostic<{ readonly form: 'a' | 'b'; readonly key: string; readonly parts?: readonly string[] }> = " +
        '{"id":"removed-key","args":{"form":{},"key":{},"parts":{"joiner":", "}},' +
        '"text":{"a":"`{key}` went.","b":"`{key}` moved."},"help":"write {parts}.","console":"error"};';
    assert.ok(source.includes(removed), source);
    assert.ok(
        source.includes(
            'export const MANGLE_CENSUS_UNREADABLE: SzBrowserDiagnostic<Record<never, never>> = ' +
                '{"id":"mangle-census-unreadable","args":{},"text":"The census is unreadable."};',
        ),
        source,
    );
    assert.ok(!source.includes('SZ_DIAGNOSTIC_CONSTANTS'));
    // The constants have a module of their own, which loads no template.
    assert.equal(
        generator.renderConstantsModule?.(input).split('\n').slice(3).join('\n'),
        '/** Engine limits a sentence names, from the registry the engine reads too. */\n' +
            'export const SZ_DIAGNOSTIC_CONSTANTS = {"maxNestingDepth":64} as const;\n',
    );
    assert.ok(!source.includes('RUNTIME_VALUE'));
    // A bare `Object.freeze` survives a production build in esbuild, Vite and
    // webpack (measured, PR C council): plain literals only.
    assert.ok(!source.includes('Object.freeze'));
    // The one import is a type, erased before any bundler sees it.
    assert.deepEqual(
        [...source.matchAll(/^import .*$/gm)].map(([line]) => line),
        ["import type { SzBrowserDiagnostic } from './diagnostic-template.js';"],
    );
});

test('the committed browser module carries every worded console or thrown id', () => {
    const source = generator.renderBrowserModule?.(registry) ?? '';
    const exported = [...source.matchAll(/^export const (\w+)/gm)].map(([, name]) => name);
    assert.deepEqual(
        exported,
        (generator.browserDiagnostics?.(registry) ?? []).map(({ id }) =>
            generator.browserConstName(id),
        ),
    );
    assert.ok(!source.includes('diagnostic-registry.generated'));
});

test('the Node registry module takes its constants from the constants module', () => {
    const source = renderRegistryModule(registryOf([entry()]));
    assert.ok(
        source.includes(
            "export { SZ_DIAGNOSTIC_CONSTANTS } from './diagnostic-constants.generated.js';",
        ),
    );
    assert.ok(!source.includes('export const SZ_DIAGNOSTIC_CONSTANTS'));
});

test('the editor module carries the editor ids only, each as the registry words it', () => {
    const source = renderEditorTemplates(registry);
    for (const id of EDITOR_IDS) {
        const { text } = registry.DIAGNOSTICS.find(entry => entry.id === id);
        assert.ok(source.includes(JSON.stringify(text, null, 4).split('\n')[0]), id);
    }
    assert.ok(!source.includes('"dead-class"'));
    // An arg carries what filling reads, its joiner, as the browser module's do.
    assert.ok(!source.includes('"type"'));
    assert.ok(source.includes('"args": {\n            "key": {},'), source);
    assert.throws(
        () => renderEditorTemplates({ ...registry, DIAGNOSTICS: [] }),
        /editor id unknown-key is not in the registry/,
    );
});

test('the native words module carries the ids `@csszyx/core/native` throws, as the registry words them', async () => {
    const source = renderNativeWordsModule(registry);
    const words = await import(`data:text/javascript,${encodeURIComponent(source)}`);
    for (const id of NATIVE_IDS) {
        const { text, help, note } = registry.DIAGNOSTICS.find(entry => entry.id === id);
        assert.deepEqual(words[generator.browserConstName(id)], { id, text, help, note });
    }
    assert.deepEqual(Object.keys(words), NATIVE_IDS.map(generator.browserConstName));
    assert.throws(
        () => renderNativeWordsModule({ ...registry, DIAGNOSTICS: [] }),
        /native id native-engine-unavailable is not in the registry/,
    );
});

test('the native words module refuses a template it cannot fill: one naming a computed value', () => {
    const entry = registry.DIAGNOSTICS.find(
        candidate => candidate.id === 'native-engine-unavailable',
    );
    const computed = { ...entry, note: 'see {spellingHint}.' };
    assert.throws(
        () =>
            renderNativeWordsModule({
                ...registry,
                DIAGNOSTICS: registry.DIAGNOSTICS.map(candidate =>
                    candidate === entry ? computed : candidate,
                ),
            }),
        /native-engine-unavailable: note names \{spellingHint\}, which is not an arg/,
    );
});

/** Compiler tables, a few rows each, in the shape `readLookupTables` returns. */
const TABLES = {
    migrationNotes: { maskFrom: 'write the from stop on its layer' },
    suggestionMap: { ordinal: 'numOrdinal', touchAction: 'touch', padding: 'p' },
    removedBooleanSugar: {
        flex: { key: 'display', value: 'flex' },
        tabularNums: { key: 'numSpacing', value: 'tabular' },
    },
    replacedKeys: ['tabularNums', 'ordinal'],
    closedEnumClasses: { touch: { auto: 'touch-auto', none: 'touch-none' } },
    closedEnumValueMoves: {
        'touch:pan-x': { key: 'touchPanX', value: 'x' },
        'touch:pinch-zoom': { key: 'touchPinchZoom', value: 'true' },
    },
    globalKeywordGroups: {
        touch: { property: 'touch-action', groups: 'touchPanX touchPinchZoom' },
    },
};

test('a production line names a key; the docs carry what each key needs, from the compiler tables', () => {
    const lookups = productionLookups(TABLES);
    assert.deepEqual(lookups['removed-key'], [
        {
            args: { form: 'removed', key: 'maskFrom' },
            values: { note: 'write the from stop on its layer' },
        },
        { args: { form: 'sugar', key: 'flex', replacement: "display: 'flex'" }, values: {} },
        {
            args: {
                form: 'sugar-replaced',
                key: 'tabularNums',
                replacement: "numSpacing: 'tabular'",
            },
            values: {},
        },
        { args: { form: 'replaced', key: 'ordinal', replacement: 'numOrdinal: true' }, values: {} },
        {
            args: { form: 'runtime-alias', key: 'touchAction', replacement: 'touch' },
            engine: true,
            values: {
                canonical: 'touch',
                canonicalAllowed: 'auto, none',
                groups: 'touchPanX, touchPinchZoom',
            },
        },
    ]);
    // A move under the key, and under each alias of it, as the lookup reads both.
    assert.deepEqual(lookups['moved-value'], [
        {
            args: { form: 'value', key: 'touch', value: 'pan-x' },
            values: { movedKey: 'touchPanX', movedValue: "'x'" },
        },
        {
            args: { form: 'value', key: 'touchAction', value: 'pan-x' },
            values: { movedKey: 'touchPanX', movedValue: "'x'" },
        },
        {
            args: { form: 'value', key: 'touch', value: 'pinch-zoom' },
            values: { movedKey: 'touchPinchZoom', movedValue: 'true' },
        },
        {
            args: { form: 'value', key: 'touchAction', value: 'pinch-zoom' },
            values: { movedKey: 'touchPinchZoom', movedValue: 'true' },
        },
    ]);
    assert.deepEqual(Object.keys(lookups), ['removed-key', 'moved-value']);
    // A key with no table row has no values to name.
    const bare = productionLookups({
        ...TABLES,
        closedEnumClasses: {},
        globalKeywordGroups: { touch: {} },
    })['removed-key'].at(-1);
    assert.deepEqual(bare.values, { canonical: 'touch', canonicalAllowed: '', groups: '' });
});

test('the lookups read the tables the compiler reads', () => {
    const tables = readLookupTables();
    assert.match(tables.migrationNotes.maskFrom, /maskLinear/);
    assert.equal(tables.suggestionMap.ordinal, 'numOrdinal');
    assert.ok(tables.replacedKeys.includes('ordinal'));
    assert.deepEqual(tables.removedBooleanSugar.flex, { key: 'display', value: 'flex' });
    assert.deepEqual(tables.closedEnumValueMoves['touch:pan-x'], { key: 'touchPanX', value: 'x' });
    assert.ok('touch' in tables.globalKeywordGroups);
    assert.ok('auto' in tables.closedEnumClasses.touch);
});

test('the docs data adds the placeholder grammar, each computed value and the lookups', () => {
    const input = {
        ...registryOf([entry()]),
        COMPUTED: { note: { reads: ['key'], summary: 'The note.' } },
    };
    const data = docsData(input, TABLES);
    assert.equal(data.format, 1);
    assert.deepEqual(data.diagnostics, publicData(input).diagnostics);
    assert.equal(data.placeholder, PLACEHOLDER_PATTERN.source);
    assert.deepEqual(data.computed, { note: 'The note.' });
    assert.deepEqual(data.lookups, productionLookups(TABLES));
    assert.deepEqual(docsData(registryOf([entry()]), TABLES).computed, {});
});
