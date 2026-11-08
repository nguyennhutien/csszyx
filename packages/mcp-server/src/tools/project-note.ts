/**
 * What a tool that reads the project it runs in says when the project could
 * not answer in full. An assistant pastes the answer into code, so an answer
 * made without the project's prefix, or from csszyx's own tables in place of
 * the project's Tailwind, says so beside it.
 */

/**
 * The note for an answer, or nothing when the project answered in full.
 *
 * @param unread - Why no prefix was read, or null when one (or none) was.
 * @param skipped - Why the project's Tailwind could not be asked, or null.
 * @param decided - The classes a table decided, unasked.
 * @param spaced - What migrate wrote with every `_` of a value as a space.
 * @param spaced.values - The values, as the conversion names them.
 * @param spaced.skipped - Why the project's Tailwind could not be asked, or null.
 * @returns The note, or undefined.
 */
export function projectNote(
    unread: string | null,
    skipped: string | null,
    decided: readonly { class: string }[] | undefined,
    spaced?: { values: readonly { value: string }[] | undefined; skipped: string | null },
): string | undefined {
    const parts: string[] = [];
    if (unread !== null) parts.push(`The classes were read without a Tailwind prefix: ${unread}.`);
    if (skipped !== null && decided?.length) {
        const classes = decided.map(verdict => `\`${verdict.class}\``).join(', ');
        const why =
            skipped === unread
                ? 'for the same reason'
                : `since the project's Tailwind could not be asked: ${skipped}`;
        parts.push(`csszyx's own tables decided ${classes}, ${why}.`);
    }
    if (spaced?.skipped != null && spaced.values?.length) {
        const values = [...new Set(spaced.values.map(question => `\`${question.value}\``))];
        // A reason already given is named, not repeated.
        const given = spaced.skipped === unread || (spaced.skipped === skipped && decided?.length);
        const why = given ? 'for the same reason' : `: ${spaced.skipped}`;
        parts.push(
            `Each \`_\` of ${values.join(', ')} was written as a space, since the project's Tailwind could not be asked whether it keeps one (it does in a \`url()\`)${given ? ', ' : ''}${why}.`,
        );
    }
    return parts.length > 0 ? parts.join(' ') : undefined;
}
