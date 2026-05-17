/**
 * Phase D foundation POC tests — prove the parse → walk → magic-string
 * pipeline before D2 starts a real `transform.ts` port.
 *
 * These tests do NOT exercise compiler semantics. They exercise the
 * pipeline contract:
 *   - oxc-parser actually parses TSX without errors.
 *   - Node start/end offsets feed magic-string cleanly.
 *   - Surgical edits preserve every byte outside the touched range.
 *   - A v3 source map is emitted.
 */

import { describe, expect, it } from 'vitest';
import { transformOxcPoc } from './transform-oxc.poc.js';

describe('Phase D POC — oxc-parser + magic-string pipeline', () => {
    it('replaces a sz attribute and preserves the rest of the source byte-for-byte', () => {
        const src = 'const App = () => <div sz={{ p: 4, bg: "blue-500" }} id="main">hello</div>;';
        const result = transformOxcPoc(src, 'app.tsx');

        expect(result.classes).toEqual(['p-4', 'bg-blue-500']);
        expect(result.code).toBe(
            'const App = () => <div className="p-4 bg-blue-500" id="main">hello</div>;',
        );
    });

    it('preserves leading comments, indentation, and trailing newlines verbatim', () => {
        const src = [
            '// keep this comment',
            'function X() {',
            '    return (',
            '        <div',
            '            sz={{ p: 8 }}',
            '        />',
            '    );',
            '}',
            '',
        ].join('\n');
        const result = transformOxcPoc(src, 'X.tsx');

        expect(result.code).toContain('// keep this comment');
        expect(result.code).toContain('function X() {');
        expect(result.code).toContain('    return (');
        // The multi-line sz collapses to a single-line className — exact
        // length depends on the source range overwritten, so only assert
        // the two byte-equal anchors before/after the edit.
        expect(result.code).toContain('        <div');
        expect(result.code).toContain('        />');
        expect(result.code).not.toMatch(/\bsz\s*=/);
        expect(result.code).toContain('className="p-8"');
    });

    it('leaves files without sz attributes untouched (zero-edit fast path)', () => {
        const src = 'const x = <div id="a"><span>hi</span></div>;';
        const result = transformOxcPoc(src, 'app.tsx');

        expect(result.code).toBe(src);
        expect(result.classes).toEqual([]);
    });

    it('rewrites multiple sz attributes in one pass without overlap errors', () => {
        const src =
            'const App = () => (\n    <section sz={{ p: 4 }}>\n        <div sz={{ bg: "white" }} />\n    </section>\n);';
        const result = transformOxcPoc(src, 'app.tsx');

        expect(result.classes).toEqual(['p-4', 'bg-white']);
        expect(result.code).toContain('<section className="p-4">');
        expect(result.code).toContain('<div className="bg-white" />');
    });

    it('emits a v3 source map covering the edits', () => {
        const src = 'const a = <div sz={{ p: 1 }} />;';
        const result = transformOxcPoc(src, 'a.tsx');

        expect(result.map.version).toBe(3);
        expect(result.map.sources).toContain('a.tsx');
        expect(result.map.mappings).toBeTypeOf('string');
        expect(result.map.mappings.length).toBeGreaterThan(0);
    });

    it('surfaces parser errors instead of silently producing garbage', () => {
        const src = 'const broken = <div sz={{ p: 4 ;'; // intentional syntax error
        expect(() => transformOxcPoc(src, 'broken.tsx')).toThrow(/oxc-parser errors/);
    });
});
