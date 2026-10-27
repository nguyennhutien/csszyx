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

import type { SourceTransformResult } from '@csszyx/compiler';
import { transformSourceUnrendered } from '@csszyx/compiler/internal';
import type { ContentScanner } from '@csszyx/tailwind-oracle';

import { diagnosticMessage } from './diagnostic-message.js';
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

/** What every finding carries, whichever merge removed the class. */
interface MergeAuditFindingBase {
    /** The file, as the caller named it. */
    file: string;
    /**
     * 1-based line of the `sz` key the class was written as, or of the
     * class-name attribute.
     */
    line: number;
    /** The class removed. */
    className: string;
}

/**
 * One class a merge removes, and where. A key merge always names the key,
 * which its line words; a class-name merge has none.
 */
export type MergeAuditFinding = MergeAuditFindingBase &
    (
        | {
              kind: 'merge-covered-key';
              /** The `sz` key the class was written as. */
              key: string;
          }
        | { kind: 'merge-covered-class'; key?: undefined }
    );

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
    sources.readTexts(
        input.files.map(file => ({
            file: file.path,
            text: file.source,
            extension: path.extname(file.path).slice(1),
        })),
    );
    const firstPasses = input.files.map(file => {
        const first = transformSourceUnrendered(file.source, {
            filename: file.path,
            classPrefix: input.classPrefix,
        });
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

/**
 * The line a build prints for one removed class, in the registry's words: the
 * class, for a key the key it was written as, and where.
 *
 * @param finding - One removed class.
 * @returns The warning, headed by its id and `file:line`.
 */
export function mergeRemovalLine(finding: MergeAuditFinding): string {
    const at = `${finding.file}:${finding.line}`;
    return finding.kind === 'merge-covered-key'
        ? diagnosticMessage(
              'merge-covered-key',
              { key: finding.key, className: finding.className },
              at,
          )
        : diagnosticMessage('merge-covered-class', { className: finding.className }, at);
}

/**
 * The one line a dev server prints at start for the classes a merge removed
 * at `info`: how many, which ids, how to list them, how to hide the line
 * (`merge-covered-held`).
 *
 * @param held - How many classes each `info` id removed; at least one entry.
 * @param files - How many files they are in.
 * @param configFile - The project's config file name, or the one it would
 *        create (`csszyxConfigFileNameFor`).
 * @returns The warning, `[csszyx]`-prefixed.
 */
export function mergeRemovalSummaryMessage(
    held: ReadonlyMap<MergeAuditKind, number>,
    files: number,
    configFile: string,
): string {
    let classes = 0;
    for (const count of held.values()) classes += count;
    return diagnosticMessage('merge-covered-held', {
        classes,
        files,
        kinds: MERGE_AUDIT_KINDS.filter(kind => held.has(kind)),
        configFile,
    });
}
