/**
 * The `_` an `sz` value carries that the project's Tailwind reads as a space,
 * for the tools an assistant calls before it writes the object.
 *
 * The build and `csszyx check` name it after the fact; an assistant that asks
 * first should hear the same answer, from the same project (PROJECT-RULES §4):
 * the engine's facts, asked of every stylesheet the project compiles, through
 * the one comparison the build reads.
 *
 * @module
 */
import type { ProjectAnswers } from '@csszyx/cli';
import {
    bareOf,
    type UnderscoreSpaceFinding,
    underscoreFactsOf,
    underscoreSpaceProbes,
    underscoreSpaceVerdictsPerRoot,
} from '@csszyx/unplugin/diagnostics';

/**
 * The facts the project's Tailwind reads an `_` of as a space.
 *
 * @param result - The engine's transform of one module, or null when there
 *        is none; its facts are read through `underscoreFactsOf`, which keeps
 *        the positions a located fact holds in getters.
 * @param answers - The project's stylesheets, each asked under its own prefix,
 *        so one whose prefix differs from the others' is still asked.
 * @param file - The file the module is named as.
 * @param lowered - The prefix the module was lowered under, or null.
 * @returns The findings; and why the stylesheets could not be asked, or null.
 */
export async function underscoreSpaceAnswers(
    result: Parameters<typeof underscoreFactsOf>[0],
    answers: Pick<ProjectAnswers, 'stylesheets'>,
    file: string,
    lowered: string | null,
): Promise<{ found: UnderscoreSpaceFinding[]; skipped: string | null }> {
    const sites = underscoreFactsOf(result).map(fact => ({ ...fact, file }));
    // Nothing to ask, so no stylesheet is compiled for it.
    if (underscoreSpaceProbes(sites).probed.length === 0) return { found: [], skipped: null };
    const { roots, skipped } = await answers.stylesheets();
    const { found, unserved } = underscoreSpaceVerdictsPerRoot(sites, roots, lowered);
    // A class no stylesheet serves has no reading: say so, never read as clean.
    if (skipped !== null || unserved.length === 0) return { found, skipped };
    // Named once each, as written without a prefix: each stylesheet was
    // asked under its own.
    const names = [...new Set(unserved.map(fact => bareOf(fact.className, lowered)))];
    const listed = names.map(name => `\`${name}\``).join(', ');
    return {
        found,
        skipped: `no stylesheet serves ${listed} under the prefix it sets, so no CSS is written for it`,
    };
}

/**
 * What a reply says when facts were not asked about.
 *
 * @param skipped - Why the stylesheets could not be asked.
 * @returns The note.
 */
export function underscoreUncheckedNote(skipped: string): string {
    return `An \`_\` in an sz value was not checked against this project's Tailwind (${skipped}). csszyx writes a space in an arbitrary value as \`_\`; Tailwind reads most other \`_\` as a space too, so write a space for a space and \`\\\\_\` in source for an underscore.`;
}
