/**
 * Tests for recovery-token generation + szRecover JSX integration.
 *
 * The runtime side (`@csszyx/runtime/verify`) reads tokens from a manifest
 * and matches them against `data-sz-recovery-token` attributes. These tests
 * verify the build emits both the attribute and the token map needed to
 * complete that contract.
 */

import { describe, expect, it } from 'vitest';

import { generateInlineRecoveryToken, isValidInlineRecoveryMode } from '../src/recovery-tokens.js';
import { transformSourceCode } from '../src/transform.js';

describe('generateInlineRecoveryToken', () => {
    it('produces a 12-character hex token', () => {
        const token = generateInlineRecoveryToken('src/App.tsx', 10, 4, 'div');
        expect(token).toMatch(/^[0-9a-f]{12}$/);
        expect(token).toHaveLength(12);
    });

    it('is deterministic for the same inputs', () => {
        const a = generateInlineRecoveryToken('src/App.tsx', 10, 4, 'div');
        const b = generateInlineRecoveryToken('src/App.tsx', 10, 4, 'div');
        expect(a).toBe(b);
    });

    it('differs when any input differs', () => {
        const base = generateInlineRecoveryToken('src/App.tsx', 10, 4, 'div');
        expect(generateInlineRecoveryToken('src/Other.tsx', 10, 4, 'div')).not.toBe(base);
        expect(generateInlineRecoveryToken('src/App.tsx', 11, 4, 'div')).not.toBe(base);
        expect(generateInlineRecoveryToken('src/App.tsx', 10, 5, 'div')).not.toBe(base);
        expect(generateInlineRecoveryToken('src/App.tsx', 10, 4, 'span')).not.toBe(base);
    });
});

describe('isValidInlineRecoveryMode', () => {
    it('accepts the two recognised modes', () => {
        expect(isValidInlineRecoveryMode('csr')).toBe(true);
        expect(isValidInlineRecoveryMode('dev-only')).toBe(true);
    });

    it('rejects everything else', () => {
        expect(isValidInlineRecoveryMode('ssr')).toBe(false);
        expect(isValidInlineRecoveryMode('')).toBe(false);
        expect(isValidInlineRecoveryMode(null)).toBe(false);
        expect(isValidInlineRecoveryMode(undefined)).toBe(false);
        expect(isValidInlineRecoveryMode(0)).toBe(false);
    });
});

describe('transformSourceCode — szRecover handling', () => {
    it('emits data-sz-recovery-token + collects token entry for csr mode', () => {
        const source = 'const App = () => <div szRecover="csr">child</div>;';
        const result = transformSourceCode(source, 'src/App.tsx');

        expect(result.transformed).toBe(true);
        expect(result.code).toMatch(/data-sz-recovery-token="[0-9a-f]{12}"/);
        expect(result.code).toContain('szRecover="csr"'); // szRecover preserved for runtime check

        expect(result.recoveryTokens.size).toBe(1);
        const [[token, data]] = result.recoveryTokens;
        expect(token).toMatch(/^[0-9a-f]{12}$/);
        expect(data.mode).toBe('csr');
        expect(data.component).toBe('div');
        expect(data.path).toContain('src/App.tsx');
    });

    it('emits a token for dev-only mode', () => {
        const source = 'const App = () => <section szRecover="dev-only">x</section>;';
        const result = transformSourceCode(source, 'src/Page.tsx');

        const entries = [...result.recoveryTokens.entries()];
        expect(entries).toHaveLength(1);
        expect(entries[0][1].mode).toBe('dev-only');
        expect(entries[0][1].component).toBe('section');
    });

    it('skips emission and emits a diagnostic on dynamic szRecover values', () => {
        const source = 'const App = ({ mode }) => <div szRecover={mode}>x</div>;';
        const result = transformSourceCode(source, 'src/App.tsx');

        expect(result.recoveryTokens.size).toBe(0);
        expect(result.code).not.toContain('data-sz-recovery-token');
        expect(result.diagnostics.some(d => d.includes('szRecover'))).toBe(true);
    });

    it('skips emission and emits a diagnostic on unknown mode strings', () => {
        const source = 'const App = () => <div szRecover="ssr">x</div>;';
        const result = transformSourceCode(source, 'src/App.tsx');

        expect(result.recoveryTokens.size).toBe(0);
        expect(result.code).not.toContain('data-sz-recovery-token');
        expect(result.diagnostics.some(d => d.includes('unknown mode "ssr"'))).toBe(true);
    });

    it('is idempotent on re-transform (HMR safe)', () => {
        const source = 'const App = () => <div szRecover="csr">x</div>;';
        const first = transformSourceCode(source, 'src/App.tsx');
        // Feed first.code back through — simulates a downstream tool re-running
        // the transform on already-tagged JSX. The visitor must not double-tag.
        const second = transformSourceCode(first.code, 'src/App.tsx');

        // Either: second adds zero tokens AND code stays single-tagged.
        const tagCount = (second.code.match(/data-sz-recovery-token=/g) ?? []).length;
        expect(tagCount).toBe(1);
        expect(second.recoveryTokens.size).toBe(0); // already-tagged path skips
    });

    it('collects tokens from multiple szRecover sites in one file', () => {
        const source = [
            'const A = () => <div szRecover="csr">a</div>;',
            'const B = () => <span szRecover="dev-only">b</span>;',
            'const C = () => <p szRecover="csr">c</p>;',
        ].join('\n');
        const result = transformSourceCode(source, 'src/App.tsx');

        expect(result.recoveryTokens.size).toBe(3);
        const components = [...result.recoveryTokens.values()].map(t => t.component).sort();
        expect(components).toEqual(['div', 'p', 'span']);
        const modes = [...result.recoveryTokens.values()].map(t => t.mode).sort();
        expect(modes).toEqual(['csr', 'csr', 'dev-only']);
    });

    it('produces stable tokens across rebuilds with the same source', () => {
        const source = 'const App = () => <div szRecover="csr">x</div>;';
        const a = transformSourceCode(source, 'src/App.tsx');
        const b = transformSourceCode(source, 'src/App.tsx');
        const tokenA = [...a.recoveryTokens.keys()][0];
        const tokenB = [...b.recoveryTokens.keys()][0];
        expect(tokenA).toBe(tokenB);
    });

    it('produces different tokens for the same JSX in different files', () => {
        const source = 'const App = () => <div szRecover="csr">x</div>;';
        const a = transformSourceCode(source, 'src/A.tsx');
        const b = transformSourceCode(source, 'src/B.tsx');
        const tokenA = [...a.recoveryTokens.keys()][0];
        const tokenB = [...b.recoveryTokens.keys()][0];
        expect(tokenA).not.toBe(tokenB);
    });
});
