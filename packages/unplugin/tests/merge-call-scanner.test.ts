import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { createRng } from '../../core/tests/helpers/sz-fuzz.js';
import { collectMergeCallClassNames } from '../src/authored-class-scanner.js';
import { sortStrings } from '../src/sort.js';

/**
 * Independent AST oracle for the generated grammar (unescaped string literals).
 * @param source - Valid TypeScript source.
 * @returns First-seen class names under an actual merge call.
 */
function parsedCandidates(source: string): string[] {
    const names = new Set<string>();
    const visit = (node: ts.Node, inMerge: boolean): void => {
        const inside =
            inMerge ||
            (ts.isCallExpression(node) &&
                ts.isIdentifier(node.expression) &&
                ['szcn', '_szcn'].includes(node.expression.text));
        if (inside && ts.isStringLiteral(node)) {
            for (const token of node.text.split(/\s+/)) if (token) names.add(token);
        }
        ts.forEachChild(node, child => visit(child, inside));
    };
    visit(ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true), false);
    return [...names];
}

/**
 * Count the source spans handed to the literal scan, without adding product telemetry.
 * @param source - Module text whose body slices are measured.
 * @returns Candidates and total body-slice length in UTF-16 units, not elapsed time.
 */
function scanWork(source: string): { names: string[]; units: number } {
    const slice = String.prototype.slice;
    let units = 0;
    const spy = vi.spyOn(String.prototype, 'slice').mockImplementation(function (
        this: string,
        start: number,
        end?: number,
    ) {
        const value = slice.call(this, start, end);
        if (this === source) units += value.length;
        return value;
    });
    try {
        return { names: [...collectMergeCallClassNames(source)], units };
    } finally {
        spy.mockRestore();
    }
}

describe('merge-call census traversal', () => {
    it.each([64, 256, 1024])('bounds body scan volume at depth %i', depth => {
        for (const closing of [')'.repeat(depth), '']) {
            const source = `${'szcn('.repeat(depth)}'p-4 p-2'${closing}`;
            const scanned = scanWork(source);
            expect(scanned.names).toEqual(['p-4', 'p-2']);
            // Nested bodies are already included in the outer literal scan.
            // Re-reading every suffix violates this bound deterministically.
            expect(scanned.units).toBeLessThanOrEqual(source.length);
        }
    });

    it('does not carry a cursor between scans or skip adjacent calls', () => {
        const source = "szcn('a');_szcn('b', szcn('c'));szcn('d');";
        for (let repeat = 0; repeat < 3; repeat++) {
            expect([...collectMergeCallClassNames(source)]).toEqual(['a', 'b', 'c', 'd']);
        }
    });

    it.each([
        ['', []],
        ["notSzcn('skip'); __szcn('skip'); szcnElse('skip')", []],
        ["szcn('', '  ', \"\")", []],
        ["szcn('unterminated", []],
        ["_szcn \n ('a', helper('b', szcn('c'))); szcn('d')", ['a', 'b', 'c', 'd']],
        ["szcn(/\\)/, 'a', /* ) */ _szcn('b')); _szcn('c')", ['a', 'b', 'c']],
        ["szcn(`prefix ${_szcn('a')}`, 'b'); szcn('c')", ['a', 'b', 'c']],
        [
            "szcn('é 😀 \ud800', _szcn('p-(--gap)')); szcn('tail')",
            ['é', '😀', '\ud800', 'p-(--gap)', 'tail'],
        ],
    ] as const)('preserves candidates at lexical boundaries: %s', (source, names) => {
        expect([...collectMergeCallClassNames(source)]).toEqual(names);
    });

    it.each([19, 324, 20260920])(
        'matches an independent parser on generated calls (seed %i)',
        seed => {
            const random = createRng(seed);
            for (let sample = 0; sample < 64; sample++) {
                const layers = Array.from({ length: 1 + Math.floor(random() * 48) }, (_, i) => ({
                    callee: ['szcn', '_szcn', 'helper'][Math.floor(random() * 3)],
                    literal: `${random() < 0.5 ? "'" : '"'}c${i}${random() < 0.5 ? ' gap-2' : ''}`,
                }));
                const render = (count: number) => {
                    let value = "'leaf'";
                    for (const { callee, literal } of layers.slice(0, count)) {
                        value = `${callee}(${literal}${literal[0]}, ${value})`;
                    }
                    return `szcn(${value}, 'tail'); _szcn('sibling'); helper('outside');`;
                };
                const differs = (count: number) =>
                    JSON.stringify([...collectMergeCallClassNames(render(count))]) !==
                    JSON.stringify(parsedCandidates(render(count)));
                let count = layers.length;
                // Keep seed/sample and shrink failing nesting to the smallest
                // prefix that still disagrees with the independent AST oracle.
                if (differs(count)) while (count > 0 && differs(count - 1)) count--;
                const source = render(count);
                const candidates = [...collectMergeCallClassNames(source)];
                expect(candidates, JSON.stringify({ seed, sample, count })).toEqual(
                    parsedCandidates(source),
                );
                const flattened = `szcn(${candidates.map(name => JSON.stringify(name)).join(',')})`;
                expect(
                    sortStrings(
                        collectMergeCallClassNames(`_szcn(${source.split(';')[0]});${flattened}`),
                    ),
                ).toEqual(sortStrings(candidates));
            }
        },
    );
});
