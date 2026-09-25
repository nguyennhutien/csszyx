/**
 * `csszyx check --rule merge-covered-key --rule merge-covered-class`: every
 * class a build drops because a later one on the same element covers it.
 *
 * An audit, not a problem to fix: an app upgrading to 0.18 reads it to find
 * the sites a merge changed, so it runs only when named and never fails the
 * run.
 *
 * @module
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
    auditMerges,
    type MergeAuditKind,
    openStylesheetModel,
} from '@csszyx/unplugin/next-prebuild';

import type { Reporter } from './check-report.js';

/** The rules this pass answers; a run that does not name one skips it. */
const MERGE_AUDIT_RULES = ['merge-covered-key', 'merge-covered-class'] as const;

/** What each rule says a class lost to. */
const REASON: Record<MergeAuditKind, string> = {
    'merge-covered-key':
        'removed: a later key in the same `sz` object sets every property it sets.',
    'merge-covered-class':
        'removed from `className`: an `sz` class on the same element sets every property it sets.',
};

/**
 * Report what the build removes, for the audit rules the run named; nothing
 * when it named none.
 *
 * @param out - Where findings go.
 * @param input - The run's root, files and selection.
 * @param input.cwd - Project root.
 * @param input.files - Absolute paths of the files the run scans.
 * @param input.rules - The rules the run named, if any.
 */
export async function reportMergeAudit(
    out: Reporter,
    input: { cwd: string; files: readonly string[]; rules: readonly string[] | undefined },
): Promise<void> {
    const selected: readonly MergeAuditKind[] = MERGE_AUDIT_RULES.filter(rule =>
        input.rules?.includes(rule),
    );
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
    const findings = auditMerges({ model, classPrefix: model.facts?.prefix ?? null, files }).filter(
        finding => selected.includes(finding.kind),
    );
    for (const finding of findings) {
        for (const className of finding.classes) {
            const message = `\`${className}\` ${REASON[finding.kind]}`;
            out.info(`  ${finding.file}: ${message}`);
            out.push({ rule: finding.kind, file: finding.file, message });
        }
    }
    if (findings.length === 0) out.success('No class is removed by a merge.');
    // The audit cannot read the plugin's options, which live in the bundler
    // config, so it says what the switch does instead of guessing it.
    else out.info('  note: a build with `build.mergeCoveredClasses: false` keeps these.');
}
