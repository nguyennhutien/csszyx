#!/usr/bin/env node
import fs from 'node:fs';

const file = process.argv[2];

if (!file) {
    fail('usage: scripts/validate-commit-message-policy.mjs <commit-msg-file>', 2);
}

const raw = fs.readFileSync(file, 'utf8');
const lines = raw.split(/\r?\n/).filter(line => !line.startsWith('#'));
const message = lines.join('\n').trim();
const header = lines.find(line => line.trim().length > 0)?.trim() ?? '';
const match = header.match(/^([a-z]+)(\([^)]+\))?(!)?: (.+)$/);

if (!match) {
    fail('header must be "<type>(<scope>): <subject>"');
}

const [, type, , breaking, subject] = match;
const allowedTypes = new Set([
    'feat',
    'fix',
    'docs',
    'style',
    'refactor',
    'perf',
    'test',
    'chore',
    'ci',
    'build',
    'revert',
]);

if (!allowedTypes.has(type)) {
    fail(`type "${type}" is not allowed`);
}

if (header.length > 100) {
    fail(`header is ${header.length} chars; max is 100`);
}

if (subject === subject.toLocaleUpperCase() && /[A-Z]/.test(subject)) {
    fail('subject must not be all uppercase');
}

const versionPattern = /\bv?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/;
if ((type === 'feat' || type === 'fix') && versionPattern.test(header)) {
    fail('feat/fix headers must not mention target versions; release-please decides versions');
}

if (type === 'feat' || type === 'fix') {
    const bodyLines = message
        .split(/\n/)
        .slice(1)
        .filter(line => !/^(Release-As|BREAKING CHANGE|Refs|Closes):?\b/i.test(line.trim()));
    const body = bodyLines.join('\n');

    if (versionPattern.test(body)) {
        fail(
            'feat/fix bodies must not mention target versions; use a Release-As footer only when required',
        );
    }
}

if (breaking && type !== 'feat' && type !== 'fix' && type !== 'perf') {
    fail(
        'breaking changes should use feat!, fix!, or perf! so release-please classifies them clearly',
    );
}

function fail(reason, code = 1) {
    console.error(`commit message policy failed: ${reason}`);
    process.exit(code);
}
