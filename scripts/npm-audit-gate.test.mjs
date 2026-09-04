// Unit tests for the JS dependency audit gate's failure classification.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyAuditFailure, summaryFor } from './npm-audit-gate.mjs';

// Captured verbatim from `pnpm audit --audit-level high --ignore-unfixable`
// on 2026-09-04, while the advisory endpoint answered GET in 0.4s and hung on
// every POST. Kept as the real thing: a hand-written approximation of an error
// is a test of the approximation.
const REGISTRY_DOWN = [
    'packages/core-darwin-x64 | [WARN] Unsupported platform: wanted: {"cpu":["x64"]}',
    '[WARN] POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk error (23). Will retry in 10 seconds. 2 retries left.',
    '[WARN] POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk error (23). Will retry in 1 minute. 1 retries left.',
    '[23] The operation was aborted due to timeout',
    '',
    'TimeoutError: The operation was aborted due to timeout',
    '    at new DOMException (node:internal/per_context/domexception:79:18)',
].join('\n');

const FINDINGS = [
    '┌─────────────────────┬────────────────────────────────────────────┐',
    '│ high                │ Prototype pollution in example-package      │',
    '│ Package             │ example-package                             │',
    '│ Patched in          │ >=1.2.3                                     │',
    '└─────────────────────┴────────────────────────────────────────────┘',
    '1 vulnerabilities found. Severity: 1 high',
].join('\n');

describe('classifying an audit failure', () => {
    it('reads the registry error the endpoint outage actually produced', () => {
        assert.equal(classifyAuditFailure(REGISTRY_DOWN), 'registry-unreachable');
    });

    // The rule that matters: anything not positively identified as the
    // registry failing is treated as a finding, because "we could not check"
    // must never be the quiet answer to "is this dependency tree safe".
    it('treats a report it does not recognise as findings', () => {
        assert.equal(classifyAuditFailure(FINDINGS), 'findings');
        assert.equal(classifyAuditFailure(''), 'findings');
        assert.equal(classifyAuditFailure('some future output shape'), 'findings');
    });

    // Both at once resolves to findings for the same reason: an advisory that
    // was reported is reported, whatever else went wrong in the same run.
    it('treats a run that reports both as findings', () => {
        assert.equal(classifyAuditFailure(`${REGISTRY_DOWN}\n${FINDINGS}`), 'findings');
    });

    // A retry that recovered is not a failure of the endpoint: the warning
    // lines are there, the abort is not.
    it('does not read a recovered retry as an outage', () => {
        const recovered = [
            '[WARN] POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk error (23). Will retry in 10 seconds. 2 retries left.',
            '1 vulnerabilities found. Severity: 1 high',
        ].join('\n');
        assert.equal(classifyAuditFailure(recovered), 'findings');
    });
});

describe('the summary written for the checks tab', () => {
    it('says the tree was not audited when the service was unreachable', () => {
        const summary = summaryFor('registry-unreachable');
        assert.match(summary, /not audited/i);
        assert.match(summary, /advisory service/i);
        assert.doesNotMatch(summary, /vulnerab/i);
    });

    it('says findings when there are findings', () => {
        assert.match(summaryFor('findings'), /advisor/i);
    });
});
