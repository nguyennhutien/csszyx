/**
 * The answers one migrate run gets from the project's stylesheets: asked
 * once per class, served when any stylesheet serves it, and nothing compiled
 * until a table has decided something.
 */
import { fileURLToPath } from 'node:url';

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
    return {
        oracles,
        skipped,
        stylesheetFailed: false,
        hadEntries: true,
        prefixes: [],
        stylesheets: [],
    };
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

describe('the `_` of an arbitrary value, as the project reads it', () => {
    // A path, not a URL's pathname: on Windows that is `/D:/…`, which resolves nothing.
    const REPO = fileURLToPath(new URL('../../..', import.meta.url));

    /**
     * The repository's Tailwind, as one compiled stylesheet, recording the
     * classes it is asked about.
     *
     * @param prefix - The prefix its `@import` sets, compiled as written:
     *        the real Tailwind answers only the classes that carry it.
     * @returns The oracle and what it was asked.
     */
    async function realStylesheet(prefix: string | null = null) {
        const { createEmittedClassOracle } = await import('@csszyx/tailwind-oracle');
        const oracle = await createEmittedClassOracle({
            resolveFrom: REPO,
            css: prefix ? `@import "tailwindcss" prefix(${prefix});` : '@import "tailwindcss";',
            cssBase: REPO,
        });
        if (!oracle.ok) throw new Error(oracle.reason);
        const asked: string[] = [];
        const stylesheet = {
            ok: true,
            facts: { prefix },
            findDead: () => [],
            cssFor(classes: readonly string[]) {
                asked.push(...classes);
                return oracle.cssFor(classes);
            },
        } as unknown as OpenedOracles['oracles'][number];
        return { stylesheet, asked };
    }

    const URL_VALUE = {
        class: 'bg-[url(/a_b.png)]',
        value: 'url(/a_b.png)',
        reading: 'url(/a b.png)',
    };
    const STRING_VALUE = { class: "content-['a_b']", value: "'a_b'", reading: "'a b'" };

    it('keeps an `_` the project keeps, and asks each value once', async () => {
        const { stylesheet, asked } = await realStylesheet();
        const verdicts = createMigrateVerdicts('/p', async () => project([stylesheet]));

        // The `url()` answer differs from writing every `_` as a space.
        expect(await verdicts.settleUnderscores([URL_VALUE, STRING_VALUE])).toBe(true);
        expect(verdicts.underscores).toEqual(
            new Map([
                ['url(/a_b.png)', 'url(/a_b.png)'],
                ["'a_b'", "'a b'"],
            ]),
        );
        const count = asked.length;
        expect(await verdicts.settleUnderscores([URL_VALUE])).toBe(true);
        expect(asked).toHaveLength(count);
    });

    it('says nothing changes when the project reads every `_` as a space', async () => {
        const { stylesheet } = await realStylesheet();
        const verdicts = createMigrateVerdicts('/p', async () => project([stylesheet]));
        expect(await verdicts.settleUnderscores([STRING_VALUE])).toBe(false);
        expect(await verdicts.settleUnderscores(undefined)).toBe(false);
    });

    it('asks with the prefix the stylesheet sets', async () => {
        const { stylesheet, asked } = await realStylesheet('tw');
        const verdicts = createMigrateVerdicts('/p', async () => project([stylesheet]));
        await verdicts.settleUnderscores([URL_VALUE, STRING_VALUE]);
        expect(asked[0]).toBe('tw:bg-[url(/a_b.png)]');
        expect(verdicts.underscores).toEqual(
            new Map([
                ['url(/a_b.png)', 'url(/a_b.png)'],
                ["'a_b'", "'a b'"],
            ]),
        );
    });

    it('reads each stylesheet under its own prefix, when two set different ones', async () => {
        const plain = await realStylesheet();
        const prefixed = await realStylesheet('tw');
        for (const order of [
            [plain.stylesheet, prefixed.stylesheet],
            [prefixed.stylesheet, plain.stylesheet],
        ]) {
            const verdicts = createMigrateVerdicts('/p', async () => project(order));
            await verdicts.settleUnderscores([URL_VALUE, STRING_VALUE]);
            expect(verdicts.underscores).toEqual(
                new Map([
                    ['url(/a_b.png)', 'url(/a_b.png)'],
                    ["'a_b'", "'a b'"],
                ]),
            );
        }
    });

    it('has no answer when no stylesheet compiled, and says why', async () => {
        const verdicts = createMigrateVerdicts('/p', async () => project([], ['no Tailwind']));
        expect(await verdicts.settleUnderscores([URL_VALUE])).toBe(false);
        expect(verdicts.underscores.size).toBe(0);
        expect(verdicts.skipped()).toBe('no Tailwind');
    });
});
