#!/usr/bin/env node

/**
 * Generate the per-key capability table from the Tailwind this repo pins.
 *
 * csszyx lowers a value by its shape — a sign, a CSS-wide keyword — and whether
 * Tailwind serves the class it writes for that shape depends on the utility,
 * not on csszyx. Both engines used to answer from hand-kept prefix lists
 * (`NEGATIVE_ALLOWED`, `CSS_WIDE_BRACKET_PREFIXES`) that already disagreed
 * with Tailwind: `tracking` and `mask` were listed as taking a sign Tailwind
 * does not serve on a number, and about fifty prefixes whose bracket sets
 * their own property (`cursor-[inherit]`) were missing. This script asks
 * Tailwind instead, one probe per prefix and column, and writes one row per
 * sz key.
 *
 * The table is a spelling convention for what both lanes write, measured on
 * the pinned Tailwind and gated across the Tailwind v4 versions csszyx serves
 * (`scripts/check-tailwind-versions.mjs`). It is never the verdict on a
 * project's class: that comes from the project's own Tailwind at build
 * (PROJECT-RULES §4, ADR 0012/0023/0026).
 *
 * Tailwind answers per prefix, and 29 prefixes are shared by several keys
 * (`object` is both `objectFit` and `objectPos`), so a column Tailwind serves
 * on a shared prefix is given to the keys {@link SHARED_PREFIX_COLUMNS} names.
 * Against the pin, a shared prefix gaining a column, or the table naming one
 * Tailwind stopped serving, fails the run: that is a decision for a person,
 * not a default. Against another Tailwind (`--tailwind-from`) the same
 * findings are reported, not fatal: 4.0 has no `text-shadow` for the table
 * to name, and that is a difference between versions, not a stale table.
 *
 * What a class sets is read by the repository's one CSS analyzer
 * (`candidateDeclarationsFromCss` beside `mergeSignatureFromCss`, ADR 0026 §5),
 * not by a reader of its own.
 *
 * The output is `packages/compiler/src/sz-capabilities.generated.ts`, which the
 * runtime lowering imports and `pnpm gen:rust-tables` renders for the engine.
 *
 * Usage:
 *   node --import tsx/esm scripts/gen-sz-capabilities.mjs           # write
 *   node --import tsx/esm scripts/gen-sz-capabilities.mjs --check   # CI gate
 *   node --import tsx/esm scripts/gen-sz-capabilities.mjs --tailwind-from <dir>
 *       # measure the Tailwind installed under <dir>, report how it differs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { candidateDeclarationsFromCss } from '../packages/unplugin/src/merge-signature.js';

/** Format of the generated table. Bump it when the row encoding changes. */
export const SZ_CAPABILITY_FORMAT = 1;

/**
 * Every column, in letter order, with the probe that decides it.
 *
 * `signNumber` and `signFraction` are separate on purpose: Tailwind serves
 * `-X-2` on 58 prefixes and `-X-1/2` on 14 of them, so one "takes a sign"
 * column would bless `-translate-x-1/2` and `-m-1/2` alike.
 *
 * @type {ReadonlyArray<readonly [name: string, letter: string, doc: string]>}
 */
export const COLUMNS = [
    ['signNumber', 'n', 'a sign on a number (`-mt-2`)'],
    ['signFraction', 'f', 'a sign on a fraction (`-translate-x-1/2`)'],
    ['cssWideBracket', 'w', 'a CSS-wide keyword in brackets (`cursor-[inherit]`)'],
];

/**
 * The keys a column Tailwind serves on a shared prefix belongs to.
 *
 * Tailwind cannot tell `objectFit` from `objectPos`: both lower onto `object`,
 * and `object-[inherit]` sets `object-position`. Each entry names the keys whose
 * property the probe's class sets. Only shared prefixes where Tailwind serves a
 * column appear; {@link attributeColumns} fails on a missing or a stale entry.
 *
 * @type {Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>}
 */
export const SHARED_PREFIX_COLUMNS = {
    // `insetS` / `insetE` lower onto `start` / `end`, the spelling every v4
    // serves (`inset-s-*` arrived in 4.2): one property, two keys.
    start: {
        signNumber: ['start', 'insetS'],
        signFraction: ['start', 'insetS'],
        cssWideBracket: ['start', 'insetS'],
    },
    end: {
        signNumber: ['end', 'insetE'],
        signFraction: ['end', 'insetE'],
        cssWideBracket: ['end', 'insetE'],
    },
    // The bracket sets `border-color`; the style key lowers on its own path.
    divide: { cssWideBracket: ['divideColor'] },
    // `object-[inherit]` sets `object-position`, not `object-fit`.
    object: { cssWideBracket: ['objectPos'] },
    // `list-[inherit]` sets `list-style-type`, not the position.
    list: { cssWideBracket: ['list'] },
    // `flex-[inherit]` sets the `flex` shorthand, not direction or wrap.
    flex: { cssWideBracket: ['flex'] },
    // `text-shadow-[inherit]` sets the shadow; the colour has `text-shadow-inherit`.
    'text-shadow': { cssWideBracket: ['textShadow'] },
    // `transform-[inherit]` sets `transform`, not `transform-style`.
    transform: { cssWideBracket: ['transform'] },
    // `transition-[inherit]` sets `transition-property`, not the behaviour.
    transition: { cssWideBracket: ['transition'] },
};

/**
 * Values tried in turn for the class a prefix writes with an ordinary value,
 * whose properties the bracketed keyword must set and nothing more.
 */
export const OWN_VALUE_SAMPLES = ['4', '[4px]', '[1]', '2', '1', '[2]', '[10%]', '[auto]'];

/**
 * Per column, the class that decides it on a prefix, and the plain classes of
 * the same utility without the shape (any one served means the utility has
 * that value at all). The generator asks the first; the multi-version gate
 * asks both, to tell a spelling a version does not serve from a utility the
 * version does not have.
 *
 * @type {Readonly<Record<string, { probe: (prefix: string) => string, plain: (prefix: string) => string[] }>>}
 */
export const COLUMN_PROBES = {
    signNumber: { probe: prefix => `-${prefix}-2`, plain: prefix => [`${prefix}-2`] },
    signFraction: { probe: prefix => `-${prefix}-1/2`, plain: prefix => [`${prefix}-1/2`] },
    cssWideBracket: {
        probe: prefix => `${prefix}-[inherit]`,
        plain: prefix => OWN_VALUE_SAMPLES.map(sample => `${prefix}-${sample}`),
    },
};

/**
 * The declarations a class sets, custom properties left out, read by the one
 * CSS analyzer: only rules that select the class count, and `@property` and
 * keyframes declarations do not.
 *
 * @param candidate - The class Tailwind generated the CSS for.
 * @param css - The CSS Tailwind generated for it, or `''`.
 * @returns Property (with its selector context) to value, in source order.
 */
export function declarationsOf(candidate, css) {
    const found = new Map();
    for (const { context, property, value } of candidateDeclarationsFromCss(candidate, css) ?? []) {
        if (!property.startsWith('--')) found.set(`${property} ${context}`, value);
    }
    return found;
}

/**
 * Whether a bracketed CSS-wide keyword sets the prefix's own properties to it.
 *
 * Tailwind serves `X-[inherit]` on most prefixes, but serving is not enough:
 * `blur-[inherit]` writes `blur(inherit)`, `translate-x-[inherit]` sets a
 * variable the `translate` property reads, and `space-x-[inherit]` writes
 * `calc(inherit * …)` — all invalid or inert. The keyword holds only when the
 * class sets the same properties as the prefix's ordinary value, and every
 * property whose value changed now reads exactly the keyword.
 *
 * @param {Map<string, string>} bracketed - Declarations of `X-[inherit]`.
 * @param {Map<string, string> | null} own - Declarations of an ordinary value.
 * @returns {boolean} True when the bracket sets the key's property to the keyword.
 */
export function bracketSetsOwnProperty(bracketed, own) {
    if (!own || bracketed.size === 0 || bracketed.size !== own.size) return false;
    const changed = [...bracketed].filter(([property, value]) => {
        return !own.has(property) || own.get(property) !== value;
    });
    return (
        changed.length > 0 &&
        changed.every(([property, value]) => own.has(property) && value === 'inherit')
    );
}

/**
 * Give each column Tailwind serves on a prefix to the keys that own it.
 *
 * Two kinds of finding stop the table. A fault in the table itself — a shared
 * prefix that is not shared, a key not on its prefix — always throws. A
 * finding about what this Tailwind serves — an attribution naming a column it
 * does not serve, a shared prefix serving a column nobody attributed — throws
 * too unless `tolerate` is given: then the column is left out of the row and
 * the finding is handed to `tolerate`, which is how an older Tailwind is
 * compared with the pinned table instead of refused.
 *
 * @param {Readonly<Record<string, string>>} propertyMap - sz key to prefix.
 * @param {(prefix: string) => ReadonlySet<string>} servedOn - Columns Tailwind serves.
 * @param {typeof SHARED_PREFIX_COLUMNS} shared - Hand attribution for shared prefixes.
 * @param {{ tolerate?: (finding: string) => void }} [options] - How to treat a
 *        finding about this Tailwind; absent, it fails the run.
 * @returns {Map<string, string>} sz key to its column letters, in key order.
 */
export function attributeColumns(propertyMap, servedOn, shared, options = {}) {
    const keysOf = new Map();
    for (const [key, prefix] of Object.entries(propertyMap)) {
        keysOf.set(prefix, [...(keysOf.get(prefix) ?? []), key]);
    }
    const owned = new Map(Object.keys(propertyMap).map(key => [key, new Set()]));
    const problems = [];
    const findings = [];
    for (const [prefix, keys] of keysOf) {
        const served = servedOn(prefix);
        const attribution = shared[prefix] ?? {};
        for (const [column] of COLUMNS) {
            const named = attribution[column];
            if (!served.has(column)) {
                if (named)
                    findings.push(`${prefix}: names ${column}, which Tailwind does not serve`);
                continue;
            }
            if (keys.length === 1) {
                owned.get(keys[0]).add(column);
                continue;
            }
            if (!named) {
                findings.push(
                    `${prefix}: serves ${column}; name its keys among ${keys.join(', ')}`,
                );
                continue;
            }
            for (const key of named) {
                if (keys.includes(key)) owned.get(key).add(column);
                else problems.push(`${prefix}: ${key} is not a key on this prefix`);
            }
        }
    }
    for (const prefix of Object.keys(shared)) {
        if ((keysOf.get(prefix)?.length ?? 0) < 2) {
            problems.push(`${prefix}: listed as shared, but fewer than two keys use it`);
        }
    }
    if (options.tolerate) for (const finding of findings) options.tolerate(finding);
    else problems.push(...findings);
    if (problems.length > 0) throw new Error(problems.join('\n'));
    return new Map(
        [...owned].map(([key, columns]) => [
            key,
            COLUMNS.filter(([name]) => columns.has(name))
                .map(([, letter]) => letter)
                .join(''),
        ]),
    );
}

/**
 * Ask one design system which columns each prefix serves.
 *
 * @param {(classes: string[]) => Array<string | null>} cssFor - Tailwind's answer per class.
 * @returns {(prefix: string) => Set<string>} The served columns of a prefix.
 */
export function tailwindColumns(cssFor) {
    const css = className => cssFor([className])[0] ?? '';
    return prefix => {
        const served = new Set();
        if (css(COLUMN_PROBES.signNumber.probe(prefix))) served.add('signNumber');
        if (css(COLUMN_PROBES.signFraction.probe(prefix))) served.add('signFraction');
        const declarations = className => declarationsOf(className, css(className));
        const own =
            COLUMN_PROBES.cssWideBracket
                .plain(prefix)
                .map(declarations)
                .find(found => found.size > 0) ?? null;
        if (bracketSetsOwnProperty(declarations(COLUMN_PROBES.cssWideBracket.probe(prefix)), own)) {
            served.add('cssWideBracket');
        }
        return served;
    };
}

/**
 * Render the TypeScript module.
 *
 * @param {Map<string, string>} rows - sz key to column letters.
 * @param {string} tailwindVersion - The Tailwind that answered.
 * @returns {string} TypeScript source.
 */
export function renderTypeScript(rows, tailwindVersion) {
    const letters = COLUMNS.map(
        ([name, letter, doc]) =>
            `/** Column \`${letter}\`: Tailwind serves ${doc}. */\nexport const SZ_CAP_${constantName(name)} = '${letter}';`,
    ).join('\n');
    const body = [...rows]
        .filter(([, columns]) => columns !== '')
        .map(([key, columns]) => `    ${propertyName(key)}: '${columns}',`)
        .join('\n');
    // Every key is decided; the ones with no column are named in a comment
    // rather than as empty rows, which would ship ~400 gzip bytes to the
    // browser for nothing.
    const none = wrapWords(
        [...rows].filter(([, columns]) => columns === '').map(([key]) => key),
        '    // ',
    );
    return `// @generated by scripts/gen-sz-capabilities.mjs from tailwindcss ${tailwindVersion}, the
// Tailwind this repo pins: a convention table (spelling only), gated across Tailwind v4
// versions in CI (scripts/check-tailwind-versions.mjs) —
// not a verdict about a project's Tailwind (PROJECT-RULES §4).
// Do not edit by hand. Run \`pnpm gen:sz-capabilities\` after a Tailwind bump.

/** Format of {@link SZ_CAPABILITIES}; \`pnpm gen:rust-tables\` refuses another. */
export const SZ_CAPABILITY_FORMAT = ${SZ_CAPABILITY_FORMAT};

${letters}

/**
 * How both lanes spell each sz key of \`PROPERTY_MAP\`: the letters of the
 * columns above, as the pinned Tailwind serves them. Whether a class a project
 * writes is served is answered by the project's own Tailwind at build, never
 * by this table.
 */
export const SZ_CAPABILITIES: Readonly<Record<string, string>> = {
${body}
    // No column:
${none}
};
`;
}

/**
 * Words joined into comment lines of at most 100 columns.
 *
 * @param {string[]} words - The words.
 * @param {string} lead - What starts each line.
 * @returns {string} The lines.
 */
function wrapWords(words, lead) {
    const lines = [];
    let line = lead;
    for (const word of words) {
        if (line !== lead && line.length + word.length + 2 > 100) {
            lines.push(line.trimEnd());
            line = lead;
        }
        line += `${word}, `;
    }
    lines.push(line.replace(/, $/, '.'));
    return lines.join('\n');
}

/**
 * `signNumber` → `SIGN_NUMBER`.
 *
 * @param {string} name - Column name.
 * @returns {string} Its constant suffix.
 */
export function constantName(name) {
    return name.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase();
}

/**
 * A key as an object-literal property name, quoted only when it must be.
 *
 * @param {string} key - The sz key.
 * @returns {string} The property name.
 */
function propertyName(key) {
    return /^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`;
}

/**
 * Measure the capability rows of the Tailwind a directory resolves.
 *
 * @param {object} options - What to measure.
 * @param {string} options.resolveFrom - Directory whose `node_modules` holds `tailwindcss`.
 * @param {Readonly<Record<string, string>>} options.propertyMap - sz key to prefix.
 * @param {(finding: string) => void} [options.tolerate] - Report, rather than fail on,
 *        what this Tailwind serves differently (see {@link attributeColumns}).
 * @returns {Promise<{ version: string, rows: Map<string, string>, oracle: Extract<import('@csszyx/tailwind-oracle').EmittedClassOracle, { ok: true }> }>}
 *          The Tailwind version, its rows, and the oracle that answered, for
 *          further questions of the same design system.
 */
export async function measureCapabilities({ resolveFrom, propertyMap, tolerate }) {
    const { createEmittedClassOracle } = await import('@csszyx/tailwind-oracle');
    const oracle = await createEmittedClassOracle({
        resolveFrom,
        css: '@import "tailwindcss";',
        cssBase: resolveFrom,
    });
    if (!oracle.ok) throw new Error(`no Tailwind design system to ask: ${oracle.reason}`);
    const manifest = createRequire(path.join(resolveFrom, 'package.json')).resolve(
        'tailwindcss/package.json',
    );
    const { version } = JSON.parse(readFileSync(manifest, 'utf8'));
    const rows = attributeColumns(
        propertyMap,
        tailwindColumns(oracle.cssFor),
        SHARED_PREFIX_COLUMNS,
        tolerate ? { tolerate } : {},
    );
    return { version, rows, oracle };
}

/**
 * Where two capability tables disagree, one line per key.
 *
 * @param {ReadonlyMap<string, string>} rows - The measured rows.
 * @param {Readonly<Record<string, string>>} pinned - The checked-in table (a key
 *        with no column has no entry).
 * @returns {string[]} `key: pinned 'nw', measured 'w'` lines, in key order.
 */
export function rowDifferences(rows, pinned) {
    return [...rows]
        .filter(([key, columns]) => (pinned[key] ?? '') !== columns)
        .map(([key, columns]) => `${key}: pinned '${pinned[key] ?? ''}', measured '${columns}'`);
}

/** Run the generator: write the table, check it, or compare another Tailwind. */
async function main() {
    const repoRoot = path.resolve(import.meta.dirname, '..');
    const outPath = path.join(repoRoot, 'packages/compiler/src/sz-capabilities.generated.ts');
    const { PROPERTY_MAP } = await import('../packages/compiler/src/transform-core.js');
    const fromIndex = process.argv.indexOf('--tailwind-from');
    if (fromIndex !== -1) {
        const resolveFrom = path.resolve(
            process.argv[fromIndex + 1] ?? fail('--tailwind-from needs a directory'),
        );
        const findings = [];
        const { version, rows } = await measureCapabilities({
            resolveFrom,
            propertyMap: PROPERTY_MAP,
            tolerate: finding => findings.push(finding),
        });
        const { SZ_CAPABILITIES } = await import(
            '../packages/compiler/src/sz-capabilities.generated.js'
        );
        const differences = rowDifferences(rows, SZ_CAPABILITIES);
        console.log(`[gen-sz-capabilities] tailwindcss ${version} from ${resolveFrom}`);
        for (const line of [...findings, ...differences]) console.log(`  ${line}`);
        if (findings.length + differences.length === 0) console.log('  same table as the pin');
        return;
    }
    let measured;
    try {
        measured = await measureCapabilities({ resolveFrom: repoRoot, propertyMap: PROPERTY_MAP });
    } catch (error) {
        fail(error.message);
    }
    const generated = renderTypeScript(measured.rows, measured.version);
    if (process.argv.includes('--check')) {
        if (readFileSync(outPath, 'utf8') !== generated) {
            fail(`${path.relative(repoRoot, outPath)} is stale. Run pnpm gen:sz-capabilities.`);
        }
        return;
    }
    writeFileSync(outPath, generated);
    console.log(`[gen-sz-capabilities] Wrote ${path.relative(repoRoot, outPath)}`);
}

/**
 * Print a failure and exit.
 *
 * @param {string} message - What went wrong.
 */
function fail(message) {
    console.error(`[gen-sz-capabilities] ${message}`);
    process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
