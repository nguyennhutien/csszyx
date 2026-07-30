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
import { transformSourceCode } from '../src/transform.js';
import { transformOxc } from '../src/transform-oxc.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';

const RUNTIME_IMPORT = "import { szr, szv, dynamic } from '@csszyx/runtime';\n";
const VUI_IMPORT = "import { Popup } from '@vbd/vui';\n";

/** Sources that must produce exactly one diagnostic, and its opening line. */
const WARNING_CASES: ReadonlyArray<readonly [string, string, string]> = [
    ['szr identifier', 'export const a = szr(cfg);', 'szr fallback at 2:22'],
    ['szr member', 'export const a = szr(cfg.x);', 'szr fallback at 2:22'],
    ['szr call', 'export const a = szr(mk());', 'szr fallback at 2:22'],
    ['szr member callee', 'export const a = szr(theme.build());', 'szr fallback at 2:22'],
    ['szr unreadable callee', 'export const a = szr((c ? f : g)());', 'szr fallback at 2:22'],
    ['szv identifier', 'export const v = szv(cfg);', 'szv catalog at 2:22'],
    ['szv call', 'export const v = szv(mk());', 'szv catalog at 2:22'],
    ['szv member', 'export const v = szv(cfg.variants);', 'szv catalog at 2:22'],
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

type Engine = (source: string, filename?: string) => { diagnostics?: string[] };

const LANES: ReadonlyArray<readonly [string, Engine]> = [
    ['babel', transformSourceCode],
    ['oxc', transformOxc as Engine],
    ...(isRustTransformAvailable() ? ([['rust', transformRust as Engine]] as const) : []),
];

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
    it.each(WARNING_CASES)('reports %s', (_name, body, expectedOpening) => {
        const diagnostics = diagnosticsFor(engine, RUNTIME_IMPORT + body);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toContain(expectedOpening);
        // Actionable or it is noise.
        expect(diagnostics[0]).toMatch(/szv\(\)|dynamic\(\)|module-level const/);
    });

    it.each(SILENT_CASES)('stays silent for %s', (_name, body) => {
        expect(diagnosticsFor(engine, RUNTIME_IMPORT + body)).toEqual([]);
    });

    it.each(SZS_WARNING_SOURCES)('reports an unresolvable szs slot map: %s', (_name, body) => {
        const diagnostics = diagnosticsFor(engine, VUI_IMPORT + body);
        expect(diagnostics).toEqual([szsUnsupportedDiagnostic('/p/t.tsx')]);
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
