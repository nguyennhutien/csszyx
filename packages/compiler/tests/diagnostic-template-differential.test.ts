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
import { renderSzDiagnostic, renderSzDiagnosticParts } from '../src/diagnostic-render.js';
import { SZ_DIAGNOSTIC_COMPUTED_VALUES } from '../src/diagnostic-render-helpers.js';
import { SZ_DIAGNOSTIC_REGISTRY, type SzDiagnosticSpec } from '../src/diagnostic-spec.generated.js';
import { fillSzDiagnosticTemplate } from '../src/diagnostic-template.js';
import { SZ_EDITOR_DIAGNOSTIC_TEMPLATES } from '../src/editor-diagnostic-templates.generated.js';
import { argSets } from './helpers/diagnostic-arg-samples.js';
import {
    legacyFillSzDiagnosticTemplate,
    legacyRenderSzDiagnostic,
} from './helpers/legacy-diagnostic-template.js';

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
            // An id with no words here is worded by another renderer, or not
            // yet; this one refuses it rather than print an empty line.
            if (spec.text === undefined && spec.help === undefined && spec.note === undefined) {
                expect(() =>
                    renderSzDiagnostic({
                        diagnostic: { code: spec.id as never, args: {} },
                        file: '',
                        computed: SZ_DIAGNOSTIC_COMPUTED_VALUES,
                    }),
                ).toThrow(`no words for \`${spec.id}\``);
                continue;
            }
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
