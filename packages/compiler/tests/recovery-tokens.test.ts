/**
 * Tests for szRecover JSX integration: the engine's recovery-token emission.
 *
 * The runtime side (`@csszyx/runtime/verify`) reads tokens from a manifest
 * and matches them against `data-sz-recovery-token` attributes. These tests
 * verify the build emits both the attribute and the token map needed to
 * complete that contract.
 */

import { describe, expect, it } from 'vitest';

import { transformSource } from '../src/transform-select.js';

describe('transformSource — szRecover handling', () => {
    it('emits data-sz-recovery-token + collects token entry for csr mode', () => {
        const source = 'const App = () => <div szRecover="csr">child</div>;';
        const result = transformSource(source, 'src/App.tsx');

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
        const result = transformSource(source, 'src/Page.tsx');

        const entries = [...result.recoveryTokens.entries()];
        expect(entries).toHaveLength(1);
        expect(entries[0][1].mode).toBe('dev-only');
        expect(entries[0][1].component).toBe('section');
    });

    it('skips emission and emits a diagnostic on dynamic szRecover values', () => {
        const source = 'const App = ({ mode }) => <div szRecover={mode}>x</div>;';
        const result = transformSource(source, 'src/App.tsx');

        expect(result.recoveryTokens.size).toBe(0);
        expect(result.code).not.toContain('data-sz-recovery-token');
        expect(result.diagnostics.some(d => d.includes('szRecover'))).toBe(true);
    });

    it('skips emission and emits a diagnostic on unknown mode strings', () => {
        const source = 'const App = () => <div szRecover="ssr">x</div>;';
        const result = transformSource(source, 'src/App.tsx');

        expect(result.recoveryTokens.size).toBe(0);
        expect(result.code).not.toContain('data-sz-recovery-token');
        expect(result.diagnostics.some(d => d.includes('unknown mode "ssr"'))).toBe(true);
    });

    it('is idempotent on re-transform (HMR safe)', () => {
        const source = 'const App = () => <div szRecover="csr">x</div>;';
        const first = transformSource(source, 'src/App.tsx');
        // Feed first.code back through — simulates a downstream tool re-running
        // the transform on already-tagged JSX. The visitor must not double-tag.
        const second = transformSource(first.code, 'src/App.tsx');

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
        const result = transformSource(source, 'src/App.tsx');

        expect(result.recoveryTokens.size).toBe(3);
        const components = [...result.recoveryTokens.values()].map(t => t.component).sort();
        expect(components).toEqual(['div', 'p', 'span']);
        const modes = [...result.recoveryTokens.values()].map(t => t.mode).sort();
        expect(modes).toEqual(['csr', 'csr', 'dev-only']);
    });

    it('produces stable tokens across rebuilds with the same source', () => {
        const source = 'const App = () => <div szRecover="csr">x</div>;';
        const a = transformSource(source, 'src/App.tsx');
        const b = transformSource(source, 'src/App.tsx');
        const tokenA = [...a.recoveryTokens.keys()][0];
        const tokenB = [...b.recoveryTokens.keys()][0];
        expect(tokenA).toBe(tokenB);
    });

    it('produces different tokens for the same JSX in different files', () => {
        const source = 'const App = () => <div szRecover="csr">x</div>;';
        const a = transformSource(source, 'src/A.tsx');
        const b = transformSource(source, 'src/B.tsx');
        const tokenA = [...a.recoveryTokens.keys()][0];
        const tokenB = [...b.recoveryTokens.keys()][0];
        expect(tokenA).not.toBe(tokenB);
    });
});
