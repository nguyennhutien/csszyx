/**
 * The one renderer of the engine's diagnostics (ADR 0031).
 *
 * The engine reports each diagnostic as a code, a byte offset and named args;
 * the sentence is the registry's template, filled here. A message reads:
 *
 * ```text
 * [csszyx] unknown-key: src/App.tsx:12:9
 *   Unknown property "workBreak" in sz prop. …
 *   help: …
 *   docs: https://csszyx.com/e/unknown-key
 * ```
 *
 * Node-only: the build, the CLI and the editor tooling print these. A browser
 * bundle never imports this module.
 *
 * @module diagnostic-render
 */

import type { SzDiagnosticCode } from './diagnostic-codes.generated.js';
import { PLACEHOLDER } from './diagnostic-placeholder.js';
import {
    SZ_DIAGNOSTIC_REGISTRY,
    type SzDiagnosticSpec,
    type SzDiagnosticTemplateText,
} from './diagnostic-registry.generated.js';

/** Every id's entry, by id. */
const SPECS: ReadonlyMap<string, SzDiagnosticSpec> = new Map(
    SZ_DIAGNOSTIC_REGISTRY.map(spec => [spec.id, spec]),
);

/**
 * The registry entry of a code the engine reported.
 *
 * @param code - The code.
 * @returns Its entry.
 */
function specOf(code: SzDiagnosticCode): SzDiagnosticSpec {
    return SPECS.get(code) as SzDiagnosticSpec;
}

/**
 * How each list arg of an entry joins when its sentence names it.
 *
 * @param spec - The entry.
 * @returns The joiners, by arg.
 */
function joinersOf(spec: SzDiagnosticSpec): Readonly<Record<string, string>> {
    const joiners: Record<string, string> = {};
    // The generator requires every engine id to declare its args.
    for (const [name, arg] of Object.entries(spec.args as NonNullable<SzDiagnosticSpec['args']>)) {
        if (arg.joiner !== undefined) joiners[name] = arg.joiner;
    }
    return joiners;
}

/** Where every code's page lives; the code is appended. */
export const SZ_DIAGNOSTIC_URL_BASE = 'https://csszyx.com/e/';

/** One arg value, as the wire carries it. */
type ArgValue = string | number | readonly string[];

/** A diagnostic to render: what it reports and what it names. */
export interface RenderableDiagnostic {
    code: SzDiagnosticCode;
    args: object;
    line?: number;
    column?: number;
}

/** A value computed from an issue's args, by a helper over shared data. */
export type SzDiagnosticComputed = (args: Readonly<Record<string, ArgValue>>) => string;

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
 * The body of a diagnostic: its text, then `help:` and `note:` lines.
 *
 * @param diagnostic - The diagnostic.
 * @param computed - The helpers for computed values.
 * @returns The body, its continuation lines indented by two spaces.
 */
export function renderSzDiagnosticBody(
    diagnostic: Pick<RenderableDiagnostic, 'code' | 'args'>,
    computed: Readonly<Record<string, SzDiagnosticComputed>>,
): string {
    const template = specOf(diagnostic.code);
    const args = diagnostic.args as Readonly<Record<string, ArgValue>>;
    const joiners = joinersOf(template);
    const variant = args[template.variesBy ?? 'form'];
    const part = (field: 'text' | 'help' | 'note'): string | undefined => {
        const text = templateFor(template[field], variant);
        return text === undefined ? undefined : fill(text, args, joiners, computed);
    };
    const help = part('help');
    const note = part('note');
    return [
        part('text') ?? '',
        ...(help === undefined ? [] : [`help: ${help}`]),
        ...(note === undefined ? [] : [`note: ${note}`]),
    ].join('\n  ');
}

/**
 * What a code's offset points at: a site in the file, the whole file, or no
 * place. A file-wide diagnostic reports offset 0, which is not a line 1.
 *
 * @param code - The code.
 * @returns Its position kind.
 */
export function szDiagnosticPositionOf(code: SzDiagnosticCode): SzDiagnosticSpec['position'] {
    return specOf(code).position;
}

/**
 * Where a diagnostic is, as its header names it.
 *
 * @param diagnostic - The diagnostic.
 * @param file - The file it is in, as the reader should see it.
 * @returns `file:line:column` for a site, the file alone for a file-wide one,
 *          and nothing for one about no place.
 */
function whereOf(diagnostic: RenderableDiagnostic, file: string): string {
    const position = szDiagnosticPositionOf(diagnostic.code);
    // An engine id points at a site or at its file; the generator refuses `none`.
    if (position === 'file' || diagnostic.line === undefined) return file;
    // With no file name, as a template lowered from a string has, the place alone.
    const place = `${diagnostic.line}:${diagnostic.column}`;
    return file === '' ? place : `${file}:${place}`;
}

/**
 * A whole message: the header, the body and the link to the code's page.
 *
 * @param options - What to render.
 * @param options.diagnostic - The diagnostic, located.
 * @param options.file - The file it is in, as the reader should see it.
 * @param options.computed - The helpers for computed values.
 * @returns The message.
 */
export function renderSzDiagnostic(options: {
    diagnostic: RenderableDiagnostic;
    file: string;
    computed: Readonly<Record<string, SzDiagnosticComputed>>;
}): string {
    const { diagnostic, file, computed } = options;
    const where = whereOf(diagnostic, file);
    const header =
        where === '' ? `[csszyx] ${diagnostic.code}:` : `[csszyx] ${diagnostic.code}: ${where}`;
    return [
        header,
        renderSzDiagnosticBody(diagnostic, computed),
        `docs: ${SZ_DIAGNOSTIC_URL_BASE}${diagnostic.code}`,
    ].join('\n  ');
}
