/**
 * What each out-of-band usage record says, to the character: the position
 * conventions a build error points the reader at, and the message it prints.
 *
 * Columns count UTF-16 code units from the last `\n`, 1-based, so a non-ASCII
 * character before the node moves the column by its JavaScript length, and a
 * lone `\r` is a column like any other character.
 */
import { describe, expect, it } from 'vitest';

import { GLOBAL_VAR_SCANNERS, scanOneFile } from './engine-parity-harness.js';

const SOURCE = [
    "const e = '😀é'; el.style.setProperty('--a', 1);",
    "x;\rel.style.removeProperty('--r');",
    'const A = () => <div style={{ \'--b\': 1 }} className="bg-[var(--c)] var( --d) var(\u0085--e) var(﻿--f)" />;',
].join('\n');

/**
 * The message every usage record carries.
 *
 * @param name - Custom-property name.
 * @param kind - Usage kind.
 * @returns The record's message.
 */
function message(name: string, kind: string): string {
    return `${name} is used outside csszyx-owned global variable alias rewrites (${kind}).`;
}

describe.each(GLOBAL_VAR_SCANNERS)('global-var usage records on the %s artifact', (_name, scan) => {
    const scanGlobalVarUsages = scanOneFile(scan);

    it('place each usage by UTF-16 column and name it in the message', () => {
        const at = (line: number, column: number) => ({ filePath: '/p/a.tsx', line, column });

        expect(scanGlobalVarUsages(SOURCE, '/p/a.tsx')).toEqual([
            {
                kind: 'style-set-property',
                name: '--a',
                location: at(1, 18),
                message: message('--a', 'style-set-property'),
            },
            {
                kind: 'style-remove-property',
                name: '--r',
                location: at(2, 4),
                message: message('--r', 'style-remove-property'),
            },
            {
                kind: 'jsx-style-key',
                name: '--b',
                location: at(3, 31),
                message: message('--b', 'jsx-style-key'),
            },
            ...['--c', '--d', '--f'].map(name => ({
                kind: 'class-string-var-reference',
                name,
                location: at(3, 43),
                message: message(name, 'class-string-var-reference'),
            })),
        ]);
    });

    it('report an outer call before the calls in its arguments, with constants read file-wide', () => {
        // The constant is declared after its use and redeclared in a block; the
        // last declaration in source order is the value every use reads.
        const source = [
            "el.style.setProperty(outer, el.style.getPropertyValue(inner), el.style[setProperty]('--x'));",
            "const outer = '--first';",
            "{ const outer = '--outer'; const inner = '--inner'; }",
            "const A = () => <i style={{ [outer]: el.style.removeProperty('--in-style') }} />;",
        ].join('\n');

        expect(
            scanGlobalVarUsages(source, '/p/a.tsx').map(usage => [
                usage.kind,
                usage.name,
                usage.location.line,
                usage.location.column,
            ]),
        ).toEqual([
            ['style-set-property', '--outer', 1, 1],
            ['style-get-property', '--inner', 1, 29],
            ['style-set-property', '--x', 1, 63],
            ['jsx-style-key', '--outer', 4, 29],
            ['style-remove-property', '--in-style', 4, 38],
        ]);
    });

    it('answer a batch with one list per file, in input order', () => {
        const names = scan([
            { filename: '/p/b.ts', source: "el.style.setProperty('--b', 1);" },
            { filename: '/p/plain.ts', source: 'const plain = 1;' },
            { filename: '/p/a.ts', source: "el.style.setProperty('--a', 1);" },
        ]).map(usages => usages.map(usage => `${usage.location.filePath} ${usage.name}`));

        expect(names).toEqual([['/p/b.ts --b'], [], ['/p/a.ts --a']]);
    });
});
