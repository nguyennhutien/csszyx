/**
 * The answers one migrate run gets from the project's stylesheets: asked
 * once per class, served when any stylesheet serves it, and nothing compiled
 * until a table has decided something.
 */
import { describe, expect, it, vi } from 'vitest';

import type { OpenedOracles } from '../src/commands/check.js';
import { createMigrateVerdicts } from '../src/scanner/migrate-verdicts.js';

/**
 * A stylesheet that serves exactly `served`.
 *
 * @param served - The classes it serves.
 * @param prefix - The prefix its `@import` sets.
 * @returns An oracle answering for that stylesheet.
 */
function stylesheet(served: readonly string[], prefix: string | null = null) {
    return {
        ok: true,
        facts: { prefix },
        findDead: vi.fn((classes: readonly string[]) => classes.filter(c => !served.includes(c))),
    } as unknown as OpenedOracles['oracles'][number];
}

/**
 * The project as `openOracles` would open it.
 *
 * @param oracles - Its compiled stylesheets.
 * @param skipped - Why others did not compile.
 * @returns The opened project.
 */
function project(oracles: OpenedOracles['oracles'], skipped: string[] = []): OpenedOracles {
    return { oracles, skipped, stylesheetFailed: false, hadEntries: true, prefixes: [] };
}

describe('the project answering for a migrate run', () => {
    it('compiles nothing until a table has decided something', async () => {
        const open = vi.fn(async () => project([stylesheet([])]));
        const verdicts = createMigrateVerdicts('/p', open);

        expect(await verdicts.settle(undefined)).toBe(false);
        expect(await verdicts.settle([])).toBe(false);
        expect(open).not.toHaveBeenCalled();
    });

    it('asks each class once and says when an answer contradicts its table', async () => {
        const a = stylesheet(['-z-auto']);
        const b = stylesheet(['-inset-1/2']);
        const open = vi.fn(async () => project([a, b]));
        const verdicts = createMigrateVerdicts('/p', open);

        // Agreeing with the table changes nothing.
        expect(await verdicts.settle([{ class: '-inset-1/2', served: true }])).toBe(false);
        // A refusal the project overrules, and one table yes it does not.
        expect(
            await verdicts.settle([
                { class: '-z-auto', served: false },
                { class: '-inset-1/2', served: true },
            ]),
        ).toBe(true);
        expect(await verdicts.settle([{ class: 'w-1/2', served: true }])).toBe(true);

        expect([...verdicts.answers]).toEqual([
            ['-inset-1/2', true],
            ['-z-auto', true],
            ['w-1/2', false],
        ]);
        expect(open).toHaveBeenCalledTimes(1);
        // `-inset-1/2` was asked in the first call only.
        expect(a.findDead).toHaveBeenNthCalledWith(2, ['-z-auto']);
        expect(verdicts.skipped()).toBeNull();
    });

    it('answers a table whose classes were all asked from the first answers', async () => {
        const sheet = stylesheet(['-z-auto']);
        const verdicts = createMigrateVerdicts('/p', async () => project([sheet]));

        expect(await verdicts.settle([{ class: '-z-auto', served: false }])).toBe(true);
        // Every class is answered already: no stylesheet is asked again, and
        // the verdict still comes from the answer the first call recorded.
        expect(await verdicts.settle([{ class: '-z-auto', served: false }])).toBe(true);
        expect(await verdicts.settle([{ class: '-z-auto', served: true }])).toBe(false);

        expect(sheet.findDead).toHaveBeenCalledTimes(1);
        expect([...verdicts.answers]).toEqual([['-z-auto', true]]);
    });

    it('asks with the prefix each stylesheet sets', async () => {
        const sheet = stylesheet(['tw:w-1/2'], 'tw');
        const verdicts = createMigrateVerdicts('/p', async () => project([sheet]));

        await verdicts.settle([{ class: 'w-1/2', served: true }]);

        expect(sheet.findDead).toHaveBeenCalledWith(['tw:w-1/2']);
        expect(verdicts.answers.get('w-1/2')).toBe(true);
    });

    it('leaves the tables to decide, and says why, when nothing compiles', async () => {
        const verdicts = createMigrateVerdicts('/p', async () =>
            project([], ['tailwindcss resolves to 3.4.19; v4 is required']),
        );

        expect(await verdicts.settle([{ class: '-z-auto', served: false }])).toBe(false);
        expect(verdicts.answers.size).toBe(0);
        expect(verdicts.skipped()).toBe('tailwindcss resolves to 3.4.19; v4 is required');

        const none = createMigrateVerdicts('/p', async () => project([]));
        await none.settle([{ class: '-z-auto', served: false }]);
        expect(none.skipped()).toBe('no stylesheet imports Tailwind');
    });
});
