import { createHash } from 'node:crypto';

import { transformSource } from '@csszyx/compiler/engine';
import { describe, expect, it } from 'vitest';

import {
    collectNextTransformMetadata,
    createNextSafelistShardFromMetadata,
} from '../src/next-transform-metadata.js';

describe('Next transform metadata', () => {
    it('collects quoted and boolean literals from a runtime object result', () => {
        const source = 'const App=({rest})=> <div sz={{ ...rest }} />;';
        const result = transformSource(source, { filename: '/repo/src/App.tsx' });
        const metadata = collectNextTransformMetadata(
            {
                ...result,
                usesRuntime: true,
                code: `_sz({ display: "flex", color: 'red-500', hidden: true, italic: false })`,
            },
            source,
            '/repo/src/App.tsx',
        );
        expect(metadata.classes).toEqual(['flex', 'text-red-500']);
        expect(metadata.classes).not.toContain('italic');
    });

    /**
     * The classes collected from one runtime `_sz` result.
     * @param code - The transformed code the engine would have returned.
     * @returns The collected classes, sorted.
     */
    function runtimeClasses(code: string): string[] {
        const source = 'const App=({rest})=> <div sz={{ ...rest }} />;';
        const result = transformSource(source, { filename: '/repo/src/App.tsx' });
        return collectNextTransformMetadata(
            { ...result, usesRuntime: true, code },
            source,
            '/repo/src/App.tsx',
        ).classes;
    }

    it.each([
        ['a number as the last key', '_sz({ display: "flex", p: 4 })', ['flex', 'p-4']],
        ['a boolean as the last key', '_sz({ p: 4, truncate: true })', ['p-4', 'truncate']],
        ['a key before a trailing comma', '_sz({ p: 4, m: 2, })', ['m-2', 'p-4']],
        ['a number before a line comment', '_sz({ p: 4 // pad\n })', ['p-4']],
    ])('collects %s of a runtime object', (_label, code, classes) => {
        expect(runtimeClasses(code)).toEqual(classes);
    });

    it.each([
        // `hover: { p: 4 }` is `hover:p-4`, which the engine reports itself;
        // a bare `p-4` read out of it is a class the source never asked for.
        ['a variant object', "_sz({ hover: { p: 4, color: 'red-500' }, m: 2 })", ['m-2']],
        ['a parenthesised spread', '_sz({ w: x, ...(f ? {} : { mt: 1 }), m: 2 })', ['m-2']],
    ])(
        'reads only the top level of a runtime object, never a key inside %s',
        (_label, code, classes) => {
            expect(runtimeClasses(code)).toEqual(classes);
        },
    );

    it.each([
        [
            'a quoted string',
            '_sz({ content: "{", hover: { y: "a\\"}", z: `}` }, w: `(`, p: 4 })',
            ['content-[{]', 'p-4'],
        ],
        ['a block comment', '_sz({ /* } */ p: 4, m: 2 })', ['m-2', 'p-4']],
        [
            'a regular expression',
            '_sz({ w: /[}]/.test(v) ? "full" : "auto", p: 4, m: 2 })',
            ['m-2', 'p-4'],
        ],
        [
            'a template inside a template',
            '_sz({ content: `${b ? `}` : ""}`, p: 4, m: 2 })',
            ['m-2', 'p-4'],
        ],
    ])('keeps a brace inside %s from ending the runtime object', (_label, code, classes) => {
        expect(runtimeClasses(code)).toEqual(classes);
    });

    it.each([
        [
            'a line comment',
            "_sz({ ...r, // it's\n hover: { p: 8 }, m: 2 }); const o = { gap: 3 }; s('y')",
        ],
        [
            'a regular expression',
            "_sz({ w: /'/.test(v) ? 1 : 0, m: 2 }); const cfg = { opacity: 50 }; t('x')",
        ],
        [
            'a template interpolation',
            '_sz({ content: `${"`"}`, m: 2 }); const o = { gap: 3 }; q("x")',
        ],
    ])('keeps a quote inside %s from reading past the runtime object', (_label, code) => {
        expect(runtimeClasses(code)).toEqual(['m-2']);
    });

    it.each([
        ['an object with no closing brace', '_sz({ p: 4, m: 2', ['m-2', 'p-4']],
        ['a string with no closing quote', "_sz({ p: 4, a: 'oops, m: 2 })", ['m-2', 'p-4']],
        ['a call that is not `_sz`', 'foo({ p: 4 })', []],
        ['an object followed by other code', '_sz({ p: 4 }); const o = { m: 2 }', ['p-4']],
        ['two calls in a row', '_sz({ p: 4 }); _sz({ m: 2 })', ['m-2', 'p-4']],
    ])('reads %s without losing or inventing a class', (_label, code, classes) => {
        expect(runtimeClasses(code)).toEqual(classes);
    });

    it('collects generated classes separately from raw className strings', () => {
        const source =
            'const App=()=> <div className="existing" sz={{ p: 4, display: "flex" }} />;';
        const result = transformSource(source, { filename: '/repo/src/App.tsx' });
        const metadata = collectNextTransformMetadata(result, source, '/repo/src/App.tsx');

        expect(metadata.sourceHash).toBe(createHash('sha256').update(source).digest('hex'));
        expect(metadata.classes).toEqual(['flex', 'p-4']);
        expect(metadata.rawClassNames).toEqual(['existing']);
        expect(metadata.recoveryTokenCount).toBe(0);
    });

    it('extracts static classes hidden inside runtime _sz fallback calls', () => {
        const source = 'const App=({rest})=> <div sz={{ p: 4, ...rest }} />;';
        const result = transformSource(source, { filename: '/repo/src/App.tsx' });
        const metadata = collectNextTransformMetadata(result, source, '/repo/src/App.tsx');

        expect(result.usesRuntime).toBe(true);
        expect(metadata.classes).toEqual(expect.arrayContaining(['p-4']));
    });

    it('creates safelist shard input from generated class metadata', () => {
        const source = 'const App=()=> <div className="raw" sz={{ p: 2 }} />;';
        const result = transformSource(source, { filename: '/repo/src/App.tsx' });
        const metadata = collectNextTransformMetadata(result, source, '/repo/src/App.tsx');

        expect(createNextSafelistShardFromMetadata(metadata, 'cache-key')).toEqual({
            cacheKey: 'cache-key',
            sourcePath: '/repo/src/App.tsx',
            sourceHash: createHash('sha256').update(source).digest('hex'),
            classes: ['p-2'],
            authoredClasses: ['raw'],
            mergeLiterals: [],
            classSites: metadata.classSites,
            underscoreSites: [],
        });
    });

    it('records each `_` the source writes in an `sz` value, at its key', () => {
        const source = `const App=()=> <div sz={{ p: 2, content: "'a_b'" }} />;`;
        const result = transformSource(source, { filename: '/repo/src/App.tsx' });
        const metadata = collectNextTransformMetadata(result, source, '/repo/src/App.tsx');

        expect(metadata.underscoreSites).toEqual([
            {
                key: 'content',
                value: "'a_b'",
                className: "content-['a_b']",
                line: 1,
                column: source.indexOf('content') + 1,
            },
        ]);
        expect(createNextSafelistShardFromMetadata(metadata).underscoreSites).toEqual(
            metadata.underscoreSites,
        );
    });

    it('places each class at the key it was lowered from, as the Vite lane does', () => {
        // The dead-class line of a Next command names the line, column and
        // key, so the shard carries them from the first pass.
        const source = "const App=()=> <div sz={{ break: 'bogus', p: 4 }} />;";
        const result = transformSource(source, { filename: '/repo/src/App.tsx' });
        const metadata = collectNextTransformMetadata(result, source, '/repo/src/App.tsx');
        const column = source.indexOf('break') + 1;

        expect(metadata.classSites).toEqual([
            { className: 'break-bogus', line: 1, column, key: 'break' },
            { className: 'p-4', line: 1, column: source.indexOf('p: 4') + 1, key: 'p' },
        ]);
        expect(createNextSafelistShardFromMetadata(metadata).classSites).toEqual(
            metadata.classSites,
        );
    });

    it('places the class of a one-class object too', () => {
        const source = "const App=()=> <div sz={{ justify: 'safe-center' }} />;";
        const result = transformSource(source, { filename: '/repo/src/App.tsx' });
        const metadata = collectNextTransformMetadata(result, source, '/repo/src/App.tsx');

        expect(metadata.classSites).toEqual([
            {
                className: 'justify-safe-center',
                line: 1,
                column: source.indexOf('justify') + 1,
                key: 'justify',
            },
        ]);
    });
});
