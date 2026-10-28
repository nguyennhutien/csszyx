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

import { projectAnswers } from '@csszyx/cli';
import { transformSource } from '@csszyx/compiler/engine';
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
    classPrefix: z
        .string()
        .optional()
        .describe(
            'The Tailwind prefix to compile with, e.g. "tw" for `@import "tailwindcss" prefix(tw)`. Leave it out to use the prefix the stylesheets of the project the server runs in set; pass it when the project is elsewhere or to override that.',
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

/** What the preview leaves out that a build with the project's stylesheet does. */
const MERGE_NOTE =
    'Unmerged: a build drops a Tailwind class that a later one on the same element covers — a later key in a static sz object (`{ pb: 2, p: 4 }` → `p-4`), or an sz class over a static className (`className="pb-2" sz={{ p: 4 }}` → `p-4`). Write the refinement last in sz — `{ p: 4, pb: 2 }` — to keep both. `szr` and `szv` are never merged.';

/**
 * Whether a build could merge two of the classes this module lowered to.
 *
 * Two elements never merge with each other, so a file of single-key objects
 * gets no note however many classes it holds. The engine reports each static
 * object's list; an engine too old to do so is read as one list of every class.
 *
 * @param result - What the compiler returned.
 * @param result.mergeGroups - Each static object's class list, when reported.
 * @param result.mergeOverrides - Each static class name beside a static `sz`.
 * @param result.classes - Every class the module lowered to.
 * @returns True when some object holds two or more classes, or some class
 *          name sits beside an `sz`.
 */
function mergesSomewhere(result: {
    mergeGroups?: ReadonlyArray<{ readonly classes: readonly string[] }>;
    mergeOverrides?: readonly unknown[];
    classes: ReadonlySet<string>;
}): boolean {
    if (result.mergeGroups === undefined) return result.classes.size > 1;
    return (
        result.mergeGroups.some(group => group.classes.length > 1) ||
        (result.mergeOverrides?.length ?? 0) > 0
    );
}

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
 * @param classPrefix - The Tailwind prefix to write before every class, or null.
 * @returns The compiler result plus the messages it wrote to the console.
 */
function compileWithDiagnostics(
    source: string,
    filename: string,
    classPrefix: string | null,
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
        return { result: transformSource(source, { filename, classPrefix }), warnings };
    } finally {
        console.warn = originalWarn;
        restoreEnv('NODE_ENV', originalNodeEnv);
        restoreEnv('CSSZYX_QUIET_SZ_WARNINGS', originalQuiet);
    }
}

/**
 * Why a preview made with no `classPrefix` given carries none.
 *
 * @param cwd - Where the project was looked for.
 * @param unread - Why its prefix could not be read, or null when it sets none.
 * @returns The note.
 */
function noPrefixNote(cwd: string, unread: string | null): string {
    if (unread !== null) {
        return `No classPrefix was given and the project's prefix could not be read (${unread}), so the classes carry none. Pass classPrefix to see the classes the project serves.`;
    }
    return `No classPrefix was given and no stylesheet under ${cwd} sets one, so the classes carry none. If the project is elsewhere and sets one, such as \`@import "tailwindcss" prefix(tw)\`, pass it as classPrefix to see the classes that project serves.`;
}

/**
 * Compile a source module and report what csszyx made of it.
 *
 * The prefix is the one given, else the one the project's stylesheets set
 * (`projectAnswers`, as `csszyx_reverse` reads it): an assistant rarely knows
 * the project sets `prefix(tw)`, and a preview without it shows classes that
 * project does not serve. Only the prefix is kept between calls, so a call
 * costs a find and a stat of the stylesheets (1.5-30 ms measured) and a
 * compile only after one changes.
 *
 * @param input - The validated input object.
 * @param context - Where the project is; the server's working directory by default.
 * @param context.cwd - The project root.
 * @returns MCP tool response carrying the compiled preview.
 */
export async function handleCompilePreview(
    input: CompilePreviewInput,
    context: { cwd?: string } = {},
): Promise<{
    content: Array<{ type: 'text'; text: string }>;
}> {
    const cwd = context.cwd ?? process.cwd();
    const classPrefixFrom = input.classPrefix === undefined ? 'project' : 'input';
    const read =
        input.classPrefix === undefined
            ? await projectAnswers(cwd).prefix()
            : { prefix: input.classPrefix, unread: null };
    const classPrefix = read.prefix;
    const { result, warnings } = compileWithDiagnostics(
        input.source,
        input.filename ?? 'preview.tsx',
        classPrefix,
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
                        // Echoed so the reader knows which vocabulary the classes are in.
                        classPrefix,
                        classPrefixFrom,
                        // The build merges from the project's stylesheet, which
                        // the preview does not read; only an object whose list
                        // holds two or more classes can lose one to it.
                        ...(mergesSomewhere(result) ? { mergeNote: MERGE_NOTE } : {}),
                        ...(classPrefix === null ? { note: noPrefixNote(cwd, read.unread) } : {}),
                    },
                    null,
                    2,
                ),
            },
        ],
    };
}
