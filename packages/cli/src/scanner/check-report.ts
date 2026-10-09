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
import type { SzDiagnosticLevel } from '@csszyx/types';
import {
    createDiagnosticPolicy,
    type DiagnosticPolicy,
    SZ_DIAGNOSTIC_PASS_IDS,
} from '@csszyx/unplugin/diagnostics';
import { printHeader, printInfo, printSuccess, printWarn } from '../utils/terminal-ui.js';

/**
 * Every pass that produces findings, by its stable id. The list is the
 * policy's, so a level can be set for exactly the passes that exist.
 */
export const CHECK_RULES = SZ_DIAGNOSTIC_PASS_IDS;

/** Which pass produced a finding. */
export type CheckRule = (typeof CHECK_RULES)[number];

/** One machine-readable finding. */
export interface CheckFinding {
    /** Stable id of the pass that produced it. */
    rule: CheckRule;
    /**
     * Stable id of what was found. For `sz-diagnostic` it is the compiler's
     * diagnostic kind, such as `unknown-key` or `class-precedence`; for every
     * other pass it repeats the rule.
     */
    kind: string;
    /** Project-relative file, when the finding has one. */
    file?: string;
    /** 1-based line, when the finding has one. */
    line?: number;
    /** What happened, in one sentence. */
    message: string;
    /** For an `unknown-key` finding, the known key it most likely misspells. */
    suggestion?: string;
    /**
     * How loudly the project reports it, from `csszyx.config`. Never `off`:
     * an `off` finding is not reported. The run fails on `error`, or on what
     * `--fail-on` names.
     */
    level: Exclude<SzDiagnosticLevel, 'off'>;
}

/** A finding as a pass records it, before its kind defaults to its rule and its level is read. */
export type FindingInput = Omit<CheckFinding, 'kind' | 'level'> &
    Partial<Pick<CheckFinding, 'kind'>>;

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
    /**
     * Record a finding at its level. Always collected, whatever the mode. A
     * finding with no kind is its rule; one the policy sets `off` is dropped.
     */
    push(finding: FindingInput): void;
    /** The level the project gives a finding; a pass prints nothing for `off`. */
    levelOf(finding: Pick<FindingInput, 'rule' | 'kind' | 'file'>): SzDiagnosticLevel;
    /** Everything recorded so far. */
    readonly findings: readonly CheckFinding[];
    /** Whether prose is being suppressed. */
    readonly quiet: boolean;
}

/**
 * Build a reporter for one run.
 *
 * @param json - True to suppress prose, so stdout holds one parseable document.
 * @param policy - The project's diagnostic policy; the defaults when omitted.
 * @returns The reporter.
 */
export function createReporter(
    json: boolean,
    policy: DiagnosticPolicy = createDiagnosticPolicy(),
): Reporter {
    const findings: CheckFinding[] = [];
    const levelOf: Reporter['levelOf'] = ({ rule, kind, file }) =>
        policy.levelOf({ rule, kind: kind ?? rule, file });
    const say = (print: (text: string) => void) => (text: string) => {
        if (!json) print(text);
    };
    return {
        header: say(printHeader),
        info: say(printInfo),
        warn: say(printWarn),
        success: say(printSuccess),
        push: finding => {
            const level = levelOf(finding);
            if (level === 'off') return;
            findings.push({ ...finding, kind: finding.kind ?? finding.rule, level });
        },
        levelOf,
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
