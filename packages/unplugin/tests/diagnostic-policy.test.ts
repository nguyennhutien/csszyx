/**
 * One answer to "how loudly is this finding reported", for every consumer.
 *
 * `csszyx check`, the bundler plugins and the Next commands all read the same
 * `csszyx.config`, and a level resolved twice would drift the first time one
 * side learned a new id. These pin the presets, the precedence and the
 * validation the config file goes through.
 */
import {
    renderSzDiagnosticBody,
    SZ_DIAGNOSTIC_CODES,
    SZ_DIAGNOSTIC_COMPUTED_VALUES,
} from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';

import {
    createDiagnosticPolicy,
    DIAGNOSTIC_POLICY_FORMAT,
    diagnosticConfigProblemsMessage,
    isAtLeastLevel,
    readCsszyxFileConfig,
    removedRuleIdDiagnostic,
    SZ_DIAGNOSTIC_PASS_IDS,
    SZ_DIAGNOSTIC_RULE_IDS,
} from '../src/diagnostic-policy.js';

describe('the recommended preset', () => {
    const policy = createDiagnosticPolicy();

    it('keeps every engine diagnostic an error except the notes about a choice', () => {
        const notError = new Map([
            ['class-precedence', 'info'],
            ['duplicate-sz', 'info'],
            ['fallback-nudge', 'info'],
            ['merge-classifier-unavailable', 'warn'],
            ['mangle-vars-hoist-skipped', 'info'],
            // The class still applies the opacity: a note on the spelling.
            ['color-slash-opacity', 'info'],
        ]);
        for (const code of SZ_DIAGNOSTIC_CODES) {
            expect([code, policy.levelOf({ rule: 'sz-diagnostic', kind: code })]).toEqual([
                code,
                notError.get(code) ?? 'error',
            ]);
        }
        expect(policy.levelOf({ rule: 'sz-diagnostic', kind: 'other' })).toBe('error');
    });

    it('keeps every failing pass of check an error', () => {
        for (const rule of [
            'dead-class',
            'broken-opacity',
            'sibling-keyword',
            'theme-collision',
        ] as const) {
            expect(policy.levelOf({ rule })).toBe('error');
        }
        expect(policy.levelOf({ rule: 'dead-class', kind: 'prefix-disagreement' })).toBe('error');
    });

    it('reports the merge audit as info', () => {
        expect(policy.levelOf({ rule: 'merge-covered-key' })).toBe('info');
        expect(policy.levelOf({ rule: 'merge-covered-class' })).toBe('info');
    });
});

describe('the atomic preset', () => {
    const policy = createDiagnosticPolicy({ preset: 'atomic' });

    it('raises every note about what csszyx changed to a warning', () => {
        expect(policy.levelOf({ rule: 'sz-diagnostic', kind: 'class-precedence' })).toBe('warn');
        expect(policy.levelOf({ rule: 'sz-diagnostic', kind: 'duplicate-sz' })).toBe('warn');
        expect(policy.levelOf({ rule: 'sz-diagnostic', kind: 'fallback-nudge' })).toBe('warn');
        expect(policy.levelOf({ rule: 'merge-covered-key' })).toBe('warn');
        expect(policy.levelOf({ rule: 'sz-diagnostic', kind: 'unknown-key' })).toBe('error');
    });
});

describe('precedence: preset < rules < overrides', () => {
    it('lets a kind id beat its pass id within one layer', () => {
        const policy = createDiagnosticPolicy({
            rules: { 'sz-diagnostic': 'warn', 'unknown-key': 'off' },
        });
        expect(policy.levelOf({ rule: 'sz-diagnostic', kind: 'unknown-key' })).toBe('off');
        expect(policy.levelOf({ rule: 'sz-diagnostic', kind: 'canonical-key' })).toBe('warn');
        // A later layer's pass id still beats the preset's per-kind level.
        expect(policy.levelOf({ rule: 'sz-diagnostic', kind: 'class-precedence' })).toBe('warn');
    });

    it('applies the overrides that match the file, in order, over the rules', () => {
        const policy = createDiagnosticPolicy({
            rules: { 'class-precedence': 'error' },
            overrides: [
                { files: ['src/legacy/**'], rules: { 'class-precedence': 'off' } },
                { files: 'src/legacy/keep/**', rules: { 'class-precedence': 'warn' } },
            ],
        });
        const at = (file?: string) =>
            policy.levelOf({ rule: 'sz-diagnostic', kind: 'class-precedence', file });
        expect(at('src/App.tsx')).toBe('error');
        expect(at('src/legacy/Old.tsx')).toBe('off');
        expect(at('src/legacy/keep/Old.tsx')).toBe('warn');
        // A finding with no file is matched by no override.
        expect(at()).toBe('error');
    });

    it('matches an override on any of its globs', () => {
        const policy = createDiagnosticPolicy({
            overrides: [{ files: ['lib/**', 'src/**'], rules: { 'dead-class': 'off' } }],
        });
        expect(policy.levelOf({ rule: 'dead-class', file: 'src/A.tsx' })).toBe('off');
        expect(policy.levelOf({ rule: 'dead-class', file: 'test/A.tsx' })).toBe('error');
        // A matching override that does not name the id leaves its level alone.
        expect(policy.levelOf({ rule: 'broken-opacity', file: 'src/A.tsx' })).toBe('error');
    });

    it('answers the allow lists as a filter, never as a level', () => {
        const policy = createDiagnosticPolicy({
            allow: { classes: ['later-class'], tokens: ['brand'] },
        });
        expect(policy.allowsClass('later-class')).toBe(true);
        expect(policy.allowsClass('other')).toBe(false);
        expect(policy.allowsToken('brand')).toBe(true);
        expect(policy.levelOf({ rule: 'dead-class' })).toBe('error');
    });

    it('treats an id it does not know as an error, so nothing new passes silently', () => {
        expect(createDiagnosticPolicy().levelOf({ rule: 'not-a-rule' })).toBe('error');
    });
});

describe('isAtLeastLevel', () => {
    it('orders off < info < warn < error', () => {
        expect(isAtLeastLevel('error', 'warn')).toBe(true);
        expect(isAtLeastLevel('warn', 'warn')).toBe(true);
        expect(isAtLeastLevel('info', 'warn')).toBe(false);
        expect(isAtLeastLevel('off', 'info')).toBe(false);
    });
});

describe('the rule id vocabulary', () => {
    it('names every pass, every engine code and every kind a pass reports', () => {
        expect(SZ_DIAGNOSTIC_RULE_IDS).toEqual(
            expect.arrayContaining([
                ...SZ_DIAGNOSTIC_PASS_IDS,
                ...SZ_DIAGNOSTIC_CODES,
                'prefix-disagreement',
                'unsigned-value',
                'other',
            ]),
        );
        expect(new Set(SZ_DIAGNOSTIC_RULE_IDS).size).toBe(SZ_DIAGNOSTIC_RULE_IDS.length);
    });

    it('drops the className vocabulary ids no pass ever reported', () => {
        // Never in a release: a config naming one gets the unknown-id problem.
        for (const id of ['custom-class', 'unknown-class', 'classname-expression-merge']) {
            expect(SZ_DIAGNOSTIC_RULE_IDS).not.toContain(id);
        }
        expect(
            readCsszyxFileConfig({ diagnostics: { rules: { 'custom-class': 'warn' } } }).problems,
        ).toEqual([
            expect.objectContaining({
                severity: 'error',
                message: expect.stringContaining(
                    'No rule or diagnostic is named `custom-class`, so a level set under that name applies to nothing.',
                ),
            }),
        ]);
    });
});

describe('readCsszyxFileConfig', () => {
    it('accepts a valid config with no problems', () => {
        const read = readCsszyxFileConfig({
            diagnostics: {
                preset: 'atomic',
                rules: { 'dead-class': 'warn' },
                allow: { classes: ['a'], tokens: ['b'] },
                overrides: [{ files: 'src/**', rules: { 'unknown-key': 'off' } }],
            },
        });
        expect(read.problems).toEqual([]);
        expect(read.config).toEqual({
            preset: 'atomic',
            rules: { 'dead-class': 'warn' },
            allow: { classes: ['a'], tokens: ['b'] },
            overrides: [{ files: ['src/**'], rules: { 'unknown-key': 'off' } }],
        });
    });

    it('accepts a missing config or a missing diagnostics section', () => {
        expect(readCsszyxFileConfig(undefined).problems).toEqual([]);
        expect(readCsszyxFileConfig({}).config.preset).toBe('recommended');
    });

    it('names an unknown id as an error, with the id it most likely misspells', () => {
        const read = readCsszyxFileConfig({
            diagnostics: {
                rules: { 'dead-clas': 'warn' },
                overrides: [{ files: ['x/**'], rules: { 'unknwn-key': 'off' } }],
            },
        });
        expect(read.problems).toEqual([
            {
                severity: 'error',
                path: 'diagnostics.rules',
                message:
                    'No rule or diagnostic is named `dead-clas`, so a level set under that name applies to nothing.\n' +
                    '  help: write `dead-class` if you meant it; https://csszyx.com/docs/reference/warnings/ lists every id.',
            },
            {
                severity: 'error',
                path: 'diagnostics.overrides[0].rules',
                message:
                    'No rule or diagnostic is named `unknwn-key`, so a level set under that name applies to nothing.\n' +
                    '  help: write `unknown-key` if you meant it; https://csszyx.com/docs/reference/warnings/ lists every id.',
            },
        ]);
        // The id is dropped, the rest of the config still applies.
        expect(read.config.rules).toEqual({});
    });

    it('refuses a level, a preset or a shape it cannot read', () => {
        const read = readCsszyxFileConfig({
            diagnostics: {
                preset: 'strict',
                rules: { 'dead-class': 'fatal' },
                allow: { classes: 'one', colors: [] },
                overrides: [{ rules: {} }, 'src/**'],
                strict: true,
            },
        });
        expect(read.problems.map(problem => [problem.severity, problem.path])).toEqual([
            ['error', 'diagnostics'],
            ['error', 'diagnostics.preset'],
            ['error', 'diagnostics.rules'],
            ['error', 'diagnostics.allow.classes'],
            ['error', 'diagnostics.allow'],
            ['error', 'diagnostics.overrides[0].files'],
            ['error', 'diagnostics.overrides[1]'],
        ]);
        expect(read.config.preset).toBe('recommended');
    });

    it('names an id whose level csszyx.config cannot set, with what rules can set', () => {
        // A runtime line and a thrown error: real ids, which no level reaches.
        const read = readCsszyxFileConfig({
            diagnostics: {
                rules: { 'hydration-aborted': 'off', 'dead-class': 'warn' },
                overrides: [{ files: 'src/**', rules: { 'internal-error': 'warn' } }],
            },
        });
        const notSettable = (id: string, path: string) => ({
            severity: 'error',
            path,
            message: renderSzDiagnosticBody(
                { code: 'config-id-not-settable', args: { id } },
                SZ_DIAGNOSTIC_COMPUTED_VALUES,
            ),
        });
        expect(read.problems).toEqual([
            notSettable('hydration-aborted', 'diagnostics.rules'),
            notSettable('internal-error', 'diagnostics.overrides[0].rules'),
        ]);
        expect(read.problems[0]?.message).toBe(
            '`hydration-aborted` is printed to the console or thrown, so `csszyx.config` sets no level for it.\n' +
                '  help: remove it; `rules` sets the level of engine diagnostics and `csszyx check` findings only.',
        );
        // The entry is dropped; the rest of the config still applies.
        expect(read.config.rules).toEqual({ 'dead-class': 'warn' });
        expect(read.config.overrides[0]?.rules).toEqual({});
    });

    it('warns about a removed id, naming the id that replaced it, and drops the entry', () => {
        const read = readCsszyxFileConfig({
            diagnostics: { rules: { other: 'off', 'dead-class': 'warn' } },
        });
        expect(read.problems).toEqual([
            {
                severity: 'warning',
                path: 'diagnostics.rules',
                message:
                    '`other` is no longer reported, so a `csszyx.config` level or a `--rule` or `--ignore-rule` flag naming it applies to nothing.\n' +
                    '  help: name `sz-diagnostic` instead, which reports what `other` did.',
            },
        ]);
        expect(read.config.rules).toEqual({ 'dead-class': 'warn' });
    });

    it('names no replacement for a removed id nothing replaced', () => {
        expect(
            renderSzDiagnosticBody(
                removedRuleIdDiagnostic('gone', undefined),
                SZ_DIAGNOSTIC_COMPUTED_VALUES,
            ),
        ).toBe(
            '`gone` is no longer reported, so a `csszyx.config` level or a `--rule` or `--ignore-rule` flag naming it applies to nothing.\n' +
                '  help: remove it.',
        );
    });

    it('guesses only an id whose level can be set', () => {
        // `othr` is one letter from `other`, which is removed: no level reaches
        // it, so it is never offered.
        expect(readCsszyxFileConfig({ diagnostics: { rules: { othr: 'off' } } }).problems).toEqual([
            {
                severity: 'error',
                path: 'diagnostics.rules',
                message:
                    'No rule or diagnostic is named `othr`, so a level set under that name applies to nothing.\n' +
                    '  help: check the spelling; https://csszyx.com/docs/reference/warnings/ lists every id.',
            },
        ]);
    });

    it('names an id with no near match without a guess', () => {
        expect(
            readCsszyxFileConfig({ diagnostics: { rules: { zzzzzz: 'off' } } }).problems,
        ).toEqual([
            {
                severity: 'error',
                path: 'diagnostics.rules',
                message:
                    'No rule or diagnostic is named `zzzzzz`, so a level set under that name applies to nothing.\n' +
                    '  help: check the spelling; https://csszyx.com/docs/reference/warnings/ lists every id.',
            },
        ]);
    });

    it('refuses an allow section that is not an object', () => {
        expect(readCsszyxFileConfig({ diagnostics: { allow: ['a'] } }).problems).toEqual([
            {
                severity: 'error',
                path: 'diagnostics.allow',
                message:
                    '`diagnostics.allow` is not an object, so it is ignored.\n' +
                    '  help: write it as an object, such as `{ classes: [] }` for `allow`.',
            },
        ]);
    });

    it('refuses a config or section that is not an object', () => {
        expect(readCsszyxFileConfig(3).problems[0]?.path).toBe('default export');
        expect(readCsszyxFileConfig({ diagnostics: [] }).problems[0]?.path).toBe('diagnostics');
        expect(
            readCsszyxFileConfig({ diagnostics: { rules: 'off', overrides: {} } }).problems.map(
                problem => problem.path,
            ),
        ).toEqual(['diagnostics.rules', 'diagnostics.overrides']);
    });

    it('words each problem with its registry id', () => {
        const messages = (value: unknown) =>
            readCsszyxFileConfig(value).problems.map(problem => problem.message);
        expect(messages(3)).toEqual([
            'The default export is not an object, so nothing in this file applies.\n' +
                '  help: write `export default defineConfig({ … })`, importing `defineConfig` from `csszyx`.',
        ]);
        expect(messages({ diagnostics: [] })).toEqual([
            '`diagnostics` is not an object, so it is ignored.\n' +
                '  help: write it as an object, such as `{ classes: [] }` for `allow`.',
        ]);
        expect(
            messages({
                diagnostics: {
                    preset: 'strict',
                    rules: { 'dead-class': 'fatal' },
                    allow: { classes: 'one', colors: [] },
                    overrides: [{ rules: {} }, 'src/**'],
                    strict: true,
                },
            }),
        ).toEqual([
            '`diagnostics.strict` is not a field csszyx reads, so it sets nothing.\n' +
                '  help: use `preset`, `rules`, `allow` or `overrides`.',
            '`"strict"` is not a preset, so the `recommended` levels apply.\n' +
                "  help: use `'recommended'` or `'atomic'`.",
            '`dead-class` is set to `"fatal"`, which is not a level, so that setting is ignored.\n' +
                "  help: use `'off'`, `'info'`, `'warn'` or `'error'`.",
            '`diagnostics.allow.classes` is not a list of names, so it allows nothing.\n' +
                "  help: write it as a list of strings, such as `['my-card']`.",
            '`diagnostics.allow.colors` is not a field csszyx reads, so it allows nothing.\n' +
                '  help: use `classes` or `tokens`.',
            '`diagnostics.overrides[0].files` is not a glob or a list of globs, so this override applies to no file.\n' +
                "  help: write a glob relative to the project root, such as `'src/legacy/**'`, or a list of them.",
            '`diagnostics.overrides[1]` is not a `{ files, rules }` object, so it is ignored.\n' +
                "  help: write it as `{ files: 'src/legacy/**', rules: { 'dead-class': 'off' } }`.",
        ]);
        // A level with no JSON spelling is named as JavaScript prints it.
        expect(messages({ diagnostics: { rules: { 'dead-class': undefined } } })).toEqual([
            '`dead-class` is set to `undefined`, which is not a level, so that setting is ignored.\n' +
                "  help: use `'off'`, `'info'`, `'warn'` or `'error'`.",
        ]);
        expect(messages({ diagnostics: { rules: 'off', overrides: {} } })).toEqual([
            '`diagnostics.rules` is not an object of id and level, so none of its levels apply.\n' +
                "  help: write it as `{ 'dead-class': 'warn' }`.",
            '`diagnostics.overrides` is not a list, so no override applies.\n' +
                '  help: write it as a list of `{ files, rules }` objects.',
        ]);
    });

    it('names a misspelt diagnostics key as an error, with the key it most likely means', () => {
        // Read as a plugin option it would only warn, and every level it sets
        // would fall back to the defaults with `check` still passing. With no
        // `diagnostics` beside it, nothing in the file applies.
        expect(readCsszyxFileConfig({ diagnostic: { preset: 'atomic' } }).problems).toEqual([
            {
                severity: 'error',
                path: 'default export',
                message:
                    '`diagnostic` is not a field csszyx reads, so nothing under it applies.\n' +
                    '  help: rename it to `diagnostics`.',
                fileIgnored: true,
            },
        ]);
    });

    it('keeps the rest of the file applying when a near miss sits beside diagnostics', () => {
        const read = readCsszyxFileConfig({ diagnostic: {}, diagnostics: { preset: 'atomic' } });
        expect(read.problems).toEqual([
            {
                severity: 'error',
                path: 'default export',
                message:
                    '`diagnostic` is not a field csszyx reads, so nothing under it applies.\n' +
                    '  help: rename it to `diagnostics`.',
            },
        ]);
        expect(read.config.preset).toBe('atomic');
    });

    it.each(['rules', 'preset', 'allow', 'overrides'])(
        'names a top-level `%s` as an error that belongs under diagnostics',
        key => {
            // The ESLint flat-config habit: the levels sit one level too high
            // and every one of them would be dropped with `check` passing.
            expect(readCsszyxFileConfig({ [key]: {} }).problems).toEqual([
                {
                    severity: 'error',
                    path: 'default export',
                    message:
                        `\`${key}\` is not read at the top level, so nothing under it applies.\n` +
                        `  help: move it under \`diagnostics\`, as \`diagnostics.${key}\`.`,
                    fileIgnored: true,
                },
            ]);
        },
    );

    it('warns about a plugin option written in the file, which only the bundler reads', () => {
        const read = readCsszyxFileConfig({ development: { debug: true }, diagnostics: {} });
        expect(read.problems).toEqual([
            {
                severity: 'warning',
                path: 'development',
                message:
                    '`development` is a plugin option, and this file does not set plugin options, so it is ignored.\n' +
                    '  help: pass it to the csszyx plugin in your bundler config.',
            },
        ]);
    });
});

describe('overrides[].files', () => {
    /**
     * The level an override built from these globs gives a dead class in a file.
     *
     * @param files - The globs as written.
     * @returns A function from a project-relative file to its level.
     */
    function levelUnder(files: string[]) {
        const read = readCsszyxFileConfig({
            diagnostics: { overrides: [{ files, rules: { 'dead-class': 'off' } }] },
        });
        const policy = createDiagnosticPolicy(read.config);
        return {
            problems: read.problems,
            at: (file: string) => policy.levelOf({ rule: 'dead-class', file }),
        };
    }

    it('reads a leading ./ as the project root', () => {
        const { problems, at } = levelUnder(['./src/legacy/**']);
        expect(problems).toEqual([]);
        expect(at('src/legacy/Old.tsx')).toBe('off');
    });

    it('reads a bare directory as everything under it, and a plain path as that file', () => {
        const { problems, at } = levelUnder(['src/legacy', 'lib/Old.tsx', 'pages/']);
        expect(problems).toEqual([]);
        expect(at('src/legacy/deep/Old.tsx')).toBe('off');
        expect(at('lib/Old.tsx')).toBe('off');
        expect(at('pages/index.tsx')).toBe('off');
        expect(at('src/legacyish.tsx')).toBe('error');
    });

    it('refuses a glob anchored outside the project root, which no file can match', () => {
        const refused = [
            '/src/**',
            '\\src\\**',
            '../shared/**',
            // `./` is stripped before the `..` check, not after.
            './../src/**',
            'src/../../x/**',
            'C:\\app\\src\\**',
            'C:/app/src/**',
        ];
        const { problems, at } = levelUnder([...refused, 'src/**']);
        expect(problems).toEqual(
            refused.map(glob => ({
                severity: 'error',
                path: 'diagnostics.overrides[0].files',
                message:
                    `\`${glob}\` is absolute or steps out of the project root with \`..\`, so it matches no file.\n` +
                    '  help: write it relative to the project root, such as `src/legacy/**`; csszyx matches each file by its path from there.',
            })),
        );
        // The globs that can match still apply.
        expect(at('src/A.tsx')).toBe('off');
    });

    it('reads backslashes as separators, so a Windows-written glob matches', () => {
        const { problems, at } = levelUnder(['src\\core\\**', 'src\\legacy', '.\\lib']);
        expect(problems).toEqual([]);
        expect(at('src/core/deep/A.tsx')).toBe('off');
        expect(at('src/legacy/Old.tsx')).toBe('off');
        expect(at('lib/B.tsx')).toBe('off');
        expect(at('src/other.tsx')).toBe('error');
    });

    it.each(['.', './', './.', '.\\'])('reads `%s` as the whole project', glob => {
        const { problems, at } = levelUnder([glob]);
        expect(problems).toEqual([]);
        expect(at('A.tsx')).toBe('off');
        expect(at('src/deep/B.tsx')).toBe('off');
    });

    it('drops `.` segments inside a path', () => {
        const { problems, at } = levelUnder(['src/./legacy']);
        expect(problems).toEqual([]);
        expect(at('src/legacy/Old.tsx')).toBe('off');
    });
});

describe('createDiagnosticPolicy serialization', () => {
    it('round-trips through the state file shape with its format number', () => {
        const policy = createDiagnosticPolicy({
            preset: 'atomic',
            rules: { 'dead-class': 'warn' },
            overrides: [{ files: ['a/**'], rules: { 'dead-class': 'off' } }],
        });
        const state = policy.toJSON();
        expect(state.format).toBe(DIAGNOSTIC_POLICY_FORMAT);
        const again = createDiagnosticPolicy(JSON.parse(JSON.stringify(state)).config);
        expect(again.levelOf({ rule: 'dead-class', file: 'a/b.tsx' })).toBe('off');
        expect(again.levelOf({ rule: 'dead-class' })).toBe('warn');
    });
});

describe('diagnosticConfigProblemsMessage', () => {
    const CONFIG_HELP =
        'https://csszyx.com/docs/reference/config/#csszyxconfig describes every field; a dev server, a watch build and `csszyx next watch` read it again when it or a module it imports is saved.';

    it('names the file and lists each problem under its path, tagged with its severity', () => {
        const message = diagnosticConfigProblemsMessage('csszyx.config.ts', [
            { severity: 'error', path: 'diagnostics.rules', message: '`x` is not a rule id.' },
            { severity: 'warning', path: 'development', message: 'is not read.' },
        ]);
        expect(message).toBe(
            '[csszyx] config-invalid: csszyx.config.ts\n' +
                '  This file has 2 problem(s); each one is ignored, and the rest of the file applies.\n' +
                '  - (error) diagnostics.rules: `x` is not a rule id.\n' +
                '  - (warning) development: is not read.\n' +
                `  help: ${CONFIG_HELP}\n` +
                '  docs: https://csszyx.com/e/config-invalid',
        );
    });

    it("sets a problem's own help line under its bullet", () => {
        const message = diagnosticConfigProblemsMessage('csszyx.config.ts', [
            {
                severity: 'error',
                path: 'diagnostics.rules',
                message: '`x` sets nothing.\n  help: remove it.',
            },
        ]);
        expect(message.split('\n').slice(2, 4)).toEqual([
            '  - (error) diagnostics.rules: `x` sets nothing.',
            '    help: remove it.',
        ]);
    });

    it('says the whole file was not applied when it did not load, naming the file once', () => {
        const message = diagnosticConfigProblemsMessage('csszyx.config.mjs', [
            {
                severity: 'error',
                path: 'csszyx.config.mjs',
                message:
                    'This file could not be loaded, so the `recommended` levels apply.\n' +
                    '  help: fix the error the loader reported.\n' +
                    '  note: the loader reported: Unexpected token.',
                fileIgnored: true,
            },
        ]);
        expect(message).toBe(
            '[csszyx] config-invalid: csszyx.config.mjs\n' +
                '  This file has 1 problem(s), so it is not applied and the `recommended` levels apply.\n' +
                '  - (error) This file could not be loaded, so the `recommended` levels apply.\n' +
                '    help: fix the error the loader reported.\n' +
                '    note: the loader reported: Unexpected token.\n' +
                `  help: ${CONFIG_HELP}\n` +
                '  docs: https://csszyx.com/e/config-invalid',
        );
    });
});
