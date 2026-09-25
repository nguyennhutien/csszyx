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
import { transformSource } from '@csszyx/compiler';

import {
    type MergeSignature,
    mergeGroupsOf,
    mergeOverridesOf,
    removedByMerge,
    removedByOverride,
} from './merge-signature.js';
import type { ProjectStyleModel } from './project-style-model.js';

/** Which merge dropped a class. */
export type MergeAuditKind =
    /** A later key of a static `sz` object covered an earlier one. */
    | 'merge-covered-key'
    /** An `sz` class covered a static class-name class beside it. */
    | 'merge-covered-class';

/** The classes one file loses to one merge. */
export interface MergeAuditFinding {
    /** The file, as the caller named it. */
    file: string;
    kind: MergeAuditKind;
    /** The classes removed, in source order. */
    classes: string[];
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
 * What every file loses to a merge, one finding per file and rule.
 *
 * @param input - The project's model, the prefix it settled, and the files.
 * @param input.model - The opened style model.
 * @param input.classPrefix - The Tailwind prefix the stylesheets set, or null.
 * @param input.files - The source files.
 * @returns The findings, in file order; empty when nothing merges.
 * @internal Called by `csszyx check`; not a stable shape.
 */
export function auditMerges(input: {
    model: ProjectStyleModel;
    classPrefix: string | null;
    files: readonly MergeAuditFile[];
}): MergeAuditFinding[] {
    const signatureOf = (candidate: string): MergeSignature | null =>
        input.model.mergeSignature(candidate);
    const findings: MergeAuditFinding[] = [];
    for (const file of input.files) {
        const first = transformSource(file.source, file.path, { classPrefix: input.classPrefix });
        const keys = mergeGroupsOf(first).flatMap(group => removedByMerge(group, signatureOf));
        const classes = mergeOverridesOf(first).flatMap(pair =>
            removedByOverride(pair.base, pair.over, signatureOf),
        );
        if (keys.length > 0) {
            findings.push({ file: file.relative, kind: 'merge-covered-key', classes: keys });
        }
        if (classes.length > 0) {
            findings.push({ file: file.relative, kind: 'merge-covered-class', classes });
        }
    }
    return findings;
}
