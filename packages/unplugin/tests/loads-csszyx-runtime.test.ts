/**
 * A module that loads the csszyx runtime is where a mangle build installs its
 * registry. One the scan misses gets none, and in a bundle with no other
 * runtime import every renamed class it asks the runtime for comes back
 * empty; one it reads as a load when it is not costs one import.
 */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { cpuMsPerCall } from '../../core/tests/helpers/cpu-time.js';
import { loadsCsszyxRuntime } from '../src/merge-registration.js';

describe('loadsCsszyxRuntime', () => {
    it.each([
        ["import { szcn } from 'csszyx';", 'an import'],
        ["export * from '@csszyx/runtime/split';", 'a re-export'],
        ["import '@csszyx/runtime/lowering';", 'a side-effect import'],
        ["const { szcn } = require('@csszyx/runtime');", 'a require'],
        ["const { pick } = await import('@csszyx/runtime/split');", 'a dynamic import'],
        ['const runtime = import ( "csszyx" );', 'a spaced dynamic import'],
        [
            'const rt = import(/* webpackChunkName: "csszyx-runtime" */ "csszyx");',
            'a dynamic import with a magic comment',
        ],
        ["import(/* @vite-ignore */ /* a */ '@csszyx/runtime');", 'two comments'],
        [`import(/* ${'x'.repeat(300)} */ 'csszyx');`, 'a long comment'],
        ["import(\n  // chunk\n  'csszyx');", 'a line comment'],
        ["x.replace(/'/g, ''); import('csszyx');", 'a quote in a regex before it'],
        ["const u = 'http://a'; import('csszyx');", 'a `//` in a string before it'],
        ["import 'csszyx';", 'a no-break space after `import`'],
    ])('reads %s as a load (%s)', code => {
        expect(loadsCsszyxRuntime(code)).toBe(true);
    });

    it.each([
        ["const name = '@csszyx/runtime';", 'a string'],
        ["import { x } from 'csszyx-other';", 'another package'],
        ["log('csszyx');", 'a call that only names it'],
        ["log(/* import( */ 'csszyx');", 'a comment that only names a load'],
        ["// import { sz } from 'csszyx';\nfoo();", 'a load in a line comment'],
        ["/**\n * import { sz } from 'csszyx';\n */\nfoo();", 'a load in a doc comment'],
        ['const t = "import(\'csszyx\')";', 'a load in a string'],
        ["const t = `require('csszyx')`;", 'a load in a template'],
        ["x = a */ 'csszyx';", 'a comment end with no start'],
        ["obj.import('csszyx');", 'a method named import'],
    ])('reads %s as no load (%s)', code => {
        expect(loadsCsszyxRuntime(code)).toBe(false);
    });
});

/**
 * Whether TypeScript's import pre-processor finds a runtime specifier.
 *
 * @param code - Module text.
 * @returns True when it lists one.
 */
function typescriptReads(code: string): boolean {
    return ts
        .preProcessFile(code, true, true)
        .importedFiles.some(file =>
            /^(?:csszyx|@csszyx\/runtime)(?:\/[\w-]+)?$/.test(file.fileName),
        );
}

describe('loadsCsszyxRuntime against TypeScript', () => {
    // Every load form, behind every comment form, after text that holds a
    // comment opener, and every non-load form that spells the specifier.
    const specifiers = ["'csszyx'", '"@csszyx/runtime"', "'@csszyx/runtime/merge'"];
    const gaps = [
        '',
        ' ',
        '/* x */ ',
        '/* webpackChunkName: "csszyx-runtime-chunk" */ ',
        '/* @vite-ignore */ /* a */ ',
        '\n  // line comment\n  ',
        `/* ${'x'.repeat(300)} */ `,
        '/**/ /**/ /**/ /**/ /**/ ',
    ];
    const shapes: Array<(gap: string, specifier: string) => string> = [
        (gap, s) => `import x from ${gap}${s};`,
        (gap, s) => `export * from ${gap}${s};`,
        (gap, s) => `import ${gap}${s};`,
        (gap, s) => `const m = import(${gap}${s});`,
        (gap, s) => `const m = require(${gap}${s});`,
        (gap, s) => `const name = ${gap}${s};`,
        (gap, s) => `log(${gap}${s});`,
        (_gap, s) => `const t = "import(${s.replaceAll('"', "'")})";`,
        (_gap, s) => `// import(${s})\nfoo();`,
        (gap, s) => `/* import(${gap.replaceAll('*/', '')}${s}) */ foo();`,
        (_gap, s) => `const t = \`require(${s})\`;`,
        (gap, s) => `const u = 'http://a'; const m = import(${gap}${s});`,
    ];
    const prefixes = ['', 'const q = "/*";\n', "const r = '//';\n", '`${a}/*`;\n'];
    const corpus = prefixes.flatMap(prefix =>
        shapes.flatMap(shape =>
            gaps.flatMap(gap => specifiers.map(specifier => prefix + shape(gap, specifier))),
        ),
    );

    it('agrees on every generated module', () => {
        const disagreements = corpus.filter(
            code => loadsCsszyxRuntime(code) !== typescriptReads(code),
        );
        expect(corpus).toHaveLength(1152);
        expect(disagreements).toEqual([]);
    });
});

describe('loadsCsszyxRuntime cost', () => {
    /**
     * The fastest of three passes over `code`, in CPU time per pass
     * (`cpuMsPerCall`).
     *
     * @param code - Module text.
     * @returns Milliseconds.
     */
    function fastest(code: string): number {
        let best = Number.POSITIVE_INFINITY;
        for (let run = 0; run < 3; run++) {
            best = Math.min(
                best,
                cpuMsPerCall(() => loadsCsszyxRuntime(code)),
            );
        }
        return best;
    }

    // Each worst case names the runtime and never loads it, so the pass reads
    // the whole text; the control is the same size with one comment.
    const fill = (unit: string): string => unit.repeat(Math.ceil(400_000 / unit.length));
    const control = `/* c */\n${fill("const a = f('csszyx');\n")}`;

    it.each([
        ['comment ends with no start', fill("x = a */ 'csszyx';\n")],
        ['runs of block comments', fill("/* a */ /* b */ /* c */ 'csszyx';\n")],
        ['unterminated quotes', fill("'csszyx\n")],
        ['regex-like slashes', fill("a = b / c / 'csszyx' / d;\n")],
    ])('reads %s in linear time', (_case, code) => {
        expect(loadsCsszyxRuntime(code)).toBe(false);
        expect(fastest(code) / fastest(control)).toBeLessThan(8);
    });
});
