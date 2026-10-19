/**
 * The diagnostic template filler and terminal layout as they were before
 * templates were split into segments once: a global `replace` per field per
 * diagnostic, joiners rebuilt each time, and the body joined from an array.
 * Kept verbatim as the oracle `diagnostic-template-differential.test.ts`
 * holds the current renderer to; not used by any source.
 */
import { PLACEHOLDER } from '../../src/diagnostic-placeholder.js';
import type {
    SzDiagnosticSpec,
    SzDiagnosticTemplateText,
} from '../../src/diagnostic-registry.generated.js';
import type { SzDiagnosticComputed, SzDiagnosticTemplate } from '../../src/diagnostic-template.js';

type ArgValue = string | number | readonly string[];

function joinersOf(spec: SzDiagnosticTemplate): Readonly<Record<string, string>> {
    const joiners: Record<string, string> = {};
    for (const [name, arg] of Object.entries(spec.args)) {
        if (arg.joiner !== undefined) joiners[name] = arg.joiner;
    }
    return joiners;
}

function templateFor(
    text: SzDiagnosticTemplateText | undefined,
    form: ArgValue | undefined,
): string | undefined {
    if (text === undefined || typeof text === 'string') return text;
    return typeof form === 'string' ? text[form] : undefined;
}

function fill(
    template: string,
    args: Readonly<Record<string, ArgValue>>,
    joiners: Readonly<Record<string, string>>,
    computed: Readonly<Record<string, SzDiagnosticComputed>>,
): string {
    return template.replace(PLACEHOLDER, (_: string, name: string) => {
        const value = args[name];
        if (Array.isArray(value)) return value.join(joiners[name]);
        if (value !== undefined) return String(value);
        return computed[name]?.(args) ?? '';
    });
}

/** A diagnostic as the oracle reads it: its code, args and place. */
export interface LegacyDiagnostic {
    code: string;
    args: object;
    line?: number;
    column?: number;
}

/** The parts of one diagnostic, as they were filled. */
export interface LegacyParts {
    text: string;
    help?: string;
    note?: string;
    docs: string;
}

/**
 * Fill a code's templates for one diagnostic, as it was done.
 *
 * @param template - The code's entry.
 * @param diagnostic - Its code and args.
 * @param computed - The computed values.
 * @returns The parts.
 */
export function legacyFillSzDiagnosticTemplate(
    template: SzDiagnosticTemplate,
    diagnostic: LegacyDiagnostic,
    computed: Readonly<Record<string, SzDiagnosticComputed>>,
): LegacyParts {
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
        docs: `https://csszyx.com/e/${diagnostic.code}`,
    };
}

/**
 * A whole terminal message, as it was laid out.
 *
 * @param spec - The code's entry.
 * @param diagnostic - Its code, args and place.
 * @param file - The file as the reader sees it.
 * @param computed - The computed values.
 * @returns The message.
 */
export function legacyRenderSzDiagnostic(
    spec: SzDiagnosticSpec,
    diagnostic: LegacyDiagnostic,
    file: string,
    computed: Readonly<Record<string, SzDiagnosticComputed>>,
): string {
    let where: string;
    if (spec.position === 'file' || diagnostic.line === undefined) where = file;
    else {
        const place = `${diagnostic.line}:${diagnostic.column}`;
        where = file === '' ? place : `${file}:${place}`;
    }
    const header =
        where === '' ? `[csszyx] ${diagnostic.code}:` : `[csszyx] ${diagnostic.code}: ${where}`;
    const parts = legacyFillSzDiagnosticTemplate(spec, diagnostic, computed);
    const body = [
        parts.text,
        ...(parts.help === undefined ? [] : [`help: ${parts.help}`]),
        ...(parts.note === undefined ? [] : [`note: ${parts.note}`]),
    ].join('\n  ');
    return [header, body, `docs: ${parts.docs}`].join('\n  ');
}
