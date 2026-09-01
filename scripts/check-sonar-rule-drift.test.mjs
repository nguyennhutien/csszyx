// Unit tests for the Sonar-versus-local rule drift report.

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { bucketRules, isEnabled, readSonarProperties, rspecId } from './check-sonar-rule-drift.mjs';

describe('rspec identifiers', () => {
    it('reads the id out of a documentation link', () => {
        assert.equal(
            rspecId('https://sonarsource.github.io/rspec/#/rspec/S3776/javascript'),
            'S3776',
        );
    });

    it('answers null for a rule documented somewhere else', () => {
        assert.equal(rspecId('https://example.test/rules/no-shadow'), null);
    });

    it('answers null for a rule with no documentation link', () => {
        assert.equal(rspecId(undefined), null);
    });
});

describe('eslint severities', () => {
    it('counts a bare severity', () => {
        assert.equal(isEnabled('error'), true);
        assert.equal(isEnabled('off'), false);
        assert.equal(isEnabled(0), false);
    });

    it('reads the severity out of a rule carrying options', () => {
        assert.equal(isEnabled(['error', 15]), true);
        assert.equal(isEnabled(['off', 15]), false);
    });
});

describe('bucketing', () => {
    const sonar = [
        { key: 'typescript:S3776', name: 'Cognitive Complexity' },
        { key: 'typescript:S1135', name: 'Track TODO tags' },
        { key: 'typescript:S9999', name: 'Server-only rule' },
    ];
    const local = new Map([
        ['S3776', 'cognitive-complexity'],
        ['S1135', 'todo-tag'],
    ]);

    it('separates an enabled rule from one that is available and off', () => {
        const { covered, availableOff, noLocal } = bucketRules(
            sonar,
            local,
            new Set(['sonarjs/cognitive-complexity']),
        );

        assert.deepEqual(
            covered.map(rule => rule.key),
            ['typescript:S3776'],
        );
        assert.deepEqual(
            availableOff.map(rule => rule.key),
            ['typescript:S1135'],
        );
        assert.deepEqual(
            noLocal.map(rule => rule.key),
            ['typescript:S9999'],
        );
    });

    it('names the local rule alongside the Sonar one', () => {
        const { availableOff } = bucketRules(sonar, local, new Set());

        assert.equal(
            availableOff.find(rule => rule.key === 'typescript:S3776').local,
            'cognitive-complexity',
        );
    });

    it('leaves a server-only rule without a local name', () => {
        const { noLocal } = bucketRules(sonar, local, new Set());

        assert.equal(noLocal[0].local, null);
    });

    it('sorts each bucket so two runs can be compared', () => {
        const shuffled = [sonar[2], sonar[0], sonar[1]];

        const { availableOff } = bucketRules(shuffled, local, new Set());

        assert.deepEqual(
            availableOff.map(rule => rule.key),
            ['typescript:S1135', 'typescript:S3776'],
        );
    });
});

describe('sonar properties', () => {
    it('reads keys and skips comments and blanks', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'csszyx-sonar-props-'));
        const file = path.join(dir, 'sonar-project.properties');
        writeFileSync(
            file,
            '# a comment\n\nsonar.organization=acme\nsonar.projectKey=acme_widget\n',
        );

        const properties = readSonarProperties(file);

        assert.equal(properties['sonar.organization'], 'acme');
        assert.equal(properties['sonar.projectKey'], 'acme_widget');
        assert.equal(Object.keys(properties).length, 2);
    });

    it('keeps a value that itself contains an equals sign', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'csszyx-sonar-props-'));
        const file = path.join(dir, 'sonar-project.properties');
        writeFileSync(file, 'sonar.exclusions=**/a=b/**\n');

        assert.equal(readSonarProperties(file)['sonar.exclusions'], '**/a=b/**');
    });
});
