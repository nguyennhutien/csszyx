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
import {
    SZ_DIAGNOSTIC_REGISTRY,
    type SzDiagnosticSpec,
    type SzDiagnosticWords,
} from './diagnostic-registry.generated.js';
import {
    fillSzDiagnosticTemplate,
    layoutSzDiagnostic,
    type SzDiagnosticComputed,
    type SzDiagnosticParts,
    szDiagnosticBody,
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

/** One way to render: over the registry's entries, with a set of words. */
export interface SzDiagnosticRenderer {
    /** A diagnostic's parts, each bare. */
    parts(
        diagnostic: IdentifiedDiagnostic,
        computed: Readonly<Record<string, SzDiagnosticComputed>>,
    ): SzDiagnosticParts;
    /** Its body as a terminal prints it. */
    body(
        diagnostic: IdentifiedDiagnostic,
        computed: Readonly<Record<string, SzDiagnosticComputed>>,
    ): string;
    /** The whole message: the header, the body and the link to the code's page. */
    message(options: {
        diagnostic: RenderableDiagnostic;
        file: string;
        computed: Readonly<Record<string, SzDiagnosticComputed>>;
    }): string;
}

/**
 * A renderer over the registry's entries. The registry module carries the
 * engine's words only; a renderer for other ids is given theirs, so the
 * engine lane loads no words it never prints (`diagnostic-render-root.ts`
 * gives the root's renderer every word Node prints).
 *
 * @param words - More words, by id: an entry the registry has none for.
 * @returns The renderer.
 */
export function szDiagnosticRenderer(
    words: Readonly<Record<string, SzDiagnosticWords>> = {},
): SzDiagnosticRenderer {
    // Merged once, so the filler's per-entry cache keeps working.
    const specs = new Map(
        SZ_DIAGNOSTIC_REGISTRY.map(spec => {
            const more = words[spec.id];
            return [spec.id, more === undefined ? spec : { ...spec, ...more }];
        }),
    );
    const parts: SzDiagnosticRenderer['parts'] = (diagnostic, computed) => {
        const spec = specs.get(diagnostic.code) as SzDiagnosticSpec;
        // An id whose words live with another renderer would print an empty
        // line here; a caller that reaches this picked the wrong renderer.
        if (spec.text === undefined && spec.help === undefined && spec.note === undefined) {
            throw new Error(`this renderer has no words for \`${diagnostic.code}\``);
        }
        return fillSzDiagnosticTemplate(spec, diagnostic, computed);
    };
    return {
        parts,
        body: (diagnostic, computed) => szDiagnosticBody(parts(diagnostic, computed)),
        message: ({ diagnostic, file, computed }) =>
            layoutSzDiagnostic({
                code: diagnostic.code,
                parts: parts(diagnostic, computed),
                where: whereOf(diagnostic, file),
            }),
    };
}

/** The engine lane's renderer: the registry's own words, the engine's ids. */
const ENGINE = szDiagnosticRenderer();

/**
 * Render a diagnostic's parts from its code's templates. The engine lane's:
 * an id only another Node line reports throws here; the root's renderer
 * words it.
 *
 * @param diagnostic - The diagnostic.
 * @param computed - The helpers for computed values.
 * @returns The parts; `help` and `note` only when the code has them.
 */
export function renderSzDiagnosticParts(
    diagnostic: IdentifiedDiagnostic,
    computed: Readonly<Record<string, SzDiagnosticComputed>>,
): SzDiagnosticParts {
    return ENGINE.parts(diagnostic, computed);
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
    return ENGINE.body(diagnostic, computed);
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
    return ENGINE.message(options);
}
