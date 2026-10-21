/**
 * The words of a build line or a throw, from the diagnostic registry: one
 * renderer for every Node site of the plugins, so a site passes its id and
 * args and never writes the sentence itself (ADR 0031). The compiler words
 * them for every Node package (`szDiagnosticMessage`, `szDiagnosticError`).
 *
 * @module diagnostic-message
 */

export {
    szDiagnosticError as diagnosticError,
    szDiagnosticMessage as diagnosticMessage,
} from '@csszyx/compiler';
