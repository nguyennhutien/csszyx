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
 * - the compiler's browser module: one plain object per id a console line or a
 *   throw words, which the development renderer `szReport` fills;
 * - the constants module: the engine limits a sentence names, for both;
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

import { browserSourceFiles } from './diagnostics/browser-sources.mjs';
import { productionLookups, readLookupTables } from './diagnostics/docs-lookups.mjs';
import * as registry from './diagnostics/registry.mjs';

export { browserSourceFiles };

const repoRoot = path.resolve(import.meta.dirname, '..');
const rustPath = path.join(repoRoot, 'packages/core/src/transform/generated/diagnostic_codes.rs');
const tsPath = path.join(repoRoot, 'packages/compiler/src/diagnostic-codes.generated.ts');
const registryTsPath = path.join(
    repoRoot,
    'packages/compiler/src/diagnostic-registry.generated.ts',
);
const specTsPath = path.join(repoRoot, 'packages/compiler/src/diagnostic-spec.generated.ts');
const docsDataPath = path.join(repoRoot, 'apps/docs/src/data/diagnostics.json');
const browserPath = path.join(repoRoot, 'packages/compiler/src/diagnostic-browser.generated.ts');
const nodeWordsPath = path.join(
    repoRoot,
    'packages/compiler/src/diagnostic-node-words.generated.ts',
);
const reportPath = path.join(repoRoot, 'packages/compiler/src/report.ts');
const constantsPath = path.join(
    repoRoot,
    'packages/compiler/src/diagnostic-constants.generated.ts',
);
const editorTemplatesPath = path.join(
    repoRoot,
    'packages/compiler/src/editor-diagnostic-templates.generated.ts',
);

/**
 * The codes the VS Code extension reports, from the keys it reads in a static
 * `sz` object: the engine's verdict on one key, which the extension mirrors.
 */
export const EDITOR_IDS = ['unknown-key', 'canonical-key', 'removed-key', 'numeric-key'];

/** A public id: lower-case words joined by single hyphens. */
export const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * A placeholder in a template: `{` + a camelCase name + `}`. Every other brace
 * is a literal character, so a template needs no escape for `{ p: 4 }`. A
 * `${name}` is literal too: messages quote JavaScript template strings.
 */
export const PLACEHOLDER_PATTERN = /(?<!\$)\{([a-z][a-zA-Z0-9]*)\}/g;

const SURFACES = ['engine', 'check', 'runtime', 'error'];
const HOSTS = ['browser', 'node', 'both'];
const LEVELS = ['off', 'info', 'warn', 'error'];
const POSITIONS = ['site', 'file', 'none'];
const SCALAR_TYPES = ['string', 'number', 'string[]'];
const TEMPLATE_FIELDS = ['text', 'help', 'note'];

/**
 * Names that keep their capital letter wherever they sit in a help or note
 * clause, including right after a `;`. None of them may start a clause after
 * the label or a second sentence: the label's clause starts lower-case.
 */
export const PROPER_NOUNS = new Set([
    'Astro',
    'CSS',
    'ESLint',
    'JavaScript',
    'JSX',
    'Next',
    'Node',
    'Preact',
    'Qwik',
    'React',
    'Solid',
    'Svelte',
    'Tailwind',
    'Turbopack',
    'TypeScript',
    'Vite',
    'Vue',
]);

/** A Markdown code span: double backticks around text holding one, or single. */
const CODE_SPAN = /``[^`]*?``|`[^`]*`/g;

/** What a code span reads as once its text is set aside. */
const CODE_MARK = '\u0001';

/**
 * Where a template or a rendered field breaks the casing rule (ADR 0031):
 * the main sentence (`text`) starts upper-case or with a code span and ends
 * with a period, as tsc and ESLint write theirs; a `help` or `note` is one
 * clause after its label, starting lower-case or with a code span, with more
 * advice joined by `;`, never a second sentence. Text inside a code span is
 * code, not prose, so it is not read.
 *
 * A placeholder renders text the template cannot see. At the start of a field
 * only a computed value may stand, and a test renders every value it takes;
 * an arg there is third-party text whose casing nobody chose.
 *
 * @param {'text' | 'help' | 'note'} field - The field.
 * @param {string} template - A template, or a field as rendered.
 * @param {ReadonlySet<string>} [computed] - The computed value names.
 * @returns {string[]} One message per broken rule.
 */
export function casingProblems(field, template, computed = new Set()) {
    const problems = [];
    const prose = template.replace(CODE_SPAN, CODE_MARK);
    const lead = /^\{([a-z][a-zA-Z0-9]*)\}/.exec(prose);
    const first = prose.charAt(0);
    const leadsWell =
        lead !== null
            ? computed.has(lead[1])
            : first === CODE_MARK || (field === 'text' ? /[A-Z]/ : /[a-z]/).test(first);
    if (!leadsWell) {
        problems.push(
            field === 'text'
                ? 'starts with neither an upper-case letter nor a code span'
                : 'starts with neither a lower-case letter nor a code span',
        );
    }
    if (field === 'text' && !prose.trimEnd().endsWith('.')) {
        problems.push('does not end with a period');
    }
    if (field !== 'text' && /[.?!]\s+[A-Z]/.test(prose)) {
        problems.push('has a second sentence; join further advice with `;`');
    }
    for (const [, word] of prose.matchAll(/;\s+([A-Z][A-Za-z]*)/g)) {
        if (!PROPER_NOUNS.has(word)) {
            problems.push(`starts a clause after \`;\` upper-case (${word})`);
        }
    }
    return problems;
}

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
function validateEntry(entry, groups, problems, computed = new Map(), browserFiles = undefined) {
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
    const production = entry.surfaces?.runtime?.production;
    if (entry.surfaces?.runtime && typeof production !== 'boolean' && !Array.isArray(production)) {
        problems.push(`${at}: runtime production is true, false or a list of forms`);
    }
    if (Array.isArray(production)) {
        if (production.length === 0) {
            problems.push(`${at}: lists no production form; write \`production: false\``);
        }
        for (const form of production) {
            if (!(entry.forms ?? []).includes(form)) {
                problems.push(
                    `${at}: prints in production for form ${form}, which is not one of its forms`,
                );
            }
        }
    }
    // `szReport` prints through `console.warn` unless the line is an error.
    const sink = entry.surfaces?.runtime?.console;
    if (sink !== undefined && sink !== 'error') {
        problems.push(`${at}: runtime console is \`error\`, or absent for \`console.warn\``);
    }
    validateHosts(entry, at, problems, browserFiles);
    const thrownInProduction = entry.surfaces?.error?.production;
    if (thrownInProduction !== undefined && typeof thrownInProduction !== 'boolean') {
        problems.push(`${at}: error production is true or false`);
    }
    if (!POSITIONS.includes(entry.position)) {
        problems.push(`${at}: position must be one of ${POSITIONS.join(', ')}`);
    }
    // The renderer heads an engine message with its place and fills its
    // sentence from declared args: both must be there to read.
    if (entry.surfaces?.engine && entry.position === 'none') {
        problems.push(`${at}: an engine id points at a site or at its file, never at no place`);
    }
    // The renderer and the dedupe key read every id's args.
    if (entry.args === undefined) {
        problems.push(`${at}: declares its args, \`{}\` for none`);
    }
    const args = entry.args ?? {};
    for (const [name, arg] of Object.entries(args)) {
        if (!/^[a-z][a-zA-Z0-9]*$/.test(name))
            problems.push(`${at}: argument ${name} is not camelCase`);
        if (!isArgType(arg?.type)) problems.push(`${at}: argument ${name} has an unknown type`);
        if (arg?.joiner !== undefined && arg.type !== 'string[]') {
            problems.push(`${at}: argument ${name} has a joiner but is not a list`);
        }
        if (arg?.type === 'string[]' && typeof arg.joiner !== 'string') {
            problems.push(`${at}: list argument ${name} declares no joiner`);
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
    validateTemplates(entry, at, problems, computed);
}

/**
 * The places a host names: `both` is the browser and Node.
 *
 * @param {string} host - `browser`, `node` or `both`.
 * @returns {string[]} The places.
 */
function placesOf(host) {
    return host === 'both' ? ['browser', 'node'] : [host];
}

/**
 * Where an entry renders by its surfaces: each console line's and throw's
 * \`host\`, and Node for an engine or a check id, which the build and the CLI
 * print.
 *
 * @param {Record<string, any>} entry - A registry entry.
 * @returns {Set<string>} \`browser\`, \`node\`, or both.
 */
function declaredPlaces(entry) {
    const places = new Set();
    if (entry.surfaces?.engine || entry.surfaces?.check) places.add('node');
    for (const surface of ['runtime', 'error']) {
        const host = entry.surfaces?.[surface]?.host;
        if (host !== undefined) for (const place of placesOf(host)) places.add(place);
    }
    return places;
}

/**
 * Whether Node renders an entry's words: an engine or check id, or a console
 * line or a throw whose host includes Node. The Node registry carries only
 * these words; a browser-only line's live in the browser module.
 *
 * @param {Record<string, any>} entry - A registry entry.
 * @returns {boolean} Whether it does.
 */
export function rendersInNode(entry) {
    return declaredPlaces(entry).has('node');
}

/**
 * Check where each console line and throw says it runs: \`host\` is required
 * and one of {@link HOSTS}, and, given the browser files, the places the
 * entry's \`sources\` run in must be the places its surfaces declare.
 *
 * @param {Record<string, any>} entry - A registry entry.
 * @param {string} at - The entry's label.
 * @param {string[]} problems - Where problems are collected.
 * @param {ReadonlySet<string> | undefined} browserFiles - The files a browser bundle can hold.
 */
function validateHosts(entry, at, problems, browserFiles) {
    let valid = true;
    for (const surface of ['runtime', 'error']) {
        const spec = entry.surfaces?.[surface];
        if (spec !== undefined && !HOSTS.includes(spec.host)) {
            problems.push(`${at}: ${surface} host is browser, node or both`);
            valid = false;
        }
    }
    if (!valid || browserFiles === undefined) return;
    if (!entry.surfaces?.runtime && !entry.surfaces?.error) return;
    const declared = [...declaredPlaces(entry)].sort().join(' and ');
    const actual = [
        ...new Set(
            (entry.sources ?? []).map(source =>
                browserFiles.has(source.replace(/:\d+$/, '')) ? 'browser' : 'node',
            ),
        ),
    ]
        .sort()
        .join(' and ');
    if (declared !== actual) {
        problems.push(
            `${at}: runs in ${declared} by its surfaces, but its sources run in ${actual}`,
        );
    }
}

/**
 * Check an entry's templates against its arguments: every placeholder names
 * an argument, and every required argument is used by the text of each form.
 *
 * @param {Record<string, any>} entry - A registry entry.
 * @param {string} at - The entry's label.
 * @param {string[]} problems - Where problems are collected.
 */
/**
 * The values a per-variant template is keyed by: the entry's forms, or the
 * values of the enum arg it varies by.
 *
 * @param {Record<string, any>} entry - The entry.
 * @returns {string[]} The values.
 */
function variantsOf(entry) {
    if (entry.variesBy === undefined) return entry.forms ?? [];
    const type = entry.args?.[entry.variesBy]?.type;
    return Array.isArray(type) ? type.slice(1) : [];
}

function validateTemplates(entry, at, problems, computed = new Map()) {
    const args = entry.args ?? {};
    const templates = templatesOf(entry);
    for (const { field, form, template } of templates) {
        for (const name of placeholdersOf(template)) {
            if (!(name in args) && !computed.has(name)) {
                problems.push(
                    `${at}: ${field}${form ? ` (${form})` : ''} names {${name}}, which is neither an argument nor a computed value`,
                );
            }
        }
        if (form !== undefined && !variantsOf(entry).includes(form)) {
            problems.push(
                `${at}: ${field} has a text for ${form}, which is not a value of ${entry.variesBy ?? 'form'}`,
            );
        }
    }
    // A computed value its templates name must not share a name with an arg:
    // the renderer would print the arg and never compute it.
    for (const { template } of templates) {
        for (const name of placeholdersOf(template)) {
            if (name in args && computed.has(name)) {
                problems.push(`${at}: {${name}} is both an arg and a computed value`);
            }
        }
    }
    if (entry.variesBy !== undefined && !Array.isArray(args[entry.variesBy]?.type)) {
        problems.push(`${at}: varies by ${entry.variesBy}, which is not one of its enum args`);
    }
    for (const { field, form, template } of templates) {
        for (const problem of casingProblems(field, template, new Set(computed.keys()))) {
            problems.push(`${at}: ${field}${form ? ` (${form})` : ''}: ${problem}`);
        }
    }
    const texts = templates.filter(({ field }) => field === 'text');
    if (texts.length === 0) return;
    const required = Object.entries(args)
        .filter(([name, arg]) => !arg.optional && name !== 'form')
        .map(([name]) => name);
    // An arg is used when a template names it, a computed value a template
    // names reads it, or it selects the template.
    const used = new Set(entry.variesBy === undefined ? [] : [entry.variesBy]);
    for (const { template } of templates) {
        for (const name of placeholdersOf(template)) {
            used.add(name);
            for (const read of computed.get(name)?.reads ?? []) used.add(read);
        }
    }
    for (const name of required) {
        if (!used.has(name))
            problems.push(`${at}: required argument ${name} is used by no template`);
    }
}

/**
 * Every rule the registry must keep. An id is public once it ships, so these
 * hold for ids, not for wording.
 *
 * @param {typeof registry} input - The registry module.
 * @param {ReadonlySet<string>} [browserFiles] - The files a browser bundle can
 *   hold, from {@link browserSourceFiles}; given, each \`host\` is checked
 *   against the entry's \`sources\`.
 * @returns {string[]} One message per broken rule; empty when it is sound.
 */
export function validateRegistry(input, browserFiles = undefined) {
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
        validateEntry(
            entry,
            groups,
            problems,
            new Map(Object.entries(input.COMPUTED ?? {})),
            browserFiles,
        );
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
 * Convert a kebab-case or camelCase name to snake_case.
 *
 * @param {string} name - The name.
 * @returns {string} The snake_case spelling.
 */
export function snakeName(name) {
    return name.replaceAll('-', '_').replaceAll(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * The Rust parameter and the `Args` builder call for one arg of a constructor.
 *
 * @param {string} name - The arg's registry name.
 * @param {Record<string, any>} arg - The arg.
 * @returns {{ param: string, call: string, check: string }} Source fragments.
 */
function rustArg(name, arg) {
    const param = snakeName(name);
    const listed = Array.isArray(arg.type) ? arg.type.slice(1) : undefined;
    const optional = arg.optional ? 'optional_' : '';
    const [type, method] =
        arg.type === 'number'
            ? ['u64', 'count']
            : arg.type === 'string[]'
              ? ['Vec<String>', 'list']
              : [listed ? "&'static str" : '&str', 'text'];
    // An enum arg names one of a closed set; a value outside it is the
    // engine's own mistake, caught where it is made.
    const values = listed ? `[${listed.map(item => JSON.stringify(item)).join(', ')}]` : '';
    let check = '';
    if (listed) {
        check = arg.optional
            ? `debug_assert!(${param}.is_none_or(|v| ${values}.contains(&v)));\n`
            : `debug_assert!(${values}.contains(&${param}));\n`;
    }
    return {
        param: arg.optional ? `${param}: Option<${type}>` : `${param}: ${type}`,
        call: `.${optional}${method}("${name}", ${param})`,
        check,
    };
}

/**
 * One constructor per (code, form): the only way the engine builds an issue,
 * so its args carry the registry's names in the registry's order. Each is a
 * chain of calls to the out-of-line `Args` helpers, inlined where it is used,
 * so a constructor costs its site a few calls and the binary no name.
 *
 * @param {Record<string, any>} entry - An engine id.
 * @returns {string} The constructors' Rust source.
 */
function rustConstructors(entry) {
    const args = Object.entries(entry.args ?? {}).filter(([name]) => name !== 'form');
    const fragments = args.map(([name, arg]) => rustArg(name, arg));
    const params = fragments.map(fragment => fragment.param).join(', ');
    const checks = fragments.map(fragment => fragment.check).join('');
    const calls = fragments.map(fragment => fragment.call).join('');
    const variant = variantName(entry.id);
    return (entry.forms ?? [undefined])
        .map(form => {
            const name = snakeName(form === undefined ? entry.id : `${entry.id}-${form}`);
            const head =
                form === undefined ? 'Args::default()' : `Args::default().text("form", "${form}")`;
            const label = form === undefined ? '' : ` (\`${form}\`)`;
            return `/// \`${entry.id}\`${label}: ${entry.summary}
#[must_use]
#[inline]
pub fn ${name}(${params}) -> (DiagnosticCode, Args) {
${checks}(DiagnosticCode::${variant}, ${head}${calls})
}`;
        })
        .join('\n\n');
}

/**
 * A Rust string literal: raw when the text holds a quote.
 *
 * @param {string} text - The text.
 * @returns {string} The literal.
 */
function rustStringLiteral(text) {
    return text.includes('"') ? `r#"${text}"#` : `"${text}"`;
}

/**
 * One assertion per constructor: called with every arg present, it writes them
 * under the registry's names, in the registry's order, as the wire carries them.
 *
 * @param {Record<string, any>} entry - An engine id.
 * @returns {string} The assertions' Rust source.
 */
function rustConstructorChecks(entry) {
    const args = Object.entries(entry.args ?? {}).filter(([name]) => name !== 'form');
    const sample = ([name, arg]) => {
        if (arg.type === 'number') return { rust: '7', json: 7 };
        if (arg.type === 'string[]') return { rust: `vec!["${name}".to_string()]`, json: [name] };
        const value = Array.isArray(arg.type) ? arg.type[1] : name;
        return { rust: `"${value}"`, json: value };
    };
    return (entry.forms ?? [undefined])
        .map(form => {
            const name = snakeName(form === undefined ? entry.id : `${entry.id}-${form}`);
            const values = args.map(arg => ({ arg, ...sample(arg) }));
            // Once with every optional arg, once with none: an absent one is left out.
            return [true, false]
                .map(withOptional => {
                    const call = values
                        .map(({ arg: [, spec], rust }) =>
                            spec.optional ? (withOptional ? `Some(${rust})` : 'None') : rust,
                        )
                        .join(', ');
                    const json = Object.fromEntries([
                        ...(form === undefined ? [] : [['form', form]]),
                        ...values
                            .filter(({ arg: [, spec] }) => withOptional || !spec.optional)
                            .map(({ arg: [argName], json: value }) => [argName, value]),
                    ]);
                    return `let (code, args) = issue::${name}(${call});
assert_eq!(code, DiagnosticCode::${variantName(entry.id)});
assert_eq!(args.to_json(), ${rustStringLiteral(JSON.stringify(json))});`;
                })
                .join('\n');
        })
        .join('\n');
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

${Object.values(input.CONSTANTS ?? {})
    .map(
        ({ rust, type, value }) =>
            `/// Shared with the renderer, which prints it.\n#[cfg_attr(not(feature = "native-engine"), allow(dead_code))]\npub const ${rust}: ${type} = ${value};`,
    )
    .join('\n\n')}

/// The engine's diagnostics, one constructor per code and form, each
/// returning the code with its named args in registry order.
pub mod issue {
// A form only the TypeScript lanes report has a constructor the engine never calls.
#![allow(clippy::too_many_arguments, dead_code)]
use super::DiagnosticCode;
use crate::transform::Args;

${codes.map(rustConstructors).join('\n\n')}
}

#[cfg(test)]
mod tests {
use super::{issue, DiagnosticCode};

// One assertion pair per constructor, generated: its length is the registry's.
#[test]
#[allow(clippy::too_many_lines)]
fn every_constructor_names_its_args_in_registry_order() {
${codes.map(rustConstructorChecks).join('\n')}
}
}
`;
}

/**
 * The TypeScript type of one arg.
 *
 * @param {Record<string, any>} arg - The arg.
 * @returns {string} The type.
 */
function tsArgType(arg) {
    if (Array.isArray(arg.type))
        return arg.type
            .slice(1)
            .map(value => `'${value}'`)
            .join(' | ');
    return arg.type === 'string[]' ? 'readonly string[]' : arg.type;
}

/**
 * One member of \`SzDiagnosticArgsByCode\` per engine id.
 *
 * @param {typeof registry} input - The registry module.
 * @returns {string} The interface body.
 */
function engineArgTypes(input) {
    return input.DIAGNOSTICS.filter(entry => entry.surfaces.engine)
        .map(entry => {
            const fields = Object.entries(entry.args ?? {})
                .map(
                    ([name, arg]) =>
                        `readonly ${name}${arg.optional ? '?' : ''}: ${tsArgType(arg)};`,
                )
                .join(' ');
            return `    '${entry.id}': { ${fields} };`;
        })
        .join('\n');
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
    // The engine's codes, as the Rust enum has them; `other` is the pass's own.
    const codes = input.DIAGNOSTICS.filter(entry => entry.surfaces.engine).map(entry => entry.id);
    const groups = input.GROUPS.map(group => group.id);
    const settable = settableIds(input);
    const live = input.DIAGNOSTICS.map(entry => entry.id);
    const thrown = input.DIAGNOSTICS.filter(entry => entry.surfaces.error).map(entry => entry.id);
    const defaults = input.DIAGNOSTICS.filter(entry => entry.defaults).map(
        ({ id, defaults }) => `    '${id}': ['${defaults.recommended}', '${defaults.atomic}'],`,
    );
    const removedEntries = input.REMOVED.filter(entry => entry.was !== 'error-code');
    // `never` when nothing is removed yet; an alias of `never` alone reads as redundant.
    const removedKeys =
        removedEntries.length === 0
            ? 'never'
            : removedEntries.map(entry => `'${entry.id}'`).join(' | ');
    const removed = removedEntries.map(
        ({ id, replacedBy }) =>
            `    '${id}': ${replacedBy === undefined ? 'undefined' : `'${replacedBy}'`},`,
    );
    return `// @generated by scripts/gen-diagnostic-codes.mjs
// Do not edit by hand. Edit scripts/diagnostics/registry.mjs instead.

/** What kind of problem one engine diagnostic reports, as \`csszyx check\` names it. */
export type SzDiagnosticCode =
${union(codes)};

/**
 * The named values each engine code carries in \`issue.args\`, by code. An
 * optional value the diagnostic has nothing for is absent, never \`null\`.
 */
export interface SzDiagnosticArgsByCode {
${engineArgTypes(input)}
}

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
 * The \`code\` of an error csszyx throws: every id the registry gives an
 * error surface, so a typo in \`err.code === '…'\` fails to compile.
 */
export type SzErrorCode =${thrown.length === 0 ? ' never' : `\n${union(thrown)}`};

/**
 * Where \`recommended\` and \`atomic\` differ from \`error\`, by id. An id not
 * listed is \`error\` under both.
 */
export const SZ_DIAGNOSTIC_DEFAULT_LEVELS: Readonly<
    Record<string, readonly [recommended: 'off' | 'info' | 'warn' | 'error', atomic: 'off' | 'info' | 'warn' | 'error']>
> = {
${defaults.join('\n')}
};

/**
 * Ids that shipped in a release and are no longer reported, with the id that
 * replaced each, if any. A config naming one still loads.
 */
export const SZ_REMOVED_DIAGNOSTIC_IDS: Readonly<Record<${removedKeys}, string | undefined>> = {${removed.map(line => `\n${line}`).join('')}
};

/** An id a release shipped that is no longer reported; a config naming one still loads. */
export type SzRemovedDiagnosticId = keyof typeof SZ_REMOVED_DIAGNOSTIC_IDS;
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
 * The docs site's data: the public data, plus what a page needs to show each
 * message as a reader sees it: the placeholder grammar, a line on where each
 * computed value comes from, and the rows of computed values a production
 * line leaves out (`./diagnostics/docs-lookups.mjs`).
 *
 * @param {typeof registry} input - The registry module.
 * @param {import('./diagnostics/docs-lookups.mjs').LookupTables} tables - The compiler tables.
 * @returns {Record<string, unknown>} The data.
 */
export function docsData(input, tables) {
    return {
        ...publicData(input),
        placeholder: PLACEHOLDER_PATTERN.source,
        computed: Object.fromEntries(
            Object.entries(input.COMPUTED ?? {}).map(([name, { summary }]) => [name, summary]),
        ),
        lookups: productionLookups(tables),
    };
}

/**
 * An entry without its words.
 *
 * @param {Record<string, any>} entry - A public entry.
 * @returns {Record<string, any>} Its metadata.
 */
function metadataOf(entry) {
    const { text: _text, help: _help, note: _note, ...metadata } = entry;
    return metadata;
}

/**
 * Render the Node words module: the words of every id Node renders beyond the
 * engine's — a check pass, a \`node\` or \`both\` console line, a throw in Node —
 * by id. The root's renderer reads them; \`./engine\` and \`./internal\` render
 * engine ids only and never load this module.
 *
 * @param {typeof registry} input - The registry module.
 * @returns {string} TypeScript source.
 */
export function renderNodeWordsModule(input) {
    const words = Object.fromEntries(
        input.DIAGNOSTICS.filter(
            entry =>
                !entry.surfaces.engine &&
                rendersInNode(entry) &&
                TEMPLATE_FIELDS.some(field => entry[field] !== undefined),
        ).map(({ id, text, help, note }) => [id, { text, help, note }]),
    );
    return `// @generated by scripts/gen-diagnostic-codes.mjs
// Do not edit by hand. Edit scripts/diagnostics/registry.mjs instead.
//
// Node-only, and only for the root's renderer: the engine lane loads none of it.

import type { SzDiagnosticWords } from './diagnostic-registry.generated.js';

/** The words of each id Node renders that the engine does not report, by id. */
export const SZ_NODE_DIAGNOSTIC_WORDS: Readonly<Record<string, SzDiagnosticWords>> = ${JSON.stringify(words, null, 4)};
`;
}

/**
 * The fields of an entry the renderer reads: what a line is rendered from,
 * and nothing about where or when it is reported. The render specs carry
 * these alone, so a Node entry loads no summary, surface or form; an arg
 * keeps only its joiner.
 */
export const RENDER_FIELDS = ['id', 'position', 'args', 'variesBy', 'text', 'help', 'note'];

/**
 * An entry cut down to {@link RENDER_FIELDS}.
 *
 * @param {Record<string, any>} entry - A public entry.
 * @returns {Record<string, any>} What the renderer reads of it.
 */
function renderSpecOf(entry) {
    const spec = {};
    for (const field of RENDER_FIELDS) {
        if (entry[field] === undefined) continue;
        spec[field] =
            field === 'args'
                ? Object.fromEntries(
                      Object.entries(entry.args).map(([name, arg]) => [
                          name,
                          arg.joiner === undefined ? {} : { joiner: arg.joiner },
                      ]),
                  )
                : entry[field];
    }
    return spec;
}

/**
 * The public entries, words for the engine's ids only: \`./engine\` renders
 * nothing else. The other ids Node renders have theirs in the Node words
 * module, a browser-only line's are in the browser module.
 *
 * @param {typeof registry} input - The registry module.
 * @returns {Record<string, any>[]} The entries.
 */
function nodeEntries(input) {
    return publicData(input).diagnostics.map((entry, index) =>
        input.DIAGNOSTICS[index].surfaces.engine ? entry : metadataOf(entry),
    );
}

/**
 * Render the Node-only registry module the renderer reads. Browser entries
 * never import it: one object is not tree-shaken per key, so a single use
 * would ship every entry. Each id keeps only {@link RENDER_FIELDS}, and only
 * an engine id keeps its words, so \`./engine\` loads no metadata and no
 * template it never renders. {@link renderNodeWordsModule} holds the other
 * words Node renders; {@link renderSpecModule} the full specification.
 *
 * @param {typeof registry} input - The registry module.
 * @returns {string} TypeScript source.
 */
export function renderRegistryModule(input) {
    const data = publicData(input);
    const specs = nodeEntries(input).map(renderSpecOf);
    return `// @generated by scripts/gen-diagnostic-codes.mjs
// Do not edit by hand. Edit scripts/diagnostics/registry.mjs instead.
//
// Node-only: every entry in one object, which no bundler tree-shakes per key.
// A browser entry must never import this module. It carries what a line is
// rendered from; the full specification is \`diagnostic-spec.generated.ts\`,
// which no compiler entry imports.

/** One id as the renderer reads it. */
export interface SzDiagnosticRenderSpec {
    readonly id: string;
    /** What a record's \`start\` points at. */
    readonly position: 'site' | 'file' | 'none';
    /** Every arg, by name, in registry order; a list arg with its separator. */
    readonly args: Readonly<Record<string, { readonly joiner?: string }>>;
    /** The enum arg a per-variant template is keyed by, when it is not \`form\`. */
    readonly variesBy?: string;
    /** What the diagnostic says: one template, or one per variant. */
    readonly text?: SzDiagnosticTemplateText;
    /** What to do. */
    readonly help?: SzDiagnosticTemplateText;
    /** What does not happen, or still holds. */
    readonly note?: SzDiagnosticTemplateText;
}

/** A template: one text, or one per variant of the sentence. */
export type SzDiagnosticTemplateText = string | Readonly<Record<string, string>>;

/** What a diagnostic says, apart from its metadata. */
export type SzDiagnosticWords = Pick<SzDiagnosticRenderSpec, 'text' | 'help' | 'note'>;

/** The registry's format, so a reader can refuse one it does not know. */
export const SZ_DIAGNOSTIC_REGISTRY_FORMAT = ${data.format};

// Generated once, into a module the browser helpers read too.
export { SZ_DIAGNOSTIC_CONSTANTS } from './diagnostic-constants.generated.js';

/** The computed values a template may name beside its args. */
export const SZ_DIAGNOSTIC_COMPUTED: readonly string[] = ${JSON.stringify(Object.keys(input.COMPUTED ?? {}))};

/** Every live id as the renderer reads it, in registry order. */
export const SZ_DIAGNOSTIC_RENDER_SPECS: readonly SzDiagnosticRenderSpec[] = ${JSON.stringify(specs, null, 4)};
`;
}

/**
 * Render the full specification module: every id with all its metadata, for
 * tests and tools. No compiler entry imports it
 * (\`tests/diagnostic-render-specs.test.ts\`).
 *
 * @param {typeof registry} input - The registry module.
 * @returns {string} TypeScript source.
 */
export function renderSpecModule(input) {
    return `// @generated by scripts/gen-diagnostic-codes.mjs
// Do not edit by hand. Edit scripts/diagnostics/registry.mjs instead.
//
// For tests and tools: no compiler entry may import this module. The renderer
// reads \`diagnostic-registry.generated.ts\`.

import type { SzDiagnosticTemplateText } from './diagnostic-registry.generated.js';

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
        readonly runtime?: {
            readonly production: boolean | readonly string[];
            /** Where the line prints: a browser bundle, Node, or both. */
            readonly host: 'browser' | 'node' | 'both';
            /** \`error\` when the line prints through \`console.error\`; absent, \`console.warn\`. */
            readonly console?: 'error';
        };
        readonly error?: {
            readonly classes?: readonly string[];
            readonly production?: boolean;
            /** Where it is thrown: a browser bundle, Node, or both. */
            readonly host: 'browser' | 'node' | 'both';
        };
    };
    readonly defaults?: { readonly recommended: string; readonly atomic: string };
    readonly position: 'site' | 'file' | 'none';
    readonly args: Readonly<Record<string, SzDiagnosticArgSpec>>;
    readonly forms?: readonly string[];
    readonly gaps?: readonly string[];
    /** The enum arg a per-variant template is keyed by, when it is not \`form\`. */
    readonly variesBy?: string;
    /** What the diagnostic says: one template, or one per variant. */
    readonly text?: SzDiagnosticTemplateText;
    /** What to do. */
    readonly help?: SzDiagnosticTemplateText;
    /** What does not happen, or still holds. */
    readonly note?: SzDiagnosticTemplateText;
}

/** Every live id, in registry order. */
export const SZ_DIAGNOSTIC_REGISTRY: readonly SzDiagnosticSpec[] = ${JSON.stringify(nodeEntries(input), null, 4)};
`;
}

/**
 * The constant a browser module export is named by: the id in upper snake
 * case, so `removed-key` is `REMOVED_KEY`. An id starts with a letter, so the
 * name is a valid identifier.
 *
 * @param {string} id - A public id.
 * @returns {string} The constant's name.
 */
export function browserConstName(id) {
    return id.toUpperCase().replaceAll('-', '_');
}

/**
 * The ids the browser module carries, in registry order: every id a console
 * line or a throw reports, once the registry words it. An id with no text yet
 * has nothing for the renderer to fill.
 *
 * @param {typeof registry} input - The registry module.
 * @returns {Record<string, any>[]} The entries.
 */
export function browserDiagnostics(input) {
    return input.DIAGNOSTICS.filter(
        entry =>
            (entry.surfaces.runtime !== undefined || entry.surfaces.error !== undefined) &&
            entry.text !== undefined,
    );
}

/**
 * What the development renderer reads of one entry: the id its line is headed
 * by, each arg in registry order with its joiner when it is a list, the
 * templates, and the console method when it is not \`warn\`.
 *
 * @param {Record<string, any>} entry - A registry entry.
 * @returns {Record<string, unknown>} The data; absent fields are left out.
 */
function browserEntry(entry) {
    const { id, variesBy, text, help, note } = entry;
    return {
        id,
        args: templateArgs(entry),
        variesBy,
        text,
        help,
        note,
        console: entry.surfaces.runtime?.console,
    };
}

/**
 * What filling a template reads of an entry's args: each name, in registry
 * order, with its joiner when it is a list.
 *
 * @param {Record<string, any>} entry - A registry entry.
 * @returns {Record<string, { joiner?: string }>} The args.
 */
function templateArgs(entry) {
    return Object.fromEntries(
        Object.entries(entry.args).map(([name, arg]) => [
            name,
            arg.joiner === undefined ? {} : { joiner: arg.joiner },
        ]),
    );
}

/**
 * The TypeScript type of an entry's args, for \`szReport\` to check a call's
 * args against.
 *
 * @param {Record<string, any>} entry - A registry entry.
 * @returns {string} The type.
 */
function browserArgsType(entry) {
    const fields = Object.entries(entry.args).map(
        ([name, arg]) => `readonly ${name}${arg.optional ? '?' : ''}: ${tsArgType(arg)};`,
    );
    return fields.length === 0
        ? 'Record<never, never>'
        : `{ ${fields.join(' ').replace(/;$/, '')} }`;
}

/**
 * Render the constants module: the engine limits a sentence names, in a
 * module of their own, so the helpers that print them load no template.
 *
 * @param {typeof registry} input - The registry module.
 * @returns {string} TypeScript source.
 */
export function renderConstantsModule(input) {
    const constants = Object.fromEntries(
        Object.entries(input.CONSTANTS ?? {}).map(([name, { value }]) => [name, value]),
    );
    return `// @generated by scripts/gen-diagnostic-codes.mjs
// Do not edit by hand. Edit scripts/diagnostics/registry.mjs instead.

/** Engine limits a sentence names, from the registry the engine reads too. */
export const SZ_DIAGNOSTIC_CONSTANTS = ${JSON.stringify(constants)} as const;
`;
}

/**
 * Render the browser module: one plain object literal per id
 * {@link browserDiagnostics} lists. A bundle
 * keeps only the exports it uses, and a production build that references them
 * from a \`NODE_ENV\` branch alone keeps none: a bare \`Object.freeze\`
 * survives that in esbuild, Vite and webpack (measured, PR C council), so the
 * module never calls one. It imports no value, the Node registry least of all.
 *
 * @param {typeof registry} input - The registry module.
 * @returns {string} TypeScript source.
 */
export function renderBrowserModule(input) {
    const exports = browserDiagnostics(input).map(
        entry =>
            `/** \`${entry.id}\`: ${entry.summary} */\n` +
            `export const ${browserConstName(entry.id)}: SzBrowserDiagnostic<${browserArgsType(entry)}> = ` +
            `${JSON.stringify(browserEntry(entry))};`,
    );
    return `// @generated by scripts/gen-diagnostic-codes.mjs
// Do not edit by hand. Edit scripts/diagnostics/registry.mjs instead.
//
// Browser-safe: every value is a plain literal, so a bundle drops each one it
// does not use, and no value is imported. Node code reads the whole registry
// from its own module instead.

import type { SzBrowserDiagnostic } from './diagnostic-template.js';

${exports.join('\n\n')}
`;
}

/**
 * Render the \`./report\` entry: the development reporter and every browser
 * module export, each by name, so the subpath lists its whole surface and
 * re-exports nothing it did not name.
 *
 * @param {typeof registry} input - The registry module.
 * @returns {string} TypeScript source.
 */
export function renderReportEntry(input) {
    // Sorted as Biome's import organizer leaves an export list: \`_\` first.
    const key = name => name.replaceAll('_', ' ');
    const names = browserDiagnostics(input)
        .map(entry => browserConstName(entry.id))
        .sort((a, b) => (key(a) < key(b) ? -1 : 1));
    return `// @generated by scripts/gen-diagnostic-codes.mjs
// Do not edit by hand. Edit scripts/diagnostics/registry.mjs instead.

/**
 * \`@csszyx/compiler/report\`: the development reporter \`szReport\` and
 * \`szRender\`, which words a thrown error's message the same way
 * (\`diagnostic-report.ts\`), and every id the registry words for a console
 * line or a throw, so a site imports both from one place; and
 * \`suggestSzKey\`, the key an unknown key's line names, which only a
 * development branch computes.
 *
 * @internal Shared by csszyx's own packages; not a stable API.
 * @module report
 */

export { ${names.join(', ')} } from './diagnostic-browser.generated.js';
export { type SzReportOptions, szRender, szReport } from './diagnostic-report.js';
export type { SzBrowserDiagnostic } from './diagnostic-template.js';
export { suggestSzKey } from './sz-key-suggestion.js';
`;
}

/**
 * Render the editor's template module: the entries of {@link EDITOR_IDS} only,
 * so the extension fills its messages from the registry's wording without
 * bundling the whole registry.
 *
 * @param {typeof registry} input - The registry module.
 * @returns {string} TypeScript source.
 */
export function renderEditorTemplates(input) {
    const entries = EDITOR_IDS.map(id => {
        const entry = input.DIAGNOSTICS.find(candidate => candidate.id === id);
        if (entry === undefined) throw new Error(`editor id ${id} is not in the registry`);
        const { variesBy, text, help, note } = entry;
        return [id, { args: templateArgs(entry), variesBy, text, help, note }];
    });
    return `// @generated by scripts/gen-diagnostic-codes.mjs
// Do not edit by hand. Edit scripts/diagnostics/registry.mjs instead.

import type { SzDiagnosticTemplate } from './diagnostic-template.js';

/** The registry entries of the codes the VS Code extension reports, and no others. */
export const SZ_EDITOR_DIAGNOSTIC_TEMPLATES: Readonly<
    Record<${EDITOR_IDS.map(id => `'${id}'`).join(' | ')}, SzDiagnosticTemplate>
> = ${JSON.stringify(Object.fromEntries(entries), null, 4)};
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
    const problems = validateRegistry(registry, browserSourceFiles());
    for (const problem of problems) console.error(`[gen-diagnostic-codes] ${problem}`);
    if (problems.length > 0) return 1;
    const outputs = [
        [rustPath, formatRust(renderRust(registry))],
        ...formatWithBiome([
            [tsPath, renderTypeScript(registry)],
            [registryTsPath, renderRegistryModule(registry)],
            [specTsPath, renderSpecModule(registry)],
            [docsDataPath, `${JSON.stringify(docsData(registry, readLookupTables()), null, 2)}\n`],
            [browserPath, renderBrowserModule(registry)],
            [constantsPath, renderConstantsModule(registry)],
            [reportPath, renderReportEntry(registry)],
            [nodeWordsPath, renderNodeWordsModule(registry)],
            [editorTemplatesPath, renderEditorTemplates(registry)],
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
