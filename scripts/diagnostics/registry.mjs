/**
 * Every public diagnostic id csszyx produces, on every surface (ADR 0031).
 *
 * One entry per condition: a problem that the engine reports, a `csszyx check`
 * pass finds, the runtime prints or a call throws keeps ONE id, and `surfaces`
 * says where it shows. The generator reads this module and writes the Rust
 * enum (ids with `surfaces.engine` only), the TypeScript types, the per-code
 * browser exports, the Node registry and the docs data for `/e/<id>`.
 *
 * Ids are a one-way door: they reach `rules`, `check --json`, `err.code` and
 * the console of deployed apps. Renaming one is a breaking change, and the old
 * id moves to `REMOVED`, never out of this file.
 *
 * This is PR A data only: no template text yet. `sources` records where each
 * id is produced today, from the 2026-10-18 council inventories.
 *
 * @module
 */

/** Bumped when a consumer of this module would have to change. */
export const REGISTRY_FORMAT = 1;

/**
 * @typedef {'off' | 'info' | 'warn' | 'error'} Level
 */

/**
 * @typedef {object} Group
 * @property {string} id - A pass of `csszyx check`, as `--rule` and `rules` name it.
 * @property {string} summary - What the pass reports, in one sentence.
 */

/**
 * The type of one arg. `['enum', ...values]` is a closed set of strings.
 *
 * @typedef {'string' | 'number' | 'string[]' | readonly ['enum', ...string[]]} ArgType
 */

/**
 * @typedef {object} Arg
 * @property {ArgType} type - What the value is.
 * @property {true} [optional] - Absent when the condition has no value for it; the key is left out, never `null`.
 * @property {true} [opaque] - Third-party or nested text: not compared by the docs gate, never a dedupe key alone, unstable across versions.
 * @property {string} [joiner] - For `string[]`: the separator the rendered text uses.
 */

/**
 * @typedef {object} Surfaces
 * @property {{}} [engine] - The Rust engine emits it. Every engine id is also
 *   reported by `csszyx check` under the `sz-diagnostic` group; that is
 *   implied, not written as `check`.
 * @property {{ group: string }} [check] - A non-engine `csszyx check` pass reports it as a kind of this group.
 * @property {{ production: boolean }} [runtime] - Printed to the console: by the
 *   runtime, dynamic or compiler browser entries, or by a Node build/CLI.
 *   `production` is true when it prints in a production browser build today;
 *   it is always false for a Node-only line.
 * @property {{ classes?: string[] }} [error] - Thrown. `classes` names the csszyx
 *   error classes that carry it today; a bare `Error`/`TypeError` is not listed.
 */

/**
 * @typedef {object} Diagnostic
 * @property {string} id - Kebab-case, `[a-z][a-z0-9-]*`.
 * @property {string} summary - What the problem is, in one plain sentence.
 * @property {Surfaces} surfaces - Where it shows.
 * @property {{ recommended: Level, atomic: Level }} [defaults] - Only on ids with
 *   `engine` or `check`, and only when not `error` under both presets.
 * @property {'site' | 'file' | 'none'} position - What the record's `start` points at.
 * @property {Record<string, Arg>} args - Named, camelCase. Never a position.
 * @property {string[]} [forms] - Shapes of the sentence; `args.form` is then the enum of these.
 * @property {string[]} [gaps] - Surfaces the condition belongs to that do not report it.
 * @property {string[]} sources - Where it is produced today, `packages/<path>:<line>`.
 */

/**
 * @typedef {object} Removed
 * @property {string} id - The id as it shipped.
 * @property {string} since - The release that stopped producing it.
 * @property {string} [replacedBy] - The live id that reports the same condition.
 * @property {'check-kind' | 'rule-id' | 'error-code'} was - Where the string was public.
 * @property {string} reason - Why it went.
 */

// Shared arg shapes.
/** @type {Arg} */
const STRING = { type: 'string' };
/** @type {Arg} */
const NUMBER = { type: 'number' };
/** @type {Arg} */
const OPTIONAL_STRING = { type: 'string', optional: true };
/** @type {Arg} */
const OPTIONAL_NUMBER = { type: 'number', optional: true };
/** @type {Arg} */
const OPAQUE = { type: 'string', opaque: true };
/** @type {Arg} */
const OPTIONAL_OPAQUE = { type: 'string', optional: true, opaque: true };

/**
 * The enum arg that selects a form.
 *
 * @param {readonly string[]} forms - The forms, in the order `forms` lists them.
 * @returns {Arg} The `form` arg.
 */
function formArg(forms) {
    return { type: ['enum', ...forms] };
}

/** Expression kinds a runtime fallback reports (`SzFallbackKind`, sz-fallback-matrix.ts:26). */
const FALLBACK_SHAPES = /** @type {const} */ ([
    'call',
    'identifier',
    'import',
    'member',
    'other',
    'szv-factory',
    'variant',
]);

const ENGINE = 'packages/core/src/transform/engine.rs';
const CORE_TS = 'packages/compiler/src/transform-core.ts';
const SPLIT_BOX = 'packages/runtime/src/split-box.ts';
const VARIANTS = 'packages/runtime/src/variants.ts';
const HYDRATION = 'packages/runtime/src/hydration.ts';
const UNPLUGIN = 'packages/unplugin/src/unplugin.ts';
const POLICY = 'packages/unplugin/src/diagnostic-policy.ts';
const CONFIG_FILE = 'packages/unplugin/src/csszyx-config-file.ts';
const CHECK = 'packages/cli/src/commands/check.ts';
const NATIVE = 'packages/core/native/index.js';

/** Passes of `csszyx check` (group ids): setting one sets every kind it reports. */
export const GROUPS = [
    { id: 'sz-diagnostic', summary: 'Every diagnostic the engine reports while it lowers sz.' },
    { id: 'dead-class', summary: "Emitted classes this project's Tailwind generates no CSS for." },
    {
        id: 'broken-opacity',
        summary: 'Opacity modifiers on a colour whose theme value color-mix() cannot dim.',
    },
    {
        id: 'sibling-keyword',
        summary: 'Values that emit a class setting another property than their key sets.',
    },
    { id: 'theme-collision', summary: 'Theme tokens whose name a built-in utility also uses.' },
    {
        id: 'merge-covered-key',
        summary: 'sz keys the build removed because a later key in the same object covers them.',
    },
    {
        id: 'merge-covered-class',
        summary:
            'className classes the build removed because an sz class on the element covers them.',
    },
];

/** Every live id. */
export const DIAGNOSTICS = [
    // --- engine: the Rust engine reports these (current DIAGNOSTIC_CODES order) ---
    {
        id: 'unknown-key',
        summary: 'A key no sz table knows, likely a typo.',
        surfaces: { engine: {}, runtime: { production: false } },
        position: 'site',
        args: { key: STRING, suggestion: OPTIONAL_STRING },
        sources: [`${ENGINE}:1472`, `${CORE_TS}:4124`],
    },
    {
        id: 'canonical-key',
        summary: 'An alias of a key, with the canonical spelling to write.',
        surfaces: { engine: {}, runtime: { production: false } },
        position: 'site',
        args: { key: STRING, canonical: STRING },
        sources: [`${ENGINE}:1461`, `${CORE_TS}:4124`],
    },
    {
        id: 'removed-key',
        summary: 'A key that was removed or replaced, with what to write instead.',
        surfaces: { engine: {}, runtime: { production: true } },
        position: 'site',
        forms: ['runtime-alias', 'sugar-replaced', 'sugar', 'removed', 'replaced'],
        args: {
            form: formArg(['runtime-alias', 'sugar-replaced', 'sugar', 'removed', 'replaced']),
            key: STRING,
            // Derivable from the key, but carried anyway: a production console
            // prints args in place of the sentence, and the key alone does not
            // say what to write instead.
            replacement: { type: 'string', optional: true },
        },
        sources: [
            `${ENGINE}:1140`,
            `${ENGINE}:1423`,
            `${ENGINE}:1448`,
            `${ENGINE}:1457`,
            `${CORE_TS}:4124`,
            `${CORE_TS}:4732`,
            `${CORE_TS}:4748`,
        ],
    },
    {
        id: 'numeric-key',
        summary: 'A numeric key, the mark of an array or spread passed as an sz object.',
        surfaces: { engine: {}, runtime: { production: false } },
        position: 'site',
        args: { key: STRING },
        sources: [`${ENGINE}:1465`, `${CORE_TS}:4124`],
    },
    {
        id: 'closed-enum-value',
        summary: 'A value a closed-enum key does not take.',
        surfaces: { engine: {}, runtime: { production: false } },
        position: 'site',
        forms: ['sibling-group', 'dead', 'css-value', 'font-style', 'font-smoothing'],
        args: {
            form: formArg(['sibling-group', 'dead', 'css-value', 'font-style', 'font-smoothing']),
            key: STRING,
            value: STRING,
            suggestion: OPTIONAL_STRING,
        },
        sources: [
            `${ENGINE}:1521`,
            `${ENGINE}:1526`,
            `${CORE_TS}:1267`,
            `${CORE_TS}:3235`,
            `${CORE_TS}:3242`,
            `${CORE_TS}:3380`,
            `${CORE_TS}:3391`,
        ],
    },
    {
        id: 'slash-opacity-string',
        summary:
            'A colour key given its opacity in a string, which emits nothing; the object form takes it.',
        surfaces: { engine: {}, runtime: { production: true } },
        position: 'site',
        args: { key: STRING, value: STRING },
        sources: [`${ENGINE}:1549`, 'packages/compiler/src/color-validation.ts:70'],
    },
    {
        id: 'off-scale-value',
        summary: "A spacing value off Tailwind's quarter-step scale.",
        surfaces: { engine: {}, runtime: { production: false } },
        position: 'site',
        args: { key: STRING, value: STRING },
        sources: [`${ENGINE}:883`, `${CORE_TS}:1480`],
    },
    {
        id: 'numeric-font-weight',
        summary: 'A font weight written as a numeric string.',
        surfaces: { engine: {}, runtime: { production: false } },
        position: 'site',
        args: { value: STRING },
        sources: [`${ENGINE}:1399`, `${CORE_TS}:1600`],
    },
    {
        id: 'per-side-border-style',
        summary: 'A border style on one side, which Tailwind cannot express.',
        surfaces: { engine: {}, runtime: { production: false } },
        position: 'site',
        args: { key: STRING, value: STRING },
        sources: [`${ENGINE}:901`, `${CORE_TS}:1563`],
    },
    {
        id: 'property-object',
        summary: 'An object on a key that names a property, not a variant.',
        surfaces: { engine: {}, runtime: { production: false } },
        position: 'site',
        args: { key: STRING, nestedKeys: { type: 'string[]', joiner: ', ' } },
        sources: [`${ENGINE}:921`, `${CORE_TS}:4644`],
    },
    {
        id: 'non-variant-object',
        summary: 'An object on a csszyx-owned key that is not a variant.',
        surfaces: { engine: {}, runtime: { production: false } },
        position: 'site',
        args: { key: STRING },
        sources: [`${ENGINE}:1494`, `${CORE_TS}:4574`],
    },
    {
        id: 'unknown-field',
        summary: 'A field a structured value (a mask layer) does not take.',
        surfaces: { engine: {}, runtime: { production: false } },
        position: 'site',
        args: { owner: STRING, member: STRING },
        sources: [`${ENGINE}:941`, `${CORE_TS}:3803`],
    },
    {
        id: 'runtime-value',
        summary: 'A runtime value on a key with no CSS-variable utility.',
        surfaces: { engine: {} },
        position: 'site',
        args: { key: STRING },
        sources: [`${ENGINE}:807`],
    },
    {
        id: 'unresolvable-spread',
        summary: 'A spread in an sz object the build cannot resolve.',
        surfaces: { engine: {} },
        position: 'site',
        args: {},
        sources: [`${ENGINE}:733`],
    },
    {
        id: 'style-override',
        summary: 'A props spread that may override the style sz emits.',
        surfaces: { engine: {} },
        position: 'site',
        args: {},
        sources: [`${ENGINE}:759`],
    },
    {
        id: 'szs-slot-map',
        summary: 'An szs slot map the build cannot read, or one on a host element.',
        surfaces: { engine: {} },
        position: 'site',
        forms: ['host-element', 'unreadable-slot'],
        args: { form: formArg(['host-element', 'unreadable-slot']) },
        sources: [`${ENGINE}:577`],
    },
    {
        id: 'sz-recover',
        summary: 'An szRecover value the build cannot read.',
        surfaces: { engine: {} },
        position: 'site',
        forms: ['non-literal', 'unknown-mode'],
        args: { form: formArg(['non-literal', 'unknown-mode']), mode: OPTIONAL_STRING },
        sources: [`${ENGINE}:1698`],
    },
    {
        id: 'class-precedence',
        summary: 'A runtime className beside sz, which sz overrides.',
        surfaces: { engine: {} },
        // A choice the author made, not a mistake: sz wins over a runtime className.
        defaults: { recommended: 'info', atomic: 'warn' },
        position: 'site',
        args: {},
        sources: [`${ENGINE}:1649`],
    },
    {
        id: 'duplicate-sz',
        summary: 'An element with more than one sz attribute, merged in order.',
        surfaces: { engine: {} },
        // A choice the author made: two sz attributes merge in order.
        defaults: { recommended: 'info', atomic: 'warn' },
        position: 'site',
        args: { elementName: STRING, count: NUMBER },
        sources: [`${ENGINE}:1350`],
    },
    {
        id: 'spread-split-class',
        summary: 'Class names and sz on more than one side of a spread.',
        surfaces: { engine: {} },
        position: 'site',
        args: {
            elementName: STRING,
            earlier: { type: 'string[]', joiner: ' and ' },
            example: STRING,
        },
        sources: [`${ENGINE}:1325`],
    },
    {
        id: 'moved-value',
        summary: 'A value that moved to another key, with the key to write.',
        surfaces: { engine: {}, runtime: { production: true } },
        position: 'site',
        forms: ['value', 'mask-layer'],
        args: { form: formArg(['value', 'mask-layer']), key: STRING, value: STRING },
        sources: [`${ENGINE}:1183`, `${ENGINE}:1202`, `${CORE_TS}:3305`, `${CORE_TS}:3979`],
    },
    {
        id: 'global-before-group',
        summary: 'A stand-alone keyword written before a group key that replaces it.',
        surfaces: { engine: {}, runtime: { production: true } },
        position: 'site',
        args: { global: STRING, value: STRING, group: STRING },
        sources: [`${ENGINE}:1159`, `${CORE_TS}:3335`],
    },
    {
        id: 'runtime-family-conflict',
        summary: 'A runtime value beside the other side of its key family.',
        surfaces: { engine: {} },
        position: 'site',
        forms: ['key-first', 'other-first'],
        args: { form: formArg(['key-first', 'other-first']), key: STRING, other: STRING },
        sources: [`${ENGINE}:1301`],
    },
    {
        id: 'fallback-missing-css',
        summary: 'A runtime fallback whose classes were never collected.',
        surfaces: { engine: {} },
        position: 'site',
        args: {
            site: { type: ['enum', 'sz', 'szr', 'szv', 'sz-variant-key'] },
            shape: { type: ['enum', ...FALLBACK_SHAPES], optional: true },
            detail: OPTIONAL_STRING,
            path: OPTIONAL_STRING,
            keyPath: OPTIONAL_STRING,
        },
        sources: [`${ENGINE}:637`, `${ENGINE}:672`, `${ENGINE}:719`],
    },
    {
        id: 'fallback-nudge',
        summary: 'A runtime fallback whose classes were still collected.',
        surfaces: { engine: {} },
        // The classes were collected, so nothing is missing from the CSS.
        defaults: { recommended: 'info', atomic: 'warn' },
        position: 'site',
        args: {
            site: { type: ['enum', 'sz', 'sz-array-element'] },
            shape: { type: ['enum', ...FALLBACK_SHAPES], optional: true },
            detail: OPTIONAL_STRING,
            path: OPTIONAL_STRING,
        },
        sources: [`${ENGINE}:721`, `${ENGINE}:1671`],
    },
    {
        id: 'merge-classifier-unavailable',
        summary: 'A merge table this engine cannot read, so nothing merged.',
        surfaces: { engine: {} },
        // Every class is kept, so the output is only less merged than it could be.
        defaults: { recommended: 'warn', atomic: 'warn' },
        position: 'file',
        forms: ['unreadable', 'format-mismatch'],
        args: {
            form: formArg(['unreadable', 'format-mismatch']),
            error: OPTIONAL_OPAQUE,
            tableFormat: OPTIONAL_NUMBER,
        },
        sources: [`${ENGINE}:155`],
    },
    {
        id: 'parse-error',
        summary: 'A file the parser rejected, which contributes no classes.',
        surfaces: {
            engine: {},
            runtime: { production: false },
            error: { classes: ['ExplainParseError'] },
        },
        position: 'site',
        forms: ['syntax', 'summary', 'panicked', 'expression', 'prescan'],
        args: {
            form: formArg(['syntax', 'summary', 'panicked', 'expression', 'prescan']),
            message: OPTIONAL_OPAQUE,
            errorCount: OPTIONAL_NUMBER,
        },
        sources: [
            'packages/core/src/transform/parser.rs:186',
            'packages/core/src/transform/parser.rs:198',
            `${ENGINE}:372`,
            'packages/compiler/src/template-sz.ts:229',
            'packages/cli/src/commands/explain.ts:81',
            `${UNPLUGIN}:4797`,
        ],
    },
    {
        id: 'nesting-depth',
        summary: 'A file nested deeper than the parser guard allows.',
        surfaces: { engine: {} },
        position: 'file',
        args: { depth: NUMBER },
        sources: [`${ENGINE}:173`],
    },
    {
        id: 'unsupported-dynamic-sz',
        summary: 'An sz attribute whose value the engine cannot read.',
        surfaces: { engine: {} },
        position: 'site',
        args: {},
        sources: [`${ENGINE}:563`],
    },
    {
        id: 'ast-budget',
        summary: 'A file over the AST budget, left unchanged.',
        surfaces: { engine: {}, runtime: { production: false } },
        // No `defaults` on purpose: a file over the budget contributes no class
        // to the safelist, so its styles are missing — an error, as in 0.17.2
        // and by ADR 0011's litmus.
        position: 'file',
        forms: ['transform', 'prescan'],
        args: { form: formArg(['transform', 'prescan']) },
        sources: [`${ENGINE}:350`, `${UNPLUGIN}:1204`],
    },
    {
        id: 'mangle-vars-hoist-skipped',
        summary: 'A CSS variable mangleVars could not hoist to a component.',
        surfaces: { engine: {} },
        // Every class is still emitted.
        defaults: { recommended: 'info', atomic: 'info' },
        position: 'site',
        args: {
            name: STRING,
            usageCount: NUMBER,
            reason: { type: ['enum', 'no-lca', 'non-host-ancestor', 'max-depth'] },
            maxDepth: OPTIONAL_NUMBER,
        },
        sources: ['packages/core/src/transform/css_var_planner.rs:332'],
    },
    {
        id: 'color-slash-opacity',
        summary: 'A colour object with a slash opacity in `color`; the object takes it in `op`.',
        surfaces: { engine: {}, runtime: { production: false } },
        position: 'site',
        args: { key: STRING, color: STRING, op: OPTIONAL_STRING },
        sources: [`${ENGINE}:1579`, `${CORE_TS}:2794`],
    },

    // --- check: kinds a non-engine `csszyx check` pass reports ---
    {
        id: 'unsigned-value',
        summary: 'A negative value on a key Tailwind serves no negative utility for.',
        surfaces: { check: { group: 'dead-class' } },
        position: 'file',
        args: { className: STRING },
        sources: [`${CHECK}:565`],
    },
    {
        id: 'dead-class',
        summary: "An emitted class this project's Tailwind generates no CSS for.",
        surfaces: { check: { group: 'dead-class' } },
        position: 'file',
        args: { className: STRING },
        sources: [`${CHECK}:633`],
    },
    {
        id: 'prefix-disagreement',
        summary: 'Tailwind entries in one project that set different prefixes.',
        surfaces: { check: { group: 'dead-class' }, error: {} },
        position: 'none',
        args: {
            entries: { type: 'string[]', joiner: ', ' },
            setting: OPTIONAL_STRING,
            ignoreSetting: OPTIONAL_STRING,
        },
        sources: [
            `${CHECK}:388`,
            `${UNPLUGIN}:5598`,
            'packages/unplugin/src/next-stylesheet-facts.ts:376',
        ],
    },
    {
        id: 'sibling-keyword',
        summary: 'A value that emits a class setting another property than its key sets.',
        surfaces: { check: { group: 'sibling-keyword' } },
        position: 'site',
        args: {
            key: STRING,
            value: STRING,
            className: STRING,
            sets: { type: 'string[]', joiner: ', ' },
        },
        sources: [`${CHECK}:891`],
    },
    {
        id: 'broken-opacity',
        summary: 'An opacity modifier on a colour whose theme value color-mix() cannot dim.',
        surfaces: { check: { group: 'broken-opacity' }, runtime: { production: false } },
        position: 'site',
        args: { className: STRING, value: OPTIONAL_STRING },
        gaps: ['engine'],
        sources: [`${CHECK}:656`, `${CORE_TS}:2875`],
    },
    {
        id: 'theme-collision',
        summary: 'A theme token whose name a built-in utility also uses.',
        surfaces: { check: { group: 'theme-collision' }, runtime: { production: false } },
        position: 'site',
        args: {
            name: STRING,
            classes: { type: 'string[]', joiner: ', ', optional: true },
            builtInKind: { type: ['enum', 'utility-keyword', 'value'], optional: true },
        },
        sources: [`${CHECK}:963`, 'packages/runtime/src/merge-groups.ts:537'],
    },
    {
        id: 'merge-covered-key',
        summary: 'An sz key the build removed because a later key in the same object covers it.',
        surfaces: { check: { group: 'merge-covered-key' }, runtime: { production: false } },
        // What the build merged away: an audit, never a problem.
        defaults: { recommended: 'info', atomic: 'warn' },
        position: 'site',
        args: { key: STRING, className: STRING },
        sources: [
            'packages/cli/src/scanner/merge-audit-report.ts:74',
            'packages/unplugin/src/merge-audit.ts:125',
            `${UNPLUGIN}:4020`,
        ],
    },
    {
        id: 'merge-covered-class',
        summary:
            'A className class the build removed because an sz class on the element covers it.',
        surfaces: { check: { group: 'merge-covered-class' }, runtime: { production: false } },
        // What the build merged away: an audit, never a problem.
        defaults: { recommended: 'info', atomic: 'warn' },
        position: 'site',
        args: { className: STRING },
        sources: [
            'packages/cli/src/scanner/merge-audit-report.ts:74',
            'packages/unplugin/src/merge-audit.ts:133',
            `${UNPLUGIN}:4020`,
        ],
    },

    // --- runtime: console of the runtime, dynamic and compiler browser entries ---
    {
        id: 'recovery-manifest-unreadable',
        summary: 'A recovery manifest that is not valid JSON or not in the recovery format.',
        surfaces: { runtime: { production: true }, error: {} },
        position: 'none',
        forms: ['json', 'format'],
        args: { form: formArg(['json', 'format']), error: OPTIONAL_OPAQUE },
        sources: ['packages/runtime/src/verify.ts:145', 'packages/compiler/src/manifest.ts:231'],
    },
    {
        id: 'mangle-map-unreadable',
        summary:
            'A mangle map on the page that is not a plain map of class names, so it is ignored.',
        surfaces: { runtime: { production: true } },
        position: 'none',
        forms: ['schema', 'json'],
        args: { form: formArg(['schema', 'json']), error: OPTIONAL_OPAQUE },
        sources: [`${HYDRATION}:211`, `${HYDRATION}:218`],
    },
    {
        id: 'mangle-census-unreadable',
        summary: 'A mangle census on the page that is not a valid map, so nothing was verified.',
        surfaces: { runtime: { production: true } },
        position: 'none',
        args: {},
        sources: [`${HYDRATION}:450`],
    },
    {
        id: 'mangle-checksum-mismatch',
        summary: 'A mangle map whose hash differs from the checksum it was built with.',
        surfaces: { runtime: { production: true } },
        position: 'none',
        args: { computed: STRING, expected: STRING },
        sources: [`${HYDRATION}:457`],
    },
    {
        id: 'mangle-map-unavailable',
        summary: 'A page with a mangle checksum but no census or map to recompute it from.',
        surfaces: { runtime: { production: true } },
        position: 'none',
        args: { checksum: STRING },
        sources: [`${HYDRATION}:457`],
    },
    {
        id: 'web-crypto-unavailable',
        summary: 'A page without Web Crypto, so the mangle checksum cannot be recomputed.',
        surfaces: { runtime: { production: true }, error: {} },
        position: 'none',
        args: {},
        sources: [`${HYDRATION}:445`, `${HYDRATION}:350`],
    },
    {
        id: 'hydration-aborted',
        summary: 'A hydration check that threw on an element and stopped.',
        surfaces: { runtime: { production: true } },
        position: 'none',
        args: { tagName: STRING, message: OPAQUE },
        sources: [`${HYDRATION}:501`],
    },
    {
        id: 'csr-recovery-unmarked',
        summary: 'A hydration mismatch on an element without an szRecover directive.',
        surfaces: { runtime: { production: true } },
        position: 'none',
        args: {},
        sources: [`${HYDRATION}:607`],
    },
    {
        id: 'csr-recovery-dev-only',
        summary:
            'An szRecover="dev-only" element in a production build, where its recovery is off.',
        surfaces: { runtime: { production: true } },
        position: 'none',
        forms: ['runtime', 'stripped'],
        args: {
            form: formArg(['runtime', 'stripped']),
            count: OPTIONAL_NUMBER,
            sites: { type: 'string[]', joiner: ', ', optional: true },
        },
        sources: [`${HYDRATION}:615`, `${UNPLUGIN}:7924`],
    },
    {
        id: 'csr-recovery-used',
        summary: 'A hydration mismatch the runtime recovered by rendering on the client.',
        surfaces: { runtime: { production: true } },
        position: 'none',
        args: {},
        sources: [`${HYDRATION}:619`],
    },
    {
        id: 'merge-table-format-skew',
        summary: 'A merge table in a format this runtime does not read, so szcn merges nothing.',
        surfaces: { runtime: { production: true } },
        position: 'none',
        args: { format: NUMBER },
        sources: ['packages/runtime/src/merge-signatures.ts:51'],
    },
    {
        id: 'merge-table-missing',
        summary: 'A run with no merge table, so szcn removes only exact repeats.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: {},
        sources: ['packages/runtime/src/merge-classes.ts:201'],
    },
    {
        id: 'uncompiled-sz',
        summary: 'A raw sz object that reached the runtime because its file was not compiled.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: {},
        sources: ['packages/runtime/src/strip-sz-props.ts:34'],
    },
    {
        id: 'register-szcn-groups-ignored',
        summary: 'A registerSzcnGroups call, which no longer changes what szcn merges.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: {},
        sources: ['packages/runtime/src/merge-groups.ts:403'],
    },
    {
        id: 'theme-token-ambiguous',
        summary: 'A theme token defined under two namespaces that share one class prefix.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        forms: ['color-text-size', 'font-family-weight'],
        args: { form: formArg(['color-text-size', 'font-family-weight']), name: STRING },
        sources: ['packages/runtime/src/merge-groups.ts:564'],
    },
    {
        id: 'split-box-selector-invalid',
        summary: 'A has/pick/omit selector that can never match a token.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        forms: ['array', 'empty', 'multi', 'property', 'sz-qualified'],
        args: {
            form: formArg(['array', 'empty', 'multi', 'property', 'sz-qualified']),
            selector: OPTIONAL_STRING,
            property: OPTIONAL_STRING,
            categories: { type: 'string[]', joiner: ', ', optional: true },
        },
        sources: [
            `${SPLIT_BOX}:645`,
            `${SPLIT_BOX}:651`,
            `${SPLIT_BOX}:657`,
            `${SPLIT_BOX}:663`,
            `${SPLIT_BOX}:670`,
        ],
    },
    {
        id: 'split-box-unknown-category',
        summary: 'A selector name that is no category or class prefix csszyx knows.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        forms: ['no-hint', 'hint', 'property-hint'],
        args: { form: formArg(['no-hint', 'hint', 'property-hint']), name: STRING },
        sources: [`${SPLIT_BOX}:689`, `${SPLIT_BOX}:699`, `${SPLIT_BOX}:705`],
    },
    {
        id: 'split-box-placement-variant',
        summary: 'A splitBox placement written with a variant or marker, which never matches.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: { selector: STRING, side: { type: ['enum', 'inner', 'outer'] } },
        sources: [`${SPLIT_BOX}:935`],
    },
    {
        id: 'split-box-peer-on-frame',
        summary: 'A peer class splitBox kept on the frame although its base belongs inside.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: { token: STRING },
        sources: [`${SPLIT_BOX}:1067`],
    },
    {
        id: 'split-box-unclassified',
        summary: 'A class or raw CSS splitBox cannot classify, placed on the fallback node.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        forms: ['class', 'raw-css'],
        args: {
            form: formArg(['class', 'raw-css']),
            token: OPTIONAL_STRING,
            node: { type: ['enum', 'frame', 'content'] },
        },
        sources: [`${SPLIT_BOX}:1088`, `${SPLIT_BOX}:1327`],
    },
    {
        id: 'split-box-unbounded-scroll',
        summary: 'A scrolling content node whose height nothing bounds, so it grows instead.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: { scroller: STRING },
        sources: [`${SPLIT_BOX}:1139`],
    },
    {
        id: 'split-box-unclipped-corners',
        summary: 'A rounded frame that does not clip its scrolling content.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: {},
        sources: [`${SPLIT_BOX}:1151`],
    },
    {
        id: 'split-box-hidden-content',
        summary: 'A hiding class placed on the content node, which leaves the frame visible.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: { hidden: STRING },
        sources: [`${SPLIT_BOX}:1166`],
    },
    {
        id: 'szv-config-invalid',
        summary: 'A part of an szv config that does not have the shape szv reads.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        forms: ['config', 'base', 'variants', 'default-variants', 'dimension', 'variant-value'],
        args: {
            form: formArg([
                'config',
                'base',
                'variants',
                'default-variants',
                'dimension',
                'variant-value',
            ]),
            dimension: OPTIONAL_STRING,
            token: OPTIONAL_STRING,
            got: STRING,
        },
        sources: [
            `${VARIANTS}:191`,
            `${VARIANTS}:198`,
            `${VARIANTS}:223`,
            `${VARIANTS}:227`,
            `${VARIANTS}:236`,
            `${VARIANTS}:245`,
        ],
    },
    {
        id: 'sz-object-depth',
        summary: 'An sz object at runtime nested deeper than the depth limit.',
        surfaces: { runtime: { production: false }, error: { classes: ['SzDepthError'] } },
        position: 'none',
        forms: ['value', 'szv-config'],
        args: { form: formArg(['value', 'szv-config']), maxDepth: NUMBER, where: OPTIONAL_STRING },
        sources: [
            'packages/compiler/src/sz-limits.ts:25',
            `${CORE_TS}:2623`,
            'packages/runtime/src/core.ts:179',
            `${VARIANTS}:122`,
            `${VARIANTS}:263`,
            `${SPLIT_BOX}:1398`,
            `${SPLIT_BOX}:1420`,
            `${SPLIT_BOX}:1461`,
            `${SPLIT_BOX}:1567`,
            `${SPLIT_BOX}:1594`,
            'packages/dynamic/src/purify.ts:119',
            'packages/dynamic/src/purify.ts:185',
        ],
    },
    {
        id: 'szv-forbidden-key',
        summary: 'A key in an szv config that csszyx never reads, such as __proto__.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: { where: STRING, key: STRING },
        sources: [`${VARIANTS}:270`],
    },
    {
        id: 'szv-unknown-variant',
        summary: 'A selection that names a variant the szv config does not declare.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: { key: STRING },
        sources: [`${VARIANTS}:408`, 'packages/runtime/src/szv-pick.ts:152'],
    },
    {
        id: 'szv-unknown-variant-value',
        summary: 'A selection that gives a variant a value it has no styles for.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: { key: STRING, value: STRING },
        sources: [`${VARIANTS}:415`, 'packages/runtime/src/szv-pick.ts:158'],
    },
    {
        id: 'szv-object-as-string',
        summary: 'An sz object from szv() used as a class string, which renders "[object Object]".',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: {},
        sources: [`${VARIANTS}:487`],
    },
    {
        id: 'dynamic-injection-growth',
        summary:
            'A session in which dynamic() has injected so many classes the CSSOM keeps growing.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: {},
        sources: ['packages/dynamic/src/injector.ts:214'],
    },
    {
        id: 'dynamic-unsafe-arbitrary',
        summary: 'An arbitrary value dynamic() dropped because it could inject CSS.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: { utility: STRING },
        sources: ['packages/dynamic/src/css-generator.ts:37'],
    },
    {
        id: 'dynamic-non-boolean',
        summary: 'A runtime value that is not a boolean on a key only a boolean can toggle.',
        surfaces: { runtime: { production: true } },
        position: 'none',
        args: { key: STRING, valueType: STRING },
        sources: ['packages/compiler/src/bool-class.ts:46'],
    },
    {
        id: 'dynamic-unresolvable',
        summary: 'A runtime value of a type no CSS value can be resolved from.',
        surfaces: { runtime: { production: true } },
        position: 'none',
        args: { key: STRING, valueType: STRING },
        sources: ['packages/compiler/src/spacing-var.ts:64'],
    },
    {
        id: 'dev-warnings-partial',
        summary:
            'Development warnings that cover only the files a page loads; csszyx check scans all.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        forms: ['located', 'unlocated'],
        args: { form: formArg(['located', 'unlocated']) },
        sources: [`${CORE_TS}:2437`],
    },
    {
        id: 'diagnostics-capped',
        summary: 'More findings of one kind than a run lists; the rest are counted, not printed.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        forms: ['per-id', 'dev-warnings', 'unknown-keys'],
        args: {
            form: formArg(['per-id', 'dev-warnings', 'unknown-keys']),
            id: OPTIONAL_STRING,
            count: OPTIONAL_NUMBER,
        },
        sources: [
            'packages/unplugin/src/diagnostic-limiter.ts:84',
            'packages/runtime/src/dev-warn.ts:47',
            `${CORE_TS}:4115`,
        ],
    },
    {
        id: 'sz-attribute-syntax',
        summary: 'An sz attribute string that does not parse.',
        surfaces: { runtime: { production: true }, error: {} },
        position: 'site',
        args: { input: STRING, char: OPTIONAL_STRING },
        sources: [
            'packages/csszyx/src/parse-sz-attribute.ts:38',
            'packages/csszyx/src/browser.ts:77',
        ],
    },

    // --- error: thrown, no console line of their own ---
    {
        id: 'options-object-required',
        summary: 'An options argument that is not the one object the call takes.',
        surfaces: { error: {} },
        position: 'none',
        forms: ['transform', 'csszyx-turbopack'],
        args: { form: formArg(['transform', 'csszyx-turbopack']) },
        sources: [`${CORE_TS}:2596`, 'packages/unplugin/src/next-config.ts:129'],
    },
    {
        id: 'lowering-not-loaded',
        summary: 'An sz object passed to a string helper before the lowering module is loaded.',
        surfaces: { error: {} },
        position: 'none',
        args: {},
        sources: ['packages/runtime/src/core.ts:215'],
    },
    {
        id: 'lite-sz-object',
        summary: 'An sz object passed to a lite-runtime helper, which cannot lower objects.',
        surfaces: { error: {} },
        position: 'none',
        args: { fnName: STRING, received: STRING },
        sources: ['packages/runtime/src/lite.ts:40'],
    },
    {
        id: 'split-box-sz-string',
        summary: 'A class string passed to splitBoxSz, which takes sz objects.',
        surfaces: { error: {} },
        position: 'none',
        args: { value: STRING },
        sources: [`${SPLIT_BOX}:1424`],
    },
    {
        id: 'runtime-prefix-conflict',
        summary: 'Two builds sharing one runtime that registered different Tailwind prefixes.',
        surfaces: { error: {} },
        position: 'none',
        args: { first: OPTIONAL_STRING, second: OPTIONAL_STRING },
        sources: ['packages/runtime/src/lowering-slot.ts:148'],
    },
    {
        id: 'dynamic-manifest-unreachable',
        summary: 'A dynamic manifest the browser could not fetch.',
        surfaces: { error: {} },
        position: 'none',
        args: { status: NUMBER },
        sources: ['packages/dynamic/src/manifest.ts:69'],
    },
    {
        id: 'native-engine-unavailable',
        summary: 'A native engine that is missing, cannot load, or predates this compiler.',
        surfaces: {
            runtime: { production: false },
            error: { classes: ['CsszyxNativeUnavailableError', 'RustTransformUnavailableError'] },
        },
        position: 'none',
        forms: [
            'no-platform-package',
            'not-installed',
            'missing-export',
            'stale-binding',
            'wasm-fallback',
        ],
        args: {
            form: formArg([
                'no-platform-package',
                'not-installed',
                'missing-export',
                'stale-binding',
                'wasm-fallback',
            ]),
            packageName: OPTIONAL_STRING,
            exportName: OPTIONAL_STRING,
            detail: OPTIONAL_OPAQUE,
        },
        sources: [
            `${NATIVE}:53`,
            `${NATIVE}:84`,
            `${NATIVE}:92`,
            `${NATIVE}:99`,
            `${NATIVE}:143`,
            `${NATIVE}:184`,
            'packages/compiler/src/transform-rust.ts:40',
            'packages/compiler/src/transform-rust.ts:133',
            'packages/compiler/src/transform-rust.ts:278',
            `${UNPLUGIN}:3522`,
        ],
    },
    {
        id: 'wasm-engine-unavailable',
        summary: 'A wasm engine that failed to load.',
        surfaces: { error: { classes: ['WasmTransformUnavailableError'] } },
        position: 'none',
        args: { detail: OPAQUE },
        sources: [
            'packages/compiler/src/transform-wasm.ts:89',
            'packages/compiler/src/transform-wasm.ts:134',
        ],
    },
    {
        id: 'native-migrate-unavailable',
        summary: 'A native engine csszyx migrate needs and cannot load; migrate has no wasm lane.',
        surfaces: { error: { classes: ['RustMigrateUnavailableError'] } },
        position: 'none',
        args: { detail: OPAQUE },
        sources: [
            'packages/compiler/src/migrate-rust.ts:140',
            'packages/compiler/src/migrate-rust.ts:298',
        ],
    },
    {
        id: 'engine-version-skew',
        summary: 'An engine built from other source than the compiler that loads it.',
        surfaces: { error: { classes: ['EngineVersionSkewError'] } },
        position: 'none',
        args: {
            artifact: { type: ['enum', 'native', 'wasm'] },
            expectedVersion: STRING,
            expectedDigest: STRING,
            foundVersion: OPTIONAL_STRING,
            foundDigest: OPTIONAL_STRING,
            platformPackage: OPTIONAL_STRING,
        },
        sources: [
            'packages/compiler/src/engine-identity.ts:39',
            'packages/compiler/src/engine-identity.ts:80',
        ],
    },
    {
        id: 'runtime-version-skew',
        summary: 'A @csszyx/runtime at another version than the plugin that lowers for it.',
        surfaces: { error: { classes: ['RuntimeVersionSkewError'] } },
        position: 'none',
        args: { pluginVersion: STRING, runtimeVersion: STRING, runtimeDir: STRING },
        sources: [
            'packages/unplugin/src/runtime-version.ts:30',
            'packages/unplugin/src/runtime-version.ts:99',
        ],
    },
    {
        id: 'peer-module-unresolved',
        summary: 'A peer package csszyx needs that does not resolve from the project.',
        surfaces: { error: {} },
        position: 'none',
        args: { requiredBy: STRING, request: STRING, install: STRING },
        sources: ['packages/compiler/src/peer-module.ts:46'],
    },
    {
        id: 'tailwind-v3-unavailable',
        summary: 'A project where generate-types finds no loadable Tailwind CSS v3.',
        surfaces: { error: { classes: ['TailwindUnavailableError'] } },
        position: 'none',
        forms: ['absent', 'wrong-major', 'broken-entry'],
        args: {
            form: formArg(['absent', 'wrong-major', 'broken-entry']),
            version: OPTIONAL_STRING,
            reason: OPTIONAL_OPAQUE,
        },
        sources: [
            'packages/cli/src/scanner/tailwind-availability.ts:168',
            'packages/cli/src/scanner/tailwind-availability.ts:222',
            'packages/cli/src/scanner/tailwind-availability.ts:227',
            'packages/cli/src/scanner/tailwind-availability.ts:236',
            'packages/cli/src/scanner/tailwind-availability.ts:239',
            'packages/cli/src/scanner/tailwind-availability.ts:251',
        ],
    },
    {
        id: 'explain-input-invalid',
        summary: 'An input to csszyx explain that is not one sz expression the build lowers.',
        surfaces: { error: { classes: ['ExplainParseError'] } },
        position: 'none',
        forms: ['not-one-expression', 'runtime-only'],
        args: {
            form: formArg(['not-one-expression', 'runtime-only']),
            diagnostics: { type: 'string[]', joiner: '\n', optional: true, opaque: true },
        },
        sources: [
            'packages/cli/src/commands/explain.ts:28',
            'packages/cli/src/commands/explain.ts:85',
            'packages/cli/src/commands/explain.ts:90',
        ],
    },
    {
        id: 'template-sz-invalid',
        summary:
            'A Vue or Svelte file whose template sz has errors, each reported with its own code.',
        surfaces: { error: {} },
        position: 'file',
        args: { count: NUMBER },
        sources: ['packages/svelte-adapter/src/index.ts:102', `${UNPLUGIN}:6875`],
    },
    {
        id: 'template-runtime-value',
        summary: 'A template sz value only known at runtime, which a template cannot resolve.',
        surfaces: { error: {} },
        position: 'site',
        args: {},
        sources: ['packages/compiler/src/template-sz.ts:229'],
    },
    {
        id: 'template-unparsable',
        summary: 'A Vue or Svelte file its own compiler cannot parse, so no sz in it gets a class.',
        surfaces: { error: {} },
        position: 'site',
        forms: ['vue', 'svelte-quoted', 'svelte-preprocess'],
        args: {
            form: formArg(['vue', 'svelte-quoted', 'svelte-preprocess']),
            reason: OPAQUE,
        },
        sources: [
            'packages/vue-adapter/src/template-ast.ts:123',
            'packages/svelte-adapter/src/markup-ast.ts:92',
        ],
    },
    {
        id: 'template-lang-unsupported',
        summary: 'A Vue template in a language other than HTML, which csszyx does not read.',
        surfaces: { error: {} },
        position: 'site',
        args: { lang: STRING },
        sources: ['packages/vue-adapter/src/template-ast.ts:130'],
    },
    {
        id: 'svelte-version-unsupported',
        summary: 'An installed Svelte older than 5, whose markup csszyx does not read.',
        surfaces: { error: {} },
        position: 'site',
        args: { version: STRING },
        sources: ['packages/svelte-adapter/src/markup-ast.ts:77'],
    },
    {
        id: 'ignore-package-incompatible',
        summary:
            'An installed `ignore` package that no longer reads .gitignore the way csszyx needs.',
        surfaces: { error: {} },
        position: 'none',
        args: {},
        sources: ['packages/tailwind-oracle/src/project-walk.ts:193'],
    },
    {
        id: 'internal-error',
        summary: 'A state csszyx should never reach: a csszyx bug to report.',
        surfaces: {
            error: { classes: ['RustTransformUnavailableError', 'WasmTransformUnavailableError'] },
        },
        position: 'none',
        args: { where: STRING },
        sources: [
            'packages/compiler/src/transform-rust.ts:69',
            'packages/compiler/src/transform-wasm.ts:209',
            'packages/unplugin/src/next-source-transformer.ts:53',
            `${UNPLUGIN}:1908`,
            `${UNPLUGIN}:2940`,
            `${UNPLUGIN}:4321`,
            `${UNPLUGIN}:5757`,
            'packages/unplugin/src/next-watcher.ts:132',
            'packages/unplugin/src/stable-file-snapshot.ts:44',
            'packages/tailwind-oracle/src/map-concurrent.ts:39',
            'packages/tailwind-oracle/src/project-resolver.ts:118',
        ],
    },
    {
        id: 'engine-call-failed',
        summary: 'A call into the engine that threw.',
        surfaces: { runtime: { production: false }, error: {} },
        position: 'none',
        forms: ['call', 'prescan'],
        args: { form: formArg(['call', 'prescan']), detail: OPAQUE },
        sources: [
            'packages/core/src/lib.rs:158',
            'packages/core/src/native.rs:446',
            `${UNPLUGIN}:4602`,
        ],
    },

    // --- node: build, config and CLI lines of the Node packages ---
    {
        id: 'config-invalid',
        summary: 'A csszyx.config with problems, each reported with its own code.',
        surfaces: { runtime: { production: false } },
        position: 'file',
        forms: ['partly-applied', 'not-applied'],
        args: { form: formArg(['partly-applied', 'not-applied']), count: NUMBER },
        sources: [
            `${POLICY}:674`,
            'packages/unplugin/src/sync-lane-policy.ts:250',
            `${CHECK}:1417`,
        ],
    },
    {
        id: 'unknown-rule-id',
        summary: 'A rule id no diagnostic, kind or group has, likely a typo.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        forms: ['config', 'cli'],
        args: {
            form: formArg(['config', 'cli']),
            ids: { type: 'string[]', joiner: ', ' },
            suggestion: OPTIONAL_STRING,
        },
        sources: [`${POLICY}:373`, `${CHECK}:1111`],
    },
    {
        id: 'config-id-not-settable',
        summary: 'A rule id for a runtime line or a throw, whose level csszyx.config cannot set.',
        surfaces: { runtime: { production: false } },
        position: 'file',
        args: { id: STRING },
        sources: [],
    },
    {
        id: 'removed-rule-id',
        summary: 'A rule id csszyx no longer reports, with the id that replaced it.',
        surfaces: { runtime: { production: false } },
        position: 'file',
        args: { id: STRING, replacedBy: OPTIONAL_STRING },
        sources: [],
    },
    {
        id: 'config-level-invalid',
        summary: 'A rule set to something other than off, info, warn or error.',
        surfaces: { runtime: { production: false } },
        position: 'file',
        args: { id: STRING, level: STRING },
        sources: [`${POLICY}:379`],
    },
    {
        id: 'config-preset-unknown',
        summary: 'A diagnostics preset other than recommended or atomic.',
        surfaces: { runtime: { production: false } },
        position: 'file',
        args: { preset: STRING },
        sources: [`${POLICY}:643`],
    },
    {
        id: 'config-field-unknown',
        summary: 'A field csszyx.config does not read.',
        surfaces: { runtime: { production: false } },
        position: 'file',
        forms: ['top-level', 'misspelt', 'plugin-option', 'diagnostics', 'allow'],
        args: {
            form: formArg(['top-level', 'misspelt', 'plugin-option', 'diagnostics', 'allow']),
            key: STRING,
            suggestion: OPTIONAL_STRING,
        },
        sources: [
            `${POLICY}:426`,
            `${POLICY}:562`,
            `${POLICY}:575`,
            `${POLICY}:582`,
            `${POLICY}:632`,
        ],
    },
    {
        id: 'config-field-invalid',
        summary: 'A csszyx.config field whose value does not have the shape it takes.',
        surfaces: { runtime: { production: false } },
        position: 'file',
        args: {
            field: STRING,
            expected: {
                type: [
                    'enum',
                    'object',
                    'rules-object',
                    'name-list',
                    'overrides-list',
                    'override',
                    'globs',
                ],
            },
        },
        sources: [
            `${POLICY}:365`,
            `${POLICY}:404`,
            `${POLICY}:417`,
            `${POLICY}:510`,
            `${POLICY}:518`,
            `${POLICY}:526`,
            `${POLICY}:606`,
            `${POLICY}:622`,
        ],
    },
    {
        id: 'config-glob-unmatchable',
        summary: 'An override glob that is absolute or steps out of the root, so it never matches.',
        surfaces: { runtime: { production: false } },
        position: 'file',
        args: { glob: STRING },
        sources: [`${POLICY}:483`],
    },
    {
        id: 'config-file-duplicate',
        summary: 'A second csszyx.config file beside the one csszyx reads.',
        surfaces: { runtime: { production: false } },
        position: 'file',
        args: { read: STRING },
        sources: [`${CONFIG_FILE}:573`],
    },
    {
        id: 'config-unloadable',
        summary: 'A csszyx.config that could not be loaded, so the default levels apply.',
        surfaces: { runtime: { production: false } },
        position: 'file',
        forms: ['load', 'legacy-template', 'worker'],
        args: {
            form: formArg(['load', 'legacy-template', 'worker']),
            reason: OPAQUE,
            lane: OPTIONAL_STRING,
        },
        sources: [
            `${CONFIG_FILE}:585`,
            `${CONFIG_FILE}:591`,
            'packages/unplugin/src/sync-lane-policy.ts:112',
            'packages/unplugin/src/sync-lane-policy.ts:245',
        ],
    },
    {
        id: 'config-no-default-export',
        summary: 'A csszyx.config with no default export.',
        surfaces: { runtime: { production: false } },
        position: 'file',
        args: {},
        sources: [`${CONFIG_FILE}:603`],
    },
    {
        id: 'policy-state-format-skew',
        summary: 'A saved diagnostic policy in a format this version does not read.',
        surfaces: { runtime: { production: false } },
        position: 'file',
        args: { format: NUMBER },
        sources: [`${CONFIG_FILE}:85`],
    },
    {
        id: 'safelist-shard-format-skew',
        summary: 'A Next safelist shard in a format this version does not read.',
        surfaces: { runtime: { production: false } },
        position: 'file',
        args: { format: NUMBER },
        sources: ['packages/unplugin/src/next-safelist-state.ts:55'],
    },
    {
        id: 'diagnostics-held',
        summary: 'Findings at info a production build counted instead of listing.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: { count: NUMBER },
        sources: ['packages/unplugin/src/transform-diagnostics.ts:96'],
    },
    {
        id: 'merge-covered-held',
        summary: 'Classes a build removed by merging, counted instead of listed.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: {
            classes: NUMBER,
            files: NUMBER,
            kinds: { type: 'string[]', joiner: ' and ' },
            configFile: STRING,
        },
        sources: ['packages/unplugin/src/merge-audit.ts:183', `${UNPLUGIN}:4027`],
    },
    {
        id: 'removed-option',
        summary: 'A plugin option that was removed and is no longer read.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        forms: ['inject-checksum', 'mangle-map-delivery'],
        args: { form: formArg(['inject-checksum', 'mangle-map-delivery']) },
        sources: [
            'packages/unplugin/src/mangle-delivery.ts:65',
            'packages/unplugin/src/mangle-delivery.ts:85',
            `${UNPLUGIN}:3190`,
            `${UNPLUGIN}:3196`,
        ],
    },
    {
        id: 'transform-cache-disabled',
        summary: 'A build without its transform cache, because package versions did not resolve.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: {},
        sources: [`${UNPLUGIN}:3230`],
    },
    {
        id: 'active-parser',
        summary: 'The parser a build runs, and whether it fell back from the native engine.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        forms: ['native', 'wasm', 'degraded'],
        args: { form: formArg(['native', 'wasm', 'degraded']) },
        sources: [`${UNPLUGIN}:3544`],
    },
    {
        id: 'project-reload',
        summary: 'A project-wide input that changed, so a dev server recompiled every module.',
        surfaces: { runtime: { production: false } },
        position: 'file',
        forms: ['config', 'merge-groups', 'prefix'],
        args: {
            form: formArg(['config', 'merge-groups', 'prefix']),
            before: OPTIONAL_STRING,
            after: OPTIONAL_STRING,
        },
        sources: [`${UNPLUGIN}:3464`, `${UNPLUGIN}:6327`, `${UNPLUGIN}:6336`],
    },
    {
        id: 'watch-prefix-changed',
        summary: 'A Tailwind prefix that changed during a watch build, which needs a restart.',
        surfaces: { error: {} },
        position: 'none',
        args: {
            changed: { type: 'string[]', joiner: ', ' },
            before: OPTIONAL_STRING,
            after: OPTIONAL_STRING,
        },
        sources: [`${UNPLUGIN}:5696`],
    },
    {
        id: 'safelist-unwritable',
        summary: 'A generated safelist csszyx could not write, so Tailwind misses its classes.',
        surfaces: { runtime: { production: false } },
        position: 'file',
        args: { reason: OPAQUE },
        sources: [`${UNPLUGIN}:4716`],
    },
    {
        id: 'utility-collision',
        summary: 'An @utility whose name another utility also claims, so Tailwind merges both.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: { name: STRING, reason: STRING },
        sources: [`${UNPLUGIN}:2292`],
    },
    {
        id: 'theme-scan-without-typescript',
        summary: 'Theme auto-scan turned on in a project without TypeScript configured.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: {},
        sources: [`${UNPLUGIN}:2335`],
    },
    {
        id: 'esbuild-mangle-unsupported',
        summary: 'production.mangle on the esbuild adapter, which turns mangling off.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: {},
        sources: [`${UNPLUGIN}:8559`],
    },
    {
        id: 'mangle-selector-unparsable',
        summary: 'A CSS selector the class mangler could not parse, left unmangled.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: { selector: STRING, error: OPAQUE },
        sources: ['packages/unplugin/src/css-mangler.ts:330'],
    },
    {
        id: 'mangle-preserve-invalid',
        summary: 'A production.manglePreserve entry that is not a class name or a prefix.',
        surfaces: { error: {} },
        position: 'none',
        forms: ['entry', 'lone-star'],
        args: {
            form: formArg(['entry', 'lone-star']),
            index: OPTIONAL_NUMBER,
            got: OPTIONAL_STRING,
        },
        sources: [
            'packages/unplugin/src/mangle-preserve.ts:84',
            'packages/unplugin/src/mangle-preserve.ts:90',
        ],
    },
    {
        id: 'mangle-global-vars-options-invalid',
        summary: 'production.mangleGlobalVars options csszyx cannot apply.',
        surfaces: { error: {} },
        position: 'none',
        forms: ['schema', 'tokens-required', 'auto-prefix'],
        args: {
            form: formArg(['schema', 'tokens-required', 'auto-prefix']),
            errors: { type: 'string[]', joiner: '\n', optional: true },
        },
        sources: [`${UNPLUGIN}:2910`, `${UNPLUGIN}:2916`, `${UNPLUGIN}:2922`],
    },
    {
        id: 'mangle-global-vars-plan-invalid',
        summary: 'A global-variable alias plan that renames a variable unsafely.',
        surfaces: { error: {} },
        position: 'none',
        args: { findings: { type: 'string[]', joiner: '\n', opaque: true } },
        sources: [`${UNPLUGIN}:1835`],
    },
    {
        id: 'mangle-map-too-large',
        summary: 'A CSS variable mangle map larger than its safety cap.',
        surfaces: { error: {} },
        position: 'none',
        args: { size: NUMBER, maxBytes: NUMBER },
        sources: [`${UNPLUGIN}:2060`],
    },
    {
        id: 'mangle-census-late',
        summary: 'Classes that appeared after the mangle map was frozen.',
        surfaces: { error: {} },
        position: 'none',
        forms: ['classes', 'census-changed'],
        args: {
            form: formArg(['classes', 'census-changed']),
            ownedClasses: { type: 'string[]', joiner: ', ', optional: true },
            authorClasses: { type: 'string[]', joiner: ', ', optional: true },
        },
        sources: [`${UNPLUGIN}:5861`],
    },
    {
        id: 'merge-hook-late',
        summary: 'A rule selecting on a class the build had already merged away.',
        surfaces: { error: {} },
        position: 'file',
        args: { className: STRING },
        sources: [`${UNPLUGIN}:5731`],
    },
    {
        id: 'tailwind-stylesheet-missing',
        summary: 'A configured Tailwind stylesheet that does not exist.',
        surfaces: { error: {} },
        position: 'none',
        args: { setting: STRING, missing: { type: 'string[]', joiner: ', ' }, root: STRING },
        sources: ['packages/unplugin/src/next-stylesheet-facts.ts:347', `${UNPLUGIN}:5580`],
    },
    {
        id: 'tailwind-stylesheet-broken',
        summary: 'A stylesheet reaching Tailwind that does not compile, so the prefix is unknown.',
        surfaces: { error: {} },
        position: 'none',
        args: { stylesheets: { type: 'string[]', joiner: '\n' }, setting: STRING },
        sources: [`${UNPLUGIN}:5598`, 'packages/unplugin/src/next-stylesheet-facts.ts:376'],
    },
    {
        id: 'tailwind-config-missing',
        summary: 'A Tailwind config path that does not exist.',
        surfaces: { error: {} },
        position: 'file',
        args: {},
        sources: ['packages/cli/src/scanner/tailwind-scanner.ts:108'],
    },
    {
        id: 'tailwind-config-unloadable',
        summary: 'A Tailwind config that threw while loading.',
        surfaces: { error: {} },
        position: 'file',
        args: { reason: OPAQUE },
        sources: ['packages/cli/src/scanner/tailwind-scanner.ts:121'],
    },
    {
        id: 'legacy-source-directive',
        summary: 'An @source line naming the old safelist file, which csszyx no longer writes.',
        surfaces: { error: {} },
        position: 'file',
        args: { target: STRING },
        sources: [
            'packages/unplugin/src/safelist-source.ts:248',
            'packages/unplugin/src/postcss.ts:79',
            `${UNPLUGIN}:6726`,
        ],
    },
    {
        id: 'postcss-plugin-order',
        summary:
            'The csszyx PostCSS plugin listed after Tailwind, which then never reads the safelist.',
        surfaces: { error: {} },
        position: 'none',
        args: {},
        sources: ['packages/unplugin/src/postcss.ts:110'],
    },
    {
        id: 'ignore-pattern-negated',
        summary: 'A negated pattern in an ignore list, which can only add paths.',
        surfaces: { error: {} },
        position: 'none',
        args: { pattern: STRING },
        sources: ['packages/unplugin/src/root-ignore-matcher.ts:63'],
    },
    {
        id: 'css-source-unstable',
        summary: 'A CSS source that kept changing while csszyx read it.',
        surfaces: { error: {} },
        position: 'file',
        args: {},
        sources: ['packages/unplugin/src/stable-file-snapshot.ts:61'],
    },
    {
        id: 'rsc-boundary-violation',
        summary: 'A client-only csszyx export imported into a Server Component.',
        surfaces: { error: {} },
        position: 'file',
        args: { symbol: STRING, chain: { type: 'string[]', joiner: ' -> ' } },
        sources: [
            'packages/unplugin/src/rsc-boundary.ts:222',
            'packages/unplugin/src/rsc-boundary.ts:272',
        ],
    },
    {
        id: 'next-prefix-unread',
        summary: 'A Next lane that runs before the Tailwind prefix was read.',
        surfaces: { error: { classes: ['NextStylesheetFactsPending'] } },
        position: 'none',
        args: {
            lane: { type: ['enum', 'prebuild', 'turbopack-loader'] },
            root: STRING,
            reason: STRING,
        },
        sources: [
            'packages/unplugin/src/next-prebuild.ts:164',
            'packages/unplugin/src/next-turbo-loader.ts:216',
            'packages/unplugin/src/next-turbo-loader.ts:635',
        ],
    },
    {
        id: 'next-safelist-locked',
        summary: 'A Next safelist state another live process holds the lock on.',
        surfaces: { error: { classes: ['NextSafelistStateLockedError'] } },
        position: 'none',
        args: { pid: NUMBER, root: STRING, mode: STRING, host: STRING, updatedAt: STRING },
        sources: [
            'packages/unplugin/src/next-safelist-state.ts:361',
            'packages/unplugin/src/next-safelist-state.ts:369',
            'packages/unplugin/src/next-safelist-state.ts:837',
        ],
    },
    {
        id: 'next-generation-manifest-invalid',
        summary: 'A Next generation manifest that does not have the shape csszyx writes.',
        surfaces: { error: {} },
        position: 'none',
        forms: ['read', 'written'],
        args: { form: formArg(['read', 'written']), reason: OPTIONAL_STRING },
        sources: [
            'packages/unplugin/src/next-generation-manifest.ts:155',
            'packages/unplugin/src/next-watcher-cycle.ts:75',
        ],
    },
    {
        id: 'next-mangle-vars-unsupported',
        summary: 'production.mangleVars on a Next lane that cannot mangle CSS variables.',
        surfaces: { error: {} },
        position: 'file',
        forms: ['prebuild', 'turbopack'],
        args: { form: formArg(['prebuild', 'turbopack']) },
        sources: [
            'packages/unplugin/src/next-prebuild.ts:258',
            'packages/unplugin/src/next-turbo-loader.ts:593',
        ],
    },
    {
        id: 'next-turbo-cache-unseeded',
        summary:
            'A Turbopack production build whose safelist was not seeded by csszyx next prebuild.',
        surfaces: { error: {} },
        position: 'none',
        args: { root: STRING, reason: STRING },
        sources: ['packages/unplugin/src/next-turbo-loader.ts:559'],
    },
    {
        id: 'next-sz-untransformed',
        summary: 'A Next module that still holds sz syntax after the csszyx transform.',
        surfaces: { error: {} },
        position: 'file',
        args: {},
        sources: ['packages/unplugin/src/next-source-transformer.ts:98'],
    },
    {
        id: 'next-watcher-not-started',
        summary: 'A Next safelist watcher whose first cycle did not complete.',
        surfaces: { error: {} },
        position: 'none',
        args: {},
        sources: ['packages/unplugin/src/next-watcher.ts:142'],
    },
    {
        id: 'next-watcher-unclosed',
        summary: 'A Next safelist watcher that threw while closing.',
        surfaces: { runtime: { production: false } },
        position: 'none',
        args: { detail: OPAQUE },
        sources: ['packages/cli/src/commands/next-watch.ts:546'],
    },
    {
        id: 'no-source-files',
        summary: 'A source pattern that matched no file under the root.',
        surfaces: { runtime: { production: false }, error: {} },
        position: 'none',
        args: { pattern: STRING, root: STRING },
        sources: [
            'packages/cli/src/commands/next-watch.ts:267',
            'packages/cli/src/commands/next-prebuild.ts:150',
        ],
    },
    {
        id: 'cli-option-invalid',
        summary: 'A CLI option value outside the values the command takes.',
        surfaces: { error: {} },
        position: 'none',
        forms: ['mode', 'parser-mode', 'debounce-ms'],
        args: { form: formArg(['mode', 'parser-mode', 'debounce-ms']), value: OPTIONAL_STRING },
        sources: [
            'packages/cli/src/commands/next-prebuild.ts:218',
            'packages/cli/src/commands/next-prebuild.ts:230',
            'packages/cli/src/commands/next-watch.ts:719',
            'packages/cli/src/commands/next-watch.ts:734',
        ],
    },
];

/** Ids that existed in a released tag and are no longer produced. */
export const REMOVED = [
    {
        id: 'other',
        since: '0.18.0',
        was: 'check-kind',
        reason:
            'The catch-all kind for an engine diagnostic the text matcher could not name. Every ' +
            'engine diagnostic now carries its own code, so nothing is reported as other; a ' +
            '`rules` or `--rule` entry naming it selects nothing.',
    },
    {
        id: 'CSSZYX_NATIVE_UNAVAILABLE',
        since: '0.18.0',
        replacedBy: 'native-engine-unavailable',
        was: 'error-code',
        reason:
            "The `code` of @csszyx/core's CsszyxNativeUnavailableError since 0.9.0, renamed to the " +
            'kebab-case grammar every other code uses. No /e/ page: the old string breaks the URL grammar.',
    },
];

// REVIEW NOTES
//
// Unsure ids (chosen, then alternatives):
// - uncompiled-sz (raw-sz-object, sz-object-uncompiled).
// - lite-sz-object (sz-object-in-lite, lite-received-object); lowering-not-loaded kept apart
//   because the cause differs (module not imported vs. compiler could not resolve).
// - sz-object-depth (sz-depth-exceeded, sz-too-deep); kept apart from engine nesting-depth:
//   that one is source nesting vs. the parser guard, this one runtime data vs. MAX_SZ_DEPTH.
// - dev-warnings-partial (check-scan-hint, check-scan-tip); not a problem, a hint line.
// - diagnostics-capped / diagnostics-held (limiter-cap, warnings-suppressed / info-held).
// - merge-covered-held (merge-removals-held, merge-summary).
// - active-parser: a status line, not a problem (parser-in-use; or out of scope as CLI output).
// - project-reload (dev-reload, full-reload).
// - watch-prefix-changed (prefix-changed-in-watch).
// - csr-recovery-* family (sz-recover-* would collide in meaning with engine sz-recover).
// - split-box-selector-invalid / split-box-unknown-category, renamed from the inventory's
//   box-selector-* so the family reads split-box-*; has/pick/omit live in split-box.ts.
// - szv-forbidden-key (forbidden-key: too generic for an szv-only check).
// - recovery-manifest-unreadable / mangle-map-unreadable: "-unreadable" family with the
//   existing mangle-census-unreadable (inventory suggested recovery-manifest-invalid).
// - runtime-prefix-conflict (class-prefix-conflict).
// - dynamic-manifest-unreachable (dynamic-manifest-fetch-failed).
// - peer-module-unresolved (peer-unresolved).
// - tailwind-config-missing / tailwind-config-unloadable (tailwind-config-not-found /
//   tailwind-config-load-failed), aligned with tailwind-stylesheet-missing/-broken.
// - tailwind-stylesheet-broken (stylesheet-compile-failed).
// - mangle-global-vars-options-invalid / mangle-global-vars-plan-invalid
//   (mangle-global-vars-config-invalid / mangle-global-vars-validation); "config" is kept for
//   csszyx.config, plugin options are "options".
// - next-turbo-cache-unseeded (next-turbo-cache-not-ready); next-sz-untransformed
//   (next-transform-failed-closed); next-watcher-not-started (next-watcher-initial-cycle-failed);
//   next-watcher-unclosed (next-watcher-close-failed).
// - esbuild-mangle-unsupported (mangle-esbuild-unsupported).
// - unknown-rule-id / removed-rule-id next to the amendment's config-id-not-settable: the
//   amendment's name has the config- prefix; unknown-rule-id also covers `--rule`, so it has
//   none. Alternative: config-rule-unknown / config-rule-removed, and a separate CLI id.
// - config-* problem ids (config-level-invalid, config-preset-unknown, config-field-unknown,
//   config-field-invalid, config-glob-unmatchable, config-file-duplicate, config-unloadable,
//   config-no-default-export): new; today they are lines inside the config-invalid aggregate.
// - template-sz-invalid for the template aggregate (template-errors).
// - engine-call-failed keeps "failed" because the amendment names it.
//
// Schema decisions to review:
// - Group ids collide with their own kind: dead-class, broken-opacity, sibling-keyword,
//   theme-collision, merge-covered-key and merge-covered-class are both a GROUPS id and a
//   DIAGNOSTICS id (both strings shipped as rule and kind). Uniqueness is enforced except for
//   a diagnostic whose check.group is the same id.
// - Engine ids carry no `check` surface; check reports them under sz-diagnostic by
//   implication (see Surfaces typedef).
// - unsigned-value moved from the engine block to check (ADR amendment 1: it leaves Rust).
// - Derivable args dropped (rule 3), which removes args the ADR examples show:
//   removed-key replacement/values/groups/canonical/note (all from key; the ADR §4 compact
//   example carries `replacement`), moved-value replacingKey/replacingValue and the mask
//   layer key (from key+value), closed-enum-value bare/sibling/allowed, unknown-field allowed,
//   slash-opacity-string color/opacity, color-slash-opacity written/base/important/used,
//   merge-classifier-unavailable engineFormat, nesting-depth maxDepth, runtime-family-conflict
//   first/second (became forms), split-box base/reaching/other/properties/hint, every
//   constant (thresholds, cap 512, MERGE_TABLE_FORMAT, SAFELIST_FILE). `form` itself is
//   derivable from key for removed-key; kept because forms select the sentence.
//   closed-enum-value keeps `suggestion` because amendment 7 names it, though it derives
//   from value.
// - closed-enum-value forms css-value, font-style, font-smoothing are not engine-emitted until
//   PR B; `gaps` is per id, so it is not set here. A per-form gap may be needed.
// - fallback-missing-css / fallback-nudge use the amendment's {site, shape} as enum args, not
//   `forms`; detail, path and keyPath are kept as optional user-data args (callee name,
//   import path, variant key path), which {site, shape} alone cannot carry. shape is
//   optional because the sz-variant-key and sz-array-element sites have none.
// - Two-surface ids with today's different sentences get ONE template, no surface forms:
//   broken-opacity (check + runtime), theme-collision (check + runtime), prefix-disagreement
//   (check + thrown build error; setting/ignoreSetting optional for the build help). The
//   wording has to converge, as the 19 runtime sites converge on the engine wording.
// - The TS runtime suffix "sz object was {shape} · from {frame}" (unknown-key, canonical-key,
//   removed-key, numeric-key with no location) is not modelled as per-id args: frame is a
//   location stand-in. Proposal: a lane-level note on positionless runtime records.
// - Numbers from source are strings (amendment 8): off-scale-value value is 'string'.
// - position is per id; forms can disagree: parse-error 'site' (panicked/prescan have no
//   offset), next-mangle-vars-unsupported 'file' (prebuild form has none),
//   mangle-vars-hoist-skipped 'site' (Issue.start is the expression span, though the text
//   names none).
// - runtime.production is false for every Node-only line (no browser build prints it).
// - error.classes lists csszyx classes only; bare Error/TypeError/SyntaxError/RangeError omitted.
// - CSSZYX_NATIVE_UNAVAILABLE: since '0.18.0' is the release that renames it; it shipped from
//   v0.9.0 (git grep), recorded in `reason` since the schema has no first-tag field.
// - REMOVED holds only `other` from v0.17.2 tags: the 18 shipped kinds and the 5 shipped
//   --rule ids (sz-diagnostic, dead-class, broken-opacity, sibling-keyword, theme-collision)
//   are all live; unsigned-value, prefix-disagreement, merge-covered-* never shipped in a tag.
//   custom-class, unknown-class, classname-expression-merge deleted, not tombstoned.
//
// Inventory sites left out on purpose:
// - Out of scope (amendment 5): MCP JSON-RPC errors and banners (mcp-server index.ts:259, 285,
//   301, 324, 328, 358, 359, 382; resources/index.ts:266; prompts/index.ts:128); debug traces
//   ([csszyx:bench], [csszyx/vue], 8 sites) and initRuntime({ debug }) logs
//   (runtime/src/index.ts:209 "already initialized", :226 "initialized"); CLI result output
//   (63 sites, plus check.ts:382 and merge-audit-report.ts:56 "skipped" status lines);
//   rethrows (40); cac flag errors (cli/src/bin.ts:387).
// - Passthrough sinks, exempt by sink identity (their line already carries its code):
//   diagnostic-limiter.ts:234, jest-transform.ts:436, :806, :807 (spread relay, prefixes
//   "[csszyx] " to a rendered line), next-loader-diagnostics.ts:172, next-turbo-loader.ts:663,
//   sync-lane-policy.ts:239, unplugin.ts:3275, 3355, 6799, 7418, 8084, 8109, 8125,
//   cli check.ts:1221, next-prebuild.ts:79, 81, 112, 119, 208, next-watch.ts:509, 533, 538,
//   svelte-adapter index.ts:100, compiler template-sz.ts:233 (re-placed engine diagnostic).
//   The icon prefixes at next-prebuild.ts:208 and next-watch.ts:509/533/538 must go (nothing
//   before the token), but need no id.
// - Never shown or not a message: vscode safe-eval.ts:75 NotStatic, ts-plugin index.ts:134
//   DeadlineExceeded, next-loader-diagnostics.ts:186 (warning carrier), tailwind-availability.ts:150
//   (imitates Node's MODULE_NOT_FOUND), next-watch.ts:324 and next-turbo-loader.ts:501
//   (String(error) normalisers), jest-transform.ts:435 (throws the child's stderr verbatim).
// - The ts-messages `readers` section lists consumers, not messages.
// - css-mangler.ts:330 is debug-gated; given an id (mangle-selector-unparsable) anyway because
//   it carries the [csszyx] tag the sink gate reads. Drop it if debug-gated lines count as traces.
//
// Merges (two or more inventory entries -> one id):
// - Engine + TS runtime twins (19 runtime sites): unknown-key, canonical-key, removed-key,
//   numeric-key, closed-enum-value, slash-opacity-string, off-scale-value, numeric-font-weight,
//   per-side-border-style, property-object, non-variant-object, unknown-field, moved-value,
//   global-before-group, color-slash-opacity.
// - closed-enum-value: TS alignment CSS value (transform-core.ts:1267), fontStyle (:3391),
//   fontSmoothing (:3380) as forms (amendment 7).
// - parse-error: engine summary/syntax/panicked + template-sz NOT_AN_EXPRESSION + explain
//   parse form (ExplainParseError) + unplugin prescan parse skip (unplugin.ts:4797).
// - ast-budget: engine + unplugin prescan budget skip (unplugin.ts:1204).
// - engine-call-failed: wasm/napi throws + unplugin prescan transform failure (unplugin.ts:4602).
// - native-engine-unavailable: CsszyxNativeUnavailableError forms + RustTransformUnavailableError
//   wrapper + unplugin wasm-fallback notice (unplugin.ts:3522).
// - internal-error: next-source-transformer.ts:53, unplugin.ts:2940 (unreadStylesheetsError,
//   thrown at 4321/5757), unplugin.ts:1908 (alias-table mismatch), next-watcher.ts:132,
//   stable-file-snapshot.ts:44, map-concurrent.ts:39, project-resolver.ts:118, and the
//   "returned no result" forms of transform-rust.ts:69 / transform-wasm.ts:209.
// - prefix-disagreement: check kind + thrown styleModelError 'prefixes' form.
// - tailwind-stylesheet-broken: styleModelError 'broken' form at unplugin.ts:5598 and
//   next-stylesheet-facts.ts:376 (same sites as prefix-disagreement, other form).
// - theme-collision: check pass + runtime merge-groups.ts:537. broken-opacity: check pass +
//   TS runtime transform-core.ts:2875.
// - merge-covered-key / merge-covered-class: check pass + unplugin build console (unplugin.ts:4020).
// - sz-object-depth: SzDepthError (12 throw sites) + szv config depth warning (variants.ts:263).
// - web-crypto-unavailable: console warning + throw (hydration.ts:445, :350).
// - recovery-manifest-unreadable: runtime verify.ts:145 + compiler manifest.ts:231.
// - mangle-map-unreadable: hydration.ts:211 (schema) + :218 (json).
// - diagnostics-capped: limiter cap line + runtime dev-warn cap + TS unknown-key cap
//   (inventory warning-cap-reached, two forms).
// - csr-recovery-dev-only: runtime warning + build "Stripped N tokens" line (unplugin.ts:7924).
// - sz-attribute-syntax: parse-sz-attribute.ts:38 throw + csszyx browser.ts:77 console.
// - unknown-rule-id: config `rules` typo + `csszyx check --rule/--ignore-rule` unknown id.
// - config-unloadable: csszyx-config-file.ts:585/591 + sync-lane-policy configNotReadMessage.
// - no-source-files: next-watch.ts:267 throw + next-prebuild.ts:150 console.
// - options-object-required: transform() + csszyxTurbopack().
// - legacy-source-directive: safelist-source.ts:248, postcss.ts:79, unplugin.ts:6726.
// - project-reload: unplugin.ts:3464 (config), 6327 (merge groups), 6336 (prefix).
// - removed-option: removedInjectChecksumMessage + removedMangleMapDeliveryMessage.
// - Duplicate texts in two files: szv-unknown-variant(-value) at variants.ts and szv-pick.ts;
//   cli-option-invalid parser-mode at next-prebuild.ts:230 and next-watch.ts:719.
// Kept apart although close: merge-table-format-skew (runtime szcn) vs
// merge-classifier-unavailable (engine; its summary says "this engine");
// nesting-depth vs sz-object-depth; lowering-not-loaded vs lite-sz-object vs uncompiled-sz;
// watch-prefix-changed (error, restart) vs project-reload prefix form (dev server reloaded).
