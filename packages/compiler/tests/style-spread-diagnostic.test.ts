import { describe, expect, it } from 'vitest';
import { transformRust } from '../src/transform-rust.js';
import { transformWasm } from '../src/transform-wasm.js';

import { ENGINES, RUST_LANE } from './engine-parity-harness.js';

const collisionSource =
    'const A=({width,cond,flex})=><div sz={{w:width}} {...(cond?{style:{flex,},}:{})}/>;';
const diagnosticMarker = 'possible style override';

/**
 * Each artifact's diagnostics for one source, joined for substring checks.
 *
 * @param source - Module source.
 * @returns `[artifact name, joined diagnostics]` per engine artifact.
 */
function diagnosticsPerEngine(source: string): Array<readonly [string, string]> {
    return ENGINES.map(
        ([name, transform]) =>
            [name, (transform(source, 'probe.tsx').diagnostics ?? []).join('\n')] as const,
    );
}

describe('style supplied by a prop spread beside runtime sz values', () => {
    it('every artifact normalizes safe conditional object branches', () => {
        for (const [name, diagnostics] of diagnosticsPerEngine(collisionSource)) {
            expect(diagnostics, name).not.toContain(diagnosticMarker);
        }
    });

    it('injects generated style into every conditional branch exactly once', () => {
        for (const [, transform] of ENGINES) {
            const code = transform(collisionSource, 'probe.tsx').code ?? '';
            expect(code.match(/__szSpacingVar/g)).toHaveLength(2);
            expect(code).not.toMatch(/\sstyle=\{\{/);
        }
    });

    it.runIf(RUST_LANE)('native is byte-identical to wasm for safe branches', () => {
        const wasm = transformWasm(collisionSource, 'probe.tsx');
        const rust = transformRust(collisionSource, 'probe.tsx');
        expect(rust.code).toBe(wasm.code);
        expect(rust.diagnostics).toEqual(wasm.diagnostics);
    });

    it.each([
        ['unresolved spread', 'const A=({width,props})=><div sz={{w:width}} {...props}/>;'],
        [
            'object branch with an unknown nested spread',
            'const A=({width,cond,rest})=><div sz={{w:width}} {...(cond?{...rest}:{})}/>;',
        ],
        ['multiple prop spreads', 'const A=({width,a,b})=><div sz={{w:width}} {...a} {...b}/>;'],
        [
            'computed object-branch keys',
            'const A=({width,key,value})=><div sz={{w:width}} {...{[key]:value}}/>;',
        ],
    ])('keeps the warning for %s', (_, source) => {
        for (const [name, diagnostics] of diagnosticsPerEngine(source)) {
            expect(diagnostics, name).toContain(diagnosticMarker);
        }
    });

    it('merges a safe expression-valued style without an explicit style attribute', () => {
        const source = 'const A=({width,base})=><div sz={{w:width}} {...{style:base,id:"x"}}/>;';
        for (const [, transform] of ENGINES) {
            const result = transform(source, 'probe.tsx');
            expect((result.diagnostics ?? []).join('\n')).not.toContain(diagnosticMarker);
            expect(result.code).toMatch(/\.\.\.\(?base\)?/);
            expect(result.code).not.toMatch(/\sstyle=\{\{/);
        }
    });

    it.each([
        ['static sz does not emit style', 'const A=({props})=><div sz={{p:4}} {...props}/>;'],
        [
            'an explicit style attribute is mergeable',
            'const A=({width,flex})=><div sz={{w:width}} style={{flex}}/>;',
        ],
        [
            'a runtime sz value without a spread is safe',
            'const A=({width})=><div sz={{w:width}}/>;',
        ],
    ])('does not warn when %s', (_, source) => {
        for (const [name, diagnostics] of diagnosticsPerEngine(source)) {
            expect(diagnostics, name).not.toContain(diagnosticMarker);
        }
    });
});
