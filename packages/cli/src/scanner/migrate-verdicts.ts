/**
 * The project's own Tailwind, answering where a migrate table would decide.
 *
 * A few of migrate's refusals read csszyx's own knowledge of the Tailwind
 * this repository pins: a sign on a keyword (`-z-auto`), a fraction on a key
 * (`m-1/2`), a sign on that fraction (`-inset-1/2`), a modifier on a value
 * that is not a colour (`m-2/50`). Whether a class is served is the
 * project's Tailwind's answer (PROJECT-RULES §4, ADR 0012), and `csszyx
 * migrate` runs where that Tailwind is installed. The engine reports every
 * class a table decided; this asks the project's stylesheets about them,
 * with the oracle `csszyx check` uses, so the caller can migrate the file
 * again with the answers.
 *
 * Nothing is compiled until a table has decided something, and a stylesheet
 * is compiled once per run. A class counts as served when any of the
 * project's stylesheets serves it, as `check` counts it. With no Tailwind v4
 * to ask — no stylesheet, Tailwind v3, a stylesheet that does not compile —
 * there are no answers and the tables decide, as they did.
 *
 * @module
 */
import type { MigrateRustTableVerdict } from '@csszyx/compiler/migrate';

import type { OpenedOracles } from '../commands/check.js';

/** Compiles the project's stylesheets; injected in tests. */
export type OpenProjectOracles = (cwd: string) => Promise<OpenedOracles>;

/** The project's answers for one migrate run. */
export interface MigrateVerdicts {
    /** Every answer so far: `true` when the project serves the class. */
    readonly answers: Map<string, boolean>;
    /**
     * Ask about the classes in `verdicts` that have no answer yet.
     *
     * @param verdicts - What the tables decided, unasked.
     * @returns Whether any answer differs from its table's verdict, which is
     *   when the file has to be migrated again.
     */
    settle(verdicts: readonly MigrateRustTableVerdict[] | undefined): Promise<boolean>;
    /** Why the project could not be asked, once that is known; null otherwise. */
    readonly skipped: () => string | null;
}

/**
 * The stylesheets `csszyx check` compiles, loaded only when first needed so a
 * run no table decided anything in never imports the check pass.
 *
 * @param cwd - Project root.
 * @returns The compiled design systems.
 */
const openCheckOracles: OpenProjectOracles = async cwd => {
    const { openOracles } = await import('../commands/check.js');
    return openOracles(cwd);
};

/**
 * Answers for one migrate run over a project.
 *
 * @param cwd - Project root, where Tailwind and the stylesheets resolve.
 * @param open - How the stylesheets are compiled.
 * @returns The run's answers.
 */
export function createMigrateVerdicts(
    cwd: string,
    open: OpenProjectOracles = openCheckOracles,
): MigrateVerdicts {
    const answers = new Map<string, boolean>();
    let opened: Promise<OpenedOracles> | undefined;
    let skipped: string | null = null;

    const settle = async (
        verdicts: readonly MigrateRustTableVerdict[] | undefined,
    ): Promise<boolean> => {
        if (!verdicts?.length) return false;
        opened ??= open(cwd);
        const { oracles, skipped: reasons } = await opened;
        if (oracles.length === 0) {
            skipped = reasons.join('; ') || 'no stylesheet imports Tailwind';
            return false;
        }
        const unasked = [
            ...new Set(verdicts.map(verdict => verdict.class).filter(c => !answers.has(c))),
        ];
        if (unasked.length > 0) {
            const servedSomewhere = new Set<string>();
            for (const oracle of oracles) {
                const prefix = oracle.facts.prefix;
                const asked = unasked.map(c => (prefix ? `${prefix}:${c}` : c));
                const dead = new Set(oracle.findDead(asked));
                for (const [index, className] of unasked.entries()) {
                    if (!dead.has(asked[index] as string)) servedSomewhere.add(className);
                }
            }
            for (const className of unasked) answers.set(className, servedSomewhere.has(className));
        }
        return verdicts.some(verdict => answers.get(verdict.class) !== verdict.served);
    };

    return { answers, settle, skipped: () => skipped };
}
