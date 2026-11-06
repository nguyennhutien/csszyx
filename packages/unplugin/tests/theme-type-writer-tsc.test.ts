/**
 * Type-checks the declaration `generateThemeDts` writes, with the real
 * TypeScript compiler against the built `@csszyx/compiler` and
 * `@csszyx/runtime` types, as a consumer project would. A `toContain` on the
 * emitted text cannot tell a typed breakpoint from one whose entry type is
 * unresolved: under
 * `skipLibCheck: true` an unresolved name inside a `.d.ts` reads as `any`
 * and every key under that breakpoint goes unchecked, with no error.
 */
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { parseThemeBlocks } from '../src/theme-scanner.js';
import { generateThemeDts } from '../src/theme-type-writer.js';

// Virtual files live inside this package, so `@csszyx/compiler` resolves
// through its `node_modules` link exactly as it does for a consumer.
const ROOT = fileURLToPath(new URL('./__theme-dts-tsc__/', import.meta.url));
const THEME_DTS = `${ROOT}.csszyx/theme.d.ts`;
const CONSUMER = `${ROOT}consumer.ts`;

const CONSUMER_SOURCE = `import type { SzProps } from '@csszyx/compiler';
import { szv } from '@csszyx/runtime';
export const flat: SzProps = { tablet: { p: 4 }, '3xl': { bg: 'blue-500' } };
export const nested: SzProps = { tablet: { hover: { p: 4 } }, hover: { tablet: { m: 2 } } };
// @ts-expect-error - \`bgg\` is not an sz key under a project breakpoint
export const typo: SzProps = { tablet: { bgg: 'red-500' } };
// @ts-expect-error - \`bgg\` is not an sz key under a state inside a project breakpoint
export const nestedTypo: SzProps = { tablet: { hover: { bgg: 'red-500' } } };
// @ts-expect-error - \`flexx\` is not a display value under a project breakpoint
export const badValue: SzProps = { '3xl': { display: 'flexx' } };
export const row = szv({ variants: { size: { sm: { p: 2, tablet: { hover: { p: 4 } } } } } });
// @ts-expect-error - \`bgg\` is not an sz key in an \`szv\` row under a project breakpoint
szv({ variants: { size: { sm: { tablet: { hover: { bgg: 'red-500' } } } } } });
`;

/**
 * Type-check the consumer beside the generated declaration.
 *
 * @param skipLibCheck - The consumer's `skipLibCheck`; `true` skips the generated `.d.ts`
 * @param source - The consumer's text.
 * @param withTheme - Whether the generated declaration is in the program,
 *        as it is when `tsconfig.json` includes it.
 * @returns Every diagnostic, as `file:line TScode: message`
 */
function typeCheck(skipLibCheck: boolean, source = CONSUMER_SOURCE, withTheme = true): string[] {
    const theme = parseThemeBlocks(
        '@theme { --breakpoint-tablet: 40rem; --breakpoint-3xl: 120rem; }',
    );
    const files = new Map([
        [THEME_DTS, generateThemeDts({ outputPath: THEME_DTS, theme, sourceFiles: ['t.css'] })],
        [CONSUMER, source],
    ]);
    const options: ts.CompilerOptions = {
        strict: true,
        noEmit: true,
        skipLibCheck,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ES2022,
        types: [],
    };
    const host = ts.createCompilerHost(options);
    const { fileExists, readFile, getSourceFile } = host;
    host.fileExists = name => files.has(name) || fileExists(name);
    host.readFile = name => files.get(name) ?? readFile(name);
    host.getSourceFile = (name, languageVersion, ...rest) => {
        const text = files.get(name);
        return text === undefined
            ? getSourceFile(name, languageVersion, ...rest)
            : ts.createSourceFile(name, text, languageVersion, true);
    };
    const program = ts.createProgram(withTheme ? [CONSUMER, THEME_DTS] : [CONSUMER], options, host);
    return ts.getPreEmitDiagnostics(program).map(diagnostic => {
        const where = diagnostic.file
            ? `${diagnostic.file.fileName.replace(ROOT, '')}:${
                  diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1
              } `
            : '';
        return `${where}TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
    });
}

describe('the generated theme declaration, type-checked', () => {
    it('resolves its breakpoint entry type, so it compiles with skipLibCheck off', () => {
        expect(typeCheck(false)).toEqual([]);
    });

    it('checks keys under a project breakpoint, nested too, with skipLibCheck on', () => {
        expect(typeCheck(true)).toEqual([]);
    });

    it('reports a project breakpoint in an `szv` row as `NotAnSzKey` without the file', () => {
        const row = `import { szv } from '@csszyx/runtime';
export const row = szv({ variants: { size: { sm: { tablet: { p: 4 } } } } });
`;
        const diagnostics = typeCheck(true, row, false);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toContain('NotAnSzKey<"tablet">');
        expect(typeCheck(true, row)).toEqual([]);
    });
});

/**
 * A pnpm project lists `csszyx` and nothing else: `@csszyx/compiler` sits in
 * the store, reachable from `csszyx` but not from the project. The layout is
 * virtual and outside this repository, so nothing resolves by walking up into
 * a workspace `node_modules`.
 */
const PNPM_ROOT = '/virtual-pnpm-project/';
const PNPM_CSSZYX = `${PNPM_ROOT}node_modules/csszyx/`;
const COMPILER_TYPES = fileURLToPath(new URL('../../compiler/dist/index.d.mts', import.meta.url));

/**
 * Type-check a consumer of `csszyx` under that layout.
 *
 * @param augments - The module the generated declaration augments.
 * @returns Every diagnostic, as `file:line TScode: message`.
 */
function typeCheckUnderPnpm(augments: 'csszyx' | '@csszyx/compiler'): string[] {
    const theme = parseThemeBlocks('@theme { --breakpoint-tablet: 40rem; }');
    const themeDts = `${PNPM_ROOT}.csszyx/theme.d.ts`;
    const consumer = `${PNPM_ROOT}consumer.ts`;
    const files = new Map([
        [`${PNPM_CSSZYX}package.json`, '{ "name": "csszyx", "types": "index.d.ts" }'],
        // The interfaces as `csszyx` re-exports them: the compiler's own.
        [
            `${PNPM_CSSZYX}index.d.ts`,
            `export type { CustomTheme, SzProps, VariantModifiers } from ${JSON.stringify(
                COMPILER_TYPES,
            )};`,
        ],
        [
            themeDts,
            generateThemeDts({ outputPath: themeDts, theme, sourceFiles: ['t.css'], augments }),
        ],
        [
            consumer,
            `import type { SzProps } from 'csszyx';
export const flat: SzProps = { tablet: { p: 4 } };
// @ts-expect-error - \`bgg\` is not an sz key under a project breakpoint
export const typo: SzProps = { tablet: { bgg: 'red-500' } };
`,
        ],
    ]);
    const options: ts.CompilerOptions = {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ES2022,
        types: [],
    };
    const host = ts.createCompilerHost(options);
    const { fileExists, readFile, getSourceFile, directoryExists } = host;
    const virtual = (name: string) => name.startsWith(PNPM_ROOT);
    host.fileExists = name => files.has(name) || (!virtual(name) && fileExists(name));
    host.readFile = name => files.get(name) ?? (virtual(name) ? undefined : readFile(name));
    host.directoryExists = name =>
        virtual(`${name}/`)
            ? [...files.keys()].some(file => file.startsWith(`${name}/`))
            : (directoryExists?.(name) ?? true);
    host.realpath = name => name;
    host.getSourceFile = (name, languageVersion, ...rest) => {
        const text = files.get(name);
        return text === undefined
            ? getSourceFile(name, languageVersion, ...rest)
            : ts.createSourceFile(name, text, languageVersion, true);
    };
    const program = ts.createProgram([consumer, themeDts], options, host);
    return ts
        .getPreEmitDiagnostics(program)
        .map(
            diagnostic =>
                `${diagnostic.file?.fileName.replace(PNPM_ROOT, '') ?? ''} TS${diagnostic.code}`,
        );
}

describe('the generated theme declaration under pnpm', () => {
    it('types a project breakpoint when it augments `csszyx`, the package the project lists', () => {
        expect(typeCheckUnderPnpm('csszyx')).toEqual([]);
    });

    it('cannot reach `@csszyx/compiler`, which the project does not list', () => {
        // `tablet` is no known key, so the plain use is an excess property.
        expect(typeCheckUnderPnpm('@csszyx/compiler')).toEqual(['consumer.ts TS2353']);
    });
});
