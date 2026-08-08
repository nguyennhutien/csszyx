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
 * So this reports instead of blocking, and writes a baseline. The number is
 * meant to ratchet down; when it reaches something small enough to defend, the
 * check can be promoted to a gate. The repo already took this route for
 * mutation testing, for the same reason: a required check without a baseline
 * first is a check that gets disabled.
 *
 * @module
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const DOC_PATH = 'apps/docs/src/content/docs/docs/reference/warnings.mdx';
const BASELINE_PATH = 'scripts/undocumented-warnings-baseline.json';

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
 * Read the recorded count, or null when no baseline exists yet.
 *
 * @param repositoryRoot Absolute path to the repository root.
 * @returns The baseline count, or null.
 */
export function readBaseline(repositoryRoot) {
    try {
        return JSON.parse(readFileSync(path.join(repositoryRoot, BASELINE_PATH), 'utf8')).count;
    } catch {
        return null;
    }
}

/**
 * Report undocumented messages and compare against the baseline.
 *
 * @returns Process exit code. Always 0 — this reports, it does not gate.
 */
export function main() {
    const undocumented = findUndocumentedMessages(REPO_ROOT);
    const baseline = readBaseline(REPO_ROOT);

    console.log(`[undocumented-warnings] ${undocumented.length} message(s) not in ${DOC_PATH}`);
    if (baseline !== null) {
        const delta = undocumented.length - baseline;
        const direction = delta === 0 ? 'unchanged from' : delta < 0 ? 'down from' : 'UP from';
        console.log(`[undocumented-warnings] ${direction} the baseline of ${baseline}`);
        if (delta > 0) {
            console.log(
                '[undocumented-warnings] A new message was added without a reference entry. ' +
                    'This does not fail the build yet — document it, or re-record the baseline ' +
                    'if it is genuinely internal.',
            );
        }
    }

    const byPackage = new Map();
    for (const entry of undocumented) {
        const pkg = entry.file.split('/').slice(0, 2).join('/');
        byPackage.set(pkg, (byPackage.get(pkg) ?? 0) + 1);
    }
    console.log('');
    for (const [pkg, count] of [...byPackage].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(count).padStart(3)}  ${pkg}`);
    }

    if (process.argv.includes('--list')) {
        console.log('');
        for (const entry of undocumented) {
            console.log(`  ${entry.file}`);
            console.log(`    ${entry.message.slice(0, 150)}\n`);
        }
    }
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(main());
}
