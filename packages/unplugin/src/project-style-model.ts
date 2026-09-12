/**
 * One compiled view of the project's own stylesheets.
 *
 * The build asks the same CSS three things: which classes this project's
 * Tailwind serves, what each one sets, and what the `@import "tailwindcss"`
 * line settled for all of them — a prefix renames every utility, `important`
 * forces every declaration. Two independent paths grew for those answers: a
 * regex scan over `@theme` blocks, and the design system Tailwind itself
 * compiles. Only the second sees a theme shipped inside a package, a `@plugin`
 * or a `@config`, so a feature wired to the first misses them without saying
 * so.
 *
 * This module is the one path. It compiles each entry stylesheet once and
 * answers from those compiles; `.agent/flows/css-design-system-pipeline.md`
 * carries the map, and `tests/css-reading-entry-points.test.ts` fails when a
 * new caller opens a second one.
 *
 * @module
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
    createEmittedClassOracle,
    type StylesheetFacts,
    tailwindEntriesAmong,
} from '@csszyx/tailwind-oracle';

/** What the project's stylesheets say, from one compile of each entry. */
export interface ProjectStyleModel {
    /**
     * What the `@import "tailwindcss"` line settled for every class.
     *
     * Reported only when every entry agrees. A project whose stylesheets
     * disagree has no answer that is true of all of it, and guessing one would
     * rename classes for half the build.
     */
    facts: StylesheetFacts;
    /**
     * Which of these classes produce no CSS anywhere in the project.
     *
     * A class counts as unserved only when EVERY entry agrees it is — one
     * stylesheet serving it is enough for the project to serve it.
     *
     * @param classes - Class names, without variants.
     * @returns The subset that styles nothing, in the given order.
     */
    unserved(classes: readonly string[]): string[];
}

/**
 * What the build must say when the project's Tailwind is configured in a way
 * csszyx does not emit for yet.
 *
 * A prefix renames every utility, so `p-4` — what the lowering emits — is not a
 * class the project serves; `important` makes every declaration `!important`,
 * so a `sz` class loses to the library class it is meant to override. Neither
 * is supported yet, and both fail the same way: a green build whose emitted
 * classes style nothing, with nothing in the log to search for.
 *
 * @param facts - What the project's import line settled.
 * @returns The message, or null when nothing is unsupported.
 */
export function unsupportedStylesheetFactsMessage(facts: StylesheetFacts): string | null {
    const settings: string[] = [];
    if (facts.prefix !== null) settings.push(`prefix(${facts.prefix})`);
    if (facts.important) settings.push('important');
    if (settings.length === 0) return null;

    const what = settings.join(' and ');
    const consequence =
        facts.prefix === null
            ? 'every utility is `!important`, so a class csszyx emits cannot override one the project already applies'
            : `every utility is renamed, so the classes csszyx emits (\`p-4\`, not \`${facts.prefix}:p-4\`) produce no CSS`;
    return (
        `[csszyx] your Tailwind entry sets ${what}, which csszyx does not emit for yet: ${consequence}.\n` +
        `  help: drop ${what} from the \`@import "tailwindcss"\` line, or keep it and style those elements with \`className\` until csszyx supports it.`
    );
}

/** One entry's compiled answers. */
interface CompiledEntry {
    facts: StylesheetFacts;
    findDead(classes: readonly string[]): string[];
}

/**
 * The facts every entry agrees on.
 *
 * Taking the first entry apart from the rest makes "at least one" part of the
 * signature, so there is no empty case to invent a default for.
 *
 * @param first - One compiled entry.
 * @param rest - The other compiled entries, possibly none.
 * @returns The shared facts, with a disagreement reported as the default.
 */
function agreedFacts(first: CompiledEntry, rest: readonly CompiledEntry[]): StylesheetFacts {
    const { facts } = first;
    return {
        prefix: rest.every(entry => entry.facts.prefix === facts.prefix) ? facts.prefix : null,
        important: rest.every(entry => entry.facts.important === facts.important)
            ? facts.important
            : false,
    };
}

/**
 * Compile the project's entry stylesheets and answer from them.
 *
 * The caller has already walked the project for stylesheets, so the list is
 * handed over rather than globbed again — measured at 1 ms for one app against
 * 96 ms at the root of this monorepo, and the gap widens with the tree.
 *
 * @param resolveFrom - Project directory whose `package.json` anchors resolution.
 * @param cssFiles - Stylesheet paths the caller already walked.
 * @returns The model, or null when no entry compiled and there is nothing to ask.
 */
export async function openProjectStyleModel(
    resolveFrom: string,
    cssFiles: readonly string[],
): Promise<ProjectStyleModel | null> {
    const compiled: CompiledEntry[] = [];
    for (const entry of await tailwindEntriesAmong(cssFiles)) {
        const oracle = await createEmittedClassOracle({
            resolveFrom,
            css: await readFile(entry, 'utf8'),
            cssBase: path.dirname(entry),
        });
        // A stylesheet that will not compile is dropped rather than allowed to
        // answer: a broken stylesheet is not evidence about the project.
        if (oracle.ok) {
            compiled.push({ facts: oracle.facts, findDead: classes => oracle.findDead(classes) });
        }
    }
    const [first, ...rest] = compiled;
    if (first === undefined) return null;

    return {
        facts: agreedFacts(first, rest),
        unserved(classes) {
            const perEntry = compiled.map(entry => new Set(entry.findDead(classes)));
            return classes.filter(token => perEntry.every(dead => dead.has(token)));
        },
    };
}
