/**
 * The diagnostic policy: how loudly each kind of finding is reported.
 *
 * One module answers that for every consumer — `csszyx check`, the bundler
 * plugins, and the Next commands that hand it to the Turbopack loader — so a
 * level cannot be resolved twice and drift. It is pure: the config file is
 * loaded by `csszyx-config-file.ts`, and what a consumer does with a level
 * (print, count, fail) stays with the consumer.
 *
 * ## Resolution
 *
 * A finding is named by the pass that reported it (`rule`), the kind of
 * problem (`kind`, equal to `rule` for every pass but `sz-diagnostic` and the
 * dead-class pass's `prefix-disagreement`), and the project-relative file it
 * is in. Its level comes from three layers, the later winning:
 *
 * 1. the preset (`recommended` unless the config names `atomic`);
 * 2. `rules`;
 * 3. each `overrides[]` entry whose `files` globs match the file, in order.
 *
 * Within one layer, an entry for the kind beats an entry for its pass, so
 * `{ 'sz-diagnostic': 'warn', 'unknown-key': 'error' }` keeps unknown keys
 * failing. An id no preset knows resolves to `error`: a finding nobody has
 * classified yet must not pass a gate in silence.
 *
 * `allow` is a report filter only — the class or token is still emitted —
 * and is answered by {@link DiagnosticPolicy.allowsClass} and
 * {@link DiagnosticPolicy.allowsToken}, never by a level.
 *
 * ## For the next consumers
 *
 * - Bundler lanes route each diagnostic through {@link DiagnosticPolicy.levelOf}
 *   with `rule: 'sz-diagnostic'`, `kind: result.issues[i].code` and the file
 *   relative to the project root, and treat `off` as "drop", `info` as
 *   "counted / summarised", `warn` and `error` as "printed with file:line".
 *   A build never fails on a level. The plugin already loads the policy once
 *   per root (`loadProjectDiagnosticPolicy` in `unplugin.ts`); the place to
 *   apply it is `routeTransformDiagnostics` in `transform-diagnostics.ts`,
 *   which today classifies by text.
 * - The Turbopack loader and jest cannot import a TypeScript config; they read
 *   the policy `csszyx next prebuild`/`watch` resolved into
 *   `.csszyx/diagnostic-policy.json` with `readDiagnosticPolicyState`, which
 *   rebuilds it through {@link createDiagnosticPolicy} from
 *   {@link DiagnosticPolicy.toJSON}'s `config`.
 * - A build-time `dead-class` finding uses `rule: 'dead-class'`; the className
 *   vocabulary uses `custom-class` / `unknown-class`, both `off` under
 *   `recommended`.
 *
 * @module diagnostic-policy
 */
import { nearestName, SZ_DIAGNOSTIC_CODES } from '@csszyx/compiler';
import type {
    CsszyxFileConfig,
    SzDiagnosticLevel,
    SzDiagnosticOverride,
    SzDiagnosticPassId,
    SzDiagnosticPreset,
    SzDiagnosticRuleId,
    SzDiagnosticsConfig,
} from '@csszyx/types';
import { Minimatch } from 'minimatch';

/** Bumped when a reader of the policy state file would have to change. */
export const DIAGNOSTIC_POLICY_FORMAT = 1;

/** Every level, quietest first. */
export const SZ_DIAGNOSTIC_LEVELS: readonly SzDiagnosticLevel[] = ['off', 'info', 'warn', 'error'];

/** Every preset. */
export const SZ_DIAGNOSTIC_PRESETS: readonly SzDiagnosticPreset[] = ['recommended', 'atomic'];

/** The passes of `csszyx check`, in the order it runs them. */
export const SZ_DIAGNOSTIC_PASS_IDS: readonly SzDiagnosticPassId[] = [
    'sz-diagnostic',
    'dead-class',
    'broken-opacity',
    'sibling-keyword',
    'theme-collision',
    'merge-covered-key',
    'merge-covered-class',
];

/** Kinds a pass reports under an id other than its own. */
const EXTRA_KIND_IDS: readonly SzDiagnosticRuleId[] = [
    'prefix-disagreement',
    'custom-class',
    'unknown-class',
    'classname-expression-merge',
    'other',
];

/** Every id a level can be set for. */
export const SZ_DIAGNOSTIC_RULE_IDS: readonly SzDiagnosticRuleId[] = [
    ...SZ_DIAGNOSTIC_PASS_IDS,
    ...SZ_DIAGNOSTIC_CODES,
    ...EXTRA_KIND_IDS,
];

const KNOWN_IDS: ReadonlySet<string> = new Set(SZ_DIAGNOSTIC_RULE_IDS);

/**
 * Where `recommended` and `atomic` differ from `error`. Everything not listed
 * is `error` under both: that is the 0.17.2 verdict of `csszyx check`, which
 * failed on every finding it reported.
 */
const PRESET_EXCEPTIONS: Readonly<
    Record<string, readonly [recommended: SzDiagnosticLevel, atomic: SzDiagnosticLevel]>
> = {
    // A choice the author made, not a mistake: sz wins over a runtime
    // className, and two sz attributes merge in order.
    'class-precedence': ['info', 'warn'],
    'duplicate-sz': ['info', 'warn'],
    // What the build merged away; an audit, never a problem.
    'merge-covered-key': ['info', 'warn'],
    'merge-covered-class': ['info', 'warn'],
    // A runtime fallback whose classes were still collected.
    'fallback-nudge': ['info', 'warn'],
    // Every class is kept, so the output is only less merged than it could be.
    'merge-classifier-unavailable': ['warn', 'warn'],
    // Every class is still emitted.
    'mangle-vars-hoist-skipped': ['info', 'info'],
    // `ast-budget` is absent on purpose: a file over the budget is left
    // unchanged and contributes no class to the safelist, so its styles are
    // missing — an error, as in 0.17.2 and by ADR 0011's litmus.
    // The className vocabulary: opt-in, false positives withdrawn (ADR 0024).
    'custom-class': ['off', 'warn'],
    'unknown-class': ['off', 'warn'],
    'classname-expression-merge': ['off', 'info'],
};

/**
 * The level a preset gives an id.
 *
 * @param preset - The preset.
 * @param id - A rule or kind id.
 * @returns Its level.
 */
function presetLevel(preset: SzDiagnosticPreset, id: string): SzDiagnosticLevel {
    const exception = PRESET_EXCEPTIONS[id];
    if (exception === undefined) return 'error';
    return preset === 'recommended' ? exception[0] : exception[1];
}

/**
 * Whether a level is at least as loud as a threshold.
 *
 * @param level - The finding's level.
 * @param threshold - The quietest level that counts.
 * @returns True when `level` is `threshold` or louder.
 */
export function isAtLeastLevel(level: SzDiagnosticLevel, threshold: SzDiagnosticLevel): boolean {
    return SZ_DIAGNOSTIC_LEVELS.indexOf(level) >= SZ_DIAGNOSTIC_LEVELS.indexOf(threshold);
}

/** One finding, as the policy needs to name it. */
export interface DiagnosticSubject {
    /** The pass that reported it, such as `sz-diagnostic` or `dead-class`. */
    rule: string;
    /** The kind of problem; the rule itself when omitted. */
    kind?: string;
    /** The file, relative to the project root in forward-slash form. */
    file?: string;
}

/** A config as the policy keeps it: every field present, globs as arrays. */
export interface NormalizedDiagnosticsConfig {
    preset: SzDiagnosticPreset;
    rules: Partial<Record<SzDiagnosticRuleId, SzDiagnosticLevel>>;
    allow: { classes: string[]; tokens: string[] };
    overrides: Array<{
        files: string[];
        rules: Partial<Record<SzDiagnosticRuleId, SzDiagnosticLevel>>;
    }>;
}

/** What the state file holds. */
export interface DiagnosticPolicyState {
    format: typeof DIAGNOSTIC_POLICY_FORMAT;
    config: NormalizedDiagnosticsConfig;
}

/** The resolved policy for one project. */
export interface DiagnosticPolicy {
    /** The level of one finding. */
    levelOf(subject: DiagnosticSubject): SzDiagnosticLevel;
    /** Whether `allow.classes` names this emitted class. */
    allowsClass(name: string): boolean;
    /** Whether `allow.tokens` names this theme token. */
    allowsToken(name: string): boolean;
    /** The config the policy was built from, for the state file. */
    toJSON(): DiagnosticPolicyState;
}

/**
 * Fill the fields a config left out, so the policy never asks "is it set?".
 *
 * @param config - A config already checked by {@link readCsszyxFileConfig}.
 * @returns The same config with every field present.
 */
function normalize(config: SzDiagnosticsConfig = {}): NormalizedDiagnosticsConfig {
    return {
        preset: config.preset ?? 'recommended',
        rules: { ...config.rules },
        allow: {
            classes: [...(config.allow?.classes ?? [])],
            tokens: [...(config.allow?.tokens ?? [])],
        },
        overrides: (config.overrides ?? []).map(override => ({
            files: [override.files].flat(),
            rules: { ...override.rules },
        })),
    };
}

/**
 * The level one layer sets for a finding, if it sets one.
 *
 * @param rules - The layer's levels by id.
 * @param rule - The finding's pass.
 * @param kind - The finding's kind.
 * @returns The level, or undefined when the layer is silent on it.
 */
function layerLevel(
    rules: Partial<Record<string, SzDiagnosticLevel>>,
    rule: string,
    kind: string,
): SzDiagnosticLevel | undefined {
    return rules[kind] ?? rules[rule];
}

/**
 * Build the policy for a config.
 *
 * O(1) per {@link DiagnosticPolicy.levelOf} call plus one glob test per
 * override; matchers are compiled once here.
 *
 * @param config - The `diagnostics` section, already validated; omitted for the defaults.
 * @returns The policy.
 */
export function createDiagnosticPolicy(config?: SzDiagnosticsConfig): DiagnosticPolicy {
    const normalized = normalize(config);
    const overrides = normalized.overrides.map(override => ({
        matchers: override.files.map(glob => new Minimatch(glob, { dot: true })),
        rules: override.rules as Partial<Record<string, SzDiagnosticLevel>>,
    }));
    const rules = normalized.rules as Partial<Record<string, SzDiagnosticLevel>>;
    const classes = new Set(normalized.allow.classes);
    const tokens = new Set(normalized.allow.tokens);
    return {
        levelOf({ rule, kind = rule, file }) {
            let level = presetLevel(normalized.preset, kind);
            level = layerLevel(rules, rule, kind) ?? level;
            if (file === undefined) return level;
            for (const override of overrides) {
                if (!override.matchers.some(matcher => matcher.match(file))) continue;
                level = layerLevel(override.rules, rule, kind) ?? level;
            }
            return level;
        },
        allowsClass: name => classes.has(name),
        allowsToken: name => tokens.has(name),
        toJSON: () => ({ format: DIAGNOSTIC_POLICY_FORMAT, config: normalized }),
    };
}

/** One thing wrong with a config file. */
export interface DiagnosticConfigProblem {
    /** `error` fails `csszyx check`; `warning` is only printed. */
    severity: 'error' | 'warning';
    /** Where in the file, such as `diagnostics.rules`. */
    path: string;
    /** What is wrong, in one sentence. */
    message: string;
}

/** What {@link readCsszyxFileConfig} made of a file's default export. */
export interface ReadFileConfig {
    /** The usable part, with every problem entry dropped. */
    config: NormalizedDiagnosticsConfig;
    problems: DiagnosticConfigProblem[];
}

/** Keys of the `diagnostics` section. */
const DIAGNOSTICS_KEYS = new Set(['preset', 'rules', 'allow', 'overrides']);

/**
 * Names as code spans, joined.
 *
 * @param names - The names.
 * @param separator - What goes between two.
 * @returns For example `` `a`, `b` ``.
 */
function codeList(names: Iterable<string>, separator: string): string {
    return [...names].map(name => `\`${name}\``).join(separator);
}
/** Keys of `diagnostics.allow`. */
const ALLOW_KEYS = new Set(['classes', 'tokens']);

/**
 * Whether a value is a plain object, as a config section must be.
 *
 * @param value - Anything.
 * @returns True for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is a list of strings.
 *
 * @param value - Anything.
 * @returns True for an array whose every entry is a string.
 */
function isStringList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

/**
 * The known id a misspelt one most likely means.
 *
 * @param id - The id as written.
 * @returns ` — did you mean \`x\`?`, or an empty string.
 */
function didYouMean(id: string): string {
    const near = nearestName(
        id,
        SZ_DIAGNOSTIC_RULE_IDS.map(known => [known, known] as const),
        Math.max(1, Math.floor(id.length / 4)),
    );
    return near === null ? '' : ` — did you mean \`${near}\`?`;
}

/**
 * Keep the valid entries of a `rules` object, recording each invalid one.
 *
 * @param value - The `rules` value as written.
 * @param at - Its path, for the problems.
 * @param problems - Collector.
 * @returns The valid levels.
 */
function readRules(
    value: unknown,
    at: string,
    problems: DiagnosticConfigProblem[],
): Partial<Record<SzDiagnosticRuleId, SzDiagnosticLevel>> {
    const rules: Partial<Record<SzDiagnosticRuleId, SzDiagnosticLevel>> = {};
    if (value === undefined) return rules;
    if (!isRecord(value)) {
        problems.push({ severity: 'error', path: at, message: 'must be an object of id → level.' });
        return rules;
    }
    for (const [id, level] of Object.entries(value)) {
        if (!KNOWN_IDS.has(id)) {
            problems.push({
                severity: 'error',
                path: at,
                message: `\`${id}\` is not a rule id${didYouMean(id) || '.'}`,
            });
        } else if (!SZ_DIAGNOSTIC_LEVELS.includes(level as SzDiagnosticLevel)) {
            problems.push({
                severity: 'error',
                path: at,
                message: `\`${id}\` is set to ${JSON.stringify(level)}; a level is one of ${SZ_DIAGNOSTIC_LEVELS.join(', ')}.`,
            });
        } else {
            rules[id as SzDiagnosticRuleId] = level as SzDiagnosticLevel;
        }
    }
    return rules;
}

/**
 * Keep the valid part of `diagnostics.allow`.
 *
 * @param value - The `allow` value as written.
 * @param problems - Collector.
 * @returns The valid lists.
 */
function readAllow(
    value: unknown,
    problems: DiagnosticConfigProblem[],
): SzDiagnosticsConfig['allow'] {
    if (value === undefined) return {};
    if (!isRecord(value)) {
        problems.push({
            severity: 'error',
            path: 'diagnostics.allow',
            message: 'must be an object.',
        });
        return {};
    }
    const allow: NonNullable<SzDiagnosticsConfig['allow']> = {};
    for (const key of ['classes', 'tokens'] as const) {
        const list = value[key];
        if (list === undefined) continue;
        if (isStringList(list)) allow[key] = list;
        else {
            problems.push({
                severity: 'error',
                path: `diagnostics.allow.${key}`,
                message: 'must be a list of names.',
            });
        }
    }
    for (const key of Object.keys(value)) {
        if (ALLOW_KEYS.has(key)) continue;
        problems.push({
            severity: 'error',
            path: 'diagnostics.allow',
            message: `\`${key}\` is not read; \`allow\` takes \`classes\` and \`tokens\`.`,
        });
    }
    return allow;
}

/**
 * Keep the valid entries of `diagnostics.overrides`.
 *
 * @param value - The `overrides` value as written.
 * @param problems - Collector.
 * @returns The valid entries.
 */
function readOverrides(
    value: unknown,
    problems: DiagnosticConfigProblem[],
): SzDiagnosticOverride[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        problems.push({
            severity: 'error',
            path: 'diagnostics.overrides',
            message: 'must be a list of { files, rules }.',
        });
        return [];
    }
    const overrides: SzDiagnosticOverride[] = [];
    for (const [index, entry] of value.entries()) {
        const at = `diagnostics.overrides[${index}]`;
        if (!isRecord(entry)) {
            problems.push({ severity: 'error', path: at, message: 'must be { files, rules }.' });
            continue;
        }
        const files = entry.files;
        if (!(typeof files === 'string' || isStringList(files))) {
            problems.push({
                severity: 'error',
                path: `${at}.files`,
                message: 'must be a glob or a list of globs, relative to the project root.',
            });
            continue;
        }
        overrides.push({ files, rules: readRules(entry.rules, `${at}.rules`, problems) });
    }
    return overrides;
}

/**
 * Validate a config file's default export and keep what is usable.
 *
 * Unknown ids, levels and shapes are `error` problems: an id that matched
 * nothing would set nothing, and the finding it was meant for would keep its
 * default without a word. A top-level key other than `diagnostics` is a
 * `warning`: the file used to be scaffolded with plugin options that nothing
 * read, and a project still carrying them should not start failing `check`.
 *
 * @param value - The default export.
 * @returns The usable config and every problem, in the order written.
 */
export function readCsszyxFileConfig(value: unknown): ReadFileConfig {
    const problems: DiagnosticConfigProblem[] = [];
    if (value === undefined) return { config: normalize(), problems };
    if (!isRecord(value)) {
        problems.push({
            severity: 'error',
            path: 'default export',
            message: 'must be an object; write `export default defineConfig({ … })`.',
        });
        return { config: normalize(), problems };
    }
    for (const key of Object.keys(value)) {
        if (key === 'diagnostics') continue;
        problems.push({
            severity: 'warning',
            path: key,
            message: `\`${key}\` is not read from this file; plugin options belong in the bundler config.`,
        });
    }
    const section = (value as CsszyxFileConfig).diagnostics as unknown;
    if (section === undefined) return { config: normalize(), problems };
    if (!isRecord(section)) {
        problems.push({ severity: 'error', path: 'diagnostics', message: 'must be an object.' });
        return { config: normalize(), problems };
    }
    for (const key of Object.keys(section)) {
        if (DIAGNOSTICS_KEYS.has(key)) continue;
        problems.push({
            severity: 'error',
            path: 'diagnostics',
            message: `\`${key}\` is not read; \`diagnostics\` takes ${codeList(DIAGNOSTICS_KEYS, ', ')}.`,
        });
    }
    const config: SzDiagnosticsConfig = {};
    if (section.preset !== undefined) {
        if (SZ_DIAGNOSTIC_PRESETS.includes(section.preset as SzDiagnosticPreset)) {
            config.preset = section.preset as SzDiagnosticPreset;
        } else {
            problems.push({
                severity: 'error',
                path: 'diagnostics.preset',
                message: `${JSON.stringify(section.preset)} is not a preset; use ${codeList(SZ_DIAGNOSTIC_PRESETS, ' or ')}.`,
            });
        }
    }
    config.rules = readRules(section.rules, 'diagnostics.rules', problems);
    config.allow = readAllow(section.allow, problems);
    config.overrides = readOverrides(section.overrides, problems);
    return { config: normalize(config), problems };
}

/**
 * Render a config file's problems as one warning.
 *
 * @param file - The config file, as the user would name it.
 * @param problems - Its problems; at least one.
 * @returns The text, `[csszyx]`-prefixed.
 */
export function diagnosticConfigProblemsMessage(
    file: string,
    problems: readonly DiagnosticConfigProblem[],
): string {
    const lines = problems.map(problem => `  - ${problem.path}: ${problem.message}`);
    return (
        `[csszyx] ${file} has ${problems.length} problem(s):\n${lines.join('\n')}\n` +
        'Each one is ignored; the rest of the file applies.'
    );
}
