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
import {
    renderSzDiagnosticParts,
    SZ_DIAGNOSTIC_COMPUTED_VALUES,
    SZ_DIAGNOSTIC_URL_BASE,
    type SzDiagnosticId,
} from '@csszyx/compiler';
import type { SzDiagnosticLevel } from '@csszyx/types';
import {
    createDiagnosticPolicy,
    type DiagnosticPolicy,
    SZ_DIAGNOSTIC_PASS_IDS,
} from '@csszyx/unplugin/diagnostics';
import { colors, icons, printHeader, printInfo, printSuccess } from '../utils/terminal-ui.js';

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
    /** 1-based column in UTF-16 code units, when the finding has a site. */
    column?: number;
    /** What happened, in one sentence: the main sentence alone, with no layout. */
    message: string;
    /** What to do, as the clause after `help:`, when the finding has one. */
    help?: string;
    /** What happened to the output, after `note:`, when the finding has one. */
    note?: string;
    /**
     * For an `unknown-key` finding, the known key it most likely misspells.
     * The same value as `args.suggestion`, kept where version 1 put it.
     */
    suggestion?: string;
    /** The values its sentence names, by the registry's arg names. */
    args?: Readonly<Record<string, unknown>>;
    /** The page that explains the kind: `https://csszyx.com/e/<kind>`. */
    url?: string;
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

/** What a pass knows of one finding it words from the registry. */
export interface RegistryFindingInput {
    /** The pass that found it. */
    rule: CheckRule;
    /** The registry id; the finding's kind. */
    code: SzDiagnosticId;
    /** The values its sentence names, by the registry's arg names. */
    args: Readonly<Record<string, unknown>>;
    /** Project-relative file, when the finding has one. */
    file?: string;
    /** 1-based line, when the finding has one. */
    line?: number;
}

/**
 * A finding in the registry's words: the sentence, `help` and `note` of its
 * code, its args and the page that explains it, as an `sz-diagnostic`
 * finding carries them. A pass that wrote its own sentence printed words the
 * code's page did not have.
 *
 * @param input - The pass, the code, its args and where it is.
 * @returns The finding; its kind is the code.
 */
export function registryFinding(input: RegistryFindingInput): FindingInput {
    const { rule, code, args, file, line } = input;
    const { text, help, note } = renderSzDiagnosticParts(
        { code, args },
        SZ_DIAGNOSTIC_COMPUTED_VALUES,
    );
    return {
        rule,
        kind: code,
        ...(file === undefined ? {} : { file }),
        ...(line === undefined ? {} : { line }),
        // An absent part stays `undefined`, which the JSON leaves out.
        message: text,
        help,
        note,
        args,
        url: `${SZ_DIAGNOSTIC_URL_BASE}${code}`,
    };
}

/**
 * The `help:` and `note:` lines of a finding, as the text report prints them
 * under it.
 *
 * @param finding - The finding.
 * @param indent - What each line starts with.
 * @returns The lines; none for a part the finding does not have.
 */
export function partLines(finding: Pick<FindingInput, 'help' | 'note'>, indent: string): string[] {
    return [
        ...(finding.help === undefined ? [] : [`${indent}help: ${finding.help}`]),
        ...(finding.note === undefined ? [] : [`${indent}note: ${finding.note}`]),
    ];
}

/**
 * The finding for entries that set different prefixes. It can be left out by
 * id like a diagnostic kind, which skips the dead-class pass: that pass needs
 * one prefix to ask about.
 */
export const PREFIX_DISAGREEMENT = 'prefix-disagreement' as const;

/** Where the JSON Schema of the document `--json` writes is published. */
export const CHECK_REPORT_SCHEMA = 'https://csszyx.com/schemas/check-v2.json';

/**
 * The document `--json` writes.
 *
 * Version 2 split an `sz-diagnostic` finding's `message` into the main
 * sentence, `help` and `note`: in version 1 the message held the terminal's
 * `\n  help:` layout, and a consumer had to cut it apart by a rule written
 * nowhere.
 */
export interface CheckReport {
    /** The JSON Schema this document follows. */
    $schema: typeof CHECK_REPORT_SCHEMA;
    /** Bumped when a consumer would have to change to keep reading this. */
    version: 2;
    findings: CheckFinding[];
}

/** Both output channels, so a pass writes once and does not know the mode. */
export interface Reporter {
    header(text: string): void;
    info(text: string): void;
    warn(text: string): void;
    success(text: string): void;
    /**
     * A note about the run itself, not about a finding: a pass skipped, and
     * why. Printed like `info`; in `--json` it goes to stderr, since the
     * document has no place for it and dropping it hides why a gate passed.
     */
    runInfo(text: string): void;
    /**
     * A warning or a failure about the run itself, such as an id that selects
     * nothing. Printed like `warn`; in `--json` it goes to stderr, so a run
     * that fails or checks nothing still says why in the CI log.
     */
    runWarn(text: string): void;
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
 * Print a warning, with one mark per line.
 *
 * A leading newline is a blank line of its own, not one carrying the warning
 * glyph. A summary that starts with its own mark — `✖` when it fails the run,
 * `!` when it does not — is printed without the glyph in front of it.
 *
 * @param text - The warning, possibly starting with newlines and a mark.
 * @param line - Writes one line: `console.log`, or `console.error` for stderr.
 */
function printMarked(text: string, line: (text?: string) => void = console.log): void {
    const body = text.replace(/^\n+/, '');
    for (let blank = text.length - body.length; blank > 0; blank--) line();
    if (body.startsWith('\u2716')) line(colors.error(body));
    else if (body.startsWith('! ')) line(colors.warn(body));
    else line(colors.warn(`${icons.warn} ${body}`));
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
        warn: say(printMarked),
        success: say(printSuccess),
        runInfo: json ? text => console.error(colors.info(`${icons.info} ${text}`)) : printInfo,
        runWarn: json ? text => printMarked(text, console.error) : text => printMarked(text),
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
    const report: CheckReport = {
        $schema: CHECK_REPORT_SCHEMA,
        version: 2,
        findings: [...reporter.findings],
    };
    return JSON.stringify(report, null, 2);
}
