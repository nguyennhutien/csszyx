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
 * @returns Every diagnostic, as `file:line TScode: message`
 */
function typeCheck(skipLibCheck: boolean): string[] {
    const theme = parseThemeBlocks(
        '@theme { --breakpoint-tablet: 40rem; --breakpoint-3xl: 120rem; }',
    );
    const files = new Map([
        [THEME_DTS, generateThemeDts({ outputPath: THEME_DTS, theme, sourceFiles: ['t.css'] })],
        [CONSUMER, CONSUMER_SOURCE],
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
    const program = ts.createProgram([CONSUMER, THEME_DTS], options, host);
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
});
