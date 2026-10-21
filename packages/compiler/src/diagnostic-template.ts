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

import type { SzDiagnosticId } from './diagnostic-codes.generated.js';
import { PLACEHOLDER } from './diagnostic-placeholder.js';
import type { SzDiagnosticTemplateText } from './diagnostic-registry.generated.js';

/** A diagnostic to fill: the code its page is named by, and its args. */
export interface TemplatedDiagnostic {
    code: string;
    args: object;
}

/**
 * What filling a code needs from its registry entry: how each list arg joins,
 * the arg a per-variant template is keyed by, and the templates. A registry
 * entry is one; so is each export of the browser module.
 */
export interface SzDiagnosticTemplate {
    /**
     * Every arg name in registry order, separated by one space, each one the
     * entry may leave out followed by `?`: `'form key replacement?'`. Names
     * are camelCase (the generator refuses any other), so neither mark can
     * be part of one.
     */
    readonly args: string;
    /** The separator each list arg is written with; absent when it has none. */
    readonly joiners?: Readonly<Record<string, string>>;
    /** The enum arg a per-variant template is keyed by, when it is not `form`. */
    readonly variesBy?: string;
    /** What the diagnostic says: one template, or one per variant. */
    readonly text?: SzDiagnosticTemplateText;
    /** What to do. */
    readonly help?: SzDiagnosticTemplateText;
    /** What does not happen, or still holds. */
    readonly note?: SzDiagnosticTemplateText;
}

/**
 * One id as the browser module carries it, for `szReport` to print.
 *
 * @template Args - The args a report of it passes, as the registry declares them.
 */
export interface SzBrowserDiagnostic<Args extends object = Readonly<Record<string, ArgValue>>>
    extends SzDiagnosticTemplate {
    /** The id the line is headed by. */
    readonly id: SzDiagnosticId;
    /** `error` when the line prints through `console.error`; absent, `console.warn`. */
    readonly console?: 'error';
    /** Never set: carries `Args` to the `szReport` call that names this id. */
    readonly argsType?: Args;
}

/** Where every code's page lives; the code is appended. */
export const SZ_DIAGNOSTIC_URL_BASE = 'https://csszyx.com/e/';

/** One arg value, as the wire carries it. */
export type ArgValue = string | number | readonly string[];

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
    /** The args the entry may not leave out. */
    required: readonly string[];
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
 * An entry's arg names in registry order, each optional one still marked `?`.
 *
 * @param spec - The entry.
 * @returns The names; none for an entry with no args (`args: ''`).
 */
export function argNamesOf(spec: Pick<SzDiagnosticTemplate, 'args'>): string[] {
    return spec.args === '' ? [] : spec.args.split(' ');
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
        compiled = {
            joiners: spec.joiners ?? {},
            required: argNamesOf(spec).filter(name => !name.endsWith('?')),
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
 * Refuse a diagnostic its templates cannot word: a required arg left out, or
 * a form the sentence has no text for. Filled anyway, either prints an empty
 * space where the value or the sentence belongs. The types refuse the same
 * calls at a site that names its id; this catches args built at run time,
 * such as an engine issue's.
 *
 * Reads what {@link compiledOf} kept, so a render allocates nothing for it.
 *
 * @param template - The code's entry.
 * @param required - Its required args, from its compiled form.
 * @param code - The code.
 * @param args - The issue's args.
 * @param variant - The form its templates are keyed by, when they have forms.
 */
function assertFillable(
    template: SzDiagnosticTemplate,
    required: readonly string[],
    code: string,
    args: Readonly<Record<string, ArgValue>>,
    variant: ArgValue | undefined,
): void {
    for (const name of required) {
        if (args[name] === undefined) {
            throw new Error(`[csszyx] \`${code}\` was reported without its \`${name}\` arg`);
        }
    }
    const { text } = template;
    if (typeof text === 'object' && (typeof variant !== 'string' || text[variant] === undefined)) {
        throw new Error(`[csszyx] \`${code}\` has no sentence for the form \`${String(variant)}\``);
    }
}

/**
 * Fill a code's templates for one diagnostic. Outside production it throws
 * on a diagnostic it cannot word ({@link assertFillable}); a production
 * build fills what it has, so a user is never stopped by a wording slip.
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
    if (process.env.NODE_ENV !== 'production') {
        assertFillable(template, compiled.required, diagnostic.code, args, variant);
    }
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

/**
 * The terminal layout of a body: the text, then each labelled part, two
 * spaces in.
 *
 * @param parts - The parts.
 * @returns The body.
 */
export function szDiagnosticBody(parts: SzDiagnosticParts): string {
    let body = parts.text;
    if (parts.help !== undefined) body += `\n  help: ${parts.help}`;
    if (parts.note !== undefined) body += `\n  note: ${parts.note}`;
    return body;
}

/**
 * A whole message as a console or a terminal prints it, the one layout the
 * build and the browser share. With a place, the header names it and the body
 * follows two spaces in, as the engine's messages read; an empty place leaves
 * the header bare. With none, as a browser line has, the sentence follows the
 * code on the first line. The link to the code's page comes last.
 *
 * @param options - What to lay out.
 * @param options.code - The code the line is headed by.
 * @param options.parts - The filled parts.
 * @param options.where - Where the diagnostic is, when it has a place.
 * @returns The message.
 */
export function layoutSzDiagnostic(options: {
    code: string;
    parts: SzDiagnosticParts;
    where?: string;
}): string {
    const { code, parts, where } = options;
    const tag = `[csszyx] ${code}:`;
    const body = szDiagnosticBody(parts);
    let head = `${tag} ${body}`;
    if (where === '') head = `${tag}\n  ${body}`;
    else if (where !== undefined) head = `${tag} ${where}\n  ${body}`;
    return `${head}\n  docs: ${parts.docs}`;
}
