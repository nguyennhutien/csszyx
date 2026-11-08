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
    type UnderscoreSpaceFinding,
    underscoreSpaceProbes,
    underscoreSpaceVerdicts,
} from '@csszyx/unplugin/diagnostics';

/** One fact as the engine reports it, its position resolved or not. */
interface EngineFact {
    readonly key: string;
    readonly value: string;
    readonly className: string;
    readonly line: number;
    readonly column: number;
}

/**
 * The facts the project's Tailwind reads an `_` of as a space.
 *
 * @param facts - The engine's facts for one module.
 * @param answers - The project's stylesheets.
 * @param file - The file the module is named as.
 * @returns The findings; and why the stylesheets could not be asked, or null.
 */
export async function underscoreSpaceAnswers(
    facts: readonly EngineFact[],
    answers: Pick<ProjectAnswers, 'cssPerRoot'>,
    file: string,
): Promise<{ found: UnderscoreSpaceFinding[]; skipped: string | null }> {
    // Field by field: a located fact resolves its position in getters, which
    // a spread drops.
    const sites = facts.map(({ key, value, className, line, column }) => ({
        key,
        value,
        className,
        line,
        column,
        file,
    }));
    const probes = underscoreSpaceProbes(sites);
    if (probes.probed.length === 0) return { found: [], skipped: null };
    const { css, skipped } = await answers.cssPerRoot(probes.classes);
    return { found: underscoreSpaceVerdicts(probes, css), skipped };
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
