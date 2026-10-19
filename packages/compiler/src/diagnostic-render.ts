/**
 * The one renderer of the engine's diagnostics (ADR 0031).
 *
 * The engine reports each diagnostic as a code, a byte offset and named args;
 * the sentence is the registry's template, filled here. A sink that lays the
 * parts out itself reads `renderSzDiagnosticParts`; in a terminal a message
 * reads:
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

import type { SzDiagnosticId } from './diagnostic-codes.generated.js';
import { SZ_DIAGNOSTIC_REGISTRY, type SzDiagnosticSpec } from './diagnostic-registry.generated.js';
import {
    fillSzDiagnosticTemplate,
    type SzDiagnosticComputed,
    type SzDiagnosticParts,
} from './diagnostic-template.js';

export {
    SZ_DIAGNOSTIC_URL_BASE,
    type SzDiagnosticComputed,
    type SzDiagnosticParts,
} from './diagnostic-template.js';

/** Every id's entry, by id. */
const SPECS: ReadonlyMap<string, SzDiagnosticSpec> = new Map(
    SZ_DIAGNOSTIC_REGISTRY.map(spec => [spec.id, spec]),
);

/**
 * The registry entry of a live id.
 *
 * @param code - The id.
 * @returns Its entry.
 */
function specOf(code: SzDiagnosticId): SzDiagnosticSpec {
    return SPECS.get(code) as SzDiagnosticSpec;
}

/**
 * Whether a string is a live diagnostic id, on any surface.
 *
 * @param id - Any string, such as an id a user wrote.
 * @returns True for an id the registry lists as live.
 */
export function isSzDiagnosticId(id: string): id is SzDiagnosticId {
    return SPECS.has(id);
}

/** A diagnostic to render: what it reports and what it names. */
export interface RenderableDiagnostic {
    code: SzDiagnosticId;
    args: object;
    line?: number;
    column?: number;
}

/** Any live id with its args: what the template renderer reads. */
export interface IdentifiedDiagnostic {
    code: SzDiagnosticId;
    args: object;
}

/**
 * Render a diagnostic's parts from its code's templates.
 *
 * @param diagnostic - The diagnostic.
 * @param computed - The helpers for computed values.
 * @returns The parts; `help` and `note` only when the code has them.
 */
export function renderSzDiagnosticParts(
    diagnostic: IdentifiedDiagnostic,
    computed: Readonly<Record<string, SzDiagnosticComputed>>,
): SzDiagnosticParts {
    return fillSzDiagnosticTemplate(specOf(diagnostic.code), diagnostic, computed);
}

/**
 * The body of a diagnostic as a terminal prints it: its text, then `help:`
 * and `note:` lines.
 *
 * @param diagnostic - The diagnostic.
 * @param computed - The helpers for computed values.
 * @returns The body, its continuation lines indented by two spaces.
 */
export function renderSzDiagnosticBody(
    diagnostic: IdentifiedDiagnostic,
    computed: Readonly<Record<string, SzDiagnosticComputed>>,
): string {
    return terminalBody(renderSzDiagnosticParts(diagnostic, computed));
}

/**
 * The terminal layout of a body: the text, then each labelled part, two
 * spaces in.
 *
 * @param parts - The parts.
 * @returns The body.
 */
function terminalBody(parts: SzDiagnosticParts): string {
    const { text, help, note } = parts;
    return [
        text,
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
export function szDiagnosticPositionOf(code: SzDiagnosticId): SzDiagnosticSpec['position'] {
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
    const parts = renderSzDiagnosticParts(diagnostic, computed);
    return [header, terminalBody(parts), `docs: ${parts.docs}`].join('\n  ');
}
