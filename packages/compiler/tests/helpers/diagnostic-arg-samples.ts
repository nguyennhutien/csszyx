/**
 * Sample args for every registry entry: real keys the computed values look
 * up, and hostile text (placeholder syntax, `replace` patterns, lone
 * surrogates, empty values), each set also without its optional args. Shared
 * by the tests that render every id on two renderers and compare them.
 */
import type { SzDiagnosticSpec } from '../../src/diagnostic-spec.generated.js';

/** Text values: real keys the computed values look up, and hostile text. */
const STRINGS = [
    'workBreak',
    '{key}',
    '$&',
    '$1$2$$',
    '',
    'é😀\uDC00',
    '`tick`',
    'fontStyle',
    'sz-variant-key',
    'a.b',
];
const NUMBERS = [0, 7, 64];
const LISTS: string[][] = [[], ['a'], ['{x}', '$&', 'b`c']];

/**
 * The value of one arg in the k-th sample.
 *
 * @param type - The arg's declared type.
 * @param k - The sample index.
 * @returns A value of that type.
 */
function sampleOf(type: SzDiagnosticSpec['args'][string]['type'], k: number): unknown {
    if (Array.isArray(type)) return type[1 + (k % (type.length - 1))];
    if (type === 'number') return NUMBERS[k % NUMBERS.length];
    if (type === 'string[]') return LISTS[k % LISTS.length];
    return STRINGS[k % STRINGS.length];
}

/**
 * The k-th sample of every arg of an entry, and the same without its optional
 * args.
 *
 * @param spec - The entry.
 * @param k - The sample index.
 * @returns Both arg sets.
 */
function samplePair(spec: SzDiagnosticSpec, k: number): Array<Record<string, unknown>> {
    const args: Record<string, unknown> = {};
    const required: Record<string, unknown> = {};
    for (const [name, arg] of Object.entries(spec.args)) {
        args[name] = sampleOf(arg.type, k + name.length);
        if (!arg.optional) required[name] = args[name];
    }
    return [args, required];
}

/**
 * Arg sets for one entry: for each value of the arg its sentence varies by
 * (or one pass when none), several samples, each also without its optional args.
 *
 * @param spec - The entry.
 * @returns The arg sets.
 */
export function argSets(spec: SzDiagnosticSpec): Array<Record<string, unknown>> {
    const by = spec.variesBy ?? 'form';
    const byType = spec.args[by]?.type;
    const variants = Array.isArray(byType) ? byType.slice(1) : [undefined];
    return variants.flatMap(variant =>
        STRINGS.flatMap((_, k) =>
            samplePair(spec, k).map(args =>
                variant === undefined ? args : { ...args, [by]: variant },
            ),
        ),
    );
}
