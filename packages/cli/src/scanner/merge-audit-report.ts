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

import { isCsszyxError } from '@csszyx/compiler/errors';
import { loadContentScanner } from '@csszyx/tailwind-oracle';
import type { SzDiagnosticLevel } from '@csszyx/types';
import { isAtLeastLevel } from '@csszyx/unplugin/diagnostics';
import {
    auditMerges,
    MERGE_AUDIT_KINDS,
    type MergeAuditKind,
    openStylesheetModel,
} from '@csszyx/unplugin/next-prebuild';

import {
    type FindingInput,
    PREFIX_DISAGREEMENT,
    partLines,
    type Reporter,
    registryFinding,
} from './check-report.js';

/** The rules this pass answers. */
export const MERGE_AUDIT_RULES: readonly MergeAuditKind[] = MERGE_AUDIT_KINDS;

export type { MergeAuditKind };

/**
 * One removal in the registry's words.
 *
 * @param finding - What the audit found.
 * @returns The finding to report; its kind is its rule.
 */
function removalFinding(finding: ReturnType<typeof auditMerges>[number]): FindingInput {
    const { kind, file, line, key, className } = finding;
    // `key` is absent for a `className` class, and the JSON leaves it out.
    return registryFinding({ rule: kind, code: kind, file, line, args: { key, className } });
}

/**
 * Why the audit could not open the project's stylesheets, as the rest of a
 * `Merge audit did not run:` line.
 *
 * @param error - What opening the stylesheets threw.
 * @returns The sentence that says why, and for a prefix disagreement the
 *          `help:` line of its `check` form.
 */
function notRunReason(error: unknown): string {
    if (isCsszyxError(error) && error.code === PREFIX_DISAGREEMENT) {
        // The thrown help names a build setting `check` does not take.
        const finding = registryFinding({
            rule: 'dead-class',
            code: PREFIX_DISAGREEMENT,
            args: { form: 'check', entries: error.args.entries as string[] },
        });
        return [lowerFirst(finding.message), ...partLines({ help: finding.help }, '  ')].join('\n');
    }
    // A registry message opens with its `[csszyx] <id>:` header; the
    // sentence that says why is the line after it.
    const sentence = String(error instanceof Error ? error.message : error)
        .replace(/^\[csszyx\] [a-z-]+:[^\n]*\n\s*/, '')
        .split('\n')[0] as string;
    // Only a registry sentence is lower-cased: another error's first word may
    // be a code such as `ENOENT`.
    return isCsszyxError(error) ? lowerFirst(sentence) : sentence;
}

/**
 * @param sentence - A sentence that follows a colon.
 * @returns It with a lower-case first letter.
 */
function lowerFirst(sentence: string): string {
    return sentence.charAt(0).toLowerCase() + sentence.slice(1);
}

/**
 * Report what the build removes, for the audit rules the run selected;
 * nothing when it selected none.
 *
 * An audit that was selected and could not open the project's stylesheets
 * fails the run, as the dead-class pass does: a gate on it would otherwise
 * stay green while it checks nothing. The build stops on the same
 * stylesheets, so the run is not failing on something a build accepts.
 *
 * @param out - Where findings go.
 * @param input - The run's root, files, selection and threshold.
 * @param input.cwd - Project root.
 * @param input.files - Absolute paths of the files the run scans.
 * @param input.selected - The audit rules this run answers.
 * @param input.failOn - The quietest level that fails the run.
 * @returns Whether the audit was selected and could not run.
 */
export async function reportMergeAudit(
    out: Reporter,
    input: {
        cwd: string;
        files: readonly string[];
        selected: readonly MergeAuditKind[];
        failOn: SzDiagnosticLevel;
    },
): Promise<boolean> {
    const { selected } = input;
    if (selected.length === 0) return false;
    let model: Awaited<ReturnType<typeof openStylesheetModel>>['model'];
    try {
        ({ model } = await openStylesheetModel({
            root: input.cwd,
            cacheDir: path.join(input.cwd, '.csszyx/cache'),
        }));
    } catch (error) {
        out.runWarn(`\u2716 Merge audit did not run: ${notRunReason(error)}`);
        return true;
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
    if (findings.length === 0) {
        out.success('No class is removed because another class covers it.');
        return false;
    }
    out.warn('\nClasses the build removes because an `sz` class on the same element covers them:');
    for (const finding of findings) {
        const reported = removalFinding(finding);
        out.push(reported);
        out.info(`  ${finding.file}:${finding.line}: ${reported.message}`);
    }
    // The audit cannot read the plugin's options, which live in the bundler
    // config, so it says what the switch does instead of guessing it.
    out.info('  note: a build with `build.mergeCoveredClasses: false` keeps these.');
    const levels = findings.map(finding => out.levelOf({ rule: finding.kind, file: finding.file }));
    // `!` while none fails the run, as each pass marks its summary; an
    // audit's findings are `info` unless a config raises them.
    const mark = levels.some(level => isAtLeastLevel(level, input.failOn)) ? '\u2716' : '!';
    out.warn(
        `\n${mark} ${findings.length} class(es) are removed because an \`sz\` class on the same element covers them.`,
    );
    return false;
}
