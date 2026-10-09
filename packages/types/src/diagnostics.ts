/**
 * The `csszyx.config` file: what it holds, and the identity helper that types it.
 *
 * Plugin options live in each bundler's own config, so `csszyx check` and a
 * second bundler cannot read them. Diagnostic levels have to reach all of
 * them, so they live in one file every consumer loads:
 * `csszyx.config.{ts,mts,js,mjs}` at the project root.
 *
 * Only the shapes are here. The ids the policy accepts at runtime, the
 * presets and the precedence rules live in `@csszyx/unplugin`'s
 * `diagnostic-policy` module, the one place that resolves a level.
 *
 * @module diagnostics
 */
import type { SzDiagnosticCode } from '@csszyx/compiler';

/** How loudly one kind of finding is reported. */
export type SzDiagnosticLevel = 'off' | 'info' | 'warn' | 'error';

/**
 * A starting set of levels.
 *
 * `recommended` keeps `csszyx check`'s verdict as it was, with the notes that
 * report a choice rather than a mistake lowered to `info`. `atomic` reports
 * every site where csszyx changed what was written, for an app reviewing them.
 */
export type SzDiagnosticPreset = 'recommended' | 'atomic';

/**
 * A pass of `csszyx check`. Setting one sets every kind the pass reports;
 * `sz-diagnostic` covers every engine diagnostic.
 */
export type SzDiagnosticPassId =
    | 'sz-diagnostic'
    | 'dead-class'
    | 'broken-opacity'
    | 'sibling-keyword'
    | 'theme-collision'
    | 'merge-covered-key'
    | 'merge-covered-class';

/**
 * Every id a level can be set for: a pass, an engine diagnostic code, or a
 * finding a pass reports under its own kind.
 *
 * `other` is accepted so an existing config keeps loading; no diagnostic is
 * reported under it any more.
 */
export type SzDiagnosticRuleId =
    | SzDiagnosticPassId
    | SzDiagnosticCode
    | 'prefix-disagreement'
    | 'custom-class'
    | 'unknown-class'
    | 'classname-expression-merge'
    | 'other';

/** Levels by id. */
export type SzDiagnosticRules = Partial<Record<SzDiagnosticRuleId, SzDiagnosticLevel>>;

/** Levels for a set of files, applied after `rules`. */
export interface SzDiagnosticOverride {
    /** Globs, relative to the project root, in forward-slash form. */
    files: string | string[];
    /** Levels for the matching files. */
    rules: SzDiagnosticRules;
}

/** The `diagnostics` section of `csszyx.config`. */
export interface SzDiagnosticsConfig {
    /** Starting levels. Defaults to `recommended`. */
    preset?: SzDiagnosticPreset;
    /** Levels by id, applied over the preset. */
    rules?: SzDiagnosticRules;
    /**
     * Findings to leave out of every report. A filter on what is reported,
     * never a keep-list: an allowed class is still emitted as it was.
     */
    allow?: {
        /** Emitted classes that produce no CSS on purpose (`check --allow`). */
        classes?: string[];
        /** Theme tokens that shadow a utility on purpose (`check --allow-token`). */
        tokens?: string[];
    };
    /** Levels for some files, applied last, in order. */
    overrides?: SzDiagnosticOverride[];
}

/** What `csszyx.config.{ts,mts,js,mjs}` exports by default. */
export interface CsszyxFileConfig {
    /** How each kind of finding is reported, at build and by `csszyx check`. */
    diagnostics?: SzDiagnosticsConfig;
}

/**
 * Type a `csszyx.config` file. Returns its argument unchanged.
 *
 * @param config - The project's csszyx config.
 * @returns The same object.
 * @example
 * // csszyx.config.ts
 * import { defineConfig } from 'csszyx';
 * export default defineConfig({
 *     diagnostics: { rules: { 'class-precedence': 'error' } },
 * });
 */
export function defineConfig(config: CsszyxFileConfig): CsszyxFileConfig {
    return config;
}
