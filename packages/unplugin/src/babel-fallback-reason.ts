import { OxcNotImplementedError } from '@csszyx/compiler';

/**
 * Human-facing reason for an oxc→Babel fallback warning.
 *
 * An {@link OxcNotImplementedError}'s `message` carries the internal Phase-D
 * slice label ("transformOxc: D2.1 not implemented yet — …") for the parity
 * harness; that planning shorthand leaked verbatim into build logs
 * (field-reported as baffling). Print only the construct description — the
 * surrounding warning already explains the fallback semantics.
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
