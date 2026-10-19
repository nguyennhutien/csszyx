/**
 * Every registry template renders byte for byte as the filler it replaced did.
 *
 * The oracle (`helpers/legacy-diagnostic-template.ts`) ran one global
 * `replace` per field per diagnostic and rebuilt the joiners each time; the
 * renderer under test splits each template into segments once. Every id, every
 * form, each field, with args that hold placeholder syntax, `replace`
 * patterns (`$&`, `$1`), lone surrogates and empty values, with and without
 * each optional arg, and the editor extension's own copies of its templates.
 */
import { describe, expect, it } from 'vitest';

import {
    SZ_DIAGNOSTIC_REGISTRY,
    type SzDiagnosticSpec,
} from '../src/diagnostic-registry.generated.js';
import { renderSzDiagnostic, renderSzDiagnosticParts } from '../src/diagnostic-render.js';
import { SZ_DIAGNOSTIC_COMPUTED_VALUES } from '../src/diagnostic-render-helpers.js';
import { fillSzDiagnosticTemplate } from '../src/diagnostic-template.js';
import { SZ_EDITOR_DIAGNOSTIC_TEMPLATES } from '../src/editor-diagnostic-templates.generated.js';
import {
    legacyFillSzDiagnosticTemplate,
    legacyRenderSzDiagnostic,
} from './helpers/legacy-diagnostic-template.js';

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
function argSets(spec: SzDiagnosticSpec): Array<Record<string, unknown>> {
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

/**
 * What a call returns, or the error it throws: a computed value fed a
 * value its table lacks (an unknown fallback shape) throws on both sides.
 *
 * @param run - The call.
 * @returns The value or the error's message.
 */
function outcome(run: () => unknown): unknown {
    try {
        return { value: run() };
    } catch (error) {
        return { threw: String(error) };
    }
}

describe('the diagnostic renderer against the filler it replaced', () => {
    it('fills every field of every id and form as before', () => {
        let checked = 0;
        let filled = 0;
        for (const spec of SZ_DIAGNOSTIC_REGISTRY) {
            for (const args of argSets(spec)) {
                const diagnostic = { code: spec.id, args };
                const current = outcome(() =>
                    fillSzDiagnosticTemplate(spec, diagnostic, SZ_DIAGNOSTIC_COMPUTED_VALUES),
                );
                if (typeof current === 'object' && current !== null && 'value' in current)
                    filled += 1;
                expect(
                    [
                        spec.id,
                        outcome(() =>
                            fillSzDiagnosticTemplate(
                                spec,
                                diagnostic,
                                SZ_DIAGNOSTIC_COMPUTED_VALUES,
                            ),
                        ),
                    ],
                    JSON.stringify(args),
                ).toEqual([
                    spec.id,
                    outcome(() =>
                        legacyFillSzDiagnosticTemplate(
                            spec,
                            diagnostic,
                            SZ_DIAGNOSTIC_COMPUTED_VALUES,
                        ),
                    ),
                ]);
                checked += 1;
            }
        }

        expect(checked).toBeGreaterThan(SZ_DIAGNOSTIC_REGISTRY.length * 20);
        // Most samples render text; only an unknown fallback shape throws.
        expect(filled / checked).toBeGreaterThan(0.9);
    });

    it('lays out every whole message as before, placed and unplaced', () => {
        for (const spec of SZ_DIAGNOSTIC_REGISTRY) {
            for (const args of argSets(spec)) {
                for (const place of [{}, { line: 3, column: 9 }]) {
                    for (const file of ['', 'src/a.tsx']) {
                        const diagnostic = { code: spec.id as never, args, ...place };
                        expect(
                            outcome(() =>
                                renderSzDiagnostic({
                                    diagnostic,
                                    file,
                                    computed: SZ_DIAGNOSTIC_COMPUTED_VALUES,
                                }),
                            ),
                        ).toEqual(
                            outcome(() =>
                                legacyRenderSzDiagnostic(
                                    spec,
                                    diagnostic,
                                    file,
                                    SZ_DIAGNOSTIC_COMPUTED_VALUES,
                                ),
                            ),
                        );
                    }
                }
            }
        }
    });

    it('joins a list placed straight into a sentence with its own joiner, as before', () => {
        // The registry places only `, `-joined lists in its sentences; this
        // entry is made up so each joiner is read.
        const template = {
            args: {
                list: { type: 'string[]', joiner: ' | ' },
                other: { type: 'string[]', joiner: '\n' },
            },
            text: 'a {list} b {other} c {list}',
        } as const;
        const diagnostic = {
            code: 'made-up',
            args: { list: ['x', '{y}', '$&'], other: ['1', '2'] },
        };

        expect(
            fillSzDiagnosticTemplate(template, diagnostic, SZ_DIAGNOSTIC_COMPUTED_VALUES),
        ).toEqual(
            legacyFillSzDiagnosticTemplate(template, diagnostic, SZ_DIAGNOSTIC_COMPUTED_VALUES),
        );
        expect(
            fillSzDiagnosticTemplate(template, diagnostic, SZ_DIAGNOSTIC_COMPUTED_VALUES).text,
        ).toBe('a x | {y} | $& b 1\n2 c x | {y} | $&');
    });

    it('renders the same parts twice, so nothing cached leaks between diagnostics', () => {
        const [spec] = SZ_DIAGNOSTIC_REGISTRY as [SzDiagnosticSpec];
        const first = renderSzDiagnosticParts(
            { code: spec.id as never, args: { key: 'one' } },
            SZ_DIAGNOSTIC_COMPUTED_VALUES,
        );
        const second = renderSzDiagnosticParts(
            { code: spec.id as never, args: { key: 'two' } },
            SZ_DIAGNOSTIC_COMPUTED_VALUES,
        );

        expect(first.text).toContain('one');
        expect(second.text).toContain('two');
        expect(second.text).not.toContain('one');
    });

    it("fills the editor extension's own copies of its templates as before", () => {
        for (const [code, template] of Object.entries(SZ_EDITOR_DIAGNOSTIC_TEMPLATES)) {
            const spec = SZ_DIAGNOSTIC_REGISTRY.find(
                entry => entry.id === code,
            ) as SzDiagnosticSpec;
            for (const args of argSets(spec)) {
                const diagnostic = { code, args };
                expect(
                    outcome(() =>
                        fillSzDiagnosticTemplate(
                            template,
                            diagnostic,
                            SZ_DIAGNOSTIC_COMPUTED_VALUES,
                        ),
                    ),
                ).toEqual(
                    outcome(() =>
                        legacyFillSzDiagnosticTemplate(
                            template,
                            diagnostic,
                            SZ_DIAGNOSTIC_COMPUTED_VALUES,
                        ),
                    ),
                );
            }
        }
    });
});
