import { describe, expect, it } from 'vitest';
import { transformSourceCode } from '../src/transform.js';
import { transformOxc } from '../src/transform-oxc.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';

const collisionSource =
    'const A=({width,cond,flex})=><div sz={{w:width}} {...(cond?{style:{flex}}:{})}/>;';
const diagnosticMarker = 'possible style override';

function babelDiagnostics(source: string): string[] {
    return transformSourceCode(source, 'probe.tsx').diagnostics;
}

function oxcDiagnostics(source: string): string[] {
    return transformOxc(source, 'probe.tsx').diagnostics;
}

describe('style supplied by a prop spread beside runtime sz values', () => {
    it.each([
        ['babel', babelDiagnostics],
        ['oxc', oxcDiagnostics],
    ] as const)('%s warns that generated style may override spread style', (_, transform) => {
        expect(transform(collisionSource).join('\n')).toContain(diagnosticMarker);
    });

    it.runIf(isRustTransformAvailable())('rust emits the same warning', () => {
        expect(transformRust(collisionSource, 'probe.tsx').diagnostics.join('\n')).toContain(
            diagnosticMarker,
        );
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
