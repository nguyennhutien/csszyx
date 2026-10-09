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

import { transformSource } from '@csszyx/compiler';
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
    const findings: MergeAuditFinding[] = [];
    for (const { file, first } of firstPasses) {
        const inFile: MergeAuditFinding[] = [];
        // The engine reports both lists on every first pass; one missing reads
        // as nothing to merge, which is what the build does with it.
        for (const group of first.mergeGroups ?? []) {
            for (const className of removedByMerge(group.classes, signatureOf)) {
                // A class is reported where its own key is written, not where
                // the object starts: in a multi-line object they differ.
                const at = group.classes.indexOf(className);
                inFile.push({
                    file: file.relative,
                    line: group.positions[at].line,
                    kind: 'merge-covered-key',
                    className,
                    key: group.keys[at],
                });
            }
        }
        for (const pair of first.mergeOverrides ?? []) {
            for (const className of removedByOverride(pair.base, pair.over, signatureOf)) {
                inFile.push({
                    file: file.relative,
                    line: pair.line,
                    kind: 'merge-covered-class',
                    className,
                });
            }
        }
        findings.push(...inFile.sort((left, right) => left.line - right.line));
    }
    return findings;
}
