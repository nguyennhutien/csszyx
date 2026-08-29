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

// release-please's strict PEG parser (@conventional-commits/parser) treats
// parentheses structurally and does not understand markdown backticks. An
// UNBALANCED or NESTED parens anywhere in the message — e.g. an inline-code
// fragment like `szv(` or an expression such as `calc(var(--x))` — make it fail
// to parse the whole commit, which release-please then SILENTLY DROPS: a merged
// fix/feat contributes nothing to the next release and no release PR is cut.
// Reject both shapes here so the failure surfaces before merge.
const opens = (message.match(/\(/g) ?? []).length;
const closes = (message.match(/\)/g) ?? []).length;
if (opens !== closes) {
    const side = opens > closes ? `${opens - closes} unclosed '('` : `${closes - opens} extra ')'`;
    fail(
        `commit message has unbalanced parentheses (${side}). release-please's parser drops ` +
            'such commits and skips the release. Balance every paren — write inline code as ' +
            '`szv()` or `szv`, not `szv(` — even inside backticks.',
    );
}

let depth = 0;
for (const character of message) {
    if (character === '(') {
        depth += 1;
        if (depth > 1) {
            fail(
                "commit message has nested parentheses. release-please's parser drops " +
                    'such commits and skips the release. Rewrite nested expressions such as ' +
                    '`calc(value * var(--spacing))` without the inner parentheses',
            );
        }
    } else if (character === ')') {
        depth -= 1;
    }
}

// The subject and the BREAKING CHANGE footer are copied by release-please into
// CHANGELOG.md, which GitHub renders as Markdown. A bare `<Word>` there is an
// HTML tag to the renderer and is stripped: `Props<T>` reads as `Props`,
// `@scope/pkg-<platform>` as `@scope/pkg-`. Inside a code span it survives.
const footerStart = lines.findIndex(line => /^BREAKING[ -]CHANGE:/.test(line));
const footerLines = [];
if (footerStart !== -1) {
    for (const line of lines.slice(footerStart)) {
        if (line.trim() === '') break;
        footerLines.push(line);
    }
}
for (const line of [header, ...footerLines]) {
    const outsideCode = line.replace(/`[^`]*`/g, '');
    const bare = outsideCode.match(/<[A-Za-z][A-Za-z0-9-]*>/);
    if (bare) {
        fail(
            `"${bare[0]}" in the subject or BREAKING CHANGE footer would be stripped as an HTML ` +
                'tag when the changelog renders. Put the identifier or placeholder in a code span: ' +
                `\`${bare[0]}\``,
        );
    }
}

function fail(reason, code = 1) {
    console.error(`commit message policy failed: ${reason}`);
    process.exit(code);
}
