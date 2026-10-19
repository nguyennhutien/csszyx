// Unit tests for the changed-line Sonar gate.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
    ignoredIssues,
    isIgnored,
    isSonarTest,
    newDiagnostics,
    rulesToRun,
    TYPED_CANARY,
    typedCanaryProblem,
    typescriptCopies,
} from './check-changed-sonar.mjs';
import { PROFILE_RULES_FILE } from './check-sonar-rule-drift.mjs';

const PROFILE = {
    format: 1,
    rules: [
        { key: 'typescript:S4323', rule: 'sonarjs/use-type-alias', scope: 'MAIN' },
        { key: 'typescript:S5976', rule: 'sonarjs/parameterized-tests', scope: 'TEST' },
        { key: 'typescript:S1874', rule: 'sonarjs/deprecation', scope: 'ALL' },
        { key: 'typescript:S3776', rule: 'sonarjs/cognitive-complexity', scope: 'MAIN' },
    ],
};

describe('which profile rules run on a file', () => {
    it('runs MAIN and ALL rules on source, without the complexity gate', () => {
        assert.deepEqual(
            [...rulesToRun(PROFILE, false)],
            [
                ['sonarjs/use-type-alias', 'typescript:S4323'],
                ['sonarjs/deprecation', 'typescript:S1874'],
            ],
        );
    });

    it('runs TEST and ALL rules on a test', () => {
        assert.deepEqual(
            [...rulesToRun(PROFILE, true).keys()],
            ['sonarjs/parameterized-tests', 'sonarjs/deprecation'],
        );
    });

    it('refuses a list in a format it does not read', () => {
        assert.throws(() => rulesToRun({ format: 2, rules: [] }, false), /format 2/);
    });
});

describe('Sonar test files', () => {
    const properties = { 'sonar.test.inclusions': '**/tests/**, **/*.test.ts' };

    it('reads a file under tests or named .test.ts as a test', () => {
        assert.equal(isSonarTest('packages/compiler/tests/harness.ts', properties), true);
        assert.equal(isSonarTest('packages/compiler/src/a.test.ts', properties), true);
    });

    it('reads anything else as source', () => {
        assert.equal(isSonarTest('packages/compiler/src/a.ts', properties), false);
        assert.equal(isSonarTest('packages/compiler/src/a.ts', {}), false);
    });
});

describe('issues Sonar is told to ignore', () => {
    const properties = {
        'sonar.issue.ignore.multicriteria': 'szprop, uniontypes',
        'sonar.issue.ignore.multicriteria.szprop.ruleKey': 'typescript:S6747',
        'sonar.issue.ignore.multicriteria.szprop.resourceKey': '**/*.tsx',
        'sonar.issue.ignore.multicriteria.uniontypes.ruleKey': 'typescript:S6571',
        'sonar.issue.ignore.multicriteria.uniontypes.resourceKey': '**/types/**',
    };
    const ignored = ignoredIssues(properties);

    it('reads every criterion', () => {
        assert.deepEqual(ignored, [
            { key: 'typescript:S6747', glob: '**/*.tsx' },
            { key: 'typescript:S6571', glob: '**/types/**' },
        ]);
        assert.deepEqual(ignoredIssues({}), []);
    });

    it('ignores a rule only on the files its criterion names', () => {
        assert.equal(isIgnored('typescript:S6747', 'packages/a/src/App.tsx', ignored), true);
        assert.equal(isIgnored('typescript:S6747', 'packages/a/src/app.ts', ignored), false);
        assert.equal(isIgnored('typescript:S4323', 'packages/a/src/App.tsx', ignored), false);
    });
});

describe('what counts as new', () => {
    const finding = (line, text, ruleId = 'sonarjs/use-type-alias') => ({
        ruleId,
        message: 'Replace this union type with a type alias.',
        line,
        text,
    });

    it('keeps a finding the base does not have, wherever it moved', () => {
        const head = [
            finding(40, 'function a(x: string | number) {'),
            finding(90, 'let b: A | B;'),
        ];
        const base = [finding(12, 'function a(x: string | number) {')];
        assert.deepEqual(newDiagnostics(head, base), [finding(90, 'let b: A | B;')]);
    });

    it('counts copies, so a second copy of an old finding is new', () => {
        const line = 'function a(x: string | number) {';
        assert.deepEqual(newDiagnostics([finding(1, line), finding(9, line)], [finding(1, line)]), [
            finding(9, line),
        ]);
    });

    it('tells two rules on the same line apart', () => {
        const line = 'function a(x: string | number) {';
        const other = finding(1, line, 'sonarjs/deprecation');
        assert.deepEqual(newDiagnostics([finding(1, line), other], [finding(1, line)]), [other]);
    });
});

describe('the type-aware profile rules can see types', () => {
    // sonarjs compares type flags with the `typescript` it loads; a second
    // copy numbers them differently and the rules go silent (#387).
    it('loads the same typescript as the parser that builds the program', () => {
        const copies = typescriptCopies();
        assert.equal(copies.sonarjs, copies.parser);
    });

    it('reports the canary, whose rule the profile runs', async () => {
        const profile = JSON.parse(readFileSync(PROFILE_RULES_FILE, 'utf8'));
        assert.ok(rulesToRun(profile, false).has(TYPED_CANARY.rule));
        const { ESLint } = await import('eslint');
        const eslint = new ESLint({
            overrideConfig: [
                { files: ['packages/**/*.ts'], rules: { [TYPED_CANARY.rule]: 'error' } },
            ],
        });
        const [result] = await eslint.lintText(TYPED_CANARY.source, {
            filePath: TYPED_CANARY.file,
        });
        assert.deepEqual(
            result.messages
                .filter(message => message.ruleId === TYPED_CANARY.rule)
                .map(m => m.line),
            [2],
        );
        assert.equal(await typedCanaryProblem(eslint), null);
    });

    it('fails, naming both copies, when the rules cannot see types', async () => {
        const { ESLint } = await import('eslint');
        const { default: parser } = await import('@typescript-eslint/parser');
        const { default: sonarjs } = await import('eslint-plugin-sonarjs');
        // The parser with no program: what any copy mismatch looks like to
        // the rule, without the repository's other type-aware rules.
        const blind = new ESLint({
            overrideConfigFile: true,
            overrideConfig: [
                {
                    files: ['**/*.ts'],
                    languageOptions: { parser },
                    plugins: { sonarjs },
                    rules: { [TYPED_CANARY.rule]: 'error' },
                },
            ],
        });
        const problem = await typedCanaryProblem(blind);
        assert.match(problem ?? '', /did not report a deliberate violation/);
        assert.ok(problem?.includes(typescriptCopies().parser));
    });
});
