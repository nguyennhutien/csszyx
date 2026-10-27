/**
 * Every public diagnostic id csszyx produces, on every surface (ADR 0031).
 *
 * One entry per condition: a problem that the engine reports, a `csszyx check`
 * pass finds, the runtime prints or a call throws keeps ONE id, and `surfaces`
 * says where it shows. The generator reads this module and writes the Rust
 * enum (ids with `surfaces.engine` only), the TypeScript types, the Node
 * registry and the docs data for `/e/<id>`. Per-code browser exports come with
 * the runtime reporter that imports them, so no bundle carries an unused one.
 *
 * Ids are a one-way door: they reach `rules`, `check --json`, `err.code` and
 * the console of deployed apps. Renaming one is a breaking change, and the old
 * id moves to `REMOVED`, never out of this file.
 *
 * `sources` records the files each id is produced in, `packages/<path>`. No
 * line numbers: every consumer reads the file only, and an unchecked line
 * went stale with the next edit above it.
 *
 * @module
 */

/** Bumped when a consumer of this module would have to change. */
export const REGISTRY_FORMAT = 1;

/**
 * Values a template may name beside its args, each with the args it reads. Each is derived from data both
 * engines read from one source, or a constant, never by running engine logic
 * again: the renderer's helper for each lives in
 * `packages/compiler/src/diagnostic-render-helpers.ts`, and a test there holds
 * the two lists equal.
 */
/**
 * Engine limits a sentence names. Generated into the Rust engine, which
 * enforces them, and into the renderer, which prints them: one number.
 */
export const CONSTANTS = {
    /** The deepest source nesting the engine parses; deeper is refused. */
    maxNestingDepth: { rust: 'MAX_SOURCE_NESTING_DEPTH', type: 'usize', value: 64 },
    /** The merge table format the engine reads. */
    mergeTableFormat: { rust: 'MERGE_TABLE_FORMAT', type: 'u32', value: 1 },
};

export const COMPUTED = {
    canonical: {
        reads: ['key'],
        summary: 'The canonical key of `key` (SUGGESTION_MAP).',
    },
    note: {
        reads: ['key'],
        summary: 'The migration note of `key` (MIGRATION_NOTES).',
    },
    enumAllowed: {
        reads: ['key'],
        summary: 'The values closed-enum `key` takes, joined by ", " (CLOSED_ENUM_CLASSES).',
    },
    canonicalAllowed: {
        reads: ['key'],
        summary:
            'The values the canonical key of `key` takes, joined by ", " (SUGGESTION_MAP, CLOSED_ENUM_CLASSES).',
    },
    bare: {
        reads: ['key', 'value'],
        summary: 'The class `key: value` emits without a table (CLOSED_ENUM_AFFIXES).',
    },
    movedKey: {
        reads: ['key', 'value'],
        summary: 'The key `key: value` moved to (CLOSED_ENUM_VALUE_MOVES, SUGGESTION_MAP).',
    },
    movedValue: {
        reads: ['key', 'value'],
        summary: 'The value it moved with, as a JS literal: `true` bare, otherwise quoted.',
    },
    groups: {
        reads: ['key'],
        summary:
            'The group keys of the canonical key of `key`, joined by ", " (GLOBAL_KEYWORD_GROUPS).',
    },
    maxNestingDepth: {
        reads: [],
        summary: "The engine's source nesting limit (MAX_SOURCE_NESTING_DEPTH).",
    },
    mergeTableFormat: {
        reads: [],
        summary: 'The merge table format this engine reads (MERGE_TABLE_FORMAT).',
    },
    fallbackReason: {
        reads: ['shape', 'detail', 'path', 'keyPath'],
        summary: 'Why the value fell back, from the generated sz fallback matrix for `shape`.',
    },
    fallbackSuggestion: {
        reads: ['shape'],
        summary: 'What to write instead, from the same matrix.',
    },
    earlier: {
        reads: ['classes', 'szCount', 'szAt'],
        summary: 'The classes and `sz` of the sides before the last, as a reader names them.',
    },
    example: {
        reads: ['parts'],
        summary: 'The items of the one `sz` array that replaces them.',
    },
    spreadPlace: {
        reads: ['spread'],
        summary: 'Where that array goes: after the spread named by `spread`, or "the spread".',
    },
    spellingHint: {
        reads: ['suggestion'],
        summary:
            'A `suggestion` as "write `…` if you meant it", or "check the spelling" without one.',
    },
    parserMessage: {
        reads: ['message'],
        summary: "The parser's `message`, without a closing period of its own.",
    },
    groupLiteral: {
        reads: ['groupValue'],
        summary: '`groupValue` as a JS literal: `true` bare, otherwise quoted.',
    },
    valueLiteral: {
        reads: ['value', 'valueType'],
        summary:
            '`value` as the JS literal it was written as: a string quoted, a number or boolean bare.',
    },
};

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
 * @property {{ production: boolean | string[], host: Host, console?: 'error' }} [runtime] - Printed to the
 *   console: by the runtime, dynamic or compiler browser entries, or by a Node
 *   build/CLI. `production` is true when it prints in a production browser
 *   build, or the forms that do when only some of them do; it is always false
 *   for a Node-only line. `console: 'error'` when the line prints through
 *   `console.error`; absent, it prints through `console.warn`.
 * @property {{ classes?: string[], production?: boolean, host: Host }} [error] - Thrown.
 *   `classes` names the csszyx error classes that carry it today; a bare
 *   `Error`/`TypeError` is not listed. `production: false` marks a throw that
 *   only a development build reaches; absent, a production build throws it too.
 */

/**
 * Where a console line prints or an error is thrown, required on `runtime` and
 * `error`: `browser` when every site sits in a file a browser bundle can hold
 * (the runtime, dynamic and vars packages, the umbrella's browser entries,
 * and the compiler files its browser subpaths reach — see
 * `scripts/diagnostics/browser-sources.mjs`), `node` when none does, `both`
 * otherwise. The generator checks it against `sources`: the places the
 * sources run in must equal the places the surfaces declare, an engine or
 * check id counting as Node. It decides where the words ship: the browser
 * module carries every console or thrown id, the Node registry only the ids
 * Node renders (engine, check, and a `node` or `both` host).
 *
 * @typedef {'browser' | 'node' | 'both'} Host
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
 * @property {string[]} sources - The files it is produced in today, `packages/<path>`.
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
        surfaces: {
            engine: {},
            runtime: {
                production: false,
                host: 'browser',
            },
        },
        position: 'site',
        args: { key: STRING, suggestion: OPTIONAL_STRING },
        text: '`{key}` is not an sz property.',
        help: "{spellingHint}; for a custom utility, define it with Tailwind's `@utility`.",
        note: 'the class is still emitted, and it styles nothing unless Tailwind serves that utility.',
        sources: [ENGINE, CORE_TS],
    },
    {
        id: 'canonical-key',
        summary: 'An alias of a key, with the canonical spelling to write.',
        surfaces: { engine: {}, runtime: { production: false, host: 'browser' } },
        position: 'site',
        forms: ['alias', 'font', 'scrollbar-color'],
        args: { form: formArg(['alias', 'font', 'scrollbar-color']), key: STRING },
        text: {
            alias: '`{key}` is an alias of `{canonical}`, and nothing is emitted for it.',
            font: '`{key}` is not an sz key, and nothing is emitted for it.',
            'scrollbar-color': '`{key}` is not an sz key, and nothing is emitted for it.',
        },
        help: {
            alias: 'write `{canonical}`.',
            font: 'write `weight` for the font weight, or `fontFamily` for the font family.',
            'scrollbar-color':
                'write `scrollbarThumb` for the thumb colour, or `scrollbarTrack` for the track colour.',
        },
        sources: [ENGINE, CORE_TS],
    },
    {
        id: 'removed-key',
        summary: 'A key that was removed or replaced, with what to write instead.',
        surfaces: { engine: {}, runtime: { production: true, host: 'browser' } },
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
        text: {
            'runtime-alias':
                '`{key}` is an alias of `{canonical}`, and nothing is emitted for its runtime value.',
            'sugar-replaced': '`{key}` was replaced, and nothing is emitted for it.',
            sugar: 'The boolean shorthand `{key}` was removed, and nothing is emitted for it.',
            removed: '`{key}` was removed, and nothing is emitted for it.',
            replaced: '`{key}` was replaced, and nothing is emitted for it.',
        },
        help: {
            'runtime-alias':
                'write the values {canonicalAllowed} on `{canonical}`, and any other value on its own key: {groups}.',
            'sugar-replaced': 'write `{ {replacement} }` instead, or run `csszyx migrate`.',
            sugar: 'write `{ {replacement} }` instead, or run `csszyx migrate`.',
            removed: '{note}.',
            replaced: 'write `{ {replacement} }` instead, or run `csszyx migrate`.',
        },
        sources: [ENGINE, CORE_TS],
    },
    {
        id: 'numeric-key',
        summary: 'A numeric key, the mark of an array or spread passed as an sz object.',
        surfaces: { engine: {}, runtime: { production: false, host: 'browser' } },
        position: 'site',
        args: { key: STRING },
        text: '`sz` received a numeric key `{key}`, and its value is ignored.',
        help: 'pass an object of sz keys here; a numeric key usually means an array or a spread was passed in its place.',
        sources: [ENGINE, CORE_TS],
    },
    {
        id: 'closed-enum-value',
        summary: 'A value a closed-enum key does not take.',
        // The sibling-group form prints in production: the runtime reported
        // `{ contain: 'size', containPaint: true }` as global-before-group,
        // which does, and moving it here must not make a production page quiet.
        surfaces: { engine: {}, runtime: { production: ['sibling-group'], host: 'browser' } },
        position: 'site',
        forms: ['sibling-group', 'dead', 'css-value', 'font-style', 'font-smoothing'],
        args: {
            form: formArg(['sibling-group', 'dead', 'css-value', 'font-style', 'font-smoothing']),
            key: STRING,
            value: STRING,
            suggestion: OPTIONAL_STRING,
            // The sibling-group form only: the group the engine found the
            // class in, by a search the renderer must not run a second time.
            groupKey: OPTIONAL_STRING,
            groupValue: OPTIONAL_STRING,
        },
        text: {
            'sibling-group':
                "`{key}: '{value}'` is not a `{key}` value; its class `{bare}` belongs to `{ {groupKey}: {groupLiteral} }`.",
            dead: "`{key}: '{value}'` is not a `{key}` value.",
            'css-value': "`{key}: '{value}'` is a CSS value, and `{key}-{value}` produces no CSS.",
            'font-style':
                "`{key}: '{value}'` has no Tailwind class, and nothing is emitted for it.",
            'font-smoothing':
                "`{key}: '{value}'` has no Tailwind class, and nothing is emitted for it.",
        },
        help: {
            'sibling-group':
                'write `{ {groupKey}: {groupLiteral} }`, so it combines with the other groups instead of resetting them.',
            dead: 'use one of: {enumAllowed}.',
            'css-value': "use the short form: `{ {key}: '{suggestion}' }`.",
            'font-style':
                "use `'italic'` or `'normal'`; for any other style, such as oblique, write `css: { fontStyle: '{value}' }`.",
            'font-smoothing': "use `'grayscale'` or `'subpixel'`.",
        },
        note: {
            'sibling-group': '`{key}` takes one of: {enumAllowed}.',
            dead: 'the class `{bare}` is still emitted, and only the CSS that Tailwind or your own stylesheet defines for it applies.',
        },
        sources: [ENGINE, CORE_TS],
    },
    {
        id: 'slash-opacity-string',
        summary:
            'A colour key given its opacity in a string, which emits nothing; the object form takes it.',
        surfaces: { engine: {}, runtime: { production: true, host: 'browser' } },
        position: 'site',
        // The value as written is `{color}/{opacity}`, split on its first `/`.
        args: { key: STRING, color: STRING, opacity: STRING },
        text: "`{key}: '{color}/{opacity}'` emits nothing: a string value cannot carry a slash opacity.",
        help: "use the object form: `{ color: '{color}', op: {opacity} }`.",
        sources: [ENGINE, 'packages/compiler/src/color-validation.ts'],
    },
    {
        id: 'off-scale-value',
        summary: "A spacing value off Tailwind's quarter-step scale.",
        surfaces: { engine: {}, runtime: { production: false, host: 'browser' } },
        position: 'site',
        args: { key: STRING, value: STRING },
        text: "`{key}: {value}` is not on Tailwind's spacing scale, so the class produces no CSS.",
        help: "use a quarter step such as `1.25`, `1.5` or `1.75`, or a unit value such as `'{value}rem'`.",
        sources: [ENGINE, CORE_TS],
    },
    {
        id: 'numeric-font-weight',
        summary: 'A font weight written as a numeric string.',
        surfaces: { engine: {}, runtime: { production: false, host: 'browser' } },
        position: 'site',
        args: { value: STRING },
        text: "`weight: '{value}'` is a numeric string, so `font-{value}` produces no CSS.",
        help: 'write `weight: {value}` as a number; it emits `font-[{value}]`.',
        sources: [ENGINE, CORE_TS],
    },
    {
        id: 'per-side-border-style',
        summary: 'A border style on one side, which Tailwind cannot express.',
        surfaces: { engine: {}, runtime: { production: false, host: 'browser' } },
        position: 'site',
        args: { key: STRING, value: STRING },
        text: "`{key}: '{value}'` emits nothing: Tailwind has no per-side border style.",
        help: "use `borderStyle: '{value}'` for every side, or a number on `{key}` for the width.",
        sources: [ENGINE, CORE_TS],
    },
    {
        id: 'property-object',
        summary: 'An object on a key that names a property, not a variant.',
        surfaces: { engine: {}, runtime: { production: false, host: 'browser' } },
        position: 'site',
        args: { key: STRING, nestedKeys: { type: 'string[]', joiner: ', ' } },
        text: '`{key}` sets a property and is not a variant, so its object `{ {nestedKeys} }` emits `{key}:*` classes that produce no CSS.',
        help: "move the nested keys up a level; for colour opacity, write `{ color: '…', op: … }`.",
        sources: [ENGINE, CORE_TS],
    },
    {
        id: 'non-variant-object',
        summary: 'An object on a csszyx-owned key that is not a variant.',
        surfaces: { engine: {}, runtime: { production: false, host: 'browser' } },
        position: 'site',
        args: { key: STRING },
        text: '`{key}` is not a variant, so its object emits `{key}:` classes that produce no CSS.',
        help: 'a `--*` key takes a declaration value; `container` takes `true`.',
        sources: [ENGINE, CORE_TS],
    },
    {
        id: 'unknown-field',
        summary: 'A field a structured value (a mask layer) does not take.',
        surfaces: { engine: {}, runtime: { production: false, host: 'browser' } },
        position: 'site',
        // `allowed` travels: the mask member tables are not shared data, and
        // picking one means parsing `owner`.
        args: { owner: STRING, member: STRING, allowed: { type: 'string[]', joiner: ', ' } },
        text: '`{owner}` has no field `{member}`, and nothing is emitted for it.',
        help: '`{owner}` takes `{ {allowed} }`.',
        sources: [ENGINE, CORE_TS],
    },
    {
        id: 'runtime-value',
        summary: 'A runtime value on a key with no CSS-variable utility.',
        surfaces: { engine: {} },
        position: 'site',
        args: { key: STRING },
        text: '`{key}` cannot take a runtime value: Tailwind has no utility for this key that reads a CSS variable.',
        help: 'name the values with `szv()`, or use `dynamic()` for open-ended data.',
        note: 'no class or variable is emitted for `{key}`.',
        sources: [ENGINE],
    },
    {
        id: 'unresolvable-spread',
        summary: 'A spread in an sz object the build cannot resolve.',
        surfaces: { engine: {} },
        position: 'site',
        args: {},
        text: 'This `sz` object spreads a value the build cannot read, so the object falls back to the runtime.',
        help: 'use the array form: `sz={[x, { … }]}` in place of `sz={{ ...x, … }}`.',
        note: 'the classes of the spread value were not collected, so they produce no CSS unless another source names them.',
        sources: [ENGINE],
    },
    {
        id: 'style-override',
        summary: 'A props spread that may override the style sz emits.',
        surfaces: { engine: {} },
        position: 'site',
        args: {},
        text: 'This element spreads props that may carry `style`, and the `style` that `sz` writes can replace it.',
        help: 'move the spread `style` to an explicit `style` prop, so csszyx merges both values.',
        sources: [ENGINE],
    },
    {
        id: 'szs-slot-map',
        summary: 'An szs slot map the build cannot read, or one on a host element.',
        surfaces: { engine: {} },
        position: 'site',
        forms: ['host-element', 'unreadable-slot'],
        args: { form: formArg(['host-element', 'unreadable-slot']) },
        text: {
            'host-element':
                '`szs` has no effect on a host element; it maps the slot names of a custom component.',
            'unreadable-slot':
                'A slot value in `szs` could not be read at build time, so no slot classes were compiled.',
        },
        help: {
            'host-element':
                'remove `szs`, or move it to the custom component whose slots it names.',
            'unreadable-slot':
                'write every slot as an identifier key with a static object literal or class string; for a value known only at runtime, pass the class string `dynamic()` returns.',
        },
        note: 'the attribute is left unchanged.',
        sources: [ENGINE],
    },
    {
        id: 'sz-recover',
        summary: 'An szRecover value the build cannot read.',
        surfaces: { engine: {} },
        position: 'site',
        forms: ['non-literal', 'unknown-mode'],
        args: { form: formArg(['non-literal', 'unknown-mode']), mode: OPTIONAL_STRING },
        text: {
            'non-literal': '`szRecover` takes only a string literal.',
            'unknown-mode': '`szRecover` has an unknown mode `"{mode}"`.',
        },
        help: {
            'non-literal': 'write `szRecover="csr"` or `szRecover="dev-only"`.',
            'unknown-mode': 'use `"csr"` or `"dev-only"`.',
        },
        note: 'no `data-sz-recovery-token` is written for this element.',
        sources: [ENGINE],
    },
    {
        id: 'class-precedence',
        summary: 'A runtime className beside sz, which sz overrides.',
        surfaces: { engine: {} },
        // A choice the author made, not a mistake: sz wins over a runtime className.
        defaults: { recommended: 'info', atomic: 'warn' },
        position: 'site',
        args: {},
        text: "`sz` wins over the runtime `className` on this element in any attribute order, so a caller's `className` cannot override these styles.",
        help: 'state the order in one `sz` array: `sz={[{ … }, className]}` for the caller to win, `sz={[className, { … }]}` for these styles to win.',
        sources: [ENGINE],
    },
    {
        id: 'duplicate-sz',
        summary: 'An element with more than one sz attribute, merged in order.',
        surfaces: { engine: {} },
        // A choice the author made: two sz attributes merge in order.
        defaults: { recommended: 'info', atomic: 'warn' },
        position: 'site',
        args: { elementName: STRING, count: NUMBER },
        text: '`<{elementName}>` carries {count} `sz` attributes, merged in order as `sz={[first, …, last]}`: the later one wins for each property.',
        help: 'fold them into one `sz` array, so the order is written down.',
        sources: [ENGINE],
    },
    {
        id: 'spread-split-class',
        summary: 'Class names and sz on more than one side of a spread.',
        surfaces: { engine: {} },
        position: 'site',
        // Raw parts only; the sentence names them. `classes` are the class
        // names written before the spread, `szCount` the earlier `sz`
        // attributes and `szAt` where they sit among the classes, `spread`
        // the spread's text when it is a plain name, and `parts` the items
        // of the one `sz` array that would replace them.
        args: {
            elementName: STRING,
            classes: { type: 'string[]', joiner: ' and ' },
            szCount: NUMBER,
            szAt: NUMBER,
            spread: OPTIONAL_STRING,
            parts: { type: 'string[]', joiner: ', ' },
        },
        text: '`<{elementName}>` has class names or `sz` on more than one side of a spread; in React, Preact, Solid and Qwik the last class attribute replaces the others, so {earlier} will not apply there.',
        help: 'write them in one `sz` array after {spreadPlace}, in the order that should win: `sz={[{example}]}`.',
        note: 'in Vue JSX every class is merged, so every side applies there.',
        sources: [ENGINE],
    },
    {
        id: 'moved-value',
        summary: 'A value that moved to another key, with the key to write.',
        surfaces: { engine: {}, runtime: { production: true, host: 'browser' } },
        position: 'site',
        forms: ['value', 'mask-layer'],
        args: {
            form: formArg(['value', 'mask-layer']),
            key: STRING,
            value: STRING,
            // The mask-layer form only: the layer key the value belongs to,
            // found by parsing it.
            layerKey: { type: ['enum', 'maskLinear', 'maskRadial', 'maskConic'], optional: true },
        },
        text: {
            value: "`{key}: '{value}'` moved to `{movedKey}`, and nothing is emitted for it.",
            'mask-layer':
                "`mask: '{value}'` names a gradient layer, which moved to `{layerKey}`, and nothing is emitted for it.",
        },
        help: {
            value: 'write `{ {movedKey}: {movedValue} }`, or run `csszyx migrate`.',
            'mask-layer':
                'write this layer on `{layerKey}`; `mask` takes only `none`, a `url()` or a CSS variable.',
        },
        sources: [ENGINE, CORE_TS],
    },
    {
        id: 'global-before-group',
        summary: 'A stand-alone keyword written before a group key that replaces it.',
        surfaces: { engine: {}, runtime: { production: true, host: 'browser' } },
        position: 'site',
        args: {
            global: STRING,
            // Any literal, as text; its type says how the line spells it.
            value: STRING,
            valueType: { type: ['enum', 'string', 'number', 'boolean'] },
            group: STRING,
        },
        text: '`{global}: {valueLiteral}` comes before `{group}` in one sz object, so `{group}` replaces it and the `{global}` value styles nothing.',
        help: 'to override the group, layer it: `sz={[base, { {global}: {valueLiteral} }]}`.',
        note: 'a spread such as `{ ...base, {global}: {valueLiteral} }` keeps the same key order, so it does not fix this.',
        sources: [ENGINE, CORE_TS],
    },
    {
        id: 'runtime-family-conflict',
        summary: 'A runtime value beside the other side of its key family.',
        surfaces: { engine: {} },
        position: 'site',
        forms: ['key-first', 'other-first'],
        args: { form: formArg(['key-first', 'other-first']), key: STRING, other: STRING },
        text: "`{key}` takes a runtime value beside `{other}` in one sz object, so both classes can be emitted and Tailwind's stylesheet order decides which applies, whatever the object's order.",
        help: {
            'key-first': 'layer them, later wins: `sz={[{ {key}: … }, { {other}: … }]}`.',
            'other-first': 'layer them, later wins: `sz={[{ {other}: … }, { {key}: … }]}`.',
        },
        sources: [ENGINE],
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
        variesBy: 'site',
        text: {
            sz: '`sz` falls back to the runtime: {fallbackReason}.',
            szr: '`szr` falls back to the runtime: {fallbackReason}.',
            szv: 'The `szv` config cannot be read at build time: {fallbackReason}.',
            'sz-variant-key': '`sz` falls back to the runtime: {fallbackReason}.',
        },
        help: {
            sz: '{fallbackSuggestion}',
            szr: '{fallbackSuggestion}',
            szv: 'pass the config inline, or as a module-level const object literal.',
            'sz-variant-key': '{fallbackSuggestion}',
        },
        note: {
            sz: 'its classes were not collected, so they produce no CSS unless another source names them.',
            szr: 'its classes were not collected, so they produce no CSS unless another source names them.',
            szv: 'none of its variant classes were collected, so they produce no CSS unless another source names them.',
        },
        sources: [ENGINE],
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
        variesBy: 'site',
        text: {
            sz: '`sz` falls back to the runtime: {fallbackReason}.',
            'sz-array-element':
                'This `sz` array element is an object literal with a runtime value, so the whole element is resolved at runtime.',
        },
        help: {
            sz: '{fallbackSuggestion}',
            'sz-array-element':
                'use finite literal ternary branches where you can, or move the runtime values to `dynamic()`.',
        },
        note: {
            sz: 'the runtime still turns the value into classes.',
            'sz-array-element': 'its classes are still collected, best-effort.',
        },
        sources: [ENGINE],
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
        text: {
            unreadable:
                'The merge table is not one this engine reads ({error}), so the build removes no class that a later sz key covers.',
            'format-mismatch':
                'The merge table is in format {tableFormat}, and this csszyx version reads format {mergeTableFormat}, so the build removes no class that a later sz key covers.',
        },
        help: 'install the same csszyx version of every `@csszyx` package, then rebuild; under Turbopack, delete `.csszyx/merge-table.json` and run `csszyx next prebuild`.',
        note: 'every class is kept, as before 0.18, so `{ pb: 2, p: 4 }` emits both and the stylesheet order decides.',
        sources: [ENGINE],
    },
    {
        id: 'parse-error',
        summary: 'A file the parser rejected, which contributes no classes.',
        surfaces: {
            engine: {},
            runtime: { production: false, host: 'node' },
            error: { host: 'node', classes: ['ExplainParseError'] },
        },
        position: 'site',
        forms: ['syntax', 'summary', 'panicked', 'expression', 'prescan'],
        args: {
            form: formArg(['syntax', 'summary', 'panicked', 'expression', 'prescan']),
            message: OPTIONAL_OPAQUE,
            errorCount: OPTIONAL_NUMBER,
        },
        text: {
            syntax: 'Syntax error: {parserMessage}.',
            summary: 'This file could not be parsed (syntax errors: {errorCount}).',
            panicked: 'The parser stopped at a syntax error it could not recover from.',
            expression: 'This `sz` value could not be parsed as a JavaScript expression.',
            prescan:
                'The prescan could not parse this file, so none of its classes reached the safelist.',
        },
        help: {
            syntax: 'fix the syntax at this position.',
            summary: 'fix the syntax errors reported for this file.',
            panicked: 'fix the syntax error reported for this file.',
            expression: 'write the value as an object literal, such as `{ p: 4 }`.',
            prescan: 'fix the syntax error, or check that the file extension matches its contents.',
        },
        note: {
            syntax: 'the file is left unchanged.',
            summary: 'the file is left unchanged.',
            panicked: 'the file is left unchanged.',
            expression: 'the attribute is left as written, and no class is generated for it.',
            prescan: 'its classes produce no CSS unless another source names them.',
        },
        sources: [
            'packages/core/src/transform/parser.rs',
            'packages/compiler/src/template-sz.ts',
            'packages/cli/src/commands/explain.ts',
            UNPLUGIN,
        ],
    },
    {
        id: 'nesting-depth',
        summary: 'A file nested deeper than the parser guard allows.',
        surfaces: { engine: {} },
        position: 'file',
        args: { depth: NUMBER },
        text: 'Source nesting exceeds {maxNestingDepth} levels (found {depth}).',
        help: 'flatten the structure; nesting this deep usually comes from `sz` or JSX over-nested by hand or by generated code.',
        note: 'the file is left unchanged and contributes no classes.',
        sources: [ENGINE],
    },
    {
        id: 'unsupported-dynamic-sz',
        summary: 'An sz attribute whose value the engine cannot read.',
        surfaces: { engine: {} },
        position: 'site',
        args: {},
        text: 'This `sz` attribute has no value, or a JSX element as its value.',
        help: 'give `sz` a value in braces, such as `sz={{ p: 4 }}`, or remove it.',
        note: 'the attribute is left as written; the rest of the file is still transformed.',
        sources: [ENGINE],
    },
    {
        id: 'ast-budget',
        summary: 'A file over the AST budget, left unchanged.',
        surfaces: { engine: {}, runtime: { production: false, host: 'node' } },
        // No `defaults` on purpose: a file over the budget contributes no class
        // to the safelist, so its styles are missing — an error, as in 0.17.2
        // and by ADR 0011's litmus.
        position: 'file',
        forms: ['transform', 'prescan'],
        args: { form: formArg(['transform', 'prescan']) },
        text: {
            transform: 'This file exceeds the AST node budget.',
            prescan:
                'The prescan skipped this file because it exceeds the AST node budget, so none of its classes reached the safelist.',
        },
        help: 'split the file, or raise `build.astBudgetLimit` in the plugin options; the Turbopack loader takes no budget option, so split the file there.',
        note: {
            transform: 'the file is left unchanged, and none of its classes are collected.',
            prescan: 'its classes produce no CSS unless another source names them.',
        },
        sources: [ENGINE, UNPLUGIN],
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
        variesBy: 'reason',
        text: {
            'no-lca':
                '`mangleVars` did not hoist `{name}`: its {usageCount} usages share no common JSX ancestor.',
            'non-host-ancestor':
                '`mangleVars` did not hoist `{name}`: the common ancestor of its {usageCount} usages cannot take a `style` prop.',
            'max-depth':
                '`mangleVars` did not hoist `{name}`: one of its {usageCount} usages sits more than {maxDepth} levels below their common ancestor.',
        },
        help: {
            'max-depth': 'raise `production.mangleVarHoistMaxDepth` to hoist it.',
        },
        note: 'each element that uses it keeps its own scoped variable, and every class is still emitted.',
        sources: ['packages/core/src/transform/css_var_planner.rs'],
    },
    {
        id: 'color-slash-opacity',
        summary: 'A colour object with a slash opacity in `color`; the object takes it in `op`.',
        surfaces: { engine: {}, runtime: { production: false, host: 'browser' } },
        // The class still applies an opacity either way: a note on the
        // spelling, raised to warn under atomic (user decision 2026-10-18).
        defaults: { recommended: 'info', atomic: 'warn' },
        position: 'site',
        // The colour as written is `{base}/{opacity}{important}`. `op` is the
        // JS literal the author wrote, quotes included for a string.
        forms: ['op-given', 'op-absent'],
        args: {
            form: formArg(['op-given', 'op-absent']),
            key: STRING,
            base: STRING,
            opacity: STRING,
            important: { type: ['enum', '!'], optional: true },
            op: OPTIONAL_STRING,
        },
        text: {
            'op-given':
                "`{key}: { color: '{base}/{opacity}{important}', op: {op} }` sets opacity twice; a colour object takes its opacity in `op`, not in `color`.",
            'op-absent':
                "`{key}: { color: '{base}/{opacity}{important}' }` puts the opacity in `color`; a colour object takes it in `op`.",
        },
        help: {
            'op-given': "write `{ color: '{base}{important}', op: {op} }`.",
            'op-absent': "write `{ color: '{base}{important}', op: {opacity} }`.",
        },
        note: {
            'op-given': 'the class uses `op: {op}`; the `/{opacity}` in `color` is ignored.',
            'op-absent': 'the class still applies opacity {opacity}.',
        },
        sources: [ENGINE, CORE_TS],
    },
    {
        id: 'bracketed-value',
        summary: 'A value wrapped in the brackets or parentheses csszyx writes itself.',
        surfaces: { engine: {}, runtime: { production: false, host: 'browser' } },
        position: 'site',
        args: { key: STRING, value: STRING, inner: STRING },
        text: "`{key}: '{value}'` wraps its value in brackets or parentheses, which csszyx writes itself, so nothing is emitted for it.",
        help: "write `{key}: '{inner}'`; grid line names at both ends, such as `[a] 1fr [b]`, go in `css: { … }`.",
        sources: [ENGINE, CORE_TS],
    },
    {
        id: 'opacity-value',
        summary:
            'An `op` that is not a number from 0 to 100, or one below 1 that reads as a fraction.',
        surfaces: { engine: {}, runtime: { production: false, host: 'browser' } },
        position: 'site',
        // `range`: no opacity is written. `fraction`: 0 < op < 1 is written as
        // the percent it is, and said, because 0.17 bracketed such a decimal
        // and Tailwind read it as a fraction of one (`op: 0.05` was 5%).
        forms: ['range', 'fraction'],
        // `op` is the JS literal the author wrote, quotes included for a string;
        // `percent` is `op` times 100, the fraction form only.
        args: {
            form: formArg(['range', 'fraction']),
            key: STRING,
            op: STRING,
            percent: OPTIONAL_STRING,
        },
        text: {
            range: '`{key}: { op: {op} }` is not a number from 0 to 100, so the colour is written without an opacity.',
            fraction:
                '`{key}: { op: {op} }` is {op}% opacity: `op` is a percent, not a fraction of 1.',
        },
        help: {
            range: 'write `op` as a number from `0` to `100`, such as `op: 50` or `op: 33.3`.',
            fraction: 'write `op: {percent}` for {percent}%.',
        },
        sources: [ENGINE, CORE_TS],
    },

    // --- check: kinds a non-engine `csszyx check` pass reports ---
    {
        id: 'unsigned-value',
        summary: 'A negative value on a key Tailwind serves no negative utility for.',
        surfaces: { check: { group: 'dead-class' }, runtime: { production: false, host: 'node' } },
        position: 'file',
        args: { className: STRING, utility: STRING },
        text: "`{className}` produces no CSS: this project's Tailwind serves `{utility}` but no negative form of it.",
        help: "drop the sign, or define the negative with Tailwind's `@utility`; `csszyx check --rule unsigned-value` lists every one.",
        note: 'the class is still emitted, and it styles nothing.',
        sources: [CHECK, 'packages/unplugin/src/dead-class.ts'],
    },
    {
        id: 'inert-keyword',
        summary: 'A CSS-wide keyword on a served class that no property it sets takes.',
        surfaces: { check: { group: 'dead-class' }, runtime: { production: false, host: 'node' } },
        position: 'file',
        args: { className: STRING, keyword: STRING },
        text: "`{className}` sets no property to `{keyword}`: this project's Tailwind writes the keyword into a custom property or inside another value.",
        help: "set the CSS property to `'{keyword}'` in `css: { … }`; `csszyx check --rule inert-keyword` lists every one.",
        note: 'the class is still emitted, and it styles nothing.',
        sources: [CHECK, 'packages/unplugin/src/dead-class.ts'],
    },
    {
        id: 'dead-class',
        summary: "An emitted class this project's Tailwind generates no CSS for.",
        surfaces: { check: { group: 'dead-class' }, runtime: { production: false, host: 'node' } },
        position: 'file',
        args: { className: STRING },
        text: "`{className}` produces no CSS: this project's Tailwind serves no such utility.",
        help: "fix the sz key or value, or define the class with Tailwind's `@utility`; `csszyx check --rule dead-class` lists every one.",
        note: 'the class is still emitted, and it styles nothing.',
        sources: [CHECK, 'packages/unplugin/src/dead-class.ts'],
    },
    {
        id: 'prefix-disagreement',
        summary: 'Tailwind entries in one project that set different prefixes.',
        surfaces: { check: { group: 'dead-class' }, error: { host: 'node' } },
        position: 'none',
        forms: ['build', 'next', 'check'],
        args: {
            form: formArg(['build', 'next', 'check']),
            entries: { type: 'string[]', joiner: ', ' },
            setting: OPTIONAL_STRING,
            ignoreSetting: OPTIONAL_STRING,
        },
        text: 'The Tailwind stylesheets of this project set different prefixes ({entries}), so no class csszyx emits is served by all of them.',
        help: {
            build: 'give every Tailwind stylesheet the same `@import "tailwindcss"` line, or list the stylesheets this build loads with {setting}.',
            next: 'give every Tailwind stylesheet the same `@import "tailwindcss"` line, list the stylesheets this build loads with {setting}, or leave another app\'s directory out with {ignoreSetting}.',
            check: 'give every Tailwind stylesheet the same `@import "tailwindcss"` line.',
        },
        note: {
            build: 'no module was transformed, and nothing was written.',
            next: 'no module was transformed, and nothing was written.',
            check: 'the dead-class check did not run.',
        },
        sources: [CHECK, UNPLUGIN, 'packages/unplugin/src/next-stylesheet-facts.ts'],
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
        text: "`{key}: '{value}'` emits `{className}`, which sets {sets}, not the property `{key}` sets.",
        help: 'move the value to the key that sets {sets}, or declare a theme token named `{value}` if the spelling was deliberate.',
        note: '`{className}` produces CSS, so no other check reports it.',
        sources: [CHECK],
    },
    {
        id: 'broken-opacity',
        summary: 'An opacity modifier on a colour whose theme value color-mix() cannot dim.',
        surfaces: {
            check: { group: 'broken-opacity' },
            runtime: { production: false, host: 'browser' },
        },
        position: 'site',
        args: { className: STRING, value: STRING },
        gaps: ['engine'],
        text: '`{className}` carries an opacity modifier that does not apply: its theme token resolves to the bare comma triplet `{value}`, which `color-mix()` cannot dim.',
        help: "wrap the token's variable in a colour function, such as `rgb(var(--your-triplet))`.",
        sources: [CHECK, CORE_TS],
    },
    {
        id: 'unserved-variant',
        summary: 'A bare variant name Tailwind serves no variant for, on a utility it serves.',
        // `csszyx check` and the build ask the project's own Tailwind; the
        // runtime reads a table generated from the Tailwind csszyx builds with
        // (`state-variants.generated.ts`), and only for a name csszyx knows as
        // an ARIA state, so it never prints `unknown`. An HTML attribute that
        // is no ARIA state (`inert`) has no form: every Tailwind v4 serves it
        // bare, and the table's generator fails when the pin stops.
        surfaces: {
            check: { group: 'dead-class' },
            runtime: { production: false, host: 'both' },
        },
        position: 'site',
        forms: ['aria', 'attribute-or-aria', 'unknown', 'container-name'],
        // Only the build and `csszyx check` read a container query's name
        // (`@md:sidebar:`), so no browser bundle carries its words.
        buildForms: ['container-name'],
        args: {
            form: formArg(['aria', 'attribute-or-aria', 'unknown', 'container-name']),
            variant: STRING,
            className: STRING,
            // The query a `container-name` name follows (`@md`).
            query: OPTIONAL_STRING,
        },
        // The engines lower every bare key holding an object as an open
        // variant (a project's `@custom-variant`) and cannot see the project's
        // stylesheet: their verdict would be the pinned Tailwind's, which the
        // build lane already gets from the project's own.
        gaps: ['engine'],
        text: '`{className}` produces no CSS: Tailwind serves no `{variant}` variant.',
        help: {
            aria: 'write `aria: { {variant}: { … } }` for the ARIA state.',
            'attribute-or-aria':
                "write `{ '[{variant}]': { … } }` to match the HTML attribute, or `aria: { {variant}: { … } }` for the ARIA state.",
            unknown: 'check the spelling of `{variant}`.',
            'container-name':
                "write `{ '{query}/{variant}': { … } }` for a container named `{variant}`; a name under a query is a variant.",
        },
        note: 'the class is still emitted, and it styles nothing unless the project defines `{variant}` with `@custom-variant`.',
        sources: [CHECK, 'packages/unplugin/src/dead-class.ts', CORE_TS],
    },
    {
        id: 'theme-collision',
        summary: 'A theme token whose name a built-in utility also uses.',
        surfaces: {
            check: { group: 'theme-collision' },
            runtime: { production: false, host: 'browser' },
        },
        position: 'site',
        // One form per surface: check names the built-in classes, the runtime
        // names the kind of built-in the token shadows.
        forms: ['classes', 'utility-keyword', 'value'],
        args: {
            form: formArg(['classes', 'utility-keyword', 'value']),
            name: STRING,
            // The classes form only.
            classes: { type: 'string[]', joiner: '`, `', optional: true },
        },
        text: {
            classes:
                "Theme token `{name}` also names `{classes}`, so Tailwind compiles both meanings into one rule, which sets the token's property and the built-in's.",
            'utility-keyword':
                "Theme token `{name}` shadows a built-in utility keyword, so Tailwind compiles both meanings into one class, which sets the token's property and the built-in's.",
            value: "Theme token `{name}` shadows a built-in value, so Tailwind compiles both meanings into one class, which sets the token's property and the built-in's.",
        },
        help: 'rename the token; while it shares a built-in name, no class order or `szcn` call can fix this.',
        note: 'a later class that sets only one of them does not replace it in `szcn`, so both apply and stylesheet order decides which wins; `classify` reports the built-in meaning only.',
        sources: [CHECK, 'packages/runtime/src/merge-groups.ts'],
    },
    {
        id: 'merge-covered-key',
        summary: 'An sz key the build removed because a later key in the same object covers it.',
        surfaces: {
            check: { group: 'merge-covered-key' },
            runtime: { production: false, host: 'node' },
        },
        // What the build merged away: an audit, never a problem.
        defaults: { recommended: 'info', atomic: 'warn' },
        position: 'site',
        args: { key: STRING, className: STRING },
        text: 'The build removes `{className}`, written as `{key}`, because a later key in the same sz object sets every property it sets.',
        help: 'delete `{key}` from the object; to keep every covered class, set `build.mergeCoveredClasses: false` in the plugin options.',
        sources: [
            'packages/cli/src/scanner/merge-audit-report.ts',
            'packages/unplugin/src/merge-audit.ts',
            UNPLUGIN,
        ],
    },
    {
        id: 'merge-covered-class',
        summary:
            'A className class the build removed because an sz class on the element covers it.',
        surfaces: {
            check: { group: 'merge-covered-class' },
            runtime: { production: false, host: 'node' },
        },
        // What the build merged away: an audit, never a problem.
        defaults: { recommended: 'info', atomic: 'warn' },
        position: 'site',
        args: { className: STRING },
        text: 'The build removes `{className}` from `className`, because an `sz` class on the same element sets every property it sets.',
        help: 'delete `{className}` from `className`; to keep every covered class, set `build.mergeCoveredClasses: false` in the plugin options.',
        sources: [
            'packages/cli/src/scanner/merge-audit-report.ts',
            'packages/unplugin/src/merge-audit.ts',
            UNPLUGIN,
        ],
    },

    // --- runtime: console of the runtime, dynamic and compiler browser entries ---
    {
        id: 'recovery-manifest-unreadable',
        summary: 'A recovery manifest that is not valid JSON or not in the recovery format.',
        surfaces: {
            runtime: { production: true, host: 'browser', console: 'error' },
            error: { host: 'node' },
        },
        position: 'none',
        forms: ['json', 'parse', 'format'],
        // `error` is the parser's own message, on the json and parse forms;
        // `missing` names the absent fields, on the format form.
        args: {
            form: formArg(['json', 'parse', 'format']),
            error: OPTIONAL_OPAQUE,
            missing: { type: 'string[]', joiner: '`, `', optional: true },
        },
        text: {
            json: 'The recovery manifest on this page is not valid JSON, so it is ignored.',
            format: 'This recovery manifest is missing the field(s) `{missing}`, so `parseManifest` cannot read it.',
            parse: 'This recovery manifest is not valid JSON, so `parseManifest` cannot read it.',
        },
        help: {
            json: 'serve the HTML as the build wrote it; the manifest is the `__SZ_RECOVERY_MANIFEST__` script the build adds to the page.',
            format: 'pass the manifest the build wrote, unchanged.',
            parse: 'pass the manifest the build wrote, unchanged.',
        },
        note: { json: 'the browser reported: {error}.', parse: 'the parser reported: {error}.' },
        sources: ['packages/runtime/src/verify.ts', 'packages/compiler/src/manifest.ts'],
    },
    {
        id: 'mangle-map-unreadable',
        summary:
            'A mangle map on the page that is not a plain map of class names, so it is ignored.',
        surfaces: { runtime: { production: true, host: 'browser', console: 'error' } },
        position: 'none',
        forms: ['schema', 'json'],
        // `error` is the parser's own message, on the json form only.
        args: { form: formArg(['schema', 'json']), error: OPTIONAL_OPAQUE },
        text: {
            schema: 'The class census on this page (`__CSSZYX_MANGLE_MAP__`) is not a map of class names to class names, so it is ignored.',
            json: 'The class census on this page (`__CSSZYX_MANGLE_MAP__`) is not valid JSON, so it is ignored.',
        },
        help: 'serve the HTML as the build wrote it; a census that cannot be read means the page was changed or cut short after the build.',
        note: { json: 'the browser reported: {error}.' },
        sources: [HYDRATION],
    },
    {
        id: 'mangle-census-unreadable',
        summary: 'A mangle census on the page that is not a valid map, so nothing was verified.',
        surfaces: { runtime: { production: true, host: 'browser' } },
        position: 'none',
        args: {},
        text: 'The class census on this page could not be read, so the mangle checksum was not verified.',
        help: 'serve the HTML as the build wrote it; the line before this one says what is wrong with the census.',
        sources: [HYDRATION],
    },
    {
        id: 'mangle-checksum-mismatch',
        summary: 'A mangle map whose hash differs from the checksum it was built with.',
        surfaces: { runtime: { production: true, host: 'browser' } },
        position: 'none',
        args: { computed: STRING, expected: STRING },
        text: 'The mangle map on this page hashes to `{computed}`, and the checksum it was built with is `{expected}`, so the check fails.',
        help: 'deploy the HTML and the bundle from one build.',
        note: 'this detects a damaged or stale page, not an attacker; the checksum is not signed.',
        sources: [HYDRATION],
    },
    {
        id: 'mangle-map-unavailable',
        summary: 'A page with a mangle checksum but no census or map to recompute it from.',
        surfaces: { runtime: { production: true, host: 'browser' } },
        position: 'none',
        args: { checksum: STRING },
        text: 'This page carries the checksum `{checksum}` but neither a class census nor a bundled mangle map to recompute it from, so nothing was verified.',
        help: 'keep `production.hydrationCensus` on, its default, when the build sets `production.mangleVars` without `production.mangle`, since such a build bundles no map; otherwise, load the bundle that registers the map on this page.',
        sources: [HYDRATION],
    },
    {
        id: 'web-crypto-unavailable',
        summary: 'A page without Web Crypto, so the mangle checksum cannot be recomputed.',
        surfaces: { runtime: { production: true, host: 'browser' }, error: { host: 'browser' } },
        position: 'none',
        args: {},
        text: 'Web Crypto is unavailable, so csszyx cannot recompute the mangle checksum.',
        help: 'serve the page over HTTPS, or from `localhost`.',
        note: '`crypto.subtle` exists only in a secure context; `verifyMangleChecksumAsync` answers `false` without checking.',
        sources: [HYDRATION],
    },
    {
        id: 'hydration-aborted',
        summary: 'A hydration check that threw on an element and stopped.',
        surfaces: { runtime: { production: true, host: 'browser', console: 'error' } },
        position: 'none',
        // One form per `HydrationErrorType`. csszyx itself reports only
        // checksum-mismatch; the other two reach here from a caller of the
        // public `abortHydration`, whose own `message` travels as an opaque arg.
        forms: ['checksum-mismatch', 'map-missing', 'invalid-token'],
        args: {
            form: formArg(['checksum-mismatch', 'map-missing', 'invalid-token']),
            tagName: STRING,
            message: OPTIONAL_OPAQUE,
        },
        text: {
            'checksum-mismatch':
                'The HTML, the bundle and the recovery manifest do not all come from one build, so csszyx aborted hydration at `<{tagName}>`.',
            'map-missing':
                'Your code called `abortHydration` with `map_missing`, so csszyx aborted hydration at `<{tagName}>`.',
            'invalid-token':
                'Your code called `abortHydration` with `invalid_token`, so csszyx aborted hydration at `<{tagName}>`.',
        },
        help: {
            'checksum-mismatch': 'deploy the HTML, the bundle and the manifest from one build.',
            'map-missing': 'serve the page with the mangle map its build wrote.',
            'invalid-token': 'deploy the HTML and the recovery manifest from one build.',
        },
        note: {
            'checksum-mismatch':
                'csszyx only marks the element with `data-sz-hydration-aborted` and `data-sz-interactive="false"`; nothing skips hydrating it unless your code checks `isHydrationAborted`.',
            'map-missing':
                'the caller reported: {message}; csszyx only marks the element, and nothing skips hydrating it unless your code checks `isHydrationAborted`.',
            'invalid-token':
                'the caller reported: {message}; csszyx only marks the element, and nothing skips hydrating it unless your code checks `isHydrationAborted`.',
        },
        sources: [HYDRATION],
    },
    {
        id: 'csr-recovery-unmarked',
        summary: 'A hydration mismatch on an element without an szRecover directive.',
        surfaces: { runtime: { production: true, host: 'browser' } },
        position: 'none',
        args: {},
        text: 'This element has a hydration mismatch but no `szRecover` directive, so it is not recovered on the client.',
        help: 'add `szRecover="csr"` to recover it, or `szRecover="dev-only"` to recover it in development only.',
        sources: [HYDRATION],
    },
    {
        id: 'csr-recovery-dev-only',
        summary:
            'An szRecover="dev-only" element in a production build, where its recovery is off.',
        // The stripped form is the build's own line, in Node.
        surfaces: { runtime: { production: ['runtime'], host: 'both' } },
        position: 'none',
        forms: ['runtime', 'stripped'],
        args: {
            form: formArg(['runtime', 'stripped']),
            count: OPTIONAL_NUMBER,
            sites: { type: 'string[]', joiner: ', ', optional: true },
        },
        text: {
            runtime:
                'This element has `szRecover="dev-only"`, which is off in production, so its hydration mismatch is not recovered.',
            stripped:
                'The production manifest leaves out {count} `szRecover="dev-only"` token(s), so recovery for those elements is off in production.',
        },
        help: {
            runtime:
                'fix the mismatch, or use `szRecover="csr"` where recovery must run in production.',
            stripped: 'use `szRecover="csr"` on any of them whose recovery must run in production.',
        },
        note: { stripped: 'this is expected in a production build; the tokens are at {sites}.' },
        sources: [HYDRATION, UNPLUGIN],
    },
    {
        id: 'csr-recovery-used',
        summary: 'A hydration mismatch the runtime recovered by rendering on the client.',
        surfaces: { runtime: { production: true, host: 'browser' } },
        position: 'none',
        args: {},
        text: 'The hydration-abort marks on this element were cleared, so your code can render it on the client.',
        help: 'fix the cause of the mismatch; with `szRecover="csr"`, this recovery also runs in production.',
        sources: [HYDRATION],
    },
    {
        id: 'merge-table-format-skew',
        summary: 'A merge table in a format this runtime does not read, so szcn merges nothing.',
        surfaces: { runtime: { production: true, host: 'browser' } },
        position: 'none',
        // `expected` travels: the page has no version, so it could only name
        // the latest release's format.
        args: { format: NUMBER, expected: NUMBER },
        text: 'The merge table was written in format {format}, and this csszyx version reads format {expected}, so `szcn` ignores the table and removes only exact repeats.',
        help: 'run the build, or `csszyx next prebuild` on Next.js, with the installed csszyx to write it again.',
        sources: ['packages/runtime/src/merge-signatures.ts'],
    },
    {
        id: 'merge-table-missing',
        summary: 'A run with no merge table, so szcn removes only exact repeats.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        args: {},
        text: "`szcn` has no merge table in this run, so it removes only exact repeats: `szcn('p-2', 'p-4')` keeps both classes.",
        help: 'use the csszyx plugin for Vite, Rollup, webpack or Next.js, which registers one; for jest, run the build or `csszyx next prebuild` first.',
        note: 'the csszyx plugin registers no table under esbuild, Rspack, Rsbuild, Rolldown, Farm or Bun.',
        sources: ['packages/runtime/src/merge-classes.ts'],
    },
    {
        id: 'uncompiled-sz',
        summary: 'A raw sz object that reached the runtime because its file was not compiled.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        args: {},
        text: 'A raw `sz` object reached the runtime because its file was not compiled, so it produces no CSS.',
        help: 'add the package directory to `compileSources` when the file lives in a workspace package; otherwise, check that the bundler does not skip the file.',
        note: 'csszyx dropped the object, so the DOM does not get `sz="[object Object]"`.',
        sources: ['packages/runtime/src/strip-sz-props.ts'],
    },
    {
        id: 'register-szcn-groups-ignored',
        summary: 'A registerSzcnGroups call, which no longer changes what szcn merges.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        args: {},
        text: '`registerSzcnGroups` no longer changes what `szcn` merges: `szcn` merges on the CSS your Tailwind compiles, and the groups you register only name the property that `classify` and `splitBox` read.',
        help: 'declare the tokens under `@theme` (`--color-*`, `--text-*`, `--font-*`, `--font-weight-*`), delete the CSS rules you wrote for those classes, and use a csszyx integration that supplies a merge table.',
        note: '`szcn` never removes a class from `@utility`, a plugin or plain CSS; without a table it removes only exact repeats.',
        sources: ['packages/runtime/src/merge-groups.ts'],
    },
    {
        id: 'theme-token-ambiguous',
        summary: 'A theme token defined under two namespaces that share one class prefix.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        forms: ['color-text-size', 'font-family-weight'],
        args: { form: formArg(['color-text-size', 'font-family-weight']), name: STRING },
        text: {
            'color-text-size':
                'Theme token `{name}` is defined as both a colour and a text size, so `classify` cannot name the property of `text-{name}`, and Tailwind compiles that class for only one of them.',
            'font-family-weight':
                'Theme token `{name}` is defined as both a font family and a font weight, so `classify` cannot name the property of `font-{name}`, and Tailwind compiles that class for only one of them.',
        },
        help: 'rename one of the tokens.',
        note: {
            'color-text-size':
                'a `text:color` or `text:size` placement in `splitBox` does not match `text-{name}`; `szcn` merges on the compiled CSS and is not affected.',
            'font-family-weight':
                'a `font:family` or `font:weight` placement in `splitBox` does not match `font-{name}`; `szcn` merges on the compiled CSS and is not affected.',
        },
        sources: ['packages/runtime/src/merge-groups.ts'],
    },
    {
        id: 'split-box-selector-invalid',
        summary: 'A has/pick/omit selector that can never match a token.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        forms: ['array', 'empty', 'multi', 'property', 'sz-qualified'],
        args: {
            form: formArg(['array', 'empty', 'multi', 'property', 'sz-qualified']),
            selector: OPTIONAL_STRING,
            property: OPTIONAL_STRING,
            categories: { type: 'string[]', joiner: ', ', optional: true },
            // The property form only: the properties csszyx tells apart.
            properties: { type: 'string[]', joiner: '`, `', optional: true },
            // The sz-qualified form only: the selector to pass instead.
            name: OPTIONAL_STRING,
        },
        text: {
            array: '`has`, `pick` and `omit` take one selector, so an array matches nothing.',
            empty: 'The empty selector `{}` names no category, so it matches nothing.',
            multi: 'An object selector names one category and value, so `{ {categories} }` can never match a single token.',
            property:
                '`{property}` is not a property csszyx tells apart, so `{selector}` matches nothing.',
            'sz-qualified':
                '`{selector}` names a property, and `hasSz`, `pickSz` and `omitSz` match an sz key by category only, so it matches nothing.',
        },
        help: {
            array: 'pass the selectors one at a time; `splitBox` takes a list in `inner` and `outer`.',
            empty: 'name a category and a value, such as `{ overflow: "hidden" }`.',
            multi: 'pass one selector per category.',
            property:
                "use one of `{properties}`; `classify('<a class>')` shows the one a class carries.",
            'sz-qualified': 'pass `{name}`.',
        },
        sources: [SPLIT_BOX],
    },
    {
        id: 'split-box-unknown-category',
        summary: 'A selector name that is no category or class prefix csszyx knows.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        forms: ['no-hint', 'hint', 'property-hint'],
        args: {
            form: formArg(['no-hint', 'hint', 'property-hint']),
            name: STRING,
            // The hint forms only: the category the name most likely means.
            hint: OPTIONAL_STRING,
        },
        text: '`{name}` is not a category or class prefix csszyx knows, so it matches nothing.',
        help: {
            'no-hint': "call `classify('<a class>')` to see the category a class belongs to.",
            hint: 'use the category `{hint}`.',
            'property-hint':
                'use the category `{hint}`, or `{hint}:{name}` to match that property only.',
        },
        sources: [SPLIT_BOX],
    },
    {
        id: 'split-box-placement-variant',
        summary: 'A splitBox placement written with a variant or marker, which never matches.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        // `base` is `selector` without its variant prefix and its `!` or `-`.
        args: { selector: STRING, side: { type: ['enum', 'inner', 'outer'] }, base: STRING },
        text: 'A `splitBox` placement list names a class by its base, so `{selector}` never matches: the variant prefix and the `!` or `-` marker are stripped before the comparison.',
        help: "write `{ {side}: ['{base}'] }`; it places every variant of `{base}`.",
        sources: [SPLIT_BOX],
    },
    {
        id: 'split-box-peer-on-frame',
        summary: 'A peer class splitBox kept on the frame although its base belongs inside.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        // `base` is the token's utility; `reaching` is the token rewritten to
        // reach the content from the frame, `[&>*]:` before its base.
        args: { token: STRING, base: STRING, reaching: STRING },
        text: '`splitBox` keeps `{token}` on the frame although `{base}` belongs inside, because a peer rule reaches siblings and the content node is a child of the frame, where it could never match.',
        help: 'target the content from the frame instead: `{reaching}`.',
        sources: [SPLIT_BOX],
    },
    {
        id: 'split-box-unclassified',
        summary: 'A class or raw CSS splitBox cannot classify, placed on the fallback node.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        forms: ['class', 'raw-css'],
        args: {
            form: formArg(['class', 'raw-css']),
            token: OPTIONAL_STRING,
            node: { type: ['enum', 'frame', 'content'] },
            // The placement option for the other node: `inner` when `node` is
            // the frame, `outer` when it is the content.
            side: { type: ['enum', 'inner', 'outer'] },
        },
        text: {
            class: '`{token}` is not a utility csszyx knows, so it went to the {node} node with everything else it could not classify.',
            'raw-css':
                'The `css` key holds raw CSS `splitBoxSz` does not classify, so it went to the {node} node with everything else it could not classify.',
        },
        help: {
            class: "if it belongs on the other node, place it there with `{ {side}: ['{token}'] }`; a custom `@utility` that sets properties of both nodes has no correct side, so split it into two utilities.",
            'raw-css':
                "if its declarations belong on the other node, place it yourself with `{ {side}: ['css'] }`.",
        },
        sources: [SPLIT_BOX],
    },
    {
        id: 'split-box-unbounded-scroll',
        summary: 'A scrolling content node whose height nothing bounds, so it grows instead.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        args: { scroller: STRING },
        text: '`splitBox` put `{scroller}` on the content node, but nothing bounds the height of either node, so the content grows instead of scrolling.',
        help: 'give the className a height bound such as `h-64`, `max-h-96` or `h-full`, or put `flex flex-col min-h-0` on the frame and `flex-1 min-h-0` on the content.',
        sources: [SPLIT_BOX],
    },
    {
        id: 'split-box-unclipped-corners',
        summary: 'A rounded frame that does not clip its scrolling content.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        args: {},
        text: 'The `splitBox` frame is rounded and the content scrolls, but the frame does not clip, so scrolled content paints over the corners.',
        help: 'add `overflow-hidden` to the frame.',
        sources: [SPLIT_BOX],
    },
    {
        id: 'split-box-hidden-content',
        summary: 'A hiding class placed on the content node, which leaves the frame visible.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        args: { hidden: STRING },
        text: '`splitBox` put `{hidden}` on the content node, so the frame keeps its background, border and size and stays visible.',
        help: "pass `{ outer: ['hidden'] }` if the whole box should disappear.",
        sources: [SPLIT_BOX],
    },
    {
        id: 'szv-config-invalid',
        summary: 'A part of an szv config that does not have the shape szv reads.',
        surfaces: { runtime: { production: false, host: 'browser' } },
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
        text: {
            config: 'The `szv` config is not an object (got {got}), so `szv` returns an empty sz object.',
            base: '`base` in the `szv` config is not an sz object (got {got}), so `szv` ignores it.',
            variants:
                '`variants` in the `szv` config is not an object (got {got}), so `szv` returns only `base`.',
            'default-variants':
                '`defaultVariants` in the `szv` config is not an object (got {got}), so no variant gets a default value.',
            dimension:
                '`variants.{dimension}` is not an object of values (got {got}), so it adds no classes.',
            'variant-value':
                '`variants.{dimension}.{token}` is not an sz object (got {got}), so it is ignored.',
        },
        help: {
            config: 'pass an object such as `{ base: { … }, variants: { … } }`.',
            base: 'make `base` an sz object, such as `{ p: 4 }`.',
            variants:
                'make `variants` an object of dimensions, such as `{ size: { sm: { p: 2 } } }`.',
            'default-variants':
                "make `defaultVariants` an object of values, such as `{ size: 'sm' }`.",
            dimension:
                'make `variants.{dimension}` an object that maps each value to an sz object.',
            'variant-value': 'make it an sz object, such as `{ p: 4 }`, or `null` to add nothing.',
        },
        sources: [VARIANTS],
    },
    {
        id: 'sz-object-depth',
        summary: 'An sz object at runtime nested deeper than the depth limit.',
        surfaces: {
            runtime: { production: false, host: 'browser' },
            error: { host: 'browser', classes: ['SzDepthError'] },
        },
        position: 'none',
        forms: ['value', 'szv-config'],
        args: { form: formArg(['value', 'szv-config']), maxDepth: NUMBER, where: OPTIONAL_STRING },
        text: {
            value: 'This `sz` value nests deeper than {maxDepth} levels, so csszyx rejects it.',
            'szv-config':
                '`{where}` in the `szv` config nests deeper than {maxDepth} levels, so `szv` rejects it at render.',
        },
        help: {
            value: 'check what reaches the `sz` prop; nesting this deep usually means untrusted or looping data.',
            'szv-config':
                'flatten `{where}`; nesting this deep usually means the config was built from untrusted or looping data.',
        },
        sources: [
            'packages/compiler/src/sz-limits.ts',
            CORE_TS,
            VARIANTS,
            'packages/dynamic/src/purify.ts',
            'packages/runtime/src/core.ts',
            SPLIT_BOX,
        ],
    },
    {
        id: 'szv-forbidden-key',
        summary: 'A key in an szv config that csszyx never reads, such as __proto__.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        args: { where: STRING, key: STRING },
        text: '`{where}` in the `szv` config has the forbidden key `{key}`, so it is ignored.',
        help: 'remove the key; csszyx never reads `__proto__`, `constructor` or `prototype`.',
        sources: [VARIANTS],
    },
    {
        id: 'szv-unknown-variant',
        summary: 'A selection that names a variant the szv config does not declare.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        args: { key: STRING },
        text: 'The `szv` selection names the variant `{key}`, which `variants` does not declare, so it is ignored.',
        help: 'declare `variants.{key}`, or remove `{key}` from the selection.',
        sources: ['packages/runtime/src/selection-value.ts'],
    },
    {
        id: 'szv-unknown-variant-value',
        summary: 'A selection that gives a variant a value it has no styles for.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        forms: ['listed', 'none'],
        args: {
            form: formArg(['listed', 'none']),
            key: STRING,
            value: STRING,
            allowed: { type: 'string[]', joiner: '`, `', optional: true },
        },
        text: 'The `szv` selection sets `{key}` to `{value}`, which `variants.{key}` does not define, so it adds no class.',
        help: {
            listed: 'add `{value}` to `variants.{key}`, or use one of `{allowed}`.',
            none: 'add `{value}` to `variants.{key}`, which defines no value yet.',
        },
        sources: ['packages/runtime/src/selection-value.ts'],
    },
    {
        id: 'szv-object-as-string',
        summary: 'An sz object from szv() used as a class string, which renders "[object Object]".',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        args: {},
        text: 'An sz object from `szv()` was used as a class string, such as `className={someSzv({ … })}`, which renders `[object Object]` in a production build.',
        help: 'pass it to an `sz` prop, or turn it into a class string with `szr(…)` first.',
        note: 'a development build renders an empty string in its place.',
        sources: [VARIANTS],
    },
    {
        id: 'dynamic-injection-growth',
        summary:
            'A session in which dynamic() has injected so many classes the CSSOM keeps growing.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        // `count` is the threshold the session crossed.
        args: { count: NUMBER },
        text: '`dynamic()` has injected {count} or more unique classes this session, and injected CSS rules are never removed, so the CSSOM keeps growing and style recalculation slows.',
        help: 'drive continuously changing values, such as a width that changes every animation frame, through a CSS variable instead.',
        sources: ['packages/dynamic/src/injector.ts'],
    },
    {
        id: 'dynamic-unsafe-arbitrary',
        summary: 'An arbitrary value dynamic() dropped because it could inject CSS.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        args: { utility: STRING },
        text: 'The arbitrary value in `{utility}` could inject CSS, so `dynamic()` omits the class.',
        help: 'keep untrusted data out of arbitrary values, or validate it before it reaches `dynamic()`.',
        note: 'only the first dropped value of a session is reported.',
        sources: ['packages/dynamic/src/css-generator.ts'],
    },
    {
        id: 'dynamic-non-boolean',
        summary: 'A runtime value that is not a boolean on a key only a boolean can toggle.',
        surfaces: { runtime: { production: true, host: 'browser' } },
        position: 'none',
        args: { key: STRING, valueType: STRING },
        text: 'The runtime value of `{key}` has type `{valueType}`, and only a boolean toggles this class, so it is omitted.',
        help: 'pass `true` or `false`; write other values as literals, or use `dynamic()` for a responsive object.',
        sources: ['packages/compiler/src/bool-class.ts'],
    },
    {
        id: 'dynamic-unresolvable',
        summary: 'A runtime value of a type no CSS value can be resolved from.',
        surfaces: { runtime: { production: true, host: 'browser' } },
        position: 'none',
        args: { key: STRING, valueType: STRING },
        text: 'The runtime value of `{key}` has type `{valueType}`, which cannot be resolved to CSS, so the property is omitted.',
        help: 'pass a number, a token or a CSS length; for a responsive object, use `dynamic()`.',
        sources: ['packages/compiler/src/spacing-var.ts'],
    },
    {
        id: 'dev-warnings-partial',
        summary:
            'A development warning with no source location; csszyx check names the file and key.',
        surfaces: { runtime: { production: false, host: 'browser' } },
        position: 'none',
        args: {},
        text: 'The `sz` key warning above has no source location, so it does not name the file that triggered it.',
        help: 'run `npx @csszyx/cli check` to list every file and key at once; set `CSSZYX_NO_PROJECT_SCAN_HINT=1` to hide this line.',
        sources: [CORE_TS],
    },
    {
        id: 'diagnostics-capped',
        summary: 'More findings of one kind than a run lists; the rest are counted, not printed.',
        surfaces: { runtime: { production: false, host: 'both' } },
        position: 'none',
        forms: ['per-id', 'dev-warnings', 'unknown-keys'],
        args: {
            form: formArg(['per-id', 'dev-warnings', 'unknown-keys']),
            id: OPTIONAL_STRING,
            count: OPTIONAL_NUMBER,
        },
        // The per-id line is headed by the capped id, not by this one, so a
        // grep for that id finds it: `[csszyx] <id>: +<count> more not listed`.
        // It has no sentence of its own.
        text: {
            'dev-warnings':
                'This session has printed {count} distinct development warnings, so further ones are suppressed.',
            'unknown-keys':
                'This process has reported {count} distinct unknown sz keys, so further ones are suppressed.',
            'per-id': 'This build left {count} more `{id}` finding(s) unlisted.',
        },
        help: {
            'per-id': '`csszyx check --rule {id}` lists every one.',
            'dev-warnings':
                'look above for one warning repeating with different values; a `className` built from data is the usual cause.',
            'unknown-keys':
                'look above for one key repeating with different names; sz keys built from data are the usual cause.',
        },
        sources: [
            'packages/unplugin/src/diagnostic-limiter.ts',
            'packages/runtime/src/dev-warn.ts',
            CORE_TS,
        ],
    },
    {
        id: 'sz-attribute-syntax',
        summary: 'An sz attribute string that does not parse.',
        surfaces: {
            runtime: { production: true, host: 'browser', console: 'error' },
            error: { host: 'browser' },
        },
        position: 'site',
        // `index` is where in `input` the parser met `char`, or, for `end`,
        // where the attribute stopped before a key or value was complete.
        forms: ['char', 'end'],
        args: {
            form: formArg(['char', 'end']),
            input: STRING,
            char: OPTIONAL_STRING,
            index: NUMBER,
        },
        text: {
            char: 'The `sz` attribute `{input}` has an unexpected `{char}` at offset {index}, so the element gets no classes from it.',
            end: 'The `sz` attribute `{input}` ends at offset {index} before a key or value is complete, so the element gets no classes from it.',
        },
        help: {
            char: 'write it as an object literal with commas between keys, such as `sz="p: 4, w: \'1/2\'"`; quote a value that holds `/` or `#`.',
            end: 'give every key a `:` and a value, and close every `[` and quote, such as `sz="p: 4, [&>span]: { m: 2 }"`.',
        },
        sources: ['packages/csszyx/src/browser.ts', 'packages/csszyx/src/parse-sz-attribute.ts'],
    },

    // --- error: thrown, no console line of their own ---
    {
        id: 'options-object-required',
        summary: 'An options argument that is not the one object the call takes.',
        surfaces: { error: { host: 'both' } },
        position: 'none',
        forms: [
            'transform',
            'csszyx-turbopack',
            'csszyx-turbopack-option',
            'class-name-to-sz-object',
            'class-name-to-sz-object-option',
            'serialize-manifest',
            'migrate-source',
        ],
        buildForms: ['serialize-manifest', 'migrate-source'],
        args: {
            form: formArg([
                'transform',
                'csszyx-turbopack',
                'csszyx-turbopack-option',
                'class-name-to-sz-object',
                'class-name-to-sz-object-option',
                'serialize-manifest',
                'migrate-source',
            ]),
            options: { type: 'string[]', joiner: '`, `', optional: true },
        },
        text: {
            transform:
                '`transform` takes its options in one object, so a second argument that is not an object, or a third argument, is refused.',
            'csszyx-turbopack':
                '`csszyxTurbopack` takes one object, with the config to extend under `turbopack`, so a second argument is refused.',
            'csszyx-turbopack-option':
                '`csszyxTurbopack` has no option(s) `{options}`, so the call is refused.',
            'class-name-to-sz-object':
                '`classNameToSzObject` takes its options in one object, so a second argument that is not an object, or a third argument, is refused.',
            'class-name-to-sz-object-option':
                '`classNameToSzObject` has no option(s) `{options}`, so the call is refused.',
            'serialize-manifest':
                '`serializeManifest` takes its options in one object, so a second argument that is not an object, or a third argument, is refused.',
            'migrate-source':
                '`migrateSource` takes the path under `filename` in one options object, so a second argument without it, or a third argument, is refused.',
        },
        help: {
            transform:
                "pass the prefix and the mangle map as keys: `transform(sz, { prefix: 'hover:', mangleMap })`.",
            'csszyx-turbopack':
                'write `csszyxTurbopack({ turbopack: <your config>, ...options })`; loader options go beside `turbopack`.',
            'csszyx-turbopack-option':
                'use `config`, `glob`, `importedStaticSz`, `mergeCoveredClasses`, `parserMode`, `safelistOutputFile`, `tailwindStylesheet` or `turbopack`; a Turbopack setting such as `rules` goes under `turbopack`.',
            'class-name-to-sz-object':
                'pass the migration map under `customMap`: `classNameToSzObject(className, { customMap })`.',
            'class-name-to-sz-object-option':
                'pass the migration map under `customMap`: `classNameToSzObject(className, { customMap })`.',
            'serialize-manifest':
                'pass the flag as a key: `serializeManifest(manifest, { pretty: true })`.',
            'migrate-source':
                "pass the path as a key beside the other options: `migrateSource(source, { filename: 'Card.tsx' })`.",
        },
        sources: [
            CORE_TS,
            'packages/unplugin/src/next-config.ts',
            'packages/cli/src/migrate.ts',
            'packages/compiler/src/manifest.ts',
        ],
    },
    {
        id: 'lowering-not-loaded',
        summary: 'An sz object passed to a string helper before the lowering module is loaded.',
        surfaces: { error: { host: 'browser' } },
        position: 'none',
        args: {},
        text: 'A string helper received an sz object, but the module that turns sz objects into class names is not loaded, so it cannot produce class names for it.',
        help: "add `import '@csszyx/runtime/lowering';` once at startup when the code runs outside the csszyx bundler plugin, such as in unit tests or scripts; the plugin loads it for files that can pass objects at runtime.",
        sources: ['packages/runtime/src/core.ts'],
    },
    {
        id: 'lite-sz-object',
        summary: 'An sz object passed to a lite-runtime helper, which cannot lower objects.',
        surfaces: { error: { host: 'browser', production: false } },
        position: 'none',
        args: { fnName: STRING, received: STRING },
        text: '`{fnName}()` takes class strings and received the plain object `{received}`, because the compiler could not resolve this `sz` prop at build time.',
        help: "write `sz={[cond ? varA : varB, { key: 'val' }]}`; a spread of a conditional, such as `sz={{ ...(cond ? varA : varB), key: 'val' }}`, is the usual cause.",
        note: 'a production build skips this check: `_sz` returns the object, or `[object Object]` beside other classes, and `_szMerge` throws a `TypeError`.',
        sources: ['packages/runtime/src/lite.ts'],
    },
    {
        id: 'split-box-sz-string',
        summary: 'A class string passed to splitBoxSz, which takes sz objects.',
        surfaces: { error: { host: 'browser', production: false } },
        position: 'none',
        args: { value: STRING },
        text: '`splitBoxSz` partitions sz objects, not class strings, so it cannot split `{value}`.',
        help: 'use `splitBox()` for a class string.',
        note: 'a production build drops the string instead of throwing.',
        sources: [SPLIT_BOX],
    },
    {
        id: 'runtime-prefix-conflict',
        summary: 'Two builds sharing one runtime that registered different Tailwind prefixes.',
        surfaces: { error: { host: 'browser' } },
        position: 'none',
        forms: ['prefixes', 'unprefixed'],
        args: {
            form: formArg(['prefixes', 'unprefixed']),
            first: STRING,
            // The prefixes form only: the unprefixed form has one build with no prefix.
            second: OPTIONAL_STRING,
        },
        text: {
            prefixes:
                'Two builds sharing one JavaScript runtime registered the Tailwind prefixes `{first}` and `{second}`, so csszyx cannot tell which prefix their classes take.',
            unprefixed:
                'Two builds sharing one JavaScript runtime registered different Tailwind prefixes, `{first}` and none, so csszyx cannot tell which prefix their classes take.',
        },
        help: 'keep independently configured applications on separate `@csszyx/runtime` instances, or align their Tailwind prefix.',
        sources: ['packages/runtime/src/lowering-slot.ts'],
    },
    {
        id: 'dynamic-manifest-unreachable',
        summary: 'A dynamic manifest the browser could not fetch.',
        surfaces: { error: { host: 'browser' } },
        position: 'none',
        args: { status: NUMBER },
        text: 'The `dynamic()` manifest could not be fetched (HTTP status {status}), so every class is treated as new and injected at runtime.',
        help: 'serve the manifest at the URL `setManifestUrl` names, or turn `build.emitManifest` on.',
        note: 'the error is caught and nothing is printed; csszyx does not fetch it again this session until you call `resetManifest`.',
        sources: ['packages/dynamic/src/manifest.ts'],
    },
    {
        id: 'native-engine-unavailable',
        summary: 'A native engine that is missing, cannot load, or predates this compiler.',
        surfaces: {
            runtime: { production: false, host: 'node' },
            error: {
                host: 'node',
                classes: ['CsszyxNativeUnavailableError', 'RustTransformUnavailableError'],
            },
        },
        position: 'none',
        forms: [
            'no-platform-package',
            'not-installed',
            'missing-export',
            'stale-binding',
            'stale-binding-versions',
            'wasm-fallback',
        ],
        args: {
            form: formArg([
                'no-platform-package',
                'not-installed',
                'missing-export',
                'stale-binding',
                'stale-binding-versions',
                'wasm-fallback',
            ]),
            platform: OPTIONAL_STRING,
            packageName: OPTIONAL_STRING,
            exportName: OPTIONAL_STRING,
            nativeVersion: OPTIONAL_STRING,
            coreVersion: OPTIONAL_STRING,
        },
        text: {
            'no-platform-package':
                'No prebuilt native engine covers `{platform}`, so the `rust` parser cannot run.',
            'not-installed': '`{packageName}` is not installed, so the `rust` parser cannot run.',
            'missing-export':
                '`{packageName}` does not export `{exportName}()`, which the installed `@csszyx/core` calls, so the `rust` parser cannot run.',
            'stale-binding':
                '`{packageName}` returns results the installed `@csszyx/core` cannot read, so the `rust` parser cannot run.',
            'stale-binding-versions':
                '`{packageName}` {nativeVersion} returns results the installed `@csszyx/core` {coreVersion} cannot read, so the `rust` parser cannot run.',
            'wasm-fallback':
                'The native engine is not available here, so the default `rust` parser runs on the wasm engine.',
        },
        help: {
            'no-platform-package':
                "set the parser to `wasm` (`build.parser: 'wasm'` in the plugin options, `parserMode: 'wasm'` in `csszyxTurbopack`, or `--parser-mode wasm` on `csszyx next`); the wasm engine ships inside `@csszyx/core`.",
            'not-installed':
                "reinstall without skipping optional dependencies, which installs `{packageName}` with `@csszyx/core`, or set the parser to `wasm` (`build.parser: 'wasm'` in the plugin options, `parserMode: 'wasm'` in `csszyxTurbopack`, or `--parser-mode wasm` on `csszyx next`).",
            'missing-export':
                "update `@csszyx/core` and `{packageName}` together, to the same version, or set the parser to `wasm` (`build.parser: 'wasm'` in the plugin options, `parserMode: 'wasm'` in `csszyxTurbopack`, or `--parser-mode wasm` on `csszyx next`).",
            'stale-binding':
                "update `@csszyx/core` and `{packageName}` together, to the same version, or set the parser to `wasm` (`build.parser: 'wasm'` in the plugin options, `parserMode: 'wasm'` in `csszyxTurbopack`, or `--parser-mode wasm` on `csszyx next`).",
            'stale-binding-versions':
                "update `@csszyx/core` and `{packageName}` together, to the same version, or set the parser to `wasm` (`build.parser: 'wasm'` in the plugin options, `parserMode: 'wasm'` in `csszyxTurbopack`, or `--parser-mode wasm` on `csszyx next`).",
            'wasm-fallback':
                "reinstall without skipping optional dependencies to get the native engine, or set `build.parser: 'wasm'` to hide this line.",
        },
        note: 'the wasm engine produces the same output; only parsing is slower.',
        sources: [NATIVE, 'packages/compiler/src/transform-rust.ts', UNPLUGIN],
    },
    {
        id: 'wasm-engine-unavailable',
        summary: 'A wasm engine that failed to load.',
        surfaces: { error: { host: 'node', classes: ['WasmTransformUnavailableError'] } },
        position: 'none',
        args: { detail: OPAQUE },
        text: 'The wasm engine in `@csszyx/core` did not load, so the `wasm` parser cannot run.',
        help: 'reinstall `@csszyx/core`; the wasm engine ships inside it as `parser-wasm`.',
        note: 'the loader reported: {detail}.',
        sources: ['packages/compiler/src/transform-wasm.ts'],
    },
    {
        id: 'native-migrate-unavailable',
        summary: 'A native engine csszyx migrate needs and cannot load; migrate has no wasm lane.',
        surfaces: { error: { host: 'node', classes: ['RustMigrateUnavailableError'] } },
        position: 'none',
        forms: [
            'no-platform-package',
            'not-installed',
            'missing-export',
            'stale-binding',
            'stale-binding-versions',
        ],
        args: {
            form: formArg([
                'no-platform-package',
                'not-installed',
                'missing-export',
                'stale-binding',
                'stale-binding-versions',
            ]),
            platform: OPTIONAL_STRING,
            packageName: OPTIONAL_STRING,
            exportName: OPTIONAL_STRING,
            nativeVersion: OPTIONAL_STRING,
            coreVersion: OPTIONAL_STRING,
        },
        text: {
            'no-platform-package':
                'No prebuilt native engine covers `{platform}`, so migrate cannot run.',
            'not-installed': '`{packageName}` is not installed, so migrate cannot run.',
            'missing-export':
                '`{packageName}` predates migrate and does not export `{exportName}()`, so migrate cannot run.',
            'stale-binding':
                '`{packageName}` returns results the installed `@csszyx/core` cannot read, so migrate cannot run.',
            'stale-binding-versions':
                '`{packageName}` {nativeVersion} returns results the installed `@csszyx/core` {coreVersion} cannot read, so migrate cannot run.',
        },
        help: {
            'no-platform-package':
                'run migrate on Linux, macOS or Windows, on x64 or arm64, where a prebuilt native engine exists.',
            'not-installed':
                'reinstall without skipping optional dependencies, which installs `{packageName}` with `@csszyx/core`.',
            'missing-export':
                'update `@csszyx/core` and `{packageName}` together, to a version that carries migrate.',
            'stale-binding':
                'update `@csszyx/core` and `{packageName}` together, to the same version.',
            'stale-binding-versions':
                'update `@csszyx/core` and `{packageName}` together, to the same version.',
        },
        note: 'no file was changed; migrate runs on the native engine only, and builds and the runtime do not need it.',
        sources: ['packages/compiler/src/migrate-rust.ts'],
    },
    {
        id: 'engine-version-skew',
        summary: 'An engine built from other source than the compiler that loads it.',
        surfaces: { error: { host: 'node', classes: ['EngineVersionSkewError'] } },
        position: 'none',
        forms: ['version', 'platform-package', 'unreported', 'source'],
        args: {
            form: formArg(['version', 'platform-package', 'unreported', 'source']),
            artifact: { type: ['enum', 'native', 'wasm'] },
            expectedVersion: STRING,
            expectedDigest: STRING,
            foundVersion: OPTIONAL_STRING,
            foundDigest: OPTIONAL_STRING,
            platformPackage: OPTIONAL_STRING,
        },
        text: {
            version:
                '`@csszyx/compiler` {expectedVersion} loaded the {artifact} engine {foundVersion}, and the two must come from the same release, so csszyx stops.',
            'platform-package':
                '`@csszyx/compiler` {expectedVersion} loaded the native engine {foundVersion} from `{platformPackage}`, and the two must come from the same release, so csszyx stops.',
            unreported:
                '`@csszyx/compiler` {expectedVersion} loaded a {artifact} engine from a release before 0.18, and the two must come from the same release, so csszyx stops.',
            source: 'The {artifact} engine was built from source `{foundDigest}`, and `@csszyx/compiler` {expectedVersion} expects `{expectedDigest}`, so csszyx stops.',
        },
        help: {
            version:
                'install `@csszyx/core@{expectedVersion}`; it installs its platform package at the same version.',
            'platform-package':
                'install `@csszyx/core@{expectedVersion}`, and reinstall `{platformPackage}` if your lockfile holds it at another version.',
            unreported:
                'install `@csszyx/core@{expectedVersion}`; it installs its platform package at the same version.',
            source: 'rebuild the engine from this checkout: `pnpm --filter @csszyx/core native:build` for native, `pnpm --filter @csszyx/core build` for wasm.',
        },
        sources: ['packages/compiler/src/engine-identity.ts'],
    },
    {
        id: 'runtime-version-skew',
        summary: 'A @csszyx/runtime at another version than the plugin that lowers for it.',
        surfaces: { error: { host: 'node', classes: ['RuntimeVersionSkewError'] } },
        position: 'none',
        args: { pluginVersion: STRING, runtimeVersion: STRING, runtimeDir: STRING },
        text: '`@csszyx/unplugin` {pluginVersion} found `@csszyx/runtime` {runtimeVersion} at `{runtimeDir}`, and the two must come from the same release, so the build stops.',
        help: 'install `@csszyx/runtime@{pluginVersion}`.',
        sources: ['packages/unplugin/src/runtime-version.ts'],
    },
    {
        id: 'peer-module-unresolved',
        summary: 'A peer package csszyx needs that does not resolve from the project.',
        surfaces: { error: { host: 'node' } },
        position: 'none',
        args: { requiredBy: STRING, request: STRING, install: STRING },
        text: '`{requiredBy}` reads templates with `{request}`, which does not resolve from it, so no template is read.',
        help: 'install `{install}` in the project.',
        sources: ['packages/compiler/src/peer-module.ts'],
    },
    {
        id: 'tailwind-v3-unavailable',
        summary: 'A project where generate-types finds no loadable Tailwind CSS v3.',
        surfaces: { error: { host: 'node', classes: ['TailwindUnavailableError'] } },
        position: 'none',
        forms: ['absent', 'wrong-major', 'broken-entry'],
        args: {
            form: formArg(['absent', 'wrong-major', 'broken-entry']),
            version: OPTIONAL_STRING,
            reason: OPTIONAL_OPAQUE,
        },
        text: {
            absent: '`csszyx generate-types` reads a Tailwind v3 config, and this project has no Tailwind installed.',
            'wrong-major':
                '`csszyx generate-types` reads a Tailwind v3 config, and this project has Tailwind {version}, which has no JavaScript config to read.',
            'broken-entry':
                '`csszyx generate-types` found Tailwind {version} but could not load its `resolveConfig` entry, so it cannot read the config.',
        },
        help: {
            absent: 'install `tailwindcss@3` as a dev dependency, such as `npm install -D tailwindcss@3`; on Tailwind v4 the theme lives in CSS under `@theme`, and this command is not needed.',
            'wrong-major':
                'declare the theme in CSS under `@theme`, which needs no generated types; to type a v3 config left over from a migration, run `npx -p tailwindcss@3 -p @csszyx/cli csszyx generate-types --config ./tailwind.config.js`.',
            'broken-entry':
                'reinstall it, such as `npm install --force tailwindcss@3`; if the error stays, report this csszyx bug at https://github.com/nguyennhutien/csszyx/issues with this message.',
        },
        note: {
            absent: '`@csszyx/cli` lists Tailwind v3 as an optional peer, so installing the CLI does not install it.',
            'wrong-major':
                '`tailwind.config.js` and the `resolveConfig` helper this command calls were removed in Tailwind v4.',
            'broken-entry': 'loading the entry reported: {reason}.',
        },
        sources: ['packages/cli/src/scanner/tailwind-availability.ts'],
    },
    {
        id: 'explain-input-invalid',
        summary: 'An input to csszyx explain that is not one sz expression the build lowers.',
        surfaces: { error: { host: 'node', classes: ['ExplainParseError'] } },
        position: 'none',
        forms: ['not-one-expression', 'runtime-only'],
        args: {
            form: formArg(['not-one-expression', 'runtime-only']),
            input: STRING,
            diagnostics: { type: 'string[]', joiner: '\n', optional: true, opaque: true },
        },
        text: {
            'not-one-expression':
                '`{input}` is not one sz expression, so `csszyx explain` has nothing to resolve.',
            'runtime-only':
                'The build emits no classes for `{input}`, because `_sz()` resolves it at runtime.',
        },
        help: {
            'not-one-expression':
                'pass one object literal, such as `csszyx explain "{ p: 4, bg: \'blue-500\' }"`.',
            'runtime-only':
                'write its values as literals to see the classes the build emits; a warning printed below, when there is one, names the value that needs the runtime.',
        },
        sources: ['packages/cli/src/commands/explain.ts'],
    },
    {
        id: 'template-sz-invalid',
        summary:
            'A Vue or Svelte file whose template sz has errors, each reported with its own code.',
        surfaces: { error: { host: 'node' } },
        position: 'file',
        args: { count: NUMBER },
        text: 'This file has {count} `sz` error(s), so the build stops.',
        help: 'fix each error listed below.',
        sources: [
            'packages/compiler/src/template-sz.ts',
            'packages/svelte-adapter/src/index.ts',
            UNPLUGIN,
        ],
    },
    {
        id: 'template-runtime-value',
        summary: 'A template sz value only known at runtime, which a template cannot resolve.',
        surfaces: { error: { host: 'node' } },
        position: 'site',
        args: {},
        text: 'This `sz` value is only known at runtime, and a template has no csszyx runtime to resolve it, so it gets no class.',
        help: 'write the value as a literal, such as `{ p: 4 }`, or bind `class` or `style` yourself for a value that changes at runtime.',
        note: 'the attribute is left as written.',
        sources: ['packages/compiler/src/template-sz.ts'],
    },
    {
        id: 'template-unparsable',
        summary: 'A Vue or Svelte file its own compiler cannot parse, so no sz in it gets a class.',
        surfaces: { error: { host: 'node' } },
        position: 'site',
        forms: ['vue', 'svelte-quoted', 'svelte-preprocess'],
        args: {
            form: formArg(['vue', 'svelte-quoted', 'svelte-preprocess']),
            message: OPAQUE,
        },
        text: {
            vue: 'Vue cannot parse this file, so no `sz` attribute in it gets a class.',
            'svelte-quoted':
                'Svelte cannot parse this file, so no `sz` attribute in it gets a class.',
            'svelte-preprocess':
                'Svelte cannot parse this file, so no `sz` attribute in it gets a class.',
        },
        help: {
            vue: 'fix the error the Vue compiler reports; the file does not compile without csszyx either.',
            'svelte-quoted':
                'write a quoted sz object as an expression, `sz={{ p: 4 }}`; Svelte does not parse `sz="{ p: 4 }"`.',
            'svelte-preprocess':
                'run csszyx after the preprocessors that turn this file into Svelte, such as TypeScript without `lang="ts"`, or pug.',
        },
        note: {
            vue: 'the Vue compiler reported: {parserMessage}.',
            'svelte-quoted': 'the Svelte compiler reported: {parserMessage}.',
            'svelte-preprocess': 'the Svelte compiler reported: {parserMessage}.',
        },
        sources: [
            'packages/vue-adapter/src/template-ast.ts',
            'packages/svelte-adapter/src/markup-ast.ts',
        ],
    },
    {
        id: 'template-lang-unsupported',
        summary: 'A Vue template in a language other than HTML, which csszyx does not read.',
        surfaces: { error: { host: 'node' } },
        position: 'site',
        args: { lang: STRING },
        text: 'This template is `<template lang="{lang}">`, and csszyx reads `sz` in HTML templates only, so no `sz` attribute in it gets a class.',
        help: 'write the template in HTML, or bind `class` yourself in it.',
        sources: ['packages/vue-adapter/src/template-ast.ts'],
    },
    {
        id: 'svelte-version-unsupported',
        summary: 'An installed Svelte older than 5, whose markup csszyx does not read.',
        surfaces: { error: { host: 'node' } },
        position: 'site',
        args: { version: STRING },
        text: 'Svelte {version} resolves here, and csszyx reads Svelte 5 markup only, so no `sz` attribute in this file gets a class.',
        help: 'install `svelte@5`.',
        sources: ['packages/svelte-adapter/src/markup-ast.ts'],
    },
    {
        id: 'ignore-package-incompatible',
        summary:
            'An installed `ignore` package that no longer reads .gitignore the way csszyx needs.',
        surfaces: { error: { host: 'node' } },
        position: 'none',
        args: { pinned: STRING },
        text: 'The installed `ignore` package lacks the internal matcher csszyx calls, so csszyx cannot read `.gitignore` and stops.',
        help: 'remove any override or resolution that forces another version of `ignore`, so csszyx gets `ignore@{pinned}`, the version it pins.',
        sources: ['packages/tailwind-oracle/src/project-walk.ts'],
    },
    {
        id: 'internal-error',
        summary: 'A state csszyx should never reach: a csszyx bug to report.',
        surfaces: {
            error: {
                host: 'node',
                classes: ['RustTransformUnavailableError', 'WasmTransformUnavailableError'],
            },
        },
        position: 'none',
        args: { where: STRING, detail: STRING },
        text: 'An internal check failed in `{where}`, so csszyx stops.',
        help: 'report this csszyx bug at https://github.com/nguyennhutien/csszyx/issues with this message, the csszyx version and the bundler or command you ran.',
        note: 'the check that failed: {detail}.',
        sources: [
            'packages/compiler/src/transform-rust.ts',
            'packages/compiler/src/transform-wasm.ts',
            'packages/unplugin/src/next-source-transformer.ts',
            UNPLUGIN,
            'packages/unplugin/src/next-watcher.ts',
            'packages/unplugin/src/stable-file-snapshot.ts',
            'packages/tailwind-oracle/src/map-concurrent.ts',
            'packages/tailwind-oracle/src/project-resolver.ts',
            'packages/core/src/lib.rs',
            'packages/core/src/native.rs',
            'packages/unplugin/src/next-generation-manifest.ts',
            'packages/unplugin/src/next-watcher-cycle.ts',
        ],
    },
    {
        id: 'engine-call-failed',
        summary: 'A call into the engine that threw.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        args: { file: STRING, detail: OPAQUE },
        text: 'The prescan could not transform `{file}`, so none of its classes reached the safelist.',
        help: 'fix the error the transform reported; under Tailwind `source(none)`, no class of this file gets CSS until then.',
        note: 'the transform reported: {detail}.',
        sources: [UNPLUGIN],
    },

    // --- node: build, config and CLI lines of the Node packages ---
    {
        id: 'config-invalid',
        summary: 'A csszyx.config with problems, each reported with its own code.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        forms: ['partly-applied', 'not-applied'],
        args: { form: formArg(['partly-applied', 'not-applied']), count: NUMBER },
        // The problems are listed between the text and the help, one per line.
        text: {
            'partly-applied':
                'This file has {count} problem(s); each one is ignored, and the rest of the file applies.',
            'not-applied':
                'This file has {count} problem(s), so it is not applied and the `recommended` levels apply.',
        },
        help: 'https://csszyx.com/docs/reference/config/#csszyxconfig describes every field; a dev server, a watch build and `csszyx next watch` read it again when it or a module it imports is saved.',
        sources: [POLICY, 'packages/unplugin/src/sync-lane-policy.ts', CHECK],
    },
    {
        id: 'unknown-rule-id',
        summary: 'A rule id no diagnostic, kind or group has, likely a typo.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        forms: ['config', 'cli'],
        args: {
            form: formArg(['config', 'cli']),
            ids: { type: 'string[]', joiner: '` or `' },
            suggestion: OPTIONAL_STRING,
        },
        text: {
            config: 'No rule or diagnostic is named `{ids}`, so a level set under that name applies to nothing.',
            cli: 'No rule or diagnostic is named `{ids}`, so the selection would match nothing and `csszyx check` stops.',
        },
        help: '{spellingHint}; https://csszyx.com/docs/reference/warnings/ lists every id.',
        sources: [POLICY, CHECK],
    },
    {
        id: 'config-id-not-settable',
        summary: 'A rule id for a runtime line or a throw, whose level csszyx.config cannot set.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        args: { id: STRING },
        text: '`{id}` is printed to the console or thrown, so `csszyx.config` sets no level for it.',
        help: 'remove it; `rules` sets the level of engine diagnostics and `csszyx check` findings only.',
        sources: [POLICY],
    },
    {
        id: 'removed-rule-id',
        summary: 'A rule id csszyx no longer reports, with the id that replaced it.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        forms: ['replaced', 'removed'],
        args: { form: formArg(['replaced', 'removed']), id: STRING, replacedBy: OPTIONAL_STRING },
        text: '`{id}` is no longer reported, so a `csszyx.config` level or a `--rule` or `--ignore-rule` flag naming it applies to nothing.',
        help: {
            replaced: 'name `{replacedBy}` instead, which reports what `{id}` did.',
            removed: 'remove it.',
        },
        sources: [POLICY, CHECK],
    },
    {
        id: 'config-level-invalid',
        summary: 'A rule set to something other than off, info, warn or error.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        args: { id: STRING, level: STRING },
        text: '`{id}` is set to `{level}`, which is not a level, so that setting is ignored.',
        help: "use `'off'`, `'info'`, `'warn'` or `'error'`.",
        sources: [POLICY],
    },
    {
        id: 'config-preset-unknown',
        summary: 'A diagnostics preset other than recommended or atomic.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        args: { preset: STRING },
        text: '`{preset}` is not a preset, so the `recommended` levels apply.',
        help: "use `'recommended'` or `'atomic'`.",
        sources: [POLICY],
    },
    {
        id: 'config-field-unknown',
        summary: 'A field csszyx.config does not read.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        forms: ['top-level', 'misspelt', 'plugin-option', 'diagnostics', 'allow'],
        args: {
            form: formArg(['top-level', 'misspelt', 'plugin-option', 'diagnostics', 'allow']),
            key: STRING,
            suggestion: OPTIONAL_STRING,
        },
        text: {
            'top-level': '`{key}` is not read at the top level, so nothing under it applies.',
            misspelt: '`{key}` is not a field csszyx reads, so nothing under it applies.',
            'plugin-option':
                '`{key}` is a plugin option, and this file does not set plugin options, so it is ignored.',
            diagnostics: '`diagnostics.{key}` is not a field csszyx reads, so it sets nothing.',
            allow: '`diagnostics.allow.{key}` is not a field csszyx reads, so it allows nothing.',
        },
        help: {
            'top-level': 'move it under `diagnostics`, as `diagnostics.{key}`.',
            misspelt: 'rename it to `{suggestion}`.',
            'plugin-option': 'pass it to the csszyx plugin in your bundler config.',
            diagnostics: 'use `preset`, `rules`, `allow` or `overrides`.',
            allow: 'use `classes` or `tokens`.',
        },
        sources: [POLICY],
    },
    {
        id: 'config-field-invalid',
        summary: 'A csszyx.config field whose value does not have the shape it takes.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        variesBy: 'expected',
        args: {
            field: STRING,
            expected: {
                type: [
                    'enum',
                    'config-object',
                    'object',
                    'rules-object',
                    'name-list',
                    'overrides-list',
                    'override',
                    'globs',
                ],
            },
        },
        text: {
            'config-object':
                'The default export is not an object, so nothing in this file applies.',
            object: '`{field}` is not an object, so it is ignored.',
            'rules-object':
                '`{field}` is not an object of id and level, so none of its levels apply.',
            'name-list': '`{field}` is not a list of names, so it allows nothing.',
            'overrides-list': '`{field}` is not a list, so no override applies.',
            override: '`{field}` is not a `{ files, rules }` object, so it is ignored.',
            globs: '`{field}` is not a glob or a list of globs, so this override applies to no file.',
        },
        help: {
            'config-object':
                'write `export default defineConfig({ … })`, importing `defineConfig` from `csszyx`.',
            object: 'write it as an object, such as `{ classes: [] }` for `allow`.',
            'rules-object': "write it as `{ 'dead-class': 'warn' }`.",
            'name-list': "write it as a list of strings, such as `['my-card']`.",
            'overrides-list': 'write it as a list of `{ files, rules }` objects.',
            override: "write it as `{ files: 'src/legacy/**', rules: { 'dead-class': 'off' } }`.",
            globs: "write a glob relative to the project root, such as `'src/legacy/**'`, or a list of them.",
        },
        sources: [POLICY],
    },
    {
        id: 'config-glob-unmatchable',
        summary: 'An override glob that is absolute or steps out of the root, so it never matches.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        args: { glob: STRING },
        text: '`{glob}` is absolute or steps out of the project root with `..`, so it matches no file.',
        help: 'write it relative to the project root, such as `src/legacy/**`; csszyx matches each file by its path from there.',
        sources: [POLICY],
    },
    {
        id: 'config-file-duplicate',
        summary: 'A second csszyx.config file beside the one csszyx reads.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        args: { read: STRING },
        text: '`{read}` is read first, so this file is not read and nothing in it applies.',
        help: 'keep one config file: move what this file sets into `{read}`, then delete this file.',
        sources: [CONFIG_FILE],
    },
    {
        id: 'config-unloadable',
        summary: 'A csszyx.config that could not be loaded, so the default levels apply.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        forms: ['load', 'typescript-in-js', 'legacy-template', 'worker'],
        args: {
            form: formArg(['load', 'typescript-in-js', 'legacy-template', 'worker']),
            reason: OPAQUE,
            lane: OPTIONAL_STRING,
            renameTo: OPTIONAL_STRING,
        },
        text: {
            load: 'This file could not be loaded, so the `recommended` levels apply.',
            'typescript-in-js':
                'This file holds TypeScript syntax under a JavaScript name, so it could not be loaded and the `recommended` levels apply.',
            'legacy-template':
                'This is the file `csszyx init` 0.17 and earlier wrote, which does not load, so it is ignored.',
            worker: 'This file could not be loaded in {lane}, so the levels in `.csszyx/diagnostic-policy.json` apply, or the `recommended` levels when that file does not exist.',
        },
        help: {
            load: 'fix the error the loader reported.',
            'typescript-in-js': 'rename it to `{renameTo}`.',
            'legacy-template':
                'replace it with `export default defineConfig({ diagnostics: { … } })`, importing `defineConfig` from `csszyx`, or delete it.',
            worker: 'make the file load in plain Node; `csszyx next prebuild` and `csszyx next watch` write `.csszyx/diagnostic-policy.json` for {lane}.',
        },
        note: 'the loader reported: {reason}.',
        sources: [CONFIG_FILE, 'packages/unplugin/src/sync-lane-policy.ts'],
    },
    {
        id: 'config-no-default-export',
        summary: 'A csszyx.config with no default export.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        args: {},
        text: 'This file has no default export, so nothing in it applies.',
        help: 'write `export default defineConfig({ … })`, importing `defineConfig` from `csszyx`.',
        sources: [CONFIG_FILE],
    },
    {
        id: 'policy-state-format-skew',
        summary: 'A saved diagnostic policy in a format this version does not read.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        args: { format: NUMBER, expected: NUMBER },
        text: 'This policy file was written in format {format}, and this csszyx version reads format {expected}, so the levels in it are not used.',
        help: 'run `csszyx next prebuild` or `csszyx next watch` with the installed csszyx to write it again.',
        note: 'until then csszyx loads the config file itself, in a child process, or applies the `recommended` levels when the project has none.',
        sources: [CONFIG_FILE],
    },
    {
        id: 'safelist-shard-format-skew',
        summary: 'A Next safelist shard in a format this version does not read.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        args: { format: NUMBER, expected: NUMBER },
        text: 'This safelist shard was written in format {format}, and this csszyx version reads format {expected}, so its classes are left out of the safelist.',
        help: 'run `csszyx next prebuild` with the installed csszyx to write every shard again.',
        note: 'until then a class only this shard lists gets no CSS.',
        sources: ['packages/unplugin/src/next-safelist-state.ts'],
    },
    {
        id: 'diagnostics-held',
        summary: 'Findings at info a production build counted instead of listing.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        args: { count: NUMBER },
        text: 'This build held back {count} finding(s) at `info` and listed none of them.',
        help: 'run a development build with `quiet` unset to see each one with its file and position, or `csszyx check` to list the sz findings among them.',
        note: 'they are every finding at `info`: by default the ones csszyx handles itself, such as an `sz` prop that falls back to the runtime or a class an `sz` class on the same element covers, and any finding `csszyx.config` sets to `info`.',
        sources: ['packages/unplugin/src/transform-diagnostics.ts'],
    },
    {
        id: 'merge-covered-held',
        summary: 'Classes a build removed by merging, counted instead of listed.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        args: {
            classes: NUMBER,
            files: NUMBER,
            kinds: { type: 'string[]', joiner: ' --rule ' },
            configFile: STRING,
        },
        text: 'The build removed {classes} class(es) in {files} file(s), because another class on the same element sets every property they set.',
        help: '`csszyx check --rule {kinds}` lists them; `build.mergeCoveredClasses: false` in the plugin options keeps every one.',
        note: "this line stays until each id after `--rule` is `'off'` in `diagnostics.rules` of `{configFile}`.",
        sources: ['packages/unplugin/src/merge-audit.ts', UNPLUGIN],
    },
    {
        id: 'removed-option',
        summary: 'A plugin option that was removed and is no longer read.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        forms: ['inject-checksum', 'mangle-map-delivery'],
        args: { form: formArg(['inject-checksum', 'mangle-map-delivery']) },
        text: {
            'inject-checksum':
                '`production.injectChecksum` was removed and was never read: every production build carries the hydration checksum and the census, whatever it is set to.',
            'mangle-map-delivery':
                '`production.mangleMapDelivery` was removed and is ignored: the runtime mangle map is always registered from inside the JS bundle, and the built HTML carries no inline `<script>`.',
        },
        help: {
            'inject-checksum': 'delete the option.',
            'mangle-map-delivery': 'delete the option.',
        },
        note: {
            'inject-checksum':
                'the census lists no classes when `production.mangle` is off, and the browser runs neither the checksum nor the census as script; see https://csszyx.com/docs/security/.',
            'mangle-map-delivery':
                "a strict `script-src 'self'` policy needs no exception; `window.__csszyx` is opt-in through `production.mangleDebugGlobal`.",
        },
        sources: ['packages/unplugin/src/mangle-delivery.ts', UNPLUGIN],
    },
    {
        id: 'transform-cache-disabled',
        summary: 'A build without its transform cache, because package versions did not resolve.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        args: {},
        text: 'The build could not read the installed version of `@csszyx/unplugin` or `@csszyx/compiler`, so the transform cache is off and every build transforms each file again.',
        help: 'reinstall `@csszyx/unplugin` and `@csszyx/compiler`, or set `build.cache: false` to hide this line.',
        note: 'the build output is the same; only rebuilds are slower.',
        sources: [UNPLUGIN],
    },
    {
        id: 'active-parser',
        summary: 'The parser a build runs, and whether it fell back from the native engine.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        forms: ['native', 'wasm', 'degraded'],
        args: { form: formArg(['native', 'wasm', 'degraded']) },
        text: {
            native: 'This build parses with the native engine.',
            wasm: 'This build parses with the wasm engine.',
            degraded:
                'This build parses with the wasm engine in place of the default native engine.',
        },
        sources: [UNPLUGIN],
    },
    {
        id: 'project-reload',
        summary: 'A project-wide input that changed, so a dev server recompiled every module.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        forms: ['config', 'merge-groups', 'prefix', 'prefix-added', 'prefix-removed'],
        args: {
            form: formArg(['config', 'merge-groups', 'prefix', 'prefix-added', 'prefix-removed']),
            before: OPTIONAL_STRING,
            after: OPTIONAL_STRING,
        },
        text: {
            config: 'This file changed, so csszyx read its levels again, recompiled every module and reloaded the page.',
            'merge-groups':
                'This file changed which sz keys cover each other, so csszyx recompiled every module and reloaded the page.',
            prefix: 'This file changed the Tailwind prefix from `{before}` to `{after}`, so csszyx recompiled every module and reloaded the page.',
            'prefix-added':
                'This file set the Tailwind prefix `{after}`, so csszyx recompiled every module and reloaded the page.',
            'prefix-removed':
                'This file removed the Tailwind prefix `{before}`, so csszyx recompiled every module and reloaded the page.',
        },
        sources: [UNPLUGIN],
    },
    {
        id: 'watch-prefix-changed',
        summary: 'A Tailwind prefix that changed during a watch build, which needs a restart.',
        surfaces: { error: { host: 'node' } },
        position: 'none',
        forms: ['changed', 'added', 'removed'],
        args: {
            form: formArg(['changed', 'added', 'removed']),
            changed: { type: 'string[]', joiner: '`, `' },
            before: OPTIONAL_STRING,
            after: OPTIONAL_STRING,
        },
        text: {
            changed:
                '`{changed}` changed the Tailwind prefix from `{before}` to `{after}`, and this watch session compiled its modules under the old one, so their classes would style nothing.',
            added: '`{changed}` set the Tailwind prefix `{after}`, and this watch session compiled its modules without one, so their classes would style nothing.',
            removed:
                '`{changed}` removed the Tailwind prefix `{before}`, and this watch session compiled its modules under it, so their classes would style nothing.',
        },
        help: 'restart the watch session.',
        note: 'every rebuild fails with this error until the restart, or until the prefix is changed back.',
        sources: [UNPLUGIN],
    },
    {
        id: 'watch-merge-groups-changed',
        summary:
            'A stylesheet edit during a watch build that changed which sz keys cover each other.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        args: { changed: { type: 'string[]', joiner: '`, `' } },
        text: '`{changed}` changed which sz keys cover each other, and this watch session merged its modules under the old stylesheet, so an sz object may keep a class a later key now covers, or lack one a later key no longer covers.',
        help: 'restart the watch session.',
        note: 'this rebuild finished, and only sz objects that use those keys are stale until the restart.',
        sources: [UNPLUGIN],
    },
    {
        id: 'safelist-unwritable',
        summary: 'A generated safelist csszyx could not write, so Tailwind misses its classes.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        args: { reason: OPAQUE },
        text: 'The generated safelist could not be written, so the CSS Tailwind generates is missing the classes csszyx found.',
        help: 'check that the directory exists and is writable.',
        note: 'the file system reported: {reason}.',
        sources: [UNPLUGIN],
    },
    {
        id: 'safelist-capped',
        summary: 'A safelist that hit its class cap, so the classes past it were left out.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        args: { max: NUMBER },
        text: 'The safelist reached its cap of {max} classes, so the build left out every class it found after that.',
        help: 'look for `sz` values that write a different arbitrary value per element, such as `w-[137px]`, and replace them with theme values.',
        note: 'the classes left out produce no CSS unless another source names them; the cap is fixed, and no option raises it.',
        sources: [UNPLUGIN],
    },
    {
        id: 'utility-collision',
        summary: 'An @utility whose name another utility also claims, so Tailwind merges both.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        forms: ['declared-twice', 'theme-token'],
        args: { form: formArg(['declared-twice', 'theme-token']), name: STRING },
        text: {
            'declared-twice':
                '`@utility {name}` is declared twice, so Tailwind merges both declarations into one class, and no single place in your CSS shows what `{name}` sets.',
            'theme-token':
                '`@utility {name}` names a class a theme token already generates, so Tailwind merges both into one class, and no single place in your CSS shows what `{name}` sets.',
        },
        help: {
            'declared-twice': 'merge the two blocks into one, or rename one of them.',
            'theme-token': 'rename the `@utility` or the theme token.',
        },
        note: 'every use of `{name}` gets both, including a class an `sz` prop emits, and Tailwind does not warn about it.',
        sources: [UNPLUGIN],
    },
    {
        id: 'theme-scan-without-typescript',
        summary: 'Theme auto-scan turned on in a project without TypeScript configured.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        args: { tsconfig: STRING, includePath: STRING },
        text: '`{tsconfig}` does not mention `.csszyx`, so TypeScript does not see the theme types the scan wrote to `.csszyx/theme.d.ts`.',
        help: 'add `"{includePath}"` to its `include` array.',
        sources: [UNPLUGIN],
    },
    {
        id: 'esbuild-mangle-unsupported',
        summary: 'production.mangle on the esbuild adapter, which turns mangling off.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        args: {},
        text: 'The esbuild adapter does not support `production.mangle`, so class mangling is off for this build.',
        help: 'use the Vite, Rollup or webpack plugin when the build needs mangled class names.',
        note: 'emitted JS and CSS keep the original class names, so they still match.',
        sources: [UNPLUGIN],
    },
    {
        id: 'mangle-selector-unparsable',
        summary: 'A CSS selector the class mangler could not parse, left unmangled.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        args: { selector: STRING, error: OPAQUE },
        text: 'The class mangler could not parse the selector `{selector}`, so this rule keeps the original class names, which the mangled markup no longer carries.',
        help: 'add the classes of this selector to `production.manglePreserve`, which keeps them unmangled in the markup and the CSS; if your CSS wrote the selector, fix its syntax.',
        note: 'the parser reported: {error}.',
        sources: ['packages/unplugin/src/css-mangler.ts'],
    },
    {
        id: 'mangle-preserve-invalid',
        summary: 'A production.manglePreserve entry that is not a class name or a prefix.',
        surfaces: { error: { host: 'node' } },
        position: 'none',
        forms: ['entry', 'lone-star'],
        args: {
            form: formArg(['entry', 'lone-star']),
            index: OPTIONAL_NUMBER,
            got: OPTIONAL_STRING,
        },
        text: {
            entry: '`production.manglePreserve[{index}]` is not a class name or a prefix (got {got}), so the build stops.',
            'lone-star':
                '`production.manglePreserve` holds a lone `*`, which would keep every class unmangled, so the build stops.',
        },
        help: {
            entry: 'write an exact class name, such as `bg-tag-red`, or a prefix ending in `*`, such as `bg-tag-*`.',
            'lone-star':
                'name a prefix, such as `bg-tag-*`, or set `production.mangle: false` to turn mangling off.',
        },
        sources: ['packages/unplugin/src/mangle-preserve.ts'],
    },
    {
        id: 'mangle-global-vars-options-invalid',
        summary: 'production.mangleGlobalVars options csszyx cannot apply.',
        surfaces: { error: { host: 'node' } },
        position: 'none',
        forms: ['schema', 'tokens-required', 'auto-prefix'],
        args: {
            form: formArg(['schema', 'tokens-required', 'auto-prefix']),
            errors: { type: 'string[]', joiner: '\n    - ', optional: true },
        },
        text: {
            schema: 'The `production.mangleGlobalVars` options break the rules listed below, so the build stops.',
            'tokens-required':
                '`production.mangleGlobalVars.enabled` is `true` with no `tokens`, so the build stops.',
            'auto-prefix':
                '`production.mangleGlobalVars.autoPrefix` is set, and choosing tokens by prefix is not available yet, so the build stops.',
        },
        help: {
            schema: 'fix each option the list names.',
            'tokens-required':
                "list the custom properties to alias in `tokens`, such as `tokens: ['--brand']`.",
            'auto-prefix': 'remove `autoPrefix` and list the custom properties in `tokens`.',
        },
        note: {
            schema: 'the problems:\n    - {errors}',
            'tokens-required': 'csszyx aliases only the custom properties listed in `tokens`.',
        },
        sources: [UNPLUGIN],
    },
    {
        id: 'mangle-global-vars-plan-invalid',
        summary: 'A global-variable alias plan that renames a variable unsafely.',
        surfaces: { error: { host: 'node' } },
        position: 'none',
        args: { findings: { type: 'string[]', joiner: '\n    - ', opaque: true } },
        text: '`production.mangleGlobalVars` cannot alias every listed property safely, so the build stops.',
        help: 'fix each usage listed below, or take that property out of `tokens`.',
        note: 'the findings:\n    - {findings}',
        sources: [UNPLUGIN],
    },
    {
        id: 'mangle-map-too-large',
        summary: 'A CSS variable mangle map larger than its safety cap.',
        surfaces: { error: { host: 'node' } },
        position: 'none',
        args: { size: NUMBER, maxBytes: NUMBER },
        text: 'The CSS variable mangle map is {size} bytes, over its safety cap of {maxBytes} bytes, so the build stops.',
        help: 'turn `production.mangleVars` off or split the bundle; to accept this size, raise the `CSSZYX_VAR_MANGLE_MAP_MAX_BYTES` environment variable above {size}.',
        sources: [UNPLUGIN],
    },
    {
        id: 'mangle-census-late',
        summary: 'Classes that appeared after the mangle map was frozen.',
        surfaces: { error: { host: 'node' } },
        position: 'none',
        forms: ['classes', 'census-changed'],
        args: {
            form: formArg(['classes', 'census-changed']),
            classes: { type: 'string[]', joiner: '`, `', optional: true },
        },
        text: {
            classes:
                '`{classes}` appeared after the mangle map was frozen, so the CSS emitted before then used another map, and the build stops.',
            'census-changed':
                'The class census changed after the mangle map was frozen, so the CSS emitted before then used another map, and the build stops.',
        },
        help: {
            classes:
                'move the file that uses them under the project root or a `compileSources` directory, which the prescan walks; otherwise, set `production.mangle: false` for this build.',
            'census-changed':
                'move every file that uses csszyx under the project root or a `compileSources` directory, which the prescan walks; otherwise, set `production.mangle: false` for this build.',
        },
        sources: [UNPLUGIN],
    },
    {
        id: 'mangle-hybrid-hazard',
        summary: 'A production mangle that collides with, or breaks, CSS csszyx did not write.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        forms: ['collision', 'orphan', 'selector-renamed', 'selector-matched'],
        args: {
            form: formArg(['collision', 'orphan', 'selector-renamed', 'selector-matched']),
            count: NUMBER,
            names: { type: 'string[]', joiner: '`, `', optional: true },
            selectors: { type: 'string[]', joiner: '`; `', optional: true },
            entries: { type: 'string[]', joiner: ', ', optional: true },
        },
        text: {
            collision:
                'Mangling renamed classes to {count} token(s) that CSS outside csszyx also uses as class names, such as `{names}`, so the renamed elements pick up that CSS and the elements it was written for pick up the csszyx rules.',
            orphan: 'Mangling renamed {count} class(es) that no stylesheet in this build has a rule for, such as `{names}`, so a stylesheet outside this build that styles them by name, such as one a separate Tailwind run writes, no longer matches them.',
            'selector-renamed':
                'Mangling broke {count} attribute selector(s) that match class names by text, such as `{selectors}`, so those rules stop matching and the elements lose those styles.',
            'selector-matched':
                'Mangling made {count} attribute selector(s) match the tokens it renamed classes to, such as `{selectors}`, so their rules style elements they were not written for.',
        },
        help: {
            collision:
                'rename those classes in your own CSS to something specific, such as `.x` to `.resize-handle-x`, and list the ones in a stylesheet you cannot edit in `production.mangleExclude`; until then, pass `production: { mangle: false }` to the csszyx plugin.',
            orphan: 'build that stylesheet through this bundler, so csszyx renames its rules too; until then, pass `production: { mangle: false }` to the csszyx plugin.',
            'selector-renamed':
                'keep those classes readable with `production.manglePreserve: [{entries}]`, or select on a data attribute, which mangling never changes.',
            'selector-matched':
                'reserve those tokens with `production.mangleExclude: [{entries}]`, or select on a data attribute, which mangling never changes.',
        },
        note: {
            collision:
                '`csszyx scan-collisions` lists every class name in your stylesheets that a token could take, as a `mangleExclude` list you can paste.',
            'selector-renamed':
                '`production.mangleExclude` does not help here: it reserves token names and still lets the class be renamed.',
            'selector-matched':
                'a prefix or substring selector can match tokens a later build allocates too, so the data attribute is the lasting fix.',
            orphan: 'a class that no stylesheet styles had no CSS before the rename either, so it changes nothing.',
        },
        sources: [UNPLUGIN],
    },
    {
        id: 'merge-hook-late',
        summary: 'A rule selecting on a class the build had already merged away.',
        surfaces: { error: { host: 'node' } },
        position: 'file',
        args: { className: STRING },
        text: '`{className}` was removed from this file before csszyx read a rule that selects on it, so the page would lose that class, and the build stops.',
        help: 'set `build.mergeCoveredClasses: false` to keep every class, or restart the watch session.',
        note: 'csszyx reads such rules during the prescan, before it merges; this one came later, from a module the prescan did not reach or from an edit during a watch session.',
        sources: [UNPLUGIN],
    },
    {
        id: 'merge-origin-unreadable',
        summary:
            'A Tailwind stylesheet csszyx cannot recompile without its own classes, so the build merges no class.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        args: { reason: OPAQUE },
        text: "This Tailwind stylesheet did not compile once csszyx took out its `@utility` blocks and plugin classes, so csszyx cannot tell Tailwind's classes from the project's and merges no class in this build.",
        help: 'report this csszyx bug at https://github.com/nguyennhutien/csszyx/issues with this message and the plugin or `@utility` block the stylesheet uses.',
        note: 'every class is kept, so `{ pb: 2, p: 4 }` emits `pb-2 p-4`, a `className` class stays beside the `sz` classes, and `szcn` removes only exact repeats; the compile reported: {reason}.',
        sources: [UNPLUGIN, 'packages/unplugin/src/next-stylesheet-facts.ts'],
    },
    {
        id: 'tailwind-stylesheet-missing',
        summary: 'A configured Tailwind stylesheet that does not exist.',
        surfaces: { error: { host: 'node' } },
        position: 'none',
        args: { setting: STRING, missing: { type: 'string[]', joiner: '`, `' }, root: STRING },
        text: 'The stylesheet(s) `{missing}` named by {setting} do not exist under `{root}`, so the build stops.',
        help: 'list the Tailwind stylesheet this build loads, relative to the project root.',
        sources: ['packages/unplugin/src/next-stylesheet-facts.ts', UNPLUGIN],
    },
    {
        id: 'tailwind-stylesheet-absent',
        summary:
            'A build that emitted classes for `sz` props and processed no Tailwind stylesheet.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        args: { count: NUMBER },
        text: 'This build emitted {count} class(es) for `sz` props and processed no Tailwind stylesheet, so none of those classes produces CSS.',
        help: 'add `@import "tailwindcss";` to a stylesheet the app loads; csszyx adds the `@source` for its safelist there itself.',
        sources: [UNPLUGIN],
    },
    {
        id: 'tailwind-stylesheet-broken',
        summary: 'A stylesheet reaching Tailwind that does not compile, so the prefix is unknown.',
        surfaces: { error: { host: 'node' } },
        position: 'none',
        args: { stylesheets: { type: 'string[]', joiner: '\n    ' }, setting: STRING },
        text: 'A Tailwind stylesheet did not compile, so csszyx cannot read the Tailwind prefix and transforms no module.',
        help: 'fix the stylesheet; if this build does not load it, list the stylesheets it does load with {setting}.',
        note: 'each failure, as Tailwind reported it:\n    {stylesheets}',
        sources: [UNPLUGIN, 'packages/unplugin/src/next-stylesheet-facts.ts'],
    },
    {
        id: 'tailwind-config-missing',
        summary: 'A Tailwind config path that does not exist, or a directory with no config.',
        surfaces: { error: { host: 'node' } },
        position: 'file',
        forms: ['path', 'not-found'],
        args: { form: formArg(['path', 'not-found']), root: OPTIONAL_STRING },
        text: {
            path: 'This Tailwind config does not exist, so `csszyx generate-types` cannot read the theme.',
            'not-found':
                'No Tailwind config is in `{root}`, so `csszyx generate-types` cannot read the theme.',
        },
        help: "pass the path of the project's Tailwind config with `--config`, such as `--config ./tailwind.config.js`.",
        note: {
            'not-found':
                'the search looks in this directory only, for `tailwind.config.ts`, `.js`, `.cjs` and `.mjs`.',
        },
        sources: [
            'packages/cli/src/scanner/tailwind-scanner.ts',
            'packages/cli/src/commands/generate-types.ts',
        ],
    },
    {
        id: 'tailwind-config-unloadable',
        summary: 'A Tailwind config that threw while loading.',
        surfaces: { error: { host: 'node' } },
        position: 'file',
        args: { reason: OPAQUE },
        text: 'This Tailwind config threw while loading, so `csszyx generate-types` cannot read the theme.',
        help: 'fix the error below so that Node can import the config.',
        note: 'the import failed with: {reason}.',
        sources: ['packages/cli/src/scanner/tailwind-scanner.ts'],
    },
    {
        id: 'legacy-source-directive',
        summary: 'An @source line naming the old safelist file, which csszyx no longer writes.',
        surfaces: { error: { host: 'node' } },
        position: 'file',
        args: { target: STRING },
        text: '`@source "{target}"` names the old safelist, which csszyx no longer writes, so the build stops.',
        help: "remove this line; on Next.js, also list `'@csszyx/unplugin/postcss'` before `'@tailwindcss/postcss'` in `postcss.config`.",
        note: 'csszyx adds the `@source` for `.csszyx/csszyx-classes.txt` itself: the Vite, Rollup and webpack plugins inject it, and on Next.js `@csszyx/unplugin/postcss` does.',
        sources: [
            'packages/unplugin/src/safelist-source.ts',
            'packages/unplugin/src/postcss.ts',
            UNPLUGIN,
        ],
    },
    {
        id: 'postcss-plugin-order',
        summary:
            'The csszyx PostCSS plugin listed after Tailwind, which then never reads the safelist.',
        surfaces: { error: { host: 'node' } },
        position: 'none',
        args: {},
        text: '`@csszyx/unplugin/postcss` is listed after `@tailwindcss/postcss`, so Tailwind compiles the stylesheet before csszyx adds the safelist, and the build stops.',
        help: "list `'@csszyx/unplugin/postcss'` before `'@tailwindcss/postcss'` in `postcss.config`.",
        sources: ['packages/unplugin/src/postcss.ts'],
    },
    {
        id: 'postcss-plugin-missing',
        summary:
            'A Next.js PostCSS config that does not list the csszyx plugin, so Tailwind never reads the safelist.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'file',
        args: {},
        text: 'The PostCSS config Next.js reads does not list `@csszyx/unplugin/postcss`, so Tailwind never reads the safelist and no `sz` class produces CSS.',
        help: 'add `@csszyx/unplugin/postcss` to its plugins, before `@tailwindcss/postcss`.',
        sources: ['packages/unplugin/src/next-prebuild.ts'],
    },
    {
        id: 'ignore-pattern-negated',
        summary: 'A negated pattern in an ignore list, which can only add paths.',
        surfaces: { error: { host: 'node' } },
        position: 'none',
        args: { pattern: STRING },
        text: 'The ignore pattern `{pattern}` is negated, and an ignore list cannot take one, so csszyx stops.',
        help: 'narrow the pattern that covers too much, so that nothing has to be taken back out.',
        note: 'each pattern only adds paths to leave out.',
        sources: ['packages/unplugin/src/root-ignore-matcher.ts'],
    },
    {
        id: 'compile-sources-unresolved',
        summary: 'A `compileSources` path that does not resolve to a directory.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        args: { paths: { type: 'string[]', joiner: '`, `' }, root: STRING },
        text: 'The `compileSources` path(s) `{paths}` do not resolve to a directory from `{root}`, so the build compiles nothing from them and adds none of their classes to the safelist.',
        help: "point each path at a directory, relative to the project root or absolute, such as `compileSources: ['../../packages/vui']`.",
        sources: [UNPLUGIN],
    },
    {
        id: 'compile-sources-skipped',
        summary:
            'Files under `packages/` that use csszyx and that the build skips, since `compileSources` does not list them.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        forms: ['sz', 'szv-exports'],
        args: {
            form: formArg(['sz', 'szv-exports']),
            count: NUMBER,
            files: { type: 'string[]', joiner: '\n    ' },
            szvCount: OPTIONAL_NUMBER,
        },
        text: 'The build skipped {count} file(s) under `packages/` that use csszyx, so it compiles none of their `sz` props and none of their classes reach the safelist.',
        help: "add the package directory to `compileSources`, such as `compileSources: ['packages/ui']`, or move the files out of `packages/`.",
        note: {
            sz: 'the skipped files:\n    {files}',
            'szv-exports':
                'of these, {szvCount} may export `szv` factories, so another module that calls one runs it at runtime instead of getting its classes compiled in; the skipped files:\n    {files}',
        },
        sources: [UNPLUGIN],
    },
    {
        id: 'css-source-unstable',
        summary: 'A CSS source that kept changing while csszyx read it.',
        surfaces: { error: { host: 'node' } },
        position: 'file',
        args: {},
        text: 'This CSS file changed on every read, so the build stops.',
        help: 'stop the tool that rewrites it during the build, such as a formatter or a second watcher.',
        sources: ['packages/unplugin/src/stable-file-snapshot.ts'],
    },
    {
        id: 'rsc-boundary-violation',
        summary: 'A client-only csszyx export imported into a Server Component.',
        surfaces: { error: { host: 'node' } },
        position: 'file',
        args: { symbol: STRING, chain: { type: 'string[]', joiner: '` -> `' } },
        text: 'This Server Component reaches `{symbol}` through its imports, and `{symbol}` runs only on the client, so the build stops.',
        help: "add `'use client'` to the module of `{chain}` that uses `{symbol}`, or keep that module out of server code; csszyx inserts `{symbol}` where an `sz` prop's value is known only at runtime.",
        sources: ['packages/unplugin/src/rsc-boundary.ts'],
    },
    {
        id: 'next-prefix-unread',
        summary: 'A Next lane that runs before the Tailwind prefix was read.',
        surfaces: { error: { host: 'node', classes: ['NextStylesheetFactsPending'] } },
        position: 'none',
        variesBy: 'lane',
        args: {
            lane: { type: ['enum', 'prebuild', 'turbopack-loader'] },
            root: STRING,
            reason: STRING,
        },
        text: {
            prebuild:
                'The Next prebuild has no Tailwind prefix for `{root}` ({reason}), so it stops.',
            'turbopack-loader':
                'The Turbopack loader has no Tailwind prefix for `{root}` ({reason}), so it stops.',
        },
        help: {
            prebuild:
                'run it through `csszyx next prebuild`, which reads the stylesheets first; from a script, call `prepareNextStylesheetFacts` before `runNextPrebuild`.',
            'turbopack-loader':
                'run `csszyx next prebuild` before `next build`, and `csszyx next watch` beside `next dev`; both read the stylesheets first.',
        },
        note: {
            prebuild: 'no file was transformed, and the safelist was not written.',
            'turbopack-loader': 'this module was not transformed.',
        },
        sources: [
            'packages/unplugin/src/next-prebuild.ts',
            'packages/unplugin/src/next-turbo-loader.ts',
        ],
    },
    {
        id: 'next-safelist-locked',
        summary: 'A Next safelist state another live process holds the lock on.',
        surfaces: { error: { host: 'node', classes: ['NextSafelistStateLockedError'] } },
        position: 'none',
        args: {
            pid: NUMBER,
            root: STRING,
            mode: STRING,
            host: STRING,
            updatedAt: STRING,
            command: OPTIONAL_STRING,
        },
        text: 'Process {pid} on `{host}` holds the csszyx safelist lock for `{root}` in {mode} mode, so this process cannot write the safelist.',
        help: 'stop that process, such as a running `csszyx next watch`, or wait for it to finish; a lock not refreshed for 30 seconds is taken over by the next run.',
        note: 'the lock was last refreshed at {updatedAt}.',
        sources: ['packages/unplugin/src/next-safelist-state.ts'],
    },
    {
        id: 'next-mangle-vars-unsupported',
        summary: 'production.mangleVars on a Next lane that cannot mangle CSS variables.',
        surfaces: { error: { host: 'node' } },
        position: 'file',
        forms: ['prebuild', 'turbopack'],
        args: { form: formArg(['prebuild', 'turbopack']) },
        text: {
            prebuild:
                'The Next prebuild cannot mangle CSS variables in production, and `config.mangleVars` is on, so it stops.',
            turbopack:
                'Turbopack cannot mangle CSS variables in production, and `config.mangleVars` is on, so the build stops at this module.',
        },
        help: {
            prebuild:
                'pass `config: { mangleVars: false }` to `runNextPrebuild`, or build with webpack (`next build --webpack`), which mangles them.',
            turbopack:
                'set `config: { mangleVars: false }` in `csszyxTurbopack`, or build with webpack (`next build --webpack`), which mangles them.',
        },
        sources: [
            'packages/unplugin/src/next-prebuild.ts',
            'packages/unplugin/src/next-turbo-loader.ts',
        ],
    },
    {
        id: 'next-turbo-cache-unseeded',
        summary:
            'A Turbopack production build whose safelist was not seeded by csszyx next prebuild.',
        surfaces: { error: { host: 'node' } },
        position: 'none',
        args: { root: STRING, reason: STRING },
        text: 'The Turbopack production build of `{root}` has no current safelist from `csszyx next prebuild`, so it stops.',
        help: 'run `csszyx next prebuild` before `next build`, such as `"build": "csszyx next prebuild \'app/**/*.tsx\' && next build"` in `package.json`.',
        note: 'the safelist check reported: {reason}.',
        sources: ['packages/unplugin/src/next-turbo-loader.ts'],
    },
    {
        id: 'next-sz-untransformed',
        summary: 'A Next module that still holds sz syntax after the csszyx transform.',
        surfaces: { error: { host: 'node' } },
        position: 'file',
        args: {},
        text: 'This module still holds `sz` syntax after the csszyx transform, so the build stops.',
        help: 'fix the warning reported for this file, such as a syntax error or an `ast-budget` warning for a file too large to transform; if `sz` here is not the `sz` prop, such as an object key of your own, rename it.',
        sources: ['packages/unplugin/src/next-source-transformer.ts'],
    },
    {
        id: 'next-watcher-unclosed',
        summary: 'A Next safelist watcher that threw while closing.',
        surfaces: { runtime: { production: false, host: 'node' } },
        position: 'none',
        args: { detail: OPAQUE },
        text: 'The Next safelist watcher failed while closing, so `csszyx next watch` exits with code 1.',
        help: 'run `csszyx next prebuild` to write the safelist from every source again.',
        note: 'the watcher reported: {detail}; a file saved after its last finished cycle may be missing from the safelist.',
        sources: ['packages/cli/src/commands/next-watch.ts'],
    },
    {
        id: 'no-source-files',
        summary: 'A source pattern that matched no file under the root.',
        surfaces: { runtime: { production: false, host: 'node' }, error: { host: 'node' } },
        position: 'none',
        args: { pattern: STRING, root: STRING },
        text: 'No source file under `{root}` matches `{pattern}`, so there is nothing to scan for classes.',
        help: 'pass a glob, relative to `{root}`, that matches your sources as the `[pattern]` argument, or point `--root` at the Next app; files under an `--ignore` pattern do not count.',
        sources: [
            'packages/cli/src/commands/next-watch.ts',
            'packages/cli/src/commands/next-prebuild.ts',
        ],
    },
    {
        id: 'cli-option-invalid',
        summary: 'A CLI option value outside the values the command takes.',
        surfaces: { error: { host: 'node' } },
        position: 'none',
        forms: ['mode', 'parser-mode', 'debounce-ms', 'framework', 'fail-on'],
        args: {
            form: formArg(['mode', 'parser-mode', 'debounce-ms', 'framework', 'fail-on']),
            value: OPTIONAL_STRING,
        },
        text: {
            mode: '`--mode {value}` is not a mode this command takes, so the command did not run.',
            'parser-mode':
                '`--parser-mode {value}` is not a parser this command takes, so the command did not run.',
            'debounce-ms':
                '`--debounce-ms {value}` is not a whole number of milliseconds from 0 to 60000, so the command did not run.',
            framework:
                '`--framework {value}` is not a framework `csszyx init` knows, so the command did not run.',
            'fail-on':
                '`--fail-on {value}` is not a level this command takes, so the command did not run.',
        },
        help: {
            mode: 'pass `--mode development` or `--mode production`, or leave it out for `production`.',
            'parser-mode':
                'pass `--parser-mode rust` or `--parser-mode wasm`, or leave it out for `rust`.',
            'debounce-ms':
                'pass a whole number from 0 to 60000, such as `--debounce-ms 100`, or leave it out for 50.',
            framework:
                'pass `vite-react`, `vite-vue`, `vite-svelte`, `nextjs-app` or `nextjs-pages`, or leave it out for the detected one.',
            'fail-on':
                'pass `--fail-on info`, `--fail-on warn` or `--fail-on error`, or leave it out for `error`.',
        },
        note: {
            framework:
                '`nuxt`, `sveltekit` and `astro` are accepted too; for them `csszyx init` prints the Vite plugin lines to add by hand.',
        },
        sources: [
            'packages/cli/src/commands/next-prebuild.ts',
            'packages/cli/src/commands/next-options.ts',
            'packages/cli/src/commands/next-watch.ts',
            CHECK,
            'packages/cli/src/commands/init.ts',
        ],
    },
];

/** Ids that existed in a released tag and are no longer produced. */
export const REMOVED = [
    {
        id: 'other',
        since: '0.18.0',
        replacedBy: 'sz-diagnostic',
        was: 'check-kind',
        reason:
            'The kind `csszyx check` gave an engine diagnostic whose wording its text matcher could ' +
            'not name. Every lane now keeps the engine code, so no finding is of this kind; ' +
            '`--rule other` and `rules: { other }` are still accepted, with a warning.',
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
//   (next-transform-failed-closed); next-watcher-unclosed (next-watcher-close-failed).
//   next-watcher-not-started and next-generation-manifest-invalid folded into internal-error
//   before any release: a user cannot cause either state.
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
// - Args stay off the wire only when shared data derives them: a table both
//   engines read from one source (`generate-rust-transform-tables.mjs` reads the TS
//   tables) or a constant. So removed-key values/groups/canonical/note, canonical-key
//   canonical, moved-value replacingKey/replacingValue and closed-enum-value bare/allowed
//   are dropped. What only engine logic yields travels: unknown-field `allowed` (hand-kept
//   mask tables, parsed `owner`), moved-value `layerKey`, closed-enum-value
//   `groupKey`/`groupValue` (a reverse search), slash-opacity-string and
//   color-slash-opacity split into parts (forms `op-given`/`op-absent`), and
//   spread-split-class as raw parts. removed-key keeps `replacement`: the production
//   console prints args in place of the sentence (ADR 0031 §4). runtime-family-conflict
//   first/second are forms. Constants (MAX_SOURCE_NESTING_DEPTH, MERGE_TABLE_FORMAT)
//   reach the renderer as generated constants, not args.
// - closed-enum-value forms css-value, font-style, font-smoothing are engine-emitted since
//   PR B, from the alignment tables `generate-rust-transform-tables.mjs` reads and the
//   lowering's own font modes, so no form carries a gap.
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
// - REMOVED holds `other`, the one kebab tombstone: of the v0.17.2 tags, the other 17 shipped
//   kinds and the 5 shipped --rule ids (sz-diagnostic, dead-class, broken-opacity,
//   sibling-keyword, theme-collision) are all live; unsigned-value, prefix-disagreement,
//   merge-covered-* never shipped in a tag. `other` went once every lane kept the engine's
//   code: a line with none is levelled by `sz-diagnostic`, which replaces it.
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
// - css-mangler.ts:330 (mangle-selector-unparsable) prints without `debug`: a rule left
//   unmangled stops matching the mangled markup, which a user has to hear about.
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
// - engine-call-failed: the unplugin prescan transform failure (unplugin.ts:4608) only; the
//   wasm/napi throws (lib.rs:158, native.rs:444) are a packaging bug and report internal-error.
// - native-engine-unavailable: CsszyxNativeUnavailableError forms + RustTransformUnavailableError
//   wrapper + unplugin wasm-fallback notice (unplugin.ts:3522).
// - internal-error: next-source-transformer.ts:53, unplugin.ts:2940 (unreadStylesheetsError,
//   thrown at 4321/5757), unplugin.ts:1914 (assertGlobalVarPlanMatchesEarlyAliases: alias plan vs source alias table,
//   once a site of mangle-global-vars-plan-invalid), next-watcher.ts:132 and :142 (once
//   next-watcher-not-started), next-generation-manifest.ts:155 and next-watcher-cycle.ts:75
//   (once next-generation-manifest-invalid), stable-file-snapshot.ts:44, map-concurrent.ts:39,
//   project-resolver.ts:118, the engine throws of lib.rs:158 / native.rs:444 (once the `call`
//   form of engine-call-failed), and the "returned no result" forms of transform-rust.ts:140 /
//   transform-wasm.ts:280.
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
