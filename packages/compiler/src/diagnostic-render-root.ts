/**
 * The root's renderer: every word Node prints. The engine lane's renderer
 * (`diagnostic-render.ts`) carries the engine's words only; this one adds the
 * words of a check pass, a build or CLI line and a throw in Node, which the
 * build plugins and the CLI render through `@csszyx/compiler`.
 *
 * @module diagnostic-render-root
 */

import { SZ_NODE_DIAGNOSTIC_WORDS } from './diagnostic-node-words.generated.js';
import {
    type IdentifiedDiagnostic,
    type RenderableDiagnostic,
    szDiagnosticRenderer,
} from './diagnostic-render.js';
import type { SzDiagnosticComputed, SzDiagnosticParts } from './diagnostic-template.js';

/** The renderer over every word Node prints. */
const ROOT = szDiagnosticRenderer(SZ_NODE_DIAGNOSTIC_WORDS);

/**
 * Render a diagnostic's parts from its code's templates.
 *
 * @param diagnostic - The diagnostic.
 * @param computed - The helpers for computed values.
 * @returns The parts; `help` and `note` only when the code has them.
 * @internal Used by csszyx's own packages; not a stable API.
 */
export function renderSzDiagnosticParts(
    diagnostic: IdentifiedDiagnostic,
    computed: Readonly<Record<string, SzDiagnosticComputed>>,
): SzDiagnosticParts {
    return ROOT.parts(diagnostic, computed);
}

/**
 * The body of a diagnostic as a terminal prints it: its text, then `help:`
 * and `note:` lines.
 *
 * @param diagnostic - The diagnostic.
 * @param computed - The helpers for computed values.
 * @returns The body, its continuation lines indented by two spaces.
 * @internal Used by csszyx's own packages; not a stable API.
 */
export function renderSzDiagnosticBody(
    diagnostic: IdentifiedDiagnostic,
    computed: Readonly<Record<string, SzDiagnosticComputed>>,
): string {
    return ROOT.body(diagnostic, computed);
}

/**
 * A whole message: the header, the body and the link to the code's page.
 *
 * @param options - What to render.
 * @param options.diagnostic - The diagnostic, located.
 * @param options.file - The file it is in, as the reader should see it.
 * @param options.computed - The helpers for computed values.
 * @returns The message.
 * @internal Used by csszyx's own packages; not a stable API.
 */
export function renderSzDiagnostic(options: {
    diagnostic: RenderableDiagnostic;
    file: string;
    computed: Readonly<Record<string, SzDiagnosticComputed>>;
}): string {
    return ROOT.message(options);
}
