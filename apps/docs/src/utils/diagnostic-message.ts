/**
 * The "Message" part of a `/e/<code>` page: each form's words laid out as the
 * terminal prints them, each value the message fills in shown as `<name>`,
 * and, where a production bundle prints the args in place of the words, that
 * line and the values it leaves out.
 *
 * Everything comes from `src/data/diagnostics.json`: the registry's templates,
 * its placeholder grammar, a line per computed value, and the rows the
 * generator reads from the compiler's tables (`scripts/diagnostics/docs-lookups.mjs`).
 */

import { escapeHtml, withCode } from './diagnostic-html';
import type { DiagnosticArg, DiagnosticEntry, LookupRow, Shipped } from './diagnostic-page';

/** What the message part reads beside the entry. */
export interface MessageData {
    /** The placeholder grammar of the templates, as a `RegExp` source. */
    placeholder: string;
    /** Where each computed value comes from, by the name a template uses. */
    computed: Record<string, string>;
    /** The rows a production line needs to be read, by id. */
    lookups: Record<string, LookupRow[]>;
}

/** Where every code's page lives. */
const URL_BASE = 'https://csszyx.com/e/';

/** The parts of a message, in the order the terminal prints them. */
const FIELDS = ['text', 'help', 'note'] as const;

/**
 * The values a per-variant template is keyed by: the entry's forms, or the
 * values of the enum arg it varies by.
 *
 * @param entry - The id.
 * @returns The values; empty when the words are one template.
 */
function variantsOf(entry: DiagnosticEntry): string[] {
    if (entry.variesBy === undefined) return entry.forms ?? [];
    const type = entry.args?.[entry.variesBy]?.type;
    return Array.isArray(type) ? type.slice(1) : [];
}

/**
 * One field's template for one variant.
 *
 * @param entry - The id.
 * @param field - `text`, `help` or `note`.
 * @param variant - The variant, when the words vary.
 * @returns The template, when the variant has one.
 */
function templateOf(
    entry: DiagnosticEntry,
    field: (typeof FIELDS)[number],
    variant: string | undefined,
): string | undefined {
    const value = entry[field];
    if (typeof value !== 'object') return value;
    return variant === undefined ? undefined : value[variant];
}

/**
 * A template as HTML, each placeholder shown as `<name>`.
 *
 * @param template - The template.
 * @param placeholder - The placeholder grammar.
 * @returns The HTML.
 */
function shown(template: string, placeholder: RegExp): string {
    let html = '';
    let last = 0;
    for (const match of template.matchAll(placeholder)) {
        html += `${escapeHtml(template.slice(last, match.index))}<var>&lt;${escapeHtml(match[1])}&gt;</var>`;
        last = match.index + match[0].length;
    }
    return html + escapeHtml(template.slice(last));
}

/**
 * A template filled with a row's values.
 *
 * @param template - The template.
 * @param values - Args and computed values, by name.
 * @param placeholder - The placeholder grammar.
 * @returns The text, or `undefined` when the row lacks a value it names.
 */
function filled(
    template: string,
    values: Record<string, string>,
    placeholder: RegExp,
): string | undefined {
    let complete = true;
    const text = template.replace(placeholder, (_, name: string) => {
        if (values[name] === undefined) complete = false;
        return values[name] ?? '';
    });
    return complete ? text : undefined;
}

/**
 * How a production browser bundle reports one variant in place of its words.
 *
 * @param entry - The id.
 * @param variant - The variant, when the words vary.
 * @returns `prints` for a console line, `throws` for an error, or nothing.
 */
function compactVerb(entry: DiagnosticEntry, variant: string | undefined): string | undefined {
    const production = entry.surfaces.runtime?.production;
    if (production === true) return 'prints';
    if (Array.isArray(production) && variant !== undefined && production.includes(variant)) {
        return 'prints';
    }
    const error = entry.surfaces.error;
    if (error && error.production !== false && (error.host === 'browser' || error.host === 'both')) {
        return 'throws';
    }
    return undefined;
}

/**
 * One arg in the example production line: its name in angle brackets, as the
 * JSON value its type is written as.
 *
 * @param name - The arg.
 * @param arg - Its type.
 * @returns The JSON value text.
 */
function exampleValue(name: string, arg: DiagnosticArg): string {
    if (arg.type === 'number') return `<${name}>`;
    if (arg.type === 'string[]') return `["<${name}>"]`;
    return `"<${name}>"`;
}

/**
 * The line a production bundle prints for one variant, every value as `<name>`.
 *
 * @param entry - The id.
 * @param variant - The variant, when the words vary.
 * @returns The line, unescaped.
 */
function compactLine(entry: DiagnosticEntry, variant: string | undefined): string {
    const variantArg = entry.variesBy ?? 'form';
    const fields = Object.entries(entry.args ?? {}).map(
        ([name, arg]) =>
            `${JSON.stringify(name)}:${
                name === variantArg && variant !== undefined ? JSON.stringify(variant) : exampleValue(name, arg)
            }`,
    );
    return `[csszyx] ${entry.id}: {${fields.join(',')}} ${URL_BASE}${entry.id}`;
}

/**
 * The table of what the message says for each row a production line can name.
 *
 * @param entry - The id.
 * @param rows - The rows of this variant.
 * @param placeholder - The placeholder grammar.
 * @returns The HTML.
 */
function rowsTable(entry: DiagnosticEntry, rows: LookupRow[], placeholder: RegExp): string {
    const variantArg = entry.variesBy ?? 'form';
    const columns = [...new Set(rows.flatMap(row => Object.keys(row.args)))].filter(
        name => name !== variantArg,
    );
    const body = rows.map(row => {
        const values = { ...row.args, ...row.values };
        const said = (['help', 'note'] as const)
            .map(field => {
                const template = templateOf(entry, field, row.args[variantArg]);
                const text = template === undefined ? undefined : filled(template, values, placeholder);
                return text === undefined ? undefined : `${field}: ${withCode(escapeHtml(text))}`;
            })
            .find(Boolean);
        const cells = columns.map(name =>
            row.args[name] === undefined ? '' : `<code>${escapeHtml(row.args[name])}</code>`,
        );
        return `<tr>${[...cells, said ?? ''].map(cell => `<td>${cell}</td>`).join('')}</tr>`;
    });
    return [
        '<p>For each key the line can name, the message says:</p>',
        `<table><thead><tr>${columns.map(name => `<th><code>${escapeHtml(name)}</code></th>`).join('')}<th></th></tr></thead><tbody>${body.join('')}</tbody></table>`,
    ].join('\n');
}

/**
 * The "Message" part of a page, or nothing for an id whose words the registry
 * does not hold.
 *
 * @param entry - The id.
 * @param shipped - Which ADR 0031 behaviours to describe.
 * @param data - The placeholder grammar, the computed values and the rows.
 * @returns The HTML parts.
 */
export function messageParts(entry: DiagnosticEntry, shipped: Shipped, data: MessageData): string[] {
    if (entry.text === undefined) return [];
    const placeholder = new RegExp(data.placeholder, 'g');
    const variantArg = entry.variesBy ?? 'form';
    const variants = variantsOf(entry);
    const parts = ['<h2>Message</h2>', '<p>A name in angle brackets is a value the message fills in.</p>'];
    const used = new Set<string>();
    for (const variant of variants.length === 0 ? [undefined] : variants) {
        if (variant !== undefined) parts.push(`<h3><code>${escapeHtml(variant)}</code></h3>`);
        const lines = FIELDS.flatMap(field => {
            const template = templateOf(entry, field, variant);
            if (template === undefined) return [];
            for (const match of template.matchAll(placeholder)) used.add(match[1]);
            const html = shown(template, placeholder);
            if (field !== 'text') return [`  ${field}: ${html}`];
            return [shipped.codePrefix ? `[csszyx] ${escapeHtml(entry.id)}: ${html}` : html];
        });
        lines.push(`  docs: ${URL_BASE}${escapeHtml(entry.id)}`);
        parts.push(`<pre><code>${lines.join('\n')}</code></pre>`);
        const verb = compactVerb(entry, variant);
        if (!shipped.compactProduction || verb === undefined) continue;
        const rows = (data.lookups[entry.id] ?? []).filter(
            row => variant === undefined || row.args[variantArg] === variant,
        );
        if (rows.length > 0 && rows.every(row => row.engine)) {
            parts.push(
                '<p>Only the build reports this form, with its whole message; a browser bundle never prints it.</p>',
            );
            continue;
        }
        parts.push(
            `<p>A production browser bundle ${verb} this in place of it:</p>`,
            `<pre><code>${escapeHtml(compactLine(entry, variant))}</code></pre>`,
        );
        if (rows.length > 0) parts.push(rowsTable(entry, rows, placeholder));
    }
    const computed = [...used].filter(name => data.computed[name] !== undefined);
    if (computed.length > 0) {
        parts.push(
            '<p>These values are worked out from the args:</p>',
            `<ul>${computed
                .map(
                    name =>
                        `<li><code>&lt;${escapeHtml(name)}&gt;</code>: ${withCode(escapeHtml(data.computed[name]))}</li>`,
                )
                .join('')}</ul>`,
        );
    }
    return parts;
}
