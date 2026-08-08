import { OxcNotImplementedError } from '@csszyx/compiler';

/**
 * Human-facing reason for an oxc→Babel fallback warning.
 *
 * An {@link OxcNotImplementedError}'s `message` prefixes the construct with the
 * function that refused it, which reads as internal noise in a build log. Print
 * only the construct description — the surrounding warning already explains
 * what a fallback means.
 *
 * @param error The failure thrown by the oxc lane.
 * @returns The construct description, or the raw error message for other errors.
 */
export function babelFallbackReason(error: unknown): string {
    if (error instanceof OxcNotImplementedError) {
        return error.detail;
    }
    return error instanceof Error ? error.message : String(error);
}
