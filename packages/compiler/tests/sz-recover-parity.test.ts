/**
 * `szRecover` diagnostics, on every engine.
 *
 * A `szRecover` attribute that emits no recovery token has two distinct
 * causes — a value that is not a string literal, and a string literal naming a
 * mode csszyx does not have — and they need different fixes. The removed Babel
 * and oxc lanes said which one happened; the Rust engine folded both into a
 * single sentence, because its IR recorded only the span of the offending
 * attribute and not the reason. A build could switch lanes with `build.parser`,
 * so the same source printed different advice depending on a setting that was
 * supposed to be an implementation detail.
 *
 * The removed oxc lane also named the wrong file: it reported through the
 * filename it handed the parser, which substituted `file.tsx` so JSX was
 * detected at all, so a caller that passed no filename was told about a file
 * that does not exist.
 */
import { describe, expect, it } from 'vitest';

import { transformSource, transformWasm } from '../src/engine.js';
import { engineMessage } from './engine-message.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

const NON_LITERAL = engineMessage(
    'sz-recover',
    '/p/t.tsx:1:37',
    '`szRecover` takes only a string literal.',
    'help: write `szRecover="csr"` or `szRecover="dev-only"`.',
    'note: no `data-sz-recovery-token` is written for this element.',
);

const UNKNOWN_MODE = engineMessage(
    'sz-recover',
    '/p/t.tsx:1:29',
    '`szRecover` has an unknown mode `"ssr"`.',
    'help: use `"csr"` or `"dev-only"`.',
    'note: no `data-sz-recovery-token` is written for this element.',
);

describe('szRecover diagnostics are identical on every engine', () => {
    it('reports a dynamic value as the wrong value SHAPE', () => {
        const tsx = 'export const A = ({ mode }) => <div szRecover={mode}>x</div>;';
        for (const [name, engine] of ENGINES) {
            const { warnings, result } = captureWarnings(engine, tsx);
            expect(warnings, name).toContain(NON_LITERAL);
            expect(
                result.issues?.map(issue => [issue.code, issue.args]),
                name,
            ).toEqual([['sz-recover', { form: 'non-literal' }]]);
        }
    });

    it('reports a misspelled mode by NAME, so the typo is visible', () => {
        const tsx = 'export const A = () => <div szRecover="ssr">x</div>;';
        for (const [name, engine] of ENGINES) {
            const { warnings, result } = captureWarnings(engine, tsx);
            expect(warnings, name).toContain(UNKNOWN_MODE);
            expect(
                result.issues?.map(issue => [issue.code, issue.args]),
                name,
            ).toEqual([['sz-recover', { form: 'unknown-mode', mode: 'ssr' }]]);
        }
    });

    it.each(['csr', 'dev-only'])('stays silent for the supported mode %s', mode => {
        const tsx = `export const A = () => <div szRecover="${mode}">x</div>;`;
        for (const [name, engine] of ENGINES) {
            const { warnings, result } = captureWarnings(engine, tsx);
            expect(
                (result.issues ?? []).filter(issue => issue.code === 'sz-recover'),
                name,
            ).toEqual([]);
            expect(warnings, name).toEqual([]);
        }
    });

    it.each(['csr', 'dev-only'])('writes the %s mode as a data attribute React accepts', mode => {
        // React warns in development on a camelCase attribute it does not know,
        // in every app that writes the directive, so the mode reaches the DOM
        // as `data-sz-recover`, the attribute the runtime reads.
        const tsx = `export const A = () => <section szRecover="${mode}">x</section>;`;
        for (const [name, engine] of ENGINES) {
            const { code } = engine(tsx, { filename: '/p/t.tsx' });
            expect(code, name).toMatch(
                new RegExp(
                    `<section data-sz-recover="${mode}" data-sz-recovery-token="[0-9a-f]{12}">`,
                ),
            );
            expect(code, name).not.toContain('szRecover');
        }
    });

    it.each([
        ['a dynamic value', 'export const A = ({ mode }) => <div szRecover={mode}>x</div>;'],
        ['an unknown mode', 'export const A = () => <div szRecover="ssr">x</div>;'],
    ])('renames %s too, so React stays quiet while the build warns', (_, tsx) => {
        for (const [name, engine] of ENGINES) {
            const { code } = engine(tsx, { filename: '/p/t.tsx' });
            expect(code, name).toContain('<div data-sz-recover=');
            expect(code, name).not.toContain('szRecover');
            expect(code, name).not.toContain('data-sz-recovery-token');
        }
    });

    it('names no file the caller never passed', () => {
        // Scoped to the two entry points a caller can invoke without a
        // filename: the `auto` selector and the wasm artifact. `transformRust`
        // is reached through a BATCH wrapper that substitutes
        // `file-<index>.tsx`, and that substitute also seeds recovery-token
        // generation, so aligning it is a token-stability change rather than a
        // wording one. The message SHAPE above is what both artifacts share.
        const tsx = 'export const A = ({ mode }) => <div szRecover={mode}>x</div>;';
        // Called with the filename argument OMITTED — a default parameter would
        // swallow an explicit `undefined`, so the harness cannot express this.
        for (const [name, engine] of [
            ['auto', transformSource],
            ['wasm', transformWasm],
        ] as const) {
            const recovery = engine(tsx).diagnostics.filter(message =>
                message.startsWith('[csszyx] sz-recover:'),
            );
            expect(recovery, name).toHaveLength(1);
            expect(recovery[0], name).toContain('[csszyx] sz-recover: <anonymous>:1:');
        }
    });
});
