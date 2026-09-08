/**
 * Where a `csszyx check` pass sends what it found.
 *
 * The human report groups by file and explains itself, which is right for a
 * terminal and useless to a parser. A CI annotator, an editor problem-matcher
 * and a dashboard all want the same four things per finding — which rule, which
 * file, which line, what happened — so the passes emit both: prose for the
 * terminal, and a record for anything that has to act on it.
 *
 * `rule` is a stable id rather than the message text. Messages are rewritten
 * whenever they can be made clearer, and a consumer filtering on wording would
 * break every time one was.
 *
 * @module
 */
import { printHeader, printInfo, printSuccess, printWarn } from '../utils/terminal-ui.js';

/** Which pass produced a finding. */
export type CheckRule =
    | 'sz-diagnostic'
    | 'dead-class'
    | 'broken-opacity'
    | 'sibling-keyword'
    | 'theme-collision';

/** One machine-readable finding. */
export interface CheckFinding {
    /** Stable id of the pass that produced it. */
    rule: CheckRule;
    /** Project-relative file, when the finding has one. */
    file?: string;
    /** 1-based line, when the finding has one. */
    line?: number;
    /** What happened, in one sentence. */
    message: string;
}

/** The document `--json` writes. */
export interface CheckReport {
    /** Bumped when a consumer would have to change to keep reading this. */
    version: 1;
    findings: CheckFinding[];
}

/** Both output channels, so a pass writes once and does not know the mode. */
export interface Reporter {
    header(text: string): void;
    info(text: string): void;
    warn(text: string): void;
    success(text: string): void;
    /** Record a finding. Always collected, whatever the mode. */
    push(finding: CheckFinding): void;
    /** Everything recorded so far. */
    readonly findings: readonly CheckFinding[];
    /** Whether prose is being suppressed. */
    readonly quiet: boolean;
}

/**
 * Build a reporter for one run.
 *
 * @param json - True to suppress prose, so stdout holds one parseable document.
 * @returns The reporter.
 */
export function createReporter(json: boolean): Reporter {
    const findings: CheckFinding[] = [];
    const say = (print: (text: string) => void) => (text: string) => {
        if (!json) print(text);
    };
    return {
        header: say(printHeader),
        info: say(printInfo),
        warn: say(printWarn),
        success: say(printSuccess),
        push: finding => findings.push(finding),
        findings,
        quiet: json,
    };
}

/**
 * Render the JSON document for a finished run.
 *
 * @param reporter - The run's reporter.
 * @returns The document, ready to print.
 */
export function renderJsonReport(reporter: Reporter): string {
    const report: CheckReport = { version: 1, findings: [...reporter.findings] };
    return JSON.stringify(report, null, 2);
}
