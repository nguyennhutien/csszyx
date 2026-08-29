#!/usr/bin/env node

// Render migrate's own tables — the keyword sets, boolean class maps and
// variant map in packages/compiler/src/migrate-tables/reverse-map.ts — as Rust, so the
// Rust side of migrate reads the same knowledge without a hand copy.
//
// The TypeScript module stays the source of truth until the port is complete:
// it is evaluated here rather than parsed, so a spread, a sort or a derived
// table renders as what the module actually exports. Every export is rendered
// or refused, so a new table cannot be added on one side only.
//
// Usage:
//   node --import tsx/esm scripts/gen-rust-migrate-tables.mjs           # write
//   node --import tsx/esm scripts/gen-rust-migrate-tables.mjs --check   # CI: fail if stale

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import * as reverseMap from '../packages/compiler/src/migrate-tables/reverse-map.ts';
import { formatRust, rustString } from './render-rust.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const outPath = path.join(repoRoot, 'packages/core/src/transform/generated/migrate_tables.rs');
const check = process.argv.includes('--check');

/** Exports rendered elsewhere, or logic rather than data. */
const NOT_TABLES = new Set([
    // Generated from PROPERTY_MAP by generate-reverse-property-map.mjs.
    'REVERSE_PROPERTY_MAP',
    // Logic: ported by hand, pinned by the class corpus.
    'isColorValue',
]);

/** The lookup function each record table renders to. */
const RECORD_LOOKUPS = {
    REVERSE_BOOLEAN_MAP: 'reverse_boolean',
    REVERSE_VARIANT_MAP: 'reverse_variant',
};

const generated = formatRust(render(classify(reverseMap)), 'gen-rust-migrate-tables');
const relative = path.relative(repoRoot, outPath);

if (check) {
    let current = '';
    try {
        current = readFileSync(outPath, 'utf8');
    } catch {
        fail(`${relative} is missing. Run pnpm gen:migrate-tables.`);
    }
    if (current !== generated) {
        fail(`${relative} is stale. Run pnpm gen:migrate-tables.`);
    }
    console.log('[gen-rust-migrate-tables] up to date.');
    process.exit(0);
}

writeFileSync(outPath, generated);
console.log(`[gen-rust-migrate-tables] Wrote ${relative}`);

/**
 * Sort the module's exports into the shapes the renderer knows.
 *
 * @param {Record<string, unknown>} module - The evaluated reverse-map module.
 * @returns {{ sets: [string, string[]][], records: [string, string, [string, string][]][],
 *   booleanValues: [string, { prop: string, value: string, cssProperty?: string }][],
 *   sortedPrefixes: string[] }} The tables to render.
 */
function classify(module) {
    const sets = [];
    const records = [];
    let booleanValues;
    let sortedPrefixes;

    for (const [name, value] of Object.entries(module)) {
        if (NOT_TABLES.has(name)) continue;
        if (value instanceof Set) {
            const members = [...value];
            assertStrings(name, members);
            sets.push([name, members]);
            continue;
        }
        if (name === 'SORTED_PREFIXES') {
            assertStrings(name, value);
            sortedPrefixes = value;
            continue;
        }
        if (name === 'BOOLEAN_VALUE_MAP') {
            booleanValues = Object.entries(value);
            for (const [className, entry] of booleanValues) {
                assertStrings(`${name}.${className}`, [entry.prop, entry.value]);
                if (entry.cssProperty !== undefined) {
                    assertStrings(`${name}.${className}.cssProperty`, [entry.cssProperty]);
                }
            }
            continue;
        }
        const lookup = RECORD_LOOKUPS[name];
        if (lookup !== undefined) {
            const entries = Object.entries(value);
            assertStrings(name, entries.flat());
            records.push([name, lookup, entries]);
            continue;
        }
        fail(
            `reverse-map.ts exports ${name}, which this generator does not know how to render. ` +
                'Add it to RECORD_LOOKUPS, or to NOT_TABLES with the reason it is not data.',
        );
    }

    if (booleanValues === undefined || sortedPrefixes === undefined) {
        fail('reverse-map.ts no longer exports BOOLEAN_VALUE_MAP or SORTED_PREFIXES.');
    }
    return { sets, records, booleanValues, sortedPrefixes };
}

/**
 * Refuse a table member a Rust `&str` cannot hold.
 *
 * @param {string} name - The table, for the error message.
 * @param {unknown[]} values - The members.
 */
function assertStrings(name, values) {
    for (const value of values) {
        if (typeof value !== 'string') {
            fail(`${name} holds ${JSON.stringify(value)}, which is not a string.`);
        }
    }
}

/**
 * Render the Rust module.
 *
 * @param {ReturnType<typeof classify>} tables - The tables to render.
 * @returns {string} Unformatted Rust source.
 */
function render({ sets, records, booleanValues, sortedPrefixes }) {
    const setBlocks = sets.map(([name, members]) => {
        const predicate = snake(name);
        return `/// \`${name}\` from reverse-map.ts, in source order.
pub(crate) const ${name}: &[&str] = &[
${members.map(member => `    ${rustString(member)},`).join('\n')}
];

/// Whether \`value\` is in \`${name}\`.
pub(crate) fn ${predicate}(value: &str) -> bool {
    matches!(
        value,
${members.map((member, index) => `${index === 0 ? '        ' : '        | '}${rustString(member)}`).join('\n')}
    )
}`;
    });

    const setIndex = sets.map(([name]) => `    (${rustString(name)}, ${name}, ${snake(name)}),`);

    const recordBlocks = records.map(([name, lookup, entries]) => {
        return `/// \`${name}\` from reverse-map.ts, in source order.
pub(crate) const ${name}: &[(&str, &str)] = &[
${entries.map(([key, value]) => `    (${rustString(key)}, ${rustString(value)}),`).join('\n')}
];

/// Look a key up in \`${name}\`.
pub(crate) fn ${lookup}(key: &str) -> Option<&'static str> {
    match key {
${entries.map(([key, value]) => `        ${rustString(key)} => Some(${rustString(value)}),`).join('\n')}
        _ => None,
    }
}`;
    });

    const booleanValueLiteral = ({ prop, value, cssProperty }) => {
        const css = cssProperty === undefined ? 'None' : `Some(${rustString(cssProperty)})`;
        return `BooleanValue { prop: ${rustString(prop)}, value: ${rustString(value)}, css_property: ${css} }`;
    };

    return `// @generated by scripts/gen-rust-migrate-tables.mjs
// Do not edit by hand. Edit packages/compiler/src/migrate-tables/reverse-map.ts and run
// \`pnpm gen:migrate-tables\`.
//
// migrate's own knowledge of which Tailwind value belongs to which sz key:
// the keyword sets that tell a shared prefix's meanings apart, the classes
// that are a fixed prop and value, and the variant spellings that differ
// between Tailwind and sz. The TypeScript module is evaluated and rendered,
// so these are what migrate actually uses, not a copy of its source.
#![allow(dead_code, clippy::match_same_arms, clippy::too_many_lines)]
#![allow(clippy::redundant_pub_crate)]

/// A class that migrates to one fixed sz prop and value.
///
/// \`css_property\` names the single CSS property a utility sets, so the
/// variant parser can refuse two classes that fight over it; additive
/// utilities leave it unset because they combine rather than conflict.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct BooleanValue {
    pub(crate) prop: &'static str,
    pub(crate) value: &'static str,
    pub(crate) css_property: Option<&'static str>,
}

${setBlocks.join('\n\n')}

/// One keyword set: its TypeScript name, its members, and its predicate.
pub(crate) type MigrateSet = (&'static str, &'static [&'static str], fn(&str) -> bool);

/// Every set above by name, with its members and its predicate.
pub(crate) const MIGRATE_SETS: &[MigrateSet] = &[
${setIndex.join('\n')}
];

${recordBlocks.join('\n\n')}

/// \`BOOLEAN_VALUE_MAP\` from reverse-map.ts, in source order.
pub(crate) const BOOLEAN_VALUE_MAP: &[(&str, BooleanValue)] = &[
${booleanValues.map(([key, entry]) => `    (${rustString(key)}, ${booleanValueLiteral(entry)}),`).join('\n')}
];

/// The fixed prop and value a class migrates to, if it is one of those.
pub(crate) fn boolean_value(class: &str) -> Option<BooleanValue> {
    match class {
${booleanValues.map(([key, entry]) => `        ${rustString(key)} => Some(${booleanValueLiteral(entry)}),`).join('\n')}
        _ => None,
    }
}

/// Every reverse-map prefix, longest first, so a longest-prefix match can
/// take the first hit.
pub(crate) const SORTED_PREFIXES: &[&str] = &[
${sortedPrefixes.map(prefix => `    ${rustString(prefix)},`).join('\n')}
];
`;
}

/**
 * A SCREAMING_SNAKE table name as a Rust function name.
 *
 * @param {string} name - The TypeScript export name.
 * @returns {string} The lowercase form.
 */
function snake(name) {
    return name.toLowerCase();
}

/**
 * Report a generator failure and stop.
 *
 * @param {string} message - What went wrong.
 */
function fail(message) {
    console.error(`[gen-rust-migrate-tables] ${message}`);
    process.exit(1);
}
