/**
 * `szReport`, the development renderer of a console line (ADR 0031, PR C).
 *
 * It fills the browser module's copy of an id's templates with the browser's
 * computed values, so each case here holds it to the Node renderer the build
 * prints with: the same words for every id the browser can print, and the
 * same layout as the engine's message once the line has a place.
 */
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { DIAGNOSTICS as REGISTRY } from '../../../scripts/diagnostics/registry.mjs';
import * as BROWSER from '../src/diagnostic-browser.generated.js';
import { renderSzDiagnostic } from '../src/diagnostic-render.js';
import { SZ_DIAGNOSTIC_COMPUTED_VALUES } from '../src/diagnostic-render-helpers.js';
import type { SzDiagnosticSpec } from '../src/diagnostic-spec.generated.js';
import {
    type ArgValue,
    type SzBrowserDiagnostic,
    szDiagnosticBody,
} from '../src/diagnostic-template.js';
import {
    HYDRATION_ABORTED,
    MANGLE_CENSUS_UNREADABLE,
    REMOVED_KEY,
    szReport,
    UNKNOWN_KEY,
} from '../src/report.js';
import { argSets } from './helpers/diagnostic-arg-samples.js';
import { legacyFillSzDiagnosticTemplate } from './helpers/legacy-diagnostic-template.js';

/**
 * Every id's entry, by id, from the registry itself: the Node registry module
 * keeps only the words Node renders, and a browser-only line's are not among them.
 */
const SPECS = new Map((REGISTRY as SzDiagnosticSpec[]).map(spec => [spec.id, spec]));

/** The browser module's diagnostics, each with its registry entry. */
const DIAGNOSTICS = Object.values(BROWSER).map(diagnostic => {
    const reportable = diagnostic as SzBrowserDiagnostic;
    return [reportable, SPECS.get(reportable.id) as SzDiagnosticSpec] as const;
});

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * The one message `szReport` printed, through either method.
 *
 * @returns The message.
 */
function printed(): unknown {
    const calls = [...warn.mock.calls, ...error.mock.calls];
    expect(calls).toHaveLength(1);
    return calls[0]?.[0];
}

describe('szReport', () => {
    it('prints a line with no place as its code and sentence, then help, note and page', () => {
        szReport({ diagnostic: MANGLE_CENSUS_UNREADABLE, args: {} });

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]).toEqual([
            '[csszyx] mangle-census-unreadable: The class census on this page could not be read, so the mangle checksum was not verified.\n' +
                '  help: serve the HTML as the build wrote it; the line before this one says what is wrong with the census.\n' +
                '  docs: https://csszyx.com/e/mangle-census-unreadable',
        ]);
        expect(error).not.toHaveBeenCalled();
    });

    it('fills an engine id the runtime shares in the words the build prints', () => {
        szReport({
            diagnostic: REMOVED_KEY,
            args: { form: 'replaced', key: 'ordinal', replacement: 'numOrdinal: true' },
        });

        expect(printed()).toBe(
            '[csszyx] removed-key: `ordinal` was replaced, and nothing is emitted for it.\n' +
                '  help: write `{ numOrdinal: true }` instead, or run `csszyx migrate`.\n' +
                '  docs: https://csszyx.com/e/removed-key',
        );
    });

    it('heads a placed line with its place, byte for byte as the engine renderer', () => {
        const engineIds = DIAGNOSTICS.filter(([, spec]) => spec.surfaces.engine !== undefined);
        // Every engine id the browser lanes print (15 of them, ADR 0031
        // PR C) and the two whose runtime sources are Node.
        expect(engineIds.length).toBeGreaterThanOrEqual(15);
        let checked = 0;
        for (const [diagnostic, spec] of engineIds) {
            for (const args of argSets(spec) as Array<Record<string, ArgValue>>) {
                warn.mockClear();
                error.mockClear();
                // A file-wide id names the file alone, as the engine's header does.
                const at = spec.position === 'file' ? 'src/App.tsx' : 'src/App.tsx:3:9';
                szReport({ diagnostic, args, at });
                expect(printed(), JSON.stringify(args)).toBe(
                    renderSzDiagnostic({
                        diagnostic: { code: spec.id as never, args, line: 3, column: 9 },
                        file: 'src/App.tsx',
                        computed: SZ_DIAGNOSTIC_COMPUTED_VALUES,
                    }),
                );
                checked += 1;
            }
        }
        expect(checked).toBeGreaterThan(engineIds.length * 20);
    });

    it('fills every id it carries with the Node computed values, so no computed value differs', () => {
        expect(DIAGNOSTICS.length).toBeGreaterThan(60);
        for (const [diagnostic, spec] of DIAGNOSTICS) {
            for (const args of argSets(spec) as Array<Record<string, ArgValue>>) {
                // A form only the build reports has no words in the browser
                // module; that it has none is checked below.
                if (spec.buildForms?.includes(args.form as string)) {
                    expect(JSON.stringify(diagnostic), spec.id).not.toContain(`"${args.form}":`);
                    continue;
                }
                warn.mockClear();
                error.mockClear();
                szReport({ diagnostic, args });
                // Filled from the registry's own arg objects, apart from the
                // encoded args and joiners the browser entry carries.
                const body = szDiagnosticBody(
                    legacyFillSzDiagnosticTemplate(
                        spec,
                        { code: spec.id, args },
                        SZ_DIAGNOSTIC_COMPUTED_VALUES,
                    ),
                );
                expect(printed(), `${spec.id} ${JSON.stringify(args)}`).toBe(
                    `[csszyx] ${spec.id}: ${body}\n  docs: https://csszyx.com/e/${spec.id}`,
                );
            }
        }
    });

    it('prints through console.error when the registry says the line is an error', () => {
        szReport({
            diagnostic: HYDRATION_ABORTED,
            args: { form: 'checksum-mismatch', tagName: 'div' },
        });

        expect(warn).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledTimes(1);
        expect(error.mock.calls[0]?.[0]).toMatch(
            /^\[csszyx\] hydration-aborted: The HTML, the bundle and the recovery manifest/,
        );
        // Every id the registry marks prints through `console.error`, every other through `warn`.
        for (const [diagnostic, spec] of DIAGNOSTICS) {
            expect(diagnostic.console, spec.id).toBe(spec.surfaces.runtime?.console);
        }
    });

    it('passes the extra console arguments after the message, as given', () => {
        const element = { tagName: 'DIV' };
        szReport({ diagnostic: UNKNOWN_KEY, args: { key: 'dispaly' }, extra: [element, 2] });

        const [message, ...rest] = warn.mock.calls[0] ?? [];
        expect(message).toMatch(/^\[csszyx\] unknown-key: `dispaly` is not an sz property\./);
        expect(rest).toEqual([element, 2]);
        expect(rest[0]).toBe(element);
    });
});
