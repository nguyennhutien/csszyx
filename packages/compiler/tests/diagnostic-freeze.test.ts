/**
 * The engine's diagnostics as they render today, pinned on both artifacts.
 *
 * ADR 0031 moves every sentence out of the engine's `format!` sites into the
 * diagnostic registry, renders it in TypeScript, and adds named `args` to each
 * issue. This snapshot is what that move is checked against: a reworded line
 * shows up here as a diff someone chose, and a sentence the move broke shows
 * up as one nobody did.
 *
 * Update with `vitest run tests/diagnostic-freeze.test.ts -u` only when the
 * wording change is the point of the commit.
 */
import { describe, expect, it } from 'vitest';

import { FREEZE_SOURCES } from './diagnostic-freeze-sources.js';
import { ENGINES } from './engine-parity-harness.js';

/** The file name every source is transformed as, unless its entry names one. */
const FILENAME = 'src/freeze.tsx';

/** What one source renders: each issue beside its line. */
interface Frozen {
    code: string;
    variant: string;
    issues: Array<{
        code: string;
        line: number | undefined;
        column: number | undefined;
        text: string;
    }>;
}

/**
 * Render every freeze source on one engine.
 *
 * @param engine - One artifact of the engine.
 * @returns The rendered issues, in corpus order.
 */
function freeze(engine: (typeof ENGINES)[number][1]): Frozen[] {
    return FREEZE_SOURCES.map(({ code, variant, source, filename, options }) => {
        const result = engine(source, filename ?? FILENAME, options);
        const issues = (result.issues ?? []).map((issue, index) => ({
            code: issue.code,
            line: issue.line,
            column: issue.column,
            text: result.diagnostics?.[index] ?? '',
        }));
        return { code, variant, issues };
    });
}

describe('the engine diagnostics, frozen', () => {
    it('render every form the same on both artifacts', () => {
        const [[, first], ...rest] = ENGINES;
        const expected = freeze(first);
        for (const [name, engine] of rest) expect(freeze(engine), name).toEqual(expected);
    });

    it('render every form as pinned', async () => {
        const frozen = freeze(ENGINES[0][1]);
        for (const entry of frozen) {
            expect(
                entry.issues.some(issue => issue.code === entry.code),
                `${entry.code}/${entry.variant}`,
            ).toBe(true);
        }
        await expect(`${JSON.stringify(frozen, null, 2)}\n`).toMatchFileSnapshot(
            './fixtures/diagnostic-freeze.json',
        );
    });
});
