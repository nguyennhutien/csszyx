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
 * A template split at its placeholders once: text, then each placeholder's
 * name followed by the text after it — `[text, name, text, name, text]`.
 */
type Segments = readonly string[];

/** A field's segments: one list, or one per variant. */
type CompiledField = Segments | Readonly<Record<string, Segments>>;

/** An entry's fields split into segments, and its list joiners. */
interface CompiledTemplate {
    joiners: Readonly<Record<string, string>>;
    text?: CompiledField;
    help?: CompiledField;
    note?: CompiledField;
}

/**
 * Each entry compiled on its first use, by the entry object itself: the
 * registry's own, or a copy a bundle carries (the editor extension's).
 */
const COMPILED = new WeakMap<SzDiagnosticTemplate, CompiledTemplate>();

/**
 * Split a template at its placeholders.
 *
 * @param template - The template.
 * @returns Its segments.
 */
function segmentsOf(template: string): Segments {
    const segments: string[] = [];
    let last = 0;
    // PLACEHOLDER is global, so `matchAll` reads every placeholder in order.
    for (const match of template.matchAll(PLACEHOLDER)) {
        segments.push(template.slice(last, match.index), match[1] as string);
        last = match.index + match[0].length;
    }
    segments.push(template.slice(last));
    return segments;
}

/**
 * A field split into segments: one template, or one per variant.
 *
 * @param text - The field.
 * @returns Its segments, or `undefined` when the entry has no such field.
 */
function compileField(text: SzDiagnosticTemplateText | undefined): CompiledField | undefined {
    if (text === undefined) return undefined;
    if (typeof text === 'string') return segmentsOf(text);
    const byVariant: Record<string, Segments> = {};
    for (const [variant, template] of Object.entries(text))
        byVariant[variant] = segmentsOf(template);
    return byVariant;
}

/**
 * An entry compiled: its fields split, and how each list arg joins.
 *
 * @param spec - The entry.
 * @returns It compiled, once per entry.
 */
function compiledOf(spec: SzDiagnosticTemplate): CompiledTemplate {
    let compiled = COMPILED.get(spec);
    if (compiled === undefined) {
        const joiners: Record<string, string> = {};
        for (const [name, arg] of Object.entries(spec.args)) {
            if (arg.joiner !== undefined) joiners[name] = arg.joiner;
        }
        compiled = {
            joiners,
            text: compileField(spec.text),
            help: compileField(spec.help),
            note: compileField(spec.note),
        };
        COMPILED.set(spec, compiled);
    }
    return compiled;
}

/**
 * The segments of one field for the issue's form.
 *
 * @param field - The field: one list, or one per form.
 * @param form - The issue's form, when its code has forms.
 * @returns The segments, or `undefined` when the form has none.
 */
function segmentsFor(
    field: CompiledField | undefined,
    form: ArgValue | undefined,
): Segments | undefined {
    if (field === undefined || Array.isArray(field)) return field as Segments | undefined;
    return typeof form === 'string'
        ? (field as Readonly<Record<string, Segments>>)[form]
        : undefined;
}

/**
 * Fill a template's segments in one pass, so an arg that itself holds `{x}`
 * is printed as written and never expanded.
 *
 * @param segments - The template, split.
 * @param args - The issue's args.
 * @param joiners - How each list arg joins.
 * @param computed - The helpers for computed values.
 * @returns The text.
 */
function fill(
    segments: Segments,
    args: Readonly<Record<string, ArgValue>>,
    joiners: Readonly<Record<string, string>>,
    computed: Readonly<Record<string, SzDiagnosticComputed>>,
): string {
    let text = segments[0] as string;
    for (let index = 1; index < segments.length; index += 2) {
        const name = segments[index] as string;
        const value = args[name];
        // The generator requires every list arg to declare its joiner.
        if (Array.isArray(value)) text += value.join(joiners[name]);
        else if (value !== undefined) text += String(value);
        else text += computed[name]?.(args) ?? '';
        text += segments[index + 1] as string;
    }
    return text;
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
    const compiled = compiledOf(template);
    const variant = args[template.variesBy ?? 'form'];
    const part = (field: 'text' | 'help' | 'note'): string | undefined => {
        const segments = segmentsFor(compiled[field], variant);
        return segments === undefined
            ? undefined
            : fill(segments, args, compiled.joiners, computed);
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
