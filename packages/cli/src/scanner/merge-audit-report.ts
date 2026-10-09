/**
 * `csszyx check --rule merge-covered-key --rule merge-covered-class`: every
 * class a build drops because a later one on the same element covers it.
 *
 * An audit, not a problem to fix: an app upgrading to 0.18 reads it to find
 * the sites a merge changed. It runs when named, or when `csszyx.config`
 * reports it at `warn` or louder (the `atomic` preset does); its findings are
 * `info` under `recommended`, so they fail the run only where a config raises
 * them to `error`.
 *
 * @module
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadContentScanner } from '@csszyx/tailwind-oracle';
import {
    auditMerges,
    MERGE_AUDIT_KINDS,
    type MergeAuditKind,
    mergeRemovalMessage,
    openStylesheetModel,
} from '@csszyx/unplugin/next-prebuild';

import type { Reporter } from './check-report.js';

/** The rules this pass answers. */
export const MERGE_AUDIT_RULES: readonly MergeAuditKind[] = MERGE_AUDIT_KINDS;

export type { MergeAuditKind };

/**
 * Report what the build removes, for the audit rules the run selected;
 * nothing when it selected none.
 *
 * @param out - Where findings go.
 * @param input - The run's root, files and selection.
 * @param input.cwd - Project root.
 * @param input.files - Absolute paths of the files the run scans.
 * @param input.selected - The audit rules this run answers.
 */
export async function reportMergeAudit(
    out: Reporter,
    input: { cwd: string; files: readonly string[]; selected: readonly MergeAuditKind[] },
): Promise<void> {
    const { selected } = input;
    if (selected.length === 0) return;
    let model: Awaited<ReturnType<typeof openStylesheetModel>>['model'];
    try {
        ({ model } = await openStylesheetModel({
            root: input.cwd,
            cacheDir: path.join(input.cwd, '.csszyx/cache'),
        }));
    } catch (error) {
        const reason = String(error instanceof Error ? error.message : error).split('\n')[0];
        out.warn(`Merge audit skipped: ${reason}`);
        return;
    }
    const files = await Promise.all(
        input.files.map(async file => ({
            path: file,
            relative: path.relative(input.cwd, file).split(path.sep).join('/'),
            source: await readFile(file, 'utf8'),
        })),
    );
    const findings = auditMerges({
        model,
        classPrefix: model.facts?.prefix ?? null,
        files,
        scanner: loadContentScanner(input.cwd),
    }).filter(
        finding =>
            selected.includes(finding.kind) &&
            out.levelOf({ rule: finding.kind, file: finding.file }) !== 'off',
    );
    for (const finding of findings) {
        const message = mergeRemovalMessage(finding);
        out.info(`  ${finding.file}:${finding.line}: ${message}`);
        out.push({ rule: finding.kind, file: finding.file, line: finding.line, message });
    }
    if (findings.length === 0) out.success('No class is removed by a merge.');
    // The audit cannot read the plugin's options, which live in the bundler
    // config, so it says what the switch does instead of guessing it.
    else out.info('  note: a build with `build.mergeCoveredClasses: false` keeps these.');
}
