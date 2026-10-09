/**
 * List every class a build drops because a later one on the same element
 * covers it.
 *
 * Nothing prints when a build merges, so this is how an app finds the sites a
 * merge changed: `csszyx check --rule merge-covered-key --rule
 * merge-covered-class` calls it. It reads the model and the first pass the
 * build reads, and asks the same questions the build asks before it pays for
 * a second pass.
 *
 * @module
 */
import path from 'node:path';

import { type SourceTransformResult, transformSource } from '@csszyx/compiler';
import type { ContentScanner } from '@csszyx/tailwind-oracle';

import { type MergeSignature, removedByMerge, removedByOverride } from './merge-signature.js';
import type { ProjectStyleModel } from './project-style-model.js';
import { SourceHookRegistry } from './source-hooks.js';

/** Which merge dropped a class. */
export type MergeAuditKind =
    /** A later key of a static `sz` object covered an earlier one. */
    | 'merge-covered-key'
    /** An `sz` class covered a static class-name class beside it. */
    | 'merge-covered-class';

/** Every merge rule, in the order the audit and the build name them. */
export const MERGE_AUDIT_KINDS: readonly MergeAuditKind[] = [
    'merge-covered-key',
    'merge-covered-class',
];

/** One class a merge removes, and where. */
export interface MergeAuditFinding {
    /** The file, as the caller named it. */
    file: string;
    /**
     * 1-based line of the `sz` key the class was written as, or of the
     * class-name attribute.
     */
    line: number;
    kind: MergeAuditKind;
    /** The class removed. */
    className: string;
    /** For `merge-covered-key`, the `sz` key the class was written as. */
    key?: string;
}

/** One source file to audit. */
export interface MergeAuditFile {
    /** Absolute path, handed to the compiler. */
    path: string;
    /** The name findings carry. */
    relative: string;
    source: string;
}

/**
 * Every class a merge removes, one finding per class, in file order and then
 * line order.
 *
 * @param input - The project's model, the prefix it settled, and the files.
 * @param input.model - The opened style model.
 * @param input.classPrefix - The Tailwind prefix the stylesheets set, or null.
 * @param input.files - The source files.
 * @param input.scanner - Tailwind's extractor, to read what the files select
 *        on outside the stylesheets; without one every quoted token is read.
 * @returns The findings, in file order; empty when nothing merges.
 * @internal Called by `csszyx check`; not a stable shape.
 */
export function auditMerges(input: {
    model: ProjectStyleModel;
    classPrefix: string | null;
    files: readonly MergeAuditFile[];
    scanner?: ContentScanner | null;
}): MergeAuditFinding[] {
    // Every file first: a hook in the last one keeps a class in the first,
    // as the build reads every source before it merges.
    const sources = new SourceHookRegistry(() => input.scanner ?? null);
    const firstPasses = input.files.map(file => {
        const first = transformSource(file.source, file.path, { classPrefix: input.classPrefix });
        sources.readText(file.path, file.source, path.extname(file.path).slice(1));
        sources.readLowered(file.path, first.classes);
        return { file, first };
    });
    const model = input.model.withSourceHooks(sources.hooksFor(input.model));
    const signatureOf = (candidate: string): MergeSignature | null =>
        model.mergeSignature(candidate);
    return firstPasses.flatMap(({ file, first }) =>
        mergeFindingsOf(first, file.relative, signatureOf),
    );
}

/**
 * Every class a merge removes from one first pass, in line order.
 *
 * Shared by the audit and by the build, which reports what it removed at the
 * level `csszyx.config` sets for each id.
 *
 * @param first - A first pass, with its merge groups and overrides.
 * @param file - The name the findings carry.
 * @param signatureOf - The merge signature of a class, from the style model.
 * @returns One finding per removed class.
 * @internal Called by the bundler plugin and the audit; not a stable shape.
 */
export function mergeFindingsOf(
    first: Pick<SourceTransformResult, 'mergeGroups' | 'mergeOverrides'>,
    file: string,
    signatureOf: (candidate: string) => MergeSignature | null,
): MergeAuditFinding[] {
    const inFile: MergeAuditFinding[] = [];
    // The engine reports both lists on every first pass; one missing reads
    // as nothing to merge, which is what the build does with it.
    for (const group of first.mergeGroups ?? []) {
        for (const className of removedByMerge(group.classes, signatureOf)) {
            // A class is reported where its own key is written, not where
            // the object starts: in a multi-line object they differ.
            const at = group.classes.indexOf(className);
            inFile.push({
                file,
                line: group.positions[at].line,
                kind: 'merge-covered-key',
                className,
                key: group.keys[at],
            });
        }
    }
    for (const pair of first.mergeOverrides ?? []) {
        for (const className of removedByOverride(pair.base, pair.over, signatureOf)) {
            inFile.push({ file, line: pair.line, kind: 'merge-covered-class', className });
        }
    }
    return inFile.sort((left, right) => left.line - right.line);
}

/** What each rule says a class lost to. */
const REMOVAL_REASON: Record<MergeAuditKind, string> = {
    'merge-covered-key':
        'removed: a later key in the same `sz` object sets every property it sets.',
    'merge-covered-class':
        'removed from `className`: an `sz` class on the same element sets every property it sets.',
};

/**
 * What one finding says: the class, and for a key the key it was written as,
 * since that is what the author searches the source for.
 *
 * @param finding - One removed class.
 * @returns The message, without the file and line.
 */
export function mergeRemovalMessage(finding: MergeAuditFinding): string {
    const removed =
        finding.key === undefined
            ? `\`${finding.className}\``
            : `\`${finding.key}\` (\`${finding.className}\`)`;
    return `${removed} ${REMOVAL_REASON[finding.kind]}`;
}

/**
 * The one line a dev server prints at start for the classes a merge removed
 * at `info`: how many, which ids, how to list them, how to hide the line.
 *
 * @param held - How many classes each `info` id removed; at least one entry.
 * @param files - How many files they are in.
 * @returns The warning, `[csszyx]`-prefixed.
 */
export function mergeRemovalSummaryMessage(
    held: ReadonlyMap<MergeAuditKind, number>,
    files: number,
): string {
    const ids = MERGE_AUDIT_KINDS.filter(kind => held.has(kind));
    let classes = 0;
    for (const count of held.values()) classes += count;
    const rules = ids.map(kind => `--rule ${kind}`).join(' ');
    const named = ids.map(kind => `\`${kind}\``).join(' and ');
    return (
        `[csszyx] ${classes} class(es) in ${files} file(s) were removed: another class on the same element sets every property they set.\n` +
        `  help: \`csszyx check ${rules}\` lists them.\n` +
        `  note: set ${named} to \`'off'\` in \`diagnostics.rules\` of csszyx.config.ts to hide this line; \`build.mergeCoveredClasses: false\` keeps the classes.`
    );
}
