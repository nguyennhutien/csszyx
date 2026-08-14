/**
 * csszyx_compile_preview — Compile a whole source module and report what
 * csszyx did to it.
 *
 * The other tools answer questions about an sz OBJECT, which assumes the code
 * around it is already right. Most field reports are the opposite case: the
 * object is fine and the surrounding shape is what csszyx could not compile —
 * a factory call it will not precompile, a value it must defer to the runtime,
 * a key it does not know. This runs the real transform over a source string
 * and reports the emitted code, the classes, the diagnostics, and which
 * runtime helpers survived, so the shape can be checked before it ships.
 */

import { transformSource } from '@csszyx/compiler';
import { z } from 'zod';

export const compilePreviewSchema = z.object({
    source: z
        .string()
        .describe(
            'A source module to compile. Include the code AROUND the sz prop — imports, the factory call, the component — since that is what decides whether csszyx can compile it.',
        ),
    filename: z
        .string()
        .optional()
        .describe(
            'Filename to attribute diagnostics to. The extension selects the parser, so use .tsx for JSX. Defaults to preview.tsx.',
        ),
});

/** Validated input type for the csszyx_compile_preview tool. */
export type CompilePreviewInput = z.infer<typeof compilePreviewSchema>;

/** The subset of the compiler result this tool reads. */
interface CompilerFlags {
    usesRuntime: boolean;
    usesMerge: boolean;
    usesSzPart: boolean;
    usesSzcn: boolean;
    usesSzvPick: boolean;
    usesSzvPick1: boolean;
    usesColorVar: boolean;
    usesSpacingVar: boolean;
    usesUnitVar: boolean;
    usesBoolClass: boolean;
}

/**
 * Helper name per compiler flag, in the order a reader should scan them: the
 * plain sz helper, the composition helpers, the szv lookups, then the
 * custom-property helpers a dynamic scalar falls back to.
 */
const RUNTIME_HELPERS: ReadonlyArray<readonly [string, keyof CompilerFlags]> = [
    ['_sz', 'usesRuntime'],
    ['_szMerge', 'usesMerge'],
    ['_szPart', 'usesSzPart'],
    ['szcn', 'usesSzcn'],
    ['__szvPick', 'usesSzvPick'],
    ['__szvPick1', 'usesSzvPick1'],
    ['__szColorVar', 'usesColorVar'],
    ['__szSpacingVar', 'usesSpacingVar'],
    ['__szUnitVar', 'usesUnitVar'],
    ['__szBoolClass', 'usesBoolClass'],
];

/**
 * Put one environment variable back, including back to absent.
 *
 * @param name - Variable to restore.
 * @param value - Its value before the call, or undefined when it was unset.
 */
function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
        return;
    }
    process.env[name] = value;
}

/**
 * Run the transform with the dev diagnostic channel forced on, collecting
 * everything it writes to the console.
 *
 * csszyx's diagnostics do not share one channel: the fallback matrix fills
 * `result.diagnostics`, while the unknown-key and bad-value warnings go to
 * `console.warn` behind a gate a production `NODE_ENV` turns off. A preview
 * reporting only the first list would stay silent on exactly the mistake this
 * tool exists to surface, so the gate is lifted for the call and both lists
 * come back together.
 *
 * @param source - Source module to compile.
 * @param filename - Filename to attribute diagnostics to.
 * @returns The compiler result plus the messages it wrote to the console.
 */
function compileWithDiagnostics(
    source: string,
    filename: string,
): { result: ReturnType<typeof transformSource>; warnings: string[] } {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalQuiet = process.env.CSSZYX_QUIET_SZ_WARNINGS;
    console.warn = (...args: unknown[]): void => {
        warnings.push(args.map(String).join(' '));
    };
    process.env.NODE_ENV = 'development';
    delete process.env.CSSZYX_QUIET_SZ_WARNINGS;
    try {
        return { result: transformSource(source, filename), warnings };
    } finally {
        console.warn = originalWarn;
        restoreEnv('NODE_ENV', originalNodeEnv);
        restoreEnv('CSSZYX_QUIET_SZ_WARNINGS', originalQuiet);
    }
}

/**
 * Compile a source module and report what csszyx made of it.
 *
 * @param input - The validated input object.
 * @returns MCP tool response carrying the compiled preview.
 */
export function handleCompilePreview(input: CompilePreviewInput): {
    content: Array<{ type: 'text'; text: string }>;
} {
    const { result, warnings } = compileWithDiagnostics(
        input.source,
        input.filename ?? 'preview.tsx',
    );
    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(
                    {
                        transformed: result.transformed,
                        code: result.code,
                        // Emission order, not sorted: this is the order the
                        // element actually carries, and reordering it would
                        // hide a cascade question the preview is asked about.
                        classes: [...result.classes],
                        diagnostics: [...result.diagnostics, ...warnings],
                        runtimeHelpers: RUNTIME_HELPERS.filter(
                            ([, flag]) => result[flag] === true,
                        ).map(([name]) => name),
                    },
                    null,
                    2,
                ),
            },
        ],
    };
}
