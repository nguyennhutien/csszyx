/**
 * One answer to "how loudly is this finding reported", for every consumer.
 *
 * `csszyx check`, the bundler plugins and the Next commands all read the same
 * `csszyx.config`, and a level resolved twice would drift the first time one
 * side learned a new id. These pin the presets, the precedence and the
 * validation the config file goes through.
 */
import { SZ_DIAGNOSTIC_CODES } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';

import {
    createDiagnosticPolicy,
    DIAGNOSTIC_POLICY_FORMAT,
    diagnosticConfigProblemsMessage,
    isAtLeastLevel,
    readCsszyxFileConfig,
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

    it('reports the merge audit as info and the className vocabulary not at all', () => {
        expect(policy.levelOf({ rule: 'merge-covered-key' })).toBe('info');
        expect(policy.levelOf({ rule: 'merge-covered-class' })).toBe('info');
        expect(policy.levelOf({ rule: 'custom-class' })).toBe('off');
        expect(policy.levelOf({ rule: 'unknown-class' })).toBe('off');
        expect(policy.levelOf({ rule: 'classname-expression-merge' })).toBe('off');
    });
});

describe('the atomic preset', () => {
    const policy = createDiagnosticPolicy({ preset: 'atomic' });

    it('raises every note about what csszyx changed to a warning', () => {
        expect(policy.levelOf({ rule: 'sz-diagnostic', kind: 'class-precedence' })).toBe('warn');
        expect(policy.levelOf({ rule: 'sz-diagnostic', kind: 'duplicate-sz' })).toBe('warn');
        expect(policy.levelOf({ rule: 'sz-diagnostic', kind: 'fallback-nudge' })).toBe('warn');
        expect(policy.levelOf({ rule: 'merge-covered-key' })).toBe('warn');
        expect(policy.levelOf({ rule: 'custom-class' })).toBe('warn');
        expect(policy.levelOf({ rule: 'classname-expression-merge' })).toBe('info');
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
                'custom-class',
                'unknown-class',
                'classname-expression-merge',
                'other',
            ]),
        );
        expect(new Set(SZ_DIAGNOSTIC_RULE_IDS).size).toBe(SZ_DIAGNOSTIC_RULE_IDS.length);
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
                message: '`dead-clas` is not a rule id — did you mean `dead-class`?',
            },
            {
                severity: 'error',
                path: 'diagnostics.overrides[0].rules',
                message: '`unknwn-key` is not a rule id — did you mean `unknown-key`?',
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

    it('names an id with no near match without a guess', () => {
        expect(
            readCsszyxFileConfig({ diagnostics: { rules: { zzzzzz: 'off' } } }).problems,
        ).toEqual([
            { severity: 'error', path: 'diagnostics.rules', message: '`zzzzzz` is not a rule id.' },
        ]);
    });

    it('refuses an allow section that is not an object', () => {
        expect(readCsszyxFileConfig({ diagnostics: { allow: ['a'] } }).problems).toEqual([
            { severity: 'error', path: 'diagnostics.allow', message: 'must be an object.' },
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

    it('names a misspelt diagnostics key as an error, with the key it most likely means', () => {
        // Read as a plugin option it would only warn, and every level it sets
        // would fall back to the defaults with `check` still passing. With no
        // `diagnostics` beside it, nothing in the file applies.
        expect(readCsszyxFileConfig({ diagnostic: { preset: 'atomic' } }).problems).toEqual([
            {
                severity: 'error',
                path: 'default export',
                message: '`diagnostic` is not read — did you mean `diagnostics`?',
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
                message: '`diagnostic` is not read — did you mean `diagnostics`?',
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
                    message: `\`${key}\` is not read at the top level — did you mean \`diagnostics.${key}\`?`,
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
                    '`development` is not read from this file; plugin options belong in the bundler config.',
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
                message: `\`${glob}\` can never match: files are matched by their path from the project root, so a glob cannot be absolute or step out with \`..\`.`,
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
        'https://csszyx.com/docs/reference/config/#csszyxconfig describes every field; a dev server or `csszyx next watch` reads the file again only when restarted.';

    it('names the file and lists each problem under its path, tagged with its severity', () => {
        const message = diagnosticConfigProblemsMessage('csszyx.config.ts', [
            { severity: 'error', path: 'diagnostics.rules', message: '`x` is not a rule id.' },
            { severity: 'warning', path: 'development', message: 'is not read.' },
        ]);
        expect(message).toBe(
            '[csszyx] csszyx.config.ts has 2 problem(s):\n' +
                '  - (error) diagnostics.rules: `x` is not a rule id.\n' +
                '  - (warning) development: is not read.\n' +
                'Each one is ignored; the rest of the file applies.\n' +
                `  help: ${CONFIG_HELP}`,
        );
    });

    it('says the whole file was not applied when it did not load, naming the file once', () => {
        const message = diagnosticConfigProblemsMessage('csszyx.config.mjs', [
            {
                severity: 'error',
                path: 'csszyx.config.mjs',
                message: 'could not be loaded: Unexpected token',
                fileIgnored: true,
            },
        ]);
        expect(message).toBe(
            '[csszyx] csszyx.config.mjs has 1 problem(s):\n' +
                '  - (error) could not be loaded: Unexpected token\n' +
                'The file is not applied, so every finding keeps its default level.\n' +
                `  help: ${CONFIG_HELP}`,
        );
    });
});
