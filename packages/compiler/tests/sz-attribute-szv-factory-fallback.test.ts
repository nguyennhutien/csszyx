/**
 * One cause, one message — wherever a refused szv factory surfaces.
 *
 * A factory the build saw declared as `szv` and refused to precompile already
 * reported well at the `szr` position: it named the factory as what it is and
 * the config path that disqualified it. At the sz-attribute position the same
 * factory reported as a generic unknown function instead, so the message told
 * the author to "convert to szv()" a factory that is already `szv()`, and named
 * no position at all.
 *
 * That is worse than terse. The advice is circular, so it reads as csszyx not
 * understanding the code, and the missing position sends the reader bisecting
 * the call site instead of the config. Both positions now route through the same
 * classifier.
 *
 * The narrow boundary here: only a CONFIG-level refusal rewrites. A call to a
 * function the parse never saw declared as `szv` is still a generic unknown
 * function, and a factory that qualified has nothing in its config to point at.
 */
import { describe, expect, it } from 'vitest';

import { ENGINES, type ParityEngine } from './engine-parity-harness.js';

const RUNTIME_IMPORT = "import { szv } from '@csszyx/runtime';\n";

/**
 * Diagnostics for one source, with the project-scan tip filtered out.
 *
 * @param engine - Engine entry under test.
 * @param body - Module body, appended to the runtime import.
 * @returns Reported diagnostics.
 */
function diagnosticsFor(engine: ParityEngine, body: string): string[] {
    return (engine(RUNTIME_IMPORT + body, { filename: '/p/t.tsx' }).diagnostics ?? [])
        .map(String)
        .filter(message => !message.includes('Tip: run'));
}

/** A factory whose config disqualifies at a position worth naming. */
const DISQUALIFIED_FACTORY =
    "const t = szv({ base: { color: 'red-500' }, " +
    "variants: { c: { blue: { color: 'blue-500' } } } });\n";

describe.each(ENGINES)('a refused szv factory in an sz attribute (%s)', (_name, engine) => {
    it('names the factory and the config path, not a generic call', () => {
        const diagnostics = diagnosticsFor(
            engine,
            `${DISQUALIFIED_FACTORY}export const A = () => <div sz={t({ c: 'blue' })} />;`,
        );

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toContain('szv factory `t()` could not be compiled');
        expect(diagnostics[0]).toContain('base.color');
        const { issues } = engine(
            `${RUNTIME_IMPORT}${DISQUALIFIED_FACTORY}export const A = () => <div sz={t({ c: 'blue' })} />;`,
            { filename: '/p/t.tsx' },
        );
        expect(issues?.map(issue => [issue.code, issue.args])).toEqual([
            [
                'fallback-nudge',
                { site: 'sz', shape: 'szv-factory', detail: 't', path: 'base.color' },
            ],
        ]);
    });

    it('stops telling an szv author to convert to szv', () => {
        const diagnostics = diagnosticsFor(
            engine,
            `${DISQUALIFIED_FACTORY}export const A = () => <div sz={t({ c: 'blue' })} />;`,
        );

        expect(diagnostics[0]).not.toContain('convert to szv()');
        expect(diagnostics[0]).not.toContain('returns a value unknown at build time');
    });

    it('reads the same at both positions, because it is the same cause', () => {
        // The whole point of routing one classifier: an author who moves the
        // call from an attribute to szr must not get a different explanation.
        const attribute = diagnosticsFor(
            engine,
            `${DISQUALIFIED_FACTORY}export const A = () => <div sz={t({ c: 'blue' })} />;`,
        );
        const szr = diagnosticsFor(
            engine,
            `${DISQUALIFIED_FACTORY}export const a = szr(t({ c: 'blue' }));`,
        );

        // Strip the header, the site name and what the site costs (the code, the
        // note and the docs link differ: an `szr` argument is never collected,
        // an `sz` attribute is still lowered by the runtime). What stays is the
        // cause and the advice, and those are what must match.
        const cause = (message: string) =>
            message
                .split('\n')
                .slice(1)
                .filter(line => !line.startsWith('  note:') && !line.startsWith('  docs:'))
                .join('\n')
                .replace(/^ {2}`sz\w*` falls back to the runtime: /, '');
        expect(cause(attribute[0])).toBe(cause(szr[0]));
        expect(cause(attribute[0])).not.toBe(attribute[0]);
        expect(attribute[0]).toContain('`sz` falls back to the runtime');
        expect(szr[0]).toContain('`szr` falls back to the runtime');
    });

    it('names the factory when the attribute precedes the declaration', () => {
        // The attribute is visited before the szv is recorded, so a classifier
        // that decided during the walk would miss this ordering entirely.
        const diagnostics = diagnosticsFor(
            engine,
            `export const A = () => <div sz={t({ c: 'blue' })} />;\n${DISQUALIFIED_FACTORY}`,
        );

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toContain('szv factory `t()` could not be compiled');
    });
});

describe.each(ENGINES)('what must keep reading as a generic call (%s)', (_name, engine) => {
    it('leaves a function the parse never saw declared alone', () => {
        const diagnostics = diagnosticsFor(engine, 'export const A = () => <div sz={mk()} />;');

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toContain(
            'function call `mk()` returns a value unknown at build time',
        );
        expect(diagnostics[0]).not.toContain('szv factory');
    });

    it('leaves a factory whose config qualified alone', () => {
        // A qualifying factory has nothing wrong at any path, so naming one
        // would be an invented position.
        const diagnostics = diagnosticsFor(
            engine,
            'const t = szv({ variants: { c: { blue: { p: 4 } } } });\n' +
                'export const A = ({ v }) => <div sz={t(v)} />;',
        );

        for (const message of diagnostics) {
            expect(message).not.toContain('szv factory `t()` could not be compiled');
        }
    });
});
