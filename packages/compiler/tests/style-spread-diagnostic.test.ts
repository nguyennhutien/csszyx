import { describe, expect, it } from 'vitest';
import { transformRust } from '../src/transform-rust.js';
import { transformWasm } from '../src/transform-wasm.js';

import { ENGINES, RUST_LANE } from './engine-parity-harness.js';

const collisionSource =
    'const A=({width,cond,flex})=><div sz={{w:width}} {...(cond?{style:{flex,},}:{})}/>;';
const diagnosticCode = 'style-override';

/**
 * The code of each issue every artifact reports for one source.
 *
 * @param source - Module source.
 * @returns `[artifact name, issue codes]` per engine artifact.
 */
function codesPerEngine(source: string): Array<readonly [string, string[]]> {
    return ENGINES.map(
        ([name, transform]) =>
            [
                name,
                (transform(source, { filename: 'probe.tsx' }).issues ?? []).map(
                    issue => issue.code,
                ),
            ] as const,
    );
}

describe('style supplied by a prop spread beside runtime sz values', () => {
    it('every artifact normalizes safe conditional object branches', () => {
        for (const [name, codes] of codesPerEngine(collisionSource)) {
            expect(codes, name).not.toContain(diagnosticCode);
        }
    });

    it('injects generated style into every conditional branch exactly once', () => {
        for (const [, transform] of ENGINES) {
            const code = transform(collisionSource, { filename: 'probe.tsx' }).code ?? '';
            expect(code.match(/__szSpacingVar/g)).toHaveLength(2);
            expect(code).not.toMatch(/\sstyle=\{\{/);
        }
    });

    it.runIf(RUST_LANE)('native is byte-identical to wasm for safe branches', () => {
        const wasm = transformWasm(collisionSource, { filename: 'probe.tsx' });
        const rust = transformRust(collisionSource, { filename: 'probe.tsx' });
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
        for (const [name, codes] of codesPerEngine(source)) {
            expect(codes, name).toContain(diagnosticCode);
        }
    });

    it('merges a safe expression-valued style without an explicit style attribute', () => {
        const source = 'const A=({width,base})=><div sz={{w:width}} {...{style:base,id:"x"}}/>;';
        for (const [, transform] of ENGINES) {
            const result = transform(source, { filename: 'probe.tsx' });
            expect((result.issues ?? []).map(issue => issue.code)).not.toContain(diagnosticCode);
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
        for (const [name, codes] of codesPerEngine(source)) {
            expect(codes, name).not.toContain(diagnosticCode);
        }
    });
});
