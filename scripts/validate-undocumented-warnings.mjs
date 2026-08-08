import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    extractDocumentedMessages,
    extractSourceLiterals,
    isFullyComposed,
    listSourceFiles,
    normalizeMessage,
} from './validate-warning-docs.mjs';

/**
 * The other direction of the warning reference check — messages nobody wrote
 * down.
 *
 * `validate-warning-docs.mjs` blocks merges on documented messages that source
 * no longer has. It cannot ask the reverse question, because a message the docs
 * never mentioned is not a defect the way a false quote is: some are genuinely
 * internal, and enforcing it from a standing start would fail every pull
 * request at once and simply get switched off.
 *
 * It started as a report with a baseline of seven, to be ratcheted down before
 * being enforced. The seven were documented in the same session, so the
 * baseline is zero and the check blocks: with nothing outstanding, allowing a
 * new undocumented message would just rebuild the backlog it cleared.
 *
 * The baseline file stays as the escape hatch. A message that is genuinely
 * internal can be recorded there instead of documented — deliberately, in a
 * diff someone reviews, rather than by the check quietly not noticing.
 *
 * @module
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const DOC_PATH = 'apps/docs/src/content/docs/docs/reference/warnings.mdx';
const BASELINE_PATH = 'scripts/undocumented-warnings-baseline.json';

/** Baseline shape when the file is missing, so a deleted file cannot pass. */
const EMPTY_BASELINE = { count: 0, messages: [] };

/**
 * Calls whose string arguments reach a developer as a message.
 *
 * Deliberately a list of SINKS, not of files: a message is identified by where
 * it goes, so a new warning in a package nobody thought of is still found. The
 * Rust engine pushes onto a diagnostics vector rather than printing.
 */
const SINK_PATTERN =
    /\b(?:console\.(?:warn|error)|devWarn|warnOnce|reportDiagnostic|diagnostics\.push|push_diagnostic)\s*\(/g;

/** Words a sink argument needs before it counts as a message worth documenting. */
const MIN_MESSAGE_WORDS = 8;

/**
 * Extract the source region of every warning-sink call in a file.
 *
 * Matching parentheses rather than reading to the end of the line: nearly every
 * message in this repo is a multi-line template or a concatenation, so a
 * line-based cut would capture only its first fragment.
 *
 * @param source Raw contents of one source file.
 * @returns The text inside each sink call's argument list.
 */
export function extractSinkCallRegions(source) {
    const text = String(source);
    const regions = [];
    for (const match of text.matchAll(SINK_PATTERN)) {
        let depth = 1;
        let i = match.index + match[0].length;
        const start = i;
        while (i < text.length && depth > 0) {
            if (text[i] === '(') depth++;
            else if (text[i] === ')') depth--;
            i++;
        }
        regions.push(text.slice(start, i - 1));
    }
    return regions;
}

/**
 * Collect the messages a file hands to a warning sink.
 *
 * @param source Raw contents of one source file.
 * @param rust Whether to lex the file with Rust's literal rules.
 * @returns Normalized message texts long enough to be worth documenting.
 */
export function extractSinkMessages(source, rust = false) {
    const messages = [];
    for (const region of extractSinkCallRegions(source)) {
        for (const literal of extractSourceLiterals(region, { rust })) {
            if (literal.split(' ').length >= MIN_MESSAGE_WORDS) {
                messages.push(literal);
            }
        }
    }
    return messages;
}

/**
 * Find sink messages the reference page does not describe.
 *
 * Reuses the gate's own comparison so both directions agree on what "the same
 * message" means — placeholders, line breaks and substituted values ignored.
 *
 * @param repositoryRoot Absolute path to the repository root.
 * @returns Undocumented messages with the file that declares each.
 */
export function findUndocumentedMessages(repositoryRoot) {
    const documented = extractDocumentedMessages(
        readFileSync(path.join(repositoryRoot, DOC_PATH), 'utf8'),
    ).map(entry => normalizeMessage(entry.text));
    const haystack = documented.join('\n');

    const undocumented = [];
    const seen = new Set();
    for (const file of listSourceFiles(repositoryRoot)) {
        const source = readFileSync(path.join(repositoryRoot, file), 'utf8');
        for (const message of extractSinkMessages(source, file.endsWith('.rs'))) {
            if (seen.has(message)) continue;
            seen.add(message);
            if (!isFullyComposed(message, haystack)) {
                undocumented.push({ file, message });
            }
        }
    }
    return undocumented;
}

/**
 * Read the recorded allowances.
 *
 * A missing or unreadable file reads as zero allowances rather than as "no
 * baseline": deleting it must not turn the gate off.
 *
 * @param repositoryRoot Absolute path to the repository root.
 * @returns The baseline record.
 */
export function readBaseline(repositoryRoot) {
    try {
        const parsed = JSON.parse(readFileSync(path.join(repositoryRoot, BASELINE_PATH), 'utf8'));
        return { count: parsed.count ?? 0, messages: parsed.messages ?? [] };
    } catch {
        return EMPTY_BASELINE;
    }
}

/**
 * Drop the messages the baseline records as knowingly undocumented.
 *
 * Matched on the message rather than the file so moving one between modules
 * does not silently re-allow it under a stale entry.
 *
 * @param undocumented Messages found in source.
 * @param baseline The baseline record.
 * @returns Messages that are neither documented nor allowed.
 */
export function subtractBaseline(undocumented, baseline) {
    const allowed = new Set(baseline.messages.map(entry => entry.message));
    return undocumented.filter(entry => !allowed.has(entry.message.slice(0, 120)));
}

/**
 * Fail when a warning message has no entry on the reference page.
 *
 * @returns Process exit code: 0 when every message is documented or allowed.
 */
export function main() {
    const baseline = readBaseline(REPO_ROOT);
    const offenders = subtractBaseline(findUndocumentedMessages(REPO_ROOT), baseline);

    if (offenders.length > 0) {
        console.error(
            `[undocumented-warnings] ${offenders.length} message(s) reach a developer with no ` +
                `entry in ${DOC_PATH}:\n`,
        );
        for (const entry of offenders) {
            console.error(`  ${entry.file}`);
            console.error(`    ${entry.message.slice(0, 150)}\n`);
        }
        console.error(
            'Add each to the reference page — the reader matching terminal output against it ' +
                'has no other way to find out what the message means. If one is genuinely ' +
                `internal, record it in ${BASELINE_PATH} instead, so the exemption is a diff ` +
                'someone reviews rather than a gap nobody sees.',
        );
        return 1;
    }

    const allowed = baseline.messages.length;
    console.log(
        `[undocumented-warnings] Every warning message is documented` +
            `${allowed > 0 ? ` (${allowed} allowed by baseline)` : ''}.`,
    );
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(main());
}
