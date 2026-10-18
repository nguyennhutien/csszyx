/**
 * Build-time diagnostics for `szr`, `szv` and `szs` (ADR 0011, step 4).
 *
 * These three carry the same hazard as an unresolvable `sz` prop but were
 * silent about it: `szr(<opaque>)` and `szv(<opaque>)` reported nothing on any
 * engine, so an argument the compiler could not read meant classes that never
 * reached the safelist — under Tailwind `source(none)`, missing CSS with no
 * build-log trace at all. `szs` did warn, but with one shape message and no
 * pointer at the escape hatch.
 *
 * The contract pinned here is the ADR's: identical text on every engine, so
 * flipping `build.parser` never changes the build log, and `dynamic()` stays
 * silent because runtime values are exactly what it is for.
 */
import { describe, expect, it } from 'vitest';
import {
    formatSzFallbackDiagnostic,
    SZ_FALLBACK_SZS_SUGGESTION,
    SZ_FALLBACK_SZV_SUGGESTION,
    szsUnsupportedDiagnostic,
} from '../src/sz-fallback-matrix.js';
import { engineMessage } from './engine-message.js';
import { ENGINES } from './engine-parity-harness.js';

const RUNTIME_IMPORT = "import { szr, szv, dynamic } from '@csszyx/runtime';\n";
const VUI_IMPORT = "import { Popup } from '@vbd/vui';\n";

/** What a case must report: the issue's args, and the header position. */
interface ExpectedFallback {
    site: 'szr' | 'szv';
    shape: string;
    detail: string;
    path: string;
    at: string;
}

/** Sources that must produce exactly one diagnostic, and what it reports. */
const WARNING_CASES: ReadonlyArray<readonly [string, string, ExpectedFallback]> = [
    [
        'szr identifier',
        'export const a = szr(cfg);',
        { site: 'szr', shape: 'identifier', detail: 'cfg', path: '', at: '2:22' },
    ],
    [
        'szr member',
        'export const a = szr(cfg.x);',
        { site: 'szr', shape: 'member', detail: '', path: '', at: '2:22' },
    ],
    [
        'szr call',
        'export const a = szr(mk());',
        { site: 'szr', shape: 'call', detail: 'mk', path: '', at: '2:22' },
    ],
    [
        'szr parenthesized call',
        'export const a = szr((mk()));',
        { site: 'szr', shape: 'call', detail: 'mk', path: '', at: '2:23' },
    ],
    [
        'szr member callee',
        'export const a = szr(theme.build());',
        { site: 'szr', shape: 'call', detail: 'build', path: '', at: '2:22' },
    ],
    [
        'szr unreadable callee',
        'export const a = szr((c ? f : g)());',
        { site: 'szr', shape: 'call', detail: '?', path: '', at: '2:22' },
    ],
    // A factory the parse saw declared as szv and refused: the message names
    // the factory as what it is and the config position that disqualified,
    // instead of the circular "convert to szv()" call advice.
    [
        'szr call to a disqualified szv factory',
        "const t = szv({ base: { color: 'red-500' }, variants: { c: { blue: { color: 'blue-500' } } } });\nexport const a = szr(t({ c: 'blue' }));",
        { site: 'szr', shape: 'szv-factory', detail: 't', path: 'base.color', at: '3:22' },
    ],
    [
        'szv identifier',
        'export const v = szv(cfg);',
        { site: 'szv', shape: 'identifier', detail: 'cfg', path: '', at: '2:22' },
    ],
    [
        'szv call',
        'export const v = szv(mk());',
        { site: 'szv', shape: 'call', detail: 'mk', path: '', at: '2:22' },
    ],
    [
        'szv member',
        'export const v = szv(cfg.variants);',
        { site: 'szv', shape: 'member', detail: '', path: '', at: '2:22' },
    ],
];

/** Sources that must stay silent. */
const SILENT_CASES: ReadonlyArray<readonly [string, string]> = [
    // `dynamic()` injects its own rules at runtime — a runtime value is the
    // entire point of it, so questioning the argument would be noise.
    ['dynamic identifier', 'export const d = dynamic(cfg);'],
    ['dynamic member', 'export const d = dynamic(cfg.x);'],
    ['szr static object', 'export const a = szr({ p: 4 });'],
    ['szv static config', 'export const v = szv({ variants: { pad: { a: { p: 4 } } } });'],
];

/** szs sources that must produce the slot-map diagnostic. */
const SZS_WARNING_SOURCES: ReadonlyArray<readonly [string, string]> = [
    ['opaque attribute', 'export const A = ({ s }) => <Popup szs={s} />;'],
    ['opaque slot value', 'export const A = ({ v }) => <Popup szs={{ body: v }} />;'],
    ['call attribute', 'export const A = () => <Popup szs={mk()} />;'],
];

type Engine = (
    source: string,
    filename?: string,
) => { diagnostics?: string[]; issues?: Array<{ code: string; args: object }> };

/**
 * Both artifacts of the one engine. The shared list drops the `auto`
 * selector — `transform-select.test.ts` owns that — and refuses to run in CI
 * with the native artifact missing, which a hand-rolled list here could not
 * notice.
 */
const LANES = ENGINES;

/**
 * Diagnostics for one source, with the project-scan tip filtered out.
 *
 * @param engine - Engine entry under test.
 * @param source - Full module source.
 * @returns Reported diagnostics.
 */
function diagnosticsFor(engine: Engine, source: string): string[] {
    return (engine(source, '/p/t.tsx').diagnostics ?? [])
        .map(String)
        .filter(message => !message.includes('Tip: run'));
}

describe.each(LANES)('%s lane', (_lane, engine) => {
    it.each(WARNING_CASES)('reports %s', (_name, body, expected) => {
        const source = RUNTIME_IMPORT + body;
        const diagnostics = diagnosticsFor(engine, source);
        expect(diagnostics).toHaveLength(1);
        // The header names the position, the issue names what was refused.
        expect(diagnostics[0]).toContain(
            `[csszyx] fallback-missing-css: /p/t.tsx:${expected.at}\n`,
        );
        expect(engine(source, '/p/t.tsx').issues).toMatchObject([
            {
                code: 'fallback-missing-css',
                args: {
                    site: expected.site,
                    shape: expected.shape,
                    detail: expected.detail,
                    path: expected.path,
                },
            },
        ]);
        expect(diagnostics[0]).toContain(
            expected.site === 'szv'
                ? '`szv` config cannot be read'
                : '`szr` falls back to the runtime',
        );
        // Actionable or it is noise.
        expect(diagnostics[0]).toMatch(/szv\(\)|dynamic\(\)|module-level const/);
    });

    it.each(SILENT_CASES)('stays silent for %s', (_name, body) => {
        expect(diagnosticsFor(engine, RUNTIME_IMPORT + body)).toEqual([]);
    });

    it.each(SZS_WARNING_SOURCES)('reports an unresolvable szs slot map: %s', (_name, body) => {
        const diagnostics = diagnosticsFor(engine, VUI_IMPORT + body);
        expect(diagnostics).toEqual([
            engineMessage(
                'szs-slot-map',
                `/p/t.tsx:2:${body.indexOf('szs=') + 1}`,
                'A slot value in `szs` could not be read at build time, so no slot classes were compiled.',
                'help: make every slot an identifier key with a static object literal (or class string) value; for a value only known at runtime, use `dynamic()` and pass the resulting class string.',
                'note: the attribute is left unchanged.',
            ),
        ]);
        expect(engine(VUI_IMPORT + body, '/p/t.tsx').issues).toMatchObject([
            { code: 'szs-slot-map', args: { form: 'unreadable-slot' }, line: 2 },
        ]);
        // The pointer that was missing before: a genuinely runtime slot value
        // has somewhere to go.
        expect(diagnostics[0]).toContain('dynamic()');
    });

    it('stays silent for a fully static szs slot map', () => {
        const source = `${VUI_IMPORT}export const A = () => <Popup szs={{ body: { p: 4 } }} />;`;
        expect(diagnosticsFor(engine, source)).toEqual([]);
    });
});

describe('engine parity', () => {
    const allSources = [
        ...WARNING_CASES.map(([, body]) => RUNTIME_IMPORT + body),
        ...SILENT_CASES.map(([, body]) => RUNTIME_IMPORT + body),
        ...SZS_WARNING_SOURCES.map(([, body]) => VUI_IMPORT + body),
    ];

    it.each(allSources)('every engine reports identically: %s', source => {
        const [[, first]] = LANES;
        const expected = diagnosticsFor(first, source);
        for (const [, engine] of LANES.slice(1)) {
            expect(diagnosticsFor(engine, source)).toEqual(expected);
        }
    });
});

describe('site rendering', () => {
    it('forwards the matrix advice for szr, which varies by kind', () => {
        // szr is a plain fallback: the advice is the matrix entry for the
        // expression shape, so two kinds must not read the same.
        const call = formatSzFallbackDiagnostic('szr', '1:1', 'call', 'mk');
        const member = formatSzFallbackDiagnostic('szr', '1:1', 'member');
        expect(call).toContain('function call `mk()`');
        expect(member).toContain('member expression');
        expect(call.split('Suggestion: ')[1]).not.toBe(member.split('Suggestion: ')[1]);
    });

    it('uses one config-specific advice for szv, whatever the kind', () => {
        // Pointing an szv author at szv() would be circular; what matters is
        // that the config has to be readable.
        for (const kind of ['call', 'identifier', 'member', 'other'] as const) {
            const message = formatSzFallbackDiagnostic('szv', '1:1', kind, 'x');
            expect(message).toContain(SZ_FALLBACK_SZV_SUGGESTION);
            expect(message).toContain('szv catalog at 1:1');
        }
    });

    it('labels each site distinctly', () => {
        expect(formatSzFallbackDiagnostic('sz', '1:1', 'member')).toContain('sz fallback at');
        expect(formatSzFallbackDiagnostic('szr', '1:1', 'member')).toContain('szr fallback at');
        expect(formatSzFallbackDiagnostic('szv', '1:1', 'member')).toContain('szv catalog at');
    });

    it('names the file and the escape hatch in the szs diagnostic', () => {
        const message = szsUnsupportedDiagnostic('src/Card.tsx');
        expect(message).toContain('[csszyx] szs at src/Card.tsx:');
        expect(message).toContain(SZ_FALLBACK_SZS_SUGGESTION);
    });
});
