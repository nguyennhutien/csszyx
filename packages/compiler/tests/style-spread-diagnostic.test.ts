import { describe, expect, it } from 'vitest';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';
import { transformSource } from '../src/transform-select.js';
import { transformWasm } from '../src/transform-wasm.js';

const collisionSource =
    'const A=({width,cond,flex})=><div sz={{w:width}} {...(cond?{style:{flex,},}:{})}/>;';
const diagnosticMarker = 'possible style override';

function babelDiagnostics(source: string): string[] {
    return transformSource(source, 'probe.tsx').diagnostics;
}

function oxcDiagnostics(source: string): string[] {
    return transformWasm(source, 'probe.tsx').diagnostics;
}

describe('style supplied by a prop spread beside runtime sz values', () => {
    it.each([
        ['auto', babelDiagnostics],
        ['wasm', oxcDiagnostics],
    ] as const)('%s normalizes safe conditional object branches', (_, transform) => {
        expect(transform(collisionSource).join('\n')).not.toContain(diagnosticMarker);
    });

    it('injects generated style into every conditional branch exactly once', () => {
        for (const transform of [transformSource, transformWasm]) {
            const result = transform(collisionSource, 'probe.tsx');
            expect(result.code.match(/__szSpacingVar/g)).toHaveLength(2);
            expect(result.code).not.toMatch(/\sstyle=\{\{/);
        }
    });

    it.runIf(isRustTransformAvailable())('rust is byte-identical to oxc for safe branches', () => {
        const oxc = transformWasm(collisionSource, 'probe.tsx');
        const rust = transformRust(collisionSource, 'probe.tsx');
        expect(rust.code).toBe(oxc.code);
        expect(rust.diagnostics).toEqual(oxc.diagnostics);
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
        expect(babelDiagnostics(source).join('\n')).toContain(diagnosticMarker);
        expect(oxcDiagnostics(source).join('\n')).toContain(diagnosticMarker);
        if (isRustTransformAvailable()) {
            expect(transformRust(source, 'probe.tsx').diagnostics.join('\n')).toContain(
                diagnosticMarker,
            );
        }
    });

    it('merges a safe expression-valued style without an explicit style attribute', () => {
        const source = 'const A=({width,base})=><div sz={{w:width}} {...{style:base,id:"x"}}/>;';
        for (const transform of [transformSource, transformWasm]) {
            const result = transform(source, 'probe.tsx');
            expect(result.diagnostics.join('\n')).not.toContain(diagnosticMarker);
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
        expect(babelDiagnostics(source).join('\n')).not.toContain(diagnosticMarker);
        expect(oxcDiagnostics(source).join('\n')).not.toContain(diagnosticMarker);
        if (isRustTransformAvailable()) {
            expect(transformRust(source, 'probe.tsx').diagnostics.join('\n')).not.toContain(
                diagnosticMarker,
            );
        }
    });
});
