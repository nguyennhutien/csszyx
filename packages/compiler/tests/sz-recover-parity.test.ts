/**
 * `szRecover` diagnostics, on every engine.
 *
 * A `szRecover` attribute that emits no recovery token has two distinct
 * causes — a value that is not a string literal, and a string literal naming a
 * mode csszyx does not have — and they need different fixes. The Babel and oxc
 * lanes said which one happened; the native engine folded both into a single
 * sentence, because its IR recorded only the span of the offending attribute
 * and not the reason. A build can switch lanes with `build.parser`, so the same
 * source printed different advice depending on a setting that is supposed to be
 * an implementation detail.
 *
 * The oxc lane also named the wrong file: it reports through the filename it
 * hands the parser, which substitutes `file.tsx` so JSX is detected at all, so
 * a caller that passed no filename was told about a file that does not exist.
 */
import { describe, expect, it } from 'vitest';

import { transformOxc, transformSourceCode } from '../src/index.js';
import { captureWarnings, ENGINES } from './tri-engine-harness.js';

const NON_LITERAL =
    '[csszyx] szRecover at /p/t.tsx: only string-literal values ("csr" | "dev-only") are ' +
    'supported. Dynamic values disable token emission for this element.';

const UNKNOWN_MODE =
    '[csszyx] szRecover at /p/t.tsx: unknown mode "ssr" — expected "csr" or "dev-only". ' +
    'Token emission skipped.';

describe('szRecover diagnostics are identical on every engine', () => {
    it('reports a dynamic value as the wrong value SHAPE', () => {
        const tsx = 'export const A = ({ mode }) => <div szRecover={mode}>x</div>;';
        for (const [name, engine] of ENGINES) {
            const { warnings } = captureWarnings(engine, tsx);
            expect(warnings, name).toContain(NON_LITERAL);
        }
    });

    it('reports a misspelled mode by NAME, so the typo is visible', () => {
        const tsx = 'export const A = () => <div szRecover="ssr">x</div>;';
        for (const [name, engine] of ENGINES) {
            const { warnings } = captureWarnings(engine, tsx);
            expect(warnings, name).toContain(UNKNOWN_MODE);
        }
    });

    it.each(['csr', 'dev-only'])('stays silent for the supported mode %s', mode => {
        const tsx = `export const A = () => <div szRecover="${mode}">x</div>;`;
        for (const [name, engine] of ENGINES) {
            const { warnings } = captureWarnings(engine, tsx);
            expect(
                warnings.filter(message => message.includes('szRecover')),
                name,
            ).toEqual([]);
        }
    });

    it('names no file the caller never passed', () => {
        // Scoped to the two lanes a caller can invoke without a filename. The
        // native lane is reached through a BATCH wrapper that substitutes
        // `file-<index>.tsx`, and that substitute also seeds recovery-token
        // generation, so aligning it is a token-stability change rather than a
        // wording one. The message SHAPE above is what all three share.
        const tsx = 'export const A = ({ mode }) => <div szRecover={mode}>x</div>;';
        // Called with the filename argument OMITTED — a default parameter would
        // swallow an explicit `undefined`, so the harness cannot express this.
        for (const [name, engine] of [
            ['babel', transformSourceCode],
            ['oxc', transformOxc],
        ] as const) {
            const recovery = engine(tsx).diagnostics.filter(message =>
                message.includes('szRecover'),
            );
            expect(recovery, name).toHaveLength(1);
            expect(recovery[0], name).toContain('szRecover at <anonymous>:');
        }
    });
});
