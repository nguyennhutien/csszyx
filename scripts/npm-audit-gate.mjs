#!/usr/bin/env node
// `pnpm audit`, with the two ways it can fail told apart.
//
// The command exits non-zero both when the dependency tree has an advisory and
// when it could not reach the service that knows about advisories. Those are
// opposite facts wearing the same red tick: one says "this project has a known
// vulnerability", the other says "nothing was checked". On 2026-09-04 the
// second happened for hours — the registry answered a GET in 0.4s and hung on
// every POST to the advisory endpoint — and the job read, from the outside,
// exactly like the first.
//
// So the run is classified and the reason is written where it is visible
// without opening a log: the step summary, and the last line of output.
//
// It still FAILS when the service is unreachable, and pnpm's own
// `--ignore-registry-errors` is deliberately not used. That flag exits 0 on a
// registry error, which turns an outage into a green tick on a security gate —
// every pull request during the outage would report a clean audit that never
// ran. A red tick that says why is noisy; a green one that checked nothing is
// wrong.

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The audit command, as the workflow used to spell it inline. */
const AUDIT = ['audit', '--audit-level', 'high', '--ignore-unfixable'];

/**
 * pnpm's fetch layer giving up on the advisory endpoint.
 *
 * The retry warnings alone are not enough: a run that retried and then
 * succeeded prints them too, and its exit code comes from the report. The
 * abort line is what says no report was ever produced.
 */
const ABORTED =
    /^\[\d+] The operation was aborted|^\w*(?:Timeout|FetchError|ConnectTimeout)Error:/m;

/** A line only an advisory report prints. */
const REPORTED = /\bvulnerabilit(?:y|ies)\b|\bSeverity:/i;

/**
 * Which of the two failures a non-zero audit run was.
 *
 * Positive identification only: a shape this does not recognise is a finding,
 * because "could not check" must never be the quiet answer to "is this tree
 * safe". A run that reports advisories is a finding even if something else
 * also went wrong in it.
 *
 * @param {string} output - Everything the command printed.
 * @returns {'registry-unreachable' | 'findings'} The classification.
 */
export function classifyAuditFailure(output) {
    if (REPORTED.test(output)) return 'findings';
    return ABORTED.test(output) ? 'registry-unreachable' : 'findings';
}

/**
 * The line written to the job summary, so the Checks tab carries the reason.
 *
 * @param {'registry-unreachable' | 'findings'} classification - What happened.
 * @returns {string} Markdown for the step summary.
 */
export function summaryFor(classification) {
    return classification === 'registry-unreachable'
        ? '### npm audit: dependencies were **not audited**\n\n' +
              'The advisory service could not be reached, so this run checked nothing. ' +
              'It is not a report about this repository. Re-run once the service answers.\n'
        : '### npm audit: advisories found\n\nSee the job log for the affected packages.\n';
}

/**
 * Run the audit and exit with the reason attached.
 *
 * @returns {void}
 */
function main() {
    const result = spawnSync('pnpm', AUDIT, { encoding: 'utf8' });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    process.stdout.write(output);
    if (result.error !== undefined) throw result.error;
    if (result.status === 0) {
        console.log('npm audit: no advisory at or above `high` in the dependency tree.');
        return;
    }

    const classification = classifyAuditFailure(output);
    if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryFor(classification));
    }
    if (classification === 'registry-unreachable') {
        console.error(
            '\nnpm audit did NOT run: the advisory service could not be reached, so nothing ' +
                'about this dependency tree was checked. This is not a finding. Re-run the job ' +
                'once the service answers.',
        );
    } else {
        console.error('\nnpm audit found an advisory at or above `high`. See the report above.');
    }
    process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
