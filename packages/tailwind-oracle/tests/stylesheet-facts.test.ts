/**
 * What the project's own `@import "tailwindcss"` line decided.
 *
 * `prefix(tw)` renames every utility, and `important` appends `!important` to
 * every declaration. Both are properties of the compiled design system, not of
 * the text of the stylesheet, so a `@import` written inside a package in
 * `node_modules` settles them just as well as one in the app. Everything csszyx
 * emits or judges depends on the answer: the class it lowers `sz` to, the
 * safelist it writes, the tokens it mangles, and whether a `!` in a merge means
 * anything.
 *
 * @module
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmittedClassOracle } from '../src/emitted-class-oracle.js';

/** Repository root, whose `package.json` resolves `tailwindcss`. */
const REPO = path.resolve(import.meta.dirname, '../../..');

/**
 * Build a ready oracle over the repository's own Tailwind, failing the test
 * when it degrades — these cases are about what the design system says, so a
 * skip would pass them vacuously.
 *
 * @param css Stylesheet content to load the design system from.
 * @returns The ready oracle.
 */
async function readyOracle(css: string) {
    const oracle = await createEmittedClassOracle({ resolveFrom: REPO, css, cssBase: REPO });
    if (!oracle.ok) throw new Error(`expected a ready oracle, got skip: ${oracle.reason}`);
    return oracle;
}

describe('what the stylesheet decided about every class', () => {
    it('reports no prefix and no forced important for a stock import', async () => {
        const oracle = await readyOracle('@import "tailwindcss";');

        expect(oracle.facts).toEqual({ prefix: null, important: false });
    });

    it('reports the prefix the import asked for', async () => {
        const oracle = await readyOracle('@import "tailwindcss" prefix(tw);');

        expect(oracle.facts).toEqual({ prefix: 'tw', important: false });
        // Paired with the served/unserved answer, because the prefix is only
        // worth reporting if it really is the vocabulary the project has: with
        // it set, the unprefixed name is the one that styles nothing.
        expect(oracle.findDead(['tw:p-4', 'p-4'])).toEqual(['p-4']);
    });

    it('reports the forced important the import asked for', async () => {
        const oracle = await readyOracle('@import "tailwindcss" important;');

        expect(oracle.facts).toEqual({ prefix: null, important: true });
    });

    it('reports both when the import asks for both', async () => {
        const oracle = await readyOracle('@import "tailwindcss" prefix(tw) important;');

        expect(oracle.facts).toEqual({ prefix: 'tw', important: true });
    });

    it('reads the decision through an import, not from the text it was given', async () => {
        // The line that decides sits in another stylesheet — the shape a UI
        // library ships, where the app's own CSS never mentions a prefix.
        const oracle = await readyOracle(
            '@import "./packages/tailwind-oracle/tests/fixtures/prefixed-entry.css";',
        );

        expect(oracle.facts).toEqual({ prefix: 'tw', important: false });
    });
});
