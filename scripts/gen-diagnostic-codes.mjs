#!/usr/bin/env node

/**
 * Generate every artifact that names a csszyx diagnostic from one registry.
 *
 * The registry (`scripts/diagnostics/registry.mjs`) holds each public id with
 * the surfaces it appears on — the engine, a `csszyx check` pass, a console
 * line, a thrown error — its arguments and its default levels. Every consumer
 * reads a file written from it, so an id cannot exist on one side only:
 *
 * - the engine's Rust enum (ids the engine emits);
 * - the compiler's TypeScript ids, groups, default levels and tombstones;
 * - the compiler's Node-only registry module (summaries, surfaces, arguments);
 * - the docs site's data, from which every `/e/<code>` page is built.
 *
 * `--check` fails CI when a written file is stale or the registry breaks a rule
 * (see {@link validateRegistry}).
 *
 * Usage:
 *   node scripts/gen-diagnostic-codes.mjs           # write
 *   node scripts/gen-diagnostic-codes.mjs --check   # CI gate
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import * as registry from './diagnostics/registry.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const rustPath = path.join(repoRoot, 'packages/core/src/transform/generated/diagnostic_codes.rs');
const tsPath = path.join(repoRoot, 'packages/compiler/src/diagnostic-codes.generated.ts');
const registryTsPath = path.join(
    repoRoot,
    'packages/compiler/src/diagnostic-registry.generated.ts',
);
const docsDataPath = path.join(repoRoot, 'apps/docs/src/data/diagnostics.json');

/** A public id: lower-case words joined by single hyphens. */
export const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * A placeholder in a template: `{` + a camelCase name + `}`. Every other brace
 * is a literal character, so a template needs no escape for `{ p: 4 }`. A
 * `${name}` is literal too: messages quote JavaScript template strings.
 */
export const PLACEHOLDER_PATTERN = /(?<!\$)\{([a-z][a-zA-Z0-9]*)\}/g;

const SURFACES = ['engine', 'check', 'runtime', 'error'];
const LEVELS = ['off', 'info', 'warn', 'error'];
const POSITIONS = ['site', 'file', 'none'];
const SCALAR_TYPES = ['string', 'number', 'string[]'];
const TEMPLATE_FIELDS = ['text', 'help', 'note'];

/**
 * The placeholder names a template uses, in order of first use.
 *
 * @param {string} template - A template.
 * @returns {string[]} The names.
 */
export function placeholdersOf(template) {
    return [...new Set([...template.matchAll(PLACEHOLDER_PATTERN)].map(match => match[1]))];
}

/**
 * Every template string of an entry, with where it sits, for the checks.
 *
 * @param {Record<string, any>} entry - A registry entry.
 * @returns {Array<{ field: string, form?: string, template: string }>} The templates.
 */
function templatesOf(entry) {
    const out = [];
    for (const field of TEMPLATE_FIELDS) {
        const value = entry[field];
        if (value === undefined) continue;
        if (typeof value === 'string') out.push({ field, template: value });
        else
            for (const [form, template] of Object.entries(value))
                out.push({ field, form, template });
    }
    return out;
}

/**
 * Whether an argument type is valid: a scalar name or `['enum', ...values]`.
 *
 * @param {unknown} type - The declared type.
 * @returns {boolean} Whether it is valid.
 */
function isArgType(type) {
    if (typeof type === 'string') return SCALAR_TYPES.includes(type);
    return Array.isArray(type) && type[0] === 'enum' && type.length > 1;
}

/**
 * Check one live entry; push a message per broken rule.
 *
 * @param {Record<string, any>} entry - A registry entry.
 * @param {ReadonlySet<string>} groups - The group ids.
 * @param {string[]} problems - Where problems are collected.
 */
function validateEntry(entry, groups, problems) {
    const at = `diagnostic ${JSON.stringify(entry.id)}`;
    if (typeof entry.summary !== 'string' || entry.summary.length === 0) {
        problems.push(`${at}: has no summary`);
    } else if (/[\r\n]/.test(entry.summary)) {
        // It becomes one rustdoc line in the generated enum.
        problems.push(`${at}: summary spans more than one line`);
    }
    const surfaces = Object.keys(entry.surfaces ?? {});
    if (surfaces.length === 0) problems.push(`${at}: appears on no surface`);
    for (const surface of surfaces) {
        if (!SURFACES.includes(surface)) problems.push(`${at}: unknown surface ${surface}`);
    }
    const group = entry.surfaces?.check?.group;
    if (entry.surfaces?.check && !groups.has(group)) {
        problems.push(`${at}: check group ${JSON.stringify(group)} is not a group id`);
    }
    if (entry.defaults !== undefined) {
        if (!entry.surfaces?.engine && !entry.surfaces?.check) {
            problems.push(`${at}: has default levels but no level can be set for it`);
        }
        for (const preset of ['recommended', 'atomic']) {
            if (!LEVELS.includes(entry.defaults[preset])) {
                problems.push(
                    `${at}: default level for ${preset} is not one of ${LEVELS.join(', ')}`,
                );
            }
        }
    }
    if (!POSITIONS.includes(entry.position)) {
        problems.push(`${at}: position must be one of ${POSITIONS.join(', ')}`);
    }
    const args = entry.args ?? {};
    for (const [name, arg] of Object.entries(args)) {
        if (!/^[a-z][a-zA-Z0-9]*$/.test(name))
            problems.push(`${at}: argument ${name} is not camelCase`);
        if (!isArgType(arg?.type)) problems.push(`${at}: argument ${name} has an unknown type`);
        if (arg?.joiner !== undefined && arg.type !== 'string[]') {
            problems.push(`${at}: argument ${name} has a joiner but is not a list`);
        }
    }
    if (entry.forms !== undefined) {
        const declared = args.form?.type;
        const values = Array.isArray(declared) ? declared.slice(1) : [];
        if (JSON.stringify([...values].sort()) !== JSON.stringify([...entry.forms].sort())) {
            problems.push(`${at}: forms must equal the values of its enum argument \`form\``);
        }
    }
    for (const gap of entry.gaps ?? []) {
        if (!SURFACES.includes(gap)) problems.push(`${at}: gap ${gap} is not a surface`);
        if (entry.surfaces?.[gap]) problems.push(`${at}: lists ${gap} as both a surface and a gap`);
    }
    validateTemplates(entry, at, problems);
}

/**
 * Check an entry's templates against its arguments: every placeholder names
 * an argument, and every required argument is used by the text of each form.
 *
 * @param {Record<string, any>} entry - A registry entry.
 * @param {string} at - The entry's label.
 * @param {string[]} problems - Where problems are collected.
 */
function validateTemplates(entry, at, problems) {
    const args = entry.args ?? {};
    const templates = templatesOf(entry);
    for (const { field, form, template } of templates) {
        for (const name of placeholdersOf(template)) {
            if (!(name in args)) {
                problems.push(
                    `${at}: ${field}${form ? ` (${form})` : ''} names {${name}}, which is not an argument`,
                );
            }
        }
        if (form !== undefined && !(entry.forms ?? []).includes(form)) {
            problems.push(`${at}: ${field} has a text for ${form}, which is not one of its forms`);
        }
    }
    const texts = templates.filter(({ field }) => field === 'text');
    if (texts.length === 0) return;
    const required = Object.entries(args)
        .filter(([name, arg]) => !arg.optional && name !== 'form')
        .map(([name]) => name);
    for (const name of required) {
        const used = templates.some(({ template }) => placeholdersOf(template).includes(name));
        if (!used) problems.push(`${at}: required argument ${name} is used by no template`);
    }
}

/**
 * Every rule the registry must keep. An id is public once it ships, so these
 * hold for ids, not for wording.
 *
 * @param {typeof registry} input - The registry module.
 * @returns {string[]} One message per broken rule; empty when it is sound.
 */
export function validateRegistry(input) {
    const problems = [];
    const seen = new Set();
    const claim = (id, where) => {
        if (seen.has(id)) problems.push(`${where} ${JSON.stringify(id)} is defined twice`);
        seen.add(id);
    };
    for (const group of input.GROUPS) {
        if (!ID_PATTERN.test(group.id))
            problems.push(`group ${JSON.stringify(group.id)} is not a kebab id`);
        claim(group.id, 'group');
    }
    const groups = new Set(input.GROUPS.map(group => group.id));
    const passNamed = new Set();
    for (const entry of input.DIAGNOSTICS) {
        if (!ID_PATTERN.test(entry.id)) {
            problems.push(`diagnostic ${JSON.stringify(entry.id)} is not a kebab id`);
        }
        // A pass whose findings carry the pass's own name (`dead-class` reports
        // `dead-class`) is one id: `--rule dead-class` and the kind are the
        // same string in every release, so they cannot be two entries apart.
        if (
            groups.has(entry.id) &&
            entry.surfaces?.check?.group === entry.id &&
            !passNamed.has(entry.id)
        ) {
            passNamed.add(entry.id);
        } else {
            claim(entry.id, 'diagnostic');
        }
        validateEntry(entry, groups, problems);
    }
    const live = new Set(input.DIAGNOSTICS.map(entry => entry.id));
    for (const removed of input.REMOVED) {
        // A removed error code may predate the kebab grammar; it never gets a page.
        if (removed.was !== 'error-code' && !ID_PATTERN.test(removed.id)) {
            problems.push(`removed ${JSON.stringify(removed.id)} is not a kebab id`);
        }
        claim(removed.id, 'removed');
        if (
            removed.replacedBy !== undefined &&
            !live.has(removed.replacedBy) &&
            !groups.has(removed.replacedBy)
        ) {
            problems.push(
                `removed ${JSON.stringify(removed.id)} is replaced by ${JSON.stringify(removed.replacedBy)}, which is not live`,
            );
        }
    }
    return problems;
}

/**
 * The ids a level can be set for, in registry order: every group, then every
 * entry the engine emits or a `check` pass reports.
 *
 * @param {typeof registry} input - The registry module.
 * @returns {string[]} The ids.
 */
export function settableIds(input) {
    return [
        ...new Set([
            ...input.GROUPS.map(group => group.id),
            ...input.DIAGNOSTICS.filter(entry => entry.surfaces.engine || entry.surfaces.check).map(
                entry => entry.id,
            ),
        ]),
    ];
}

/**
 * The ids `csszyx check` reports under its `sz-diagnostic` pass: what the
 * engine emits, plus what that pass reports beside it.
 *
 * @param {typeof registry} input - The registry module.
 * @returns {Array<Record<string, any>>} The entries.
 */
function szDiagnosticEntries(input) {
    return input.DIAGNOSTICS.filter(
        entry => entry.surfaces.engine || entry.surfaces.check?.group === 'sz-diagnostic',
    );
}

/**
 * Convert a kebab-case id to its Rust enum variant.
 *
 * @param {string} id - Code id.
 * @returns {string} PascalCase variant name.
 */
export function variantName(id) {
    return id
        .split('-')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

/**
 * Render the Rust module: one variant per id the engine emits.
 *
 * @param {typeof registry} input - The registry module.
 * @returns {string} Unformatted Rust source.
 */
export function renderRust(input) {
    const codes = input.DIAGNOSTICS.filter(entry => entry.surfaces.engine);
    const variants = codes
        .map(({ id, summary }) => `    /// ${summary}\n    ${variantName(id)},`)
        .join('\n');
    const arms = codes
        .map(({ id }) => `            Self::${variantName(id)} => "${id}",`)
        .join('\n');
    const all = codes.map(({ id }) => `    DiagnosticCode::${variantName(id)},`).join('\n');
    return `// @generated by scripts/gen-diagnostic-codes.mjs
// Do not edit by hand. Edit scripts/diagnostics/registry.mjs instead.

use serde::{Deserialize, Serialize};

/// What kind of problem one engine diagnostic reports.
///
/// Rendered beside the diagnostic's text, so a consumer can tell kinds apart
/// without matching the English. The serialized form is the kebab-case id
/// \`csszyx check --rule\` accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiagnosticCode {
${variants}
}

impl DiagnosticCode {
    /// The public id, as \`csszyx check --rule\` and \`check --json\` name it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
${arms}
        }
    }
}

/// Every code, in registry order.
pub const DIAGNOSTIC_CODES: [DiagnosticCode; ${codes.length}] = [
${all}
];
`;
}

/**
 * A TypeScript union of string literals, one per line.
 *
 * @param {string[]} ids - The members.
 * @returns {string} The union's source.
 */
function union(ids) {
    return ids.map(id => `    | '${id}'`).join('\n');
}

/**
 * A TypeScript array literal of strings, one per line.
 *
 * @param {string[]} ids - The members.
 * @returns {string} The array's body.
 */
function list(ids) {
    return ids.map(id => `    '${id}',`).join('\n');
}

/**
 * Render the TypeScript ids module: what code compares ids against.
 *
 * @param {typeof registry} input - The registry module.
 * @returns {string} TypeScript source.
 */
export function renderTypeScript(input) {
    const codes = szDiagnosticEntries(input).map(entry => entry.id);
    const groups = input.GROUPS.map(group => group.id);
    const settable = settableIds(input);
    const live = input.DIAGNOSTICS.map(entry => entry.id);
    const defaults = input.DIAGNOSTICS.filter(entry => entry.defaults).map(
        ({ id, defaults }) => `    '${id}': ['${defaults.recommended}', '${defaults.atomic}'],`,
    );
    const removedIds = input.REMOVED.filter(entry => entry.was !== 'error-code').map(
        entry => entry.id,
    );
    const removed = input.REMOVED.filter(entry => entry.was !== 'error-code').map(
        ({ id, replacedBy }) =>
            `    '${id}': ${replacedBy === undefined ? 'undefined' : `'${replacedBy}'`},`,
    );
    return `// @generated by scripts/gen-diagnostic-codes.mjs
// Do not edit by hand. Edit scripts/diagnostics/registry.mjs instead.

/** What kind of problem one engine diagnostic reports, as \`csszyx check\` names it. */
export type SzDiagnosticCode =
${union(codes)};

/** Every code \`csszyx check\` reports under its \`sz-diagnostic\` pass, in registry order. */
export const SZ_DIAGNOSTIC_CODES: readonly SzDiagnosticCode[] = [
${list(codes)}
];

/** A pass of \`csszyx check\`; setting one sets every kind it reports. */
export type SzDiagnosticGroupId =
${union(groups)};

/** The passes of \`csszyx check\`, in the order it runs them. */
export const SZ_DIAGNOSTIC_GROUP_IDS: readonly SzDiagnosticGroupId[] = [
${list(groups)}
];

/** Every id a level can be set for: a pass, or a kind the engine or a pass reports. */
export type SzSettableDiagnosticId =
${union(settable)};

/** Every id a level can be set for, in registry order. */
export const SZ_SETTABLE_DIAGNOSTIC_IDS: readonly SzSettableDiagnosticId[] = [
${list(settable)}
];

/** Every live public id, whatever surface prints it. */
export type SzDiagnosticId =
${union(live)};

/**
 * Where \`recommended\` and \`atomic\` differ from \`error\`, by id. An id not
 * listed is \`error\` under both.
 */
export const SZ_DIAGNOSTIC_DEFAULT_LEVELS: Readonly<
    Record<string, readonly [recommended: 'off' | 'info' | 'warn' | 'error', atomic: 'off' | 'info' | 'warn' | 'error']>
> = {
${defaults.join('\n')}
};

/** An id a release shipped that is no longer reported; a config naming one still loads. */
export type SzRemovedDiagnosticId =
${union(removedIds)};

/**
 * Ids that shipped in a release and are no longer reported, with the id that
 * replaced each, if any. A config naming one still loads.
 */
export const SZ_REMOVED_DIAGNOSTIC_IDS: Readonly<Record<SzRemovedDiagnosticId, string | undefined>> = {
${removed.join('\n')}
};
`;
}

/**
 * The public, serializable part of each entry: what the docs and the Node
 * registry module carry. `sources` is review metadata and stays out.
 *
 * @param {typeof registry} input - The registry module.
 * @returns {{ format: number, groups: object[], diagnostics: object[], removed: object[] }} The data.
 */
export function publicData(input) {
    return {
        format: input.REGISTRY_FORMAT,
        groups: input.GROUPS.map(({ id, summary }) => ({ id, summary })),
        diagnostics: input.DIAGNOSTICS.map(({ sources: _sources, ...entry }) => entry),
        removed: input.REMOVED.map(entry => ({ ...entry })),
    };
}

/**
 * Render the Node-only registry module. Browser entries never import it: one
 * object is not tree-shaken per key, so a single use would ship every entry.
 *
 * @param {typeof registry} input - The registry module.
 * @returns {string} TypeScript source.
 */
export function renderRegistryModule(input) {
    const data = publicData(input);
    return `// @generated by scripts/gen-diagnostic-codes.mjs
// Do not edit by hand. Edit scripts/diagnostics/registry.mjs instead.
//
// Node-only: every entry in one object, which no bundler tree-shakes per key.
// A browser entry must never import this module.

/** One argument a diagnostic carries. */
export interface SzDiagnosticArgSpec {
    /** \`string\`, \`number\`, \`string[]\`, or \`['enum', ...values]\`. */
    readonly type: string | readonly string[];
    /** Absent from the record when the diagnostic has nothing for it. */
    readonly optional?: boolean;
    /** Text from a third party (a parser, a JSON reader): unstable, never a key. */
    readonly opaque?: boolean;
    /** How a list joins when it is written into a sentence. */
    readonly joiner?: string;
}

/** One public diagnostic id. */
export interface SzDiagnosticSpec {
    readonly id: string;
    readonly summary: string;
    readonly surfaces: {
        readonly engine?: Record<string, never>;
        readonly check?: { readonly group: string };
        readonly runtime?: { readonly production: boolean };
        readonly error?: { readonly classes?: readonly string[] };
    };
    readonly defaults?: { readonly recommended: string; readonly atomic: string };
    readonly position: 'site' | 'file' | 'none';
    readonly args?: Readonly<Record<string, SzDiagnosticArgSpec>>;
    readonly forms?: readonly string[];
    readonly gaps?: readonly string[];
}

/** The registry's format, so a reader can refuse one it does not know. */
export const SZ_DIAGNOSTIC_REGISTRY_FORMAT = ${data.format};

/** Every live id, in registry order. */
export const SZ_DIAGNOSTIC_REGISTRY: readonly SzDiagnosticSpec[] = ${JSON.stringify(data.diagnostics, null, 4)};
`;
}

/**
 * Run rustfmt over generated source so the file matches the repo's Rust style.
 *
 * @param {string} source - Unformatted Rust source.
 * @returns {string} Formatted source, or the input when rustfmt is unavailable.
 */
function formatRust(source) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'csszyx-diagnostic-codes-'));
    const file = path.join(dir, 'diagnostic_codes.rs');
    try {
        writeFileSync(file, source);
        const result = spawnSync('rustfmt', ['--edition', '2021', file], { encoding: 'utf8' });
        if (result.status !== 0) {
            return source;
        }
        return readFileSync(file, 'utf8');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * Format TypeScript and JSON the way Biome formats that path in this repo, so a
 * generated file is byte-identical to what the formatter leaves in the tree.
 *
 * @param {Array<[string, string]>} outputs - Path and content pairs.
 * @returns {Array<[string, string]>} The formatted pairs.
 */
function formatWithBiome(outputs) {
    return outputs.map(([file, content]) => {
        const result = spawnSync(
            path.join(repoRoot, 'node_modules/.bin/biome'),
            ['format', `--stdin-file-path=${file}`],
            { cwd: repoRoot, encoding: 'utf8', input: content },
        );
        return [file, result.status === 0 ? result.stdout : content];
    });
}

/**
 * Read a file, or the empty string when it does not exist.
 *
 * @param {string} file - Absolute path.
 * @returns {string} Its contents.
 */
function readOrEmpty(file) {
    try {
        return readFileSync(file, 'utf8');
    } catch {
        return '';
    }
}

/**
 * Write every generated file, or verify the committed ones are current.
 *
 * @param {boolean} check - When true, report drift instead of writing.
 * @returns {number} Process exit code.
 */
export function main(check) {
    const problems = validateRegistry(registry);
    for (const problem of problems) console.error(`[gen-diagnostic-codes] ${problem}`);
    if (problems.length > 0) return 1;
    const outputs = [
        [rustPath, formatRust(renderRust(registry))],
        ...formatWithBiome([
            [tsPath, renderTypeScript(registry)],
            [registryTsPath, renderRegistryModule(registry)],
            [docsDataPath, `${JSON.stringify(publicData(registry), null, 2)}\n`],
        ]),
    ];
    if (check) {
        const stale = outputs.filter(([file, generated]) => readOrEmpty(file) !== generated);
        for (const [file] of stale) {
            console.error(
                `[gen-diagnostic-codes] ${path.relative(repoRoot, file)} is stale. Run pnpm gen:diagnostic-codes.`,
            );
        }
        return stale.length === 0 ? 0 : 1;
    }
    for (const [file, generated] of outputs) {
        writeFileSync(file, generated);
        console.log(`[gen-diagnostic-codes] wrote ${path.relative(repoRoot, file)}`);
    }
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(main(process.argv.includes('--check')));
}
