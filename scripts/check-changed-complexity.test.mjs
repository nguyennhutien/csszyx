// Unit tests for the changed-code cognitive-complexity gate.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    isSonarScoped,
    newDiagnostics,
    parseEslintDiagnostics,
} from './check-changed-complexity.mjs';

/**
 * One diagnostic in the shape the gate carries internally.
 *
 * @param line - 1-based line the rule reported.
 * @param complexity - The measured number in the message.
 * @param text - Source text of that line, trimmed.
 * @returns The record.
 */
function diagnostic(line, complexity, text) {
    return {
        file: 'packages/a/src/x.ts',
        line,
        message: `Refactor this function to reduce its Cognitive Complexity from ${complexity} to the 15 allowed.`,
        text,
    };
}

describe('eslint report parsing', () => {
    const report = [
        {
            filePath: `${process.cwd()}/packages/a/src/x.ts`,
            messages: [
                {
                    ruleId: 'sonarjs/cognitive-complexity',
                    line: 42,
                    message:
                        'Refactor this function to reduce its Cognitive Complexity from 17 to the 15 allowed.',
                },
                { ruleId: 'no-unused-vars', line: 9, message: 'unrelated' },
            ],
        },
    ];

    it('keeps only the cognitive-complexity rule', () => {
        const found = parseEslintDiagnostics(JSON.stringify(report), 'packages/a/src/x.ts');

        assert.equal(found.length, 1);
        assert.equal(found[0].line, 42);
    });

    it('reports paths relative to the repository', () => {
        const found = parseEslintDiagnostics(JSON.stringify(report), 'packages/a/src/x.ts');

        assert.equal(found[0].file, 'packages/a/src/x.ts');
    });

    it('survives eslint printing warnings before the JSON', () => {
        const noisy = `warning: something\n${JSON.stringify(report)}`;

        assert.equal(parseEslintDiagnostics(noisy, 'packages/a/src/x.ts').length, 1);
    });

    it('answers empty when eslint wrote no JSON at all', () => {
        assert.deepEqual(parseEslintDiagnostics('command not found', 'packages/a/src/x.ts'), []);
    });
});

describe('what counts as new', () => {
    it('ignores a function the base already reported unchanged', () => {
        // The line number moved because code above it grew; Sonar would not
        // call this new, and neither can the gate.
        const base = [diagnostic(42, 17, 'function alreadyTooBig(input) {')];
        const head = [diagnostic(87, 17, 'function alreadyTooBig(input) {')];

        assert.deepEqual(newDiagnostics(head, base), []);
    });

    it('reports a function the change made worse', () => {
        const base = [diagnostic(42, 17, 'function alreadyTooBig(input) {')];
        const head = [diagnostic(42, 19, 'function alreadyTooBig(input) {')];

        assert.equal(newDiagnostics(head, base).length, 1);
    });

    it('reports a function this change introduced', () => {
        const base = [];
        const head = [diagnostic(10, 16, 'function brandNew(input) {')];

        assert.equal(newDiagnostics(head, base).length, 1);
    });

    it('tells two same-complexity functions apart by their header', () => {
        const base = [diagnostic(42, 16, 'function first(input) {')];
        const head = [
            diagnostic(42, 16, 'function first(input) {'),
            diagnostic(90, 16, 'function second(input) {'),
        ];

        const found = newDiagnostics(head, base);

        assert.equal(found.length, 1);
        assert.equal(found[0].line, 90);
    });
});

describe('sonar scope', () => {
    it('accepts package source', () => {
        assert.equal(isSonarScoped('packages/a/src/x.ts'), true);
    });

    it('rejects the end-to-end package', () => {
        assert.equal(isSonarScoped('packages/e2e/tests/x.ts'), false);
    });
});
