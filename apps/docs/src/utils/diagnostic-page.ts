/**
 * The page every csszyx message links to: `https://csszyx.com/e/<code>`.
 *
 * Each page is written as one flat file, `e/<code>.html`, so the URL a message
 * prints answers 200 itself instead of redirecting to `e/<code>/`. The data is
 * `src/data/diagnostics.json`, generated from the registry; nothing here is
 * written by hand, so a page exists for every id by construction.
 *
 * Text from the registry is inserted as escaped text, never parsed as markup:
 * summaries and argument names can hold `<`, `{` and backticks.
 */

/** One argument of a diagnostic, as the registry declares it. */
export interface DiagnosticArg {
    type: string | string[];
    optional?: boolean;
    opaque?: boolean;
    joiner?: string;
}

/** One live id. */
export interface DiagnosticEntry {
    id: string;
    summary: string;
    surfaces: {
        engine?: Record<string, never>;
        check?: { group: string };
        runtime?: { production: boolean };
        error?: { classes?: string[] };
    };
    defaults?: { recommended: string; atomic: string };
    position: 'site' | 'file' | 'none';
    args?: Record<string, DiagnosticArg>;
    forms?: string[];
    gaps?: string[];
}

/** One id that no longer reports. */
export interface RemovedEntry {
    id: string;
    since: string;
    replacedBy?: string;
    was: string;
    reason: string;
}

/** The generated data file. */
export interface DiagnosticData {
    format: number;
    groups: Array<{ id: string; summary: string }>;
    diagnostics: DiagnosticEntry[];
    removed: RemovedEntry[];
}

/** What the messages already do, as opposed to what ADR 0031 has yet to land. */
export interface Shipped {
    /** Every message starts with `[csszyx] <code>:`. */
    codePrefix: boolean;
    /** A thrown csszyx error carries its id as `code`. */
    errorCode: boolean;
    /** A production browser bundle prints a record's args as JSON in place of the sentence. */
    compactProduction: boolean;
}

/**
 * The docs deploy from `main` as each change merges, so a page states a
 * behaviour only once the code doing it is there. The change that lands one
 * flips its flag.
 */
export const SHIPPED: Shipped = { codePrefix: false, errorCode: false, compactProduction: false };

/** How a page is rendered. */
export interface PageOptions {
    /** Ids the registry removed; a live id's page names the ones it replaced. */
    removed?: RemovedEntry[];
    /** Which ADR 0031 behaviours to describe; defaults to {@link SHIPPED}. */
    shipped?: Shipped;
}

/** Where every page links for the longer explanations. */
const WARNINGS_PAGE = '/docs/reference/warnings/';
/** The index of every code. */
const CODES_PAGE = '/docs/reference/codes/';

/**
 * Escape text for an HTML text node or a double-quoted attribute.
 *
 * @param text - Any text.
 * @returns The escaped text.
 */
export function escapeHtml(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

/**
 * One sentence per surface the id appears on, saying what reports it and
 * whether `csszyx.config` can set its level.
 *
 * @param entry - The id.
 * @param shipped - Which ADR 0031 behaviours to describe.
 * @returns The sentences, in surface order.
 */
export function surfaceSentences(entry: DiagnosticEntry, shipped: Shipped = SHIPPED): string[] {
    const out: string[] = [];
    if (entry.surfaces.engine) {
        out.push('The build reports it while it compiles a file, and `csszyx check` lists it.');
    }
    if (entry.surfaces.check) {
        out.push(`\`csszyx check\` reports it in its \`${entry.surfaces.check.group}\` pass.`);
    }
    if (entry.surfaces.runtime) {
        out.push(
            entry.surfaces.runtime.production
                ? 'It is printed to the console, by a production browser bundle too.'
                : 'It is printed to the console. A production browser bundle leaves it out.',
        );
    }
    if (entry.surfaces.error) {
        out.push(shipped.errorCode ? 'It is thrown as an error whose `code` is this id.' : 'It is thrown as an error.');
    }
    for (const gap of entry.gaps ?? []) {
        if (gap === 'engine') out.push('The build does not report it; only the runtime lane does.');
    }
    return out;
}

/**
 * Whether `csszyx.config` can set a level for the id.
 *
 * @param entry - The id.
 * @returns Whether it can.
 */
export function isSettable(entry: DiagnosticEntry): boolean {
    return Boolean(entry.surfaces.engine || entry.surfaces.check);
}

/**
 * The type of an argument as a reader writes it.
 *
 * @param arg - The argument.
 * @returns E.g. `string`, `string[]` or `'a' | 'b'`.
 */
export function argType(arg: DiagnosticArg): string {
    if (typeof arg.type === 'string') return arg.type;
    return arg.type
        .slice(1)
        .map(value => `'${value}'`)
        .join(' | ');
}

/**
 * Inline `code` spans written with backticks, the way the registry writes them.
 *
 * @param text - Escaped text.
 * @returns The text with each backtick span wrapped in `<code>`.
 */
function withCode(text: string): string {
    return text.replaceAll(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * A link.
 *
 * @param href - Where it goes, already safe in an attribute.
 * @param html - Its text, already HTML.
 * @returns The `<a>` element.
 */
function link(href: string, html: string): string {
    return `<a href="${href}">${html}</a>`;
}

/**
 * A standalone HTML page around a body.
 *
 * @param title - The page title, unescaped.
 * @param body - The body, already HTML.
 * @returns The page.
 */
function page(title: string, body: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — csszyx</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.55; }
body { max-width: 46rem; margin: 3rem auto; padding: 0 1.25rem; }
code { font-family: ui-monospace, monospace; font-size: 0.92em; }
h1 code { font-size: 1em; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 0.35rem 0.6rem; border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent); }
.banner { padding: 0.75rem 1rem; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius: 0.4rem; }
nav { margin-top: 2.5rem; font-size: 0.92em; }
</style>
</head>
<body>
${body}
<nav>${[link(CODES_PAGE, 'Every code'), link(WARNINGS_PAGE, 'Warnings &amp; troubleshooting'), link('/', 'csszyx')].join(' · ')}</nav>
</body>
</html>
`;
}

/**
 * The page of one live id.
 *
 * @param entry - The id.
 * @param options - Removed ids and which behaviours to describe.
 * @returns The page's HTML.
 */
export function renderDiagnosticPage(entry: DiagnosticEntry, options: PageOptions = {}): string {
    const { removed = [], shipped = SHIPPED } = options;
    const parts = [
        `<h1><code>${escapeHtml(entry.id)}</code></h1>`,
        `<p>${withCode(escapeHtml(entry.summary))}</p>`,
        `<ul>${surfaceSentences(entry, shipped)
            .map(sentence => `<li>${withCode(escapeHtml(sentence))}</li>`)
            .join('')}</ul>`,
    ];
    const formerly = removed.filter(old => old.replacedBy === entry.id);
    if (formerly.length > 0) {
        parts.push(
            `<p>Formerly ${formerly
                .map(old => `<code>${escapeHtml(old.id)}</code> (until ${escapeHtml(old.since)})`)
                .join(', ')}.</p>`,
        );
    }
    if (isSettable(entry)) {
        const defaults = entry.defaults ?? { recommended: 'error', atomic: 'error' };
        parts.push(
            '<h2>Level</h2>',
            `<p>Default: <code>${escapeHtml(defaults.recommended)}</code> under <code>recommended</code>, <code>${escapeHtml(defaults.atomic)}</code> under <code>atomic</code>. Set it in <code>csszyx.config</code>: <code>rules: { '${escapeHtml(entry.id)}': 'warn' }</code>.</p>`,
        );
        if (entry.surfaces.runtime || entry.surfaces.error) {
            parts.push(
                '<p>The level sets how the build and <code>csszyx check</code> report it. It does not change a console line, and it does not stop a thrown error.</p>',
            );
        }
    }
    const args = Object.entries(entry.args ?? {});
    if (args.length > 0) {
        parts.push(
            '<h2>Arguments</h2>',
            shipped.compactProduction && entry.surfaces.runtime?.production
                ? '<p>The values this diagnostic names. A production browser bundle prints them as JSON in place of the sentence.</p>'
                : '<p>The values this diagnostic names.</p>',
            `<table><thead><tr><th>Name</th><th>Type</th><th></th></tr></thead><tbody>${args
                .map(
                    ([name, arg]) =>
                        `<tr><td><code>${escapeHtml(name)}</code></td><td><code>${escapeHtml(argType(arg))}</code></td><td>${[
                            arg.optional ? 'optional' : '',
                            arg.opaque ? 'text from another tool; may change between its versions' : '',
                        ]
                            .filter(Boolean)
                            .join('; ')}</td></tr>`,
                )
                .join('')}</tbody></table>`,
        );
    }
    return page(entry.id, parts.join('\n'));
}

/**
 * The page of an id that no longer reports.
 *
 * @param entry - The removed id.
 * @returns The page's HTML.
 */
export function renderRemovedPage(entry: RemovedEntry): string {
    const replaced =
        entry.replacedBy === undefined
            ? ''
            : ` It is replaced by <a href="/e/${escapeHtml(entry.replacedBy)}"><code>${escapeHtml(entry.replacedBy)}</code></a>.`;
    return page(
        entry.id,
        [
            `<h1><code>${escapeHtml(entry.id)}</code></h1>`,
            `<p class="banner">Not reported since ${escapeHtml(entry.since)}.${replaced} A <code>csszyx.config</code> that names it still loads.</p>`,
            `<p>${withCode(escapeHtml(entry.reason))}</p>`,
        ].join('\n'),
    );
}

/**
 * The page for a code the site does not know.
 *
 * @returns The page's HTML.
 */
export function renderUnknownCodePage(): string {
    return page(
        'Unknown code',
        `<h1>Unknown code</h1>\n<p>No csszyx diagnostic has this code. ${link(CODES_PAGE, 'Every code')} is listed on one page.</p>`,
    );
}

/**
 * The ids that get a page: every live id, and every removed one whose id fits
 * the URL grammar (an old upper-case error code does not).
 *
 * @param data - The generated data.
 * @returns Page id and HTML pairs.
 */
export function diagnosticPages(data: DiagnosticData): Array<[id: string, html: string]> {
    const kebab = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
    return [
        ...data.diagnostics.map(
            (entry): [string, string] => [entry.id, renderDiagnosticPage(entry, { removed: data.removed })],
        ),
        ...data.removed
            .filter(entry => kebab.test(entry.id))
            .map((entry): [string, string] => [entry.id, renderRemovedPage(entry)]),
    ];
}
