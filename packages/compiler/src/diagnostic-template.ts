/**
 * Filling a diagnostic's templates, apart from the registry that holds them.
 *
 * The Node renderer (`diagnostic-render.ts`) looks a code's entry up in the
 * whole registry; a bundle that reports a handful of codes, such as the
 * editor extension, carries only those entries and fills them here, so it
 * never ships the registry.
 *
 * @module diagnostic-template
 */

import { PLACEHOLDER } from './diagnostic-placeholder.js';
import type {
    SzDiagnosticSpec,
    SzDiagnosticTemplateText,
} from './diagnostic-registry.generated.js';

/** A diagnostic to fill: the code its page is named by, and its args. */
export interface TemplatedDiagnostic {
    code: string;
    args: object;
}

/** What filling a code needs from its registry entry. */
export type SzDiagnosticTemplate = Pick<
    SzDiagnosticSpec,
    'args' | 'variesBy' | 'text' | 'help' | 'note'
>;

/** Where every code's page lives; the code is appended. */
export const SZ_DIAGNOSTIC_URL_BASE = 'https://csszyx.com/e/';

/** One arg value, as the wire carries it. */
type ArgValue = string | number | readonly string[];

/** A value computed from an issue's args, by a helper over shared data. */
export type SzDiagnosticComputed = (args: Readonly<Record<string, ArgValue>>) => string;

/**
 * How each list arg of an entry joins when its sentence names it.
 *
 * @param spec - The entry.
 * @returns The joiners, by arg.
 */
function joinersOf(spec: SzDiagnosticTemplate): Readonly<Record<string, string>> {
    const joiners: Record<string, string> = {};
    // The generator requires every id with a template to declare its args.
    for (const [name, arg] of Object.entries(
        spec.args as NonNullable<SzDiagnosticTemplate['args']>,
    )) {
        if (arg.joiner !== undefined) joiners[name] = arg.joiner;
    }
    return joiners;
}

/**
 * The template of one field for the issue's form.
 *
 * @param text - The field: one template, or one per form.
 * @param form - The issue's form, when its code has forms.
 * @returns The template, or `undefined` when the form has none.
 */
function templateFor(
    text: SzDiagnosticTemplateText | undefined,
    form: ArgValue | undefined,
): string | undefined {
    if (text === undefined || typeof text === 'string') return text;
    return typeof form === 'string' ? text[form] : undefined;
}

/**
 * Fill a template in one pass, so an arg that itself holds `{x}` is printed as
 * written and never expanded.
 *
 * @param template - The template.
 * @param args - The issue's args.
 * @param joiners - How each list arg joins.
 * @param computed - The helpers for computed values.
 * @returns The text.
 */
function fill(
    template: string,
    args: Readonly<Record<string, ArgValue>>,
    joiners: Readonly<Record<string, string>>,
    computed: Readonly<Record<string, SzDiagnosticComputed>>,
): string {
    // PLACEHOLDER is global, so `replace` fills every placeholder in one pass.
    return template.replace(PLACEHOLDER, (_: string, name: string) => {
        const value = args[name];
        // The generator requires every list arg to declare its joiner.
        if (Array.isArray(value)) return value.join(joiners[name]);
        if (value !== undefined) return String(value);
        return computed[name]?.(args) ?? '';
    });
}

/**
 * A diagnostic's parts, each bare: the sentence, the advice and the note
 * after their labels, and the code's page. Layout belongs to the sink: the
 * terminal indents and labels them, `csszyx check --json` and the MCP server
 * hand them over as fields.
 */
export interface SzDiagnosticParts {
    /** The main sentence. */
    text: string;
    /** What to do, as one clause; absent when the code has no advice. */
    help?: string;
    /** What happened to the output, as one clause; absent when there is none. */
    note?: string;
    /** The code's page: `https://csszyx.com/e/<code>`. */
    docs: string;
}

/**
 * Fill a code's templates for one diagnostic.
 *
 * @param template - The code's entry: its args and templates.
 * @param diagnostic - The diagnostic: the code its page is named by, and its args.
 * @param computed - The helpers for computed values.
 * @returns The parts; `help` and `note` only when the code has them.
 */
export function fillSzDiagnosticTemplate(
    template: SzDiagnosticTemplate,
    diagnostic: TemplatedDiagnostic,
    computed: Readonly<Record<string, SzDiagnosticComputed>>,
): SzDiagnosticParts {
    const args = diagnostic.args as Readonly<Record<string, ArgValue>>;
    const joiners = joinersOf(template);
    const variant = args[template.variesBy ?? 'form'];
    const part = (field: 'text' | 'help' | 'note'): string | undefined => {
        const text = templateFor(template[field], variant);
        return text === undefined ? undefined : fill(text, args, joiners, computed);
    };
    const help = part('help');
    const note = part('note');
    return {
        text: part('text') ?? '',
        ...(help === undefined ? {} : { help }),
        ...(note === undefined ? {} : { note }),
        docs: `${SZ_DIAGNOSTIC_URL_BASE}${diagnostic.code}`,
    };
}
