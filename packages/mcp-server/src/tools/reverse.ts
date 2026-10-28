/**
 * csszyx_reverse — Convert a Tailwind CSS class string into a sz object.
 * Calls classNameToSzObject() from @csszyx/cli.
 * Example: "p-4 bg-blue-500 hover:text-white" → { p: 4, bg: 'blue-500', hover: { color: 'white' } }
 *
 * The answer is compiled back before it is returned. An assistant pastes what
 * this tool says into code, so an sz object that compiles to different classes
 * than the ones asked about is a wrong answer delivered with confidence — and
 * the compiler is already here to check. `roundTrip.ok` is that check.
 *
 * Where one of migrate's tables would decide a class (a sign on a keyword, a
 * fraction on a key), the project's own Tailwind answers instead, as
 * `csszyx migrate` asks it. Its stylesheets are compiled only for a class
 * string a table decided something in, and again on each such call: measured
 * 2026-10-28, opening them costs 71–168 ms the first time and 6–89 ms after,
 * with 14–61 MB of heap, so a process-long cache would hold that memory for
 * the rare call that needs it and answer from a stylesheet the user may have
 * edited since.
 */

import { askProjectTailwind, classNameToSzObject } from '@csszyx/cli';
import { sortStrings, transform } from '@csszyx/compiler';
import { z } from 'zod';

export const reverseSchema = z.object({
    classes: z
        .string()
        .describe(
            'Tailwind CSS class string to convert. Example: "p-4 bg-blue-500 hover:text-white"',
        ),
});

/** Validated input type for the csszyx_reverse tool. */
export type ReverseInput = z.infer<typeof reverseSchema>;

/** What compiling the answer gave back, against what was asked. */
export interface RoundTrip {
    /** True when every recognized input class came back out of the compiler. */
    ok: boolean;
    /** The className the compiler emitted for the returned sz object. */
    emitted: string;
}

/**
 * Compile an sz object and compare the result with the classes it came from.
 *
 * Order is not compared: an sz object is a map, so the compiler's emission
 * order is its own. What must hold is that every recognized input class is
 * present in the output, and nothing else is — a missing class means the sz
 * form lost it, an extra one means the sz form says something the input
 * did not.
 *
 * @param szObject - The parser's answer.
 * @param recognized - Input classes the parser did recognize.
 * @returns Whether the answer compiles back to its input, and what it emitted.
 */
export function roundTrip(
    szObject: Record<string, unknown>,
    recognized: readonly string[],
): RoundTrip {
    // The compiler reports value-level problems through console.warn; they
    // are not this tool's output, and a warning here would mean the parser
    // produced a value the compiler rejects — which the comparison catches.
    const originalWarn = console.warn;
    console.warn = () => {};
    let emitted: string;
    try {
        emitted = transform(szObject as Parameters<typeof transform>[0]).className;
    } finally {
        console.warn = originalWarn;
    }
    const want = sortStrings([...recognized]);
    const got = sortStrings(emitted.split(/\s+/).filter(Boolean));
    const ok = want.length === got.length && want.every((cls, i) => cls === got[i]);
    return { ok, emitted };
}

/**
 * Convert a class string, asking the project's Tailwind about what a migrate
 * table decided, and converting again when an answer differs.
 *
 * @param classes - The class string.
 * @param cwd - The project root, where its Tailwind and stylesheets resolve.
 * @returns The conversion the project's answers give.
 */
async function convert(
    classes: string,
    cwd: string,
): Promise<ReturnType<typeof classNameToSzObject>> {
    const first = classNameToSzObject(classes);
    if (!first.tableVerdicts?.length) return first;
    const served = await askProjectTailwind(cwd, first.tableVerdicts);
    return served === null ? first : classNameToSzObject(classes, { served });
}

/**
 * Convert a Tailwind class string into a structured sz object.
 * @param input - The validated input object.
 * @param context - Where the project is; the server's working directory by default.
 * @param context.cwd - The project root.
 * @returns MCP tool response with the sz object, any unrecognized classes, and
 *   whether the object compiles back to the classes it was made from.
 */
export async function handleReverse(
    input: ReverseInput,
    context: { cwd?: string } = {},
): Promise<{
    content: Array<{ type: 'text'; text: string }>;
}> {
    const classes = input.classes.trim();
    const { szObject, unrecognized } = await convert(classes, context.cwd ?? process.cwd());
    const unrecognizedSet = new Set(unrecognized);
    const recognized = classes.split(/\s+/).filter(cls => cls && !unrecognizedSet.has(cls));

    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(
                    {
                        szObject,
                        unrecognized: unrecognized.length > 0 ? unrecognized : undefined,
                        totalRecognized: Object.keys(szObject).length,
                        totalUnrecognized: unrecognized.length,
                        roundTrip: roundTrip(szObject, recognized),
                    },
                    null,
                    2,
                ),
            },
        ],
    };
}
