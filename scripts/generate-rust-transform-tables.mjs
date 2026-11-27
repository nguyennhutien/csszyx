#!/usr/bin/env node

// Generate Rust transform lookup tables from the TypeScript compiler source.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { readTableSource } from './extract-ts-tables.mjs';
import { formatRust, rustString } from './render-rust.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const outPath = path.join(repoRoot, 'packages/core/src/transform/generated/tables.rs');

const check = process.argv.includes('--check');

/**
 * The capability-table format this reader understands. The writer
 * (`gen-sz-capabilities.mjs`) stamps its own; another number is refused rather
 * than read as rows of a shape this reader does not know.
 */
const SZ_CAPABILITY_READ_FORMAT = 1;

/** The bit each numeric-key table owns in \`numeric_key_bits\`. */
const NUMERIC_KEY_BITS = {
    decimalBracketKeys: 1,
    numberBracketKeys: 2,
    factorStringKeys: 4,
    clampedFactorKeys: 8,
    numericTextKeys: 16,
};

/**
 * The column constants of the capability table, in bit order. A row letter no
 * constant names fails the run, so a new column is rendered on purpose.
 */
const CAPABILITY_COLUMNS = [
    'SZ_CAP_SIGN_NUMBER',
    'SZ_CAP_SIGN_FRACTION',
    'SZ_CAP_CSS_WIDE_BRACKET',
];

const tables = readTables();

const generated = formatRust(renderRust(tables), 'generate-rust-transform-tables');

if (check) {
    const current = readFileSync(outPath, 'utf8');
    if (current !== generated) {
        console.error(
            '[generate-rust-transform-tables] generated tables are stale. Run pnpm gen:rust-tables.',
        );
        process.exit(1);
    }
    process.exit(0);
}

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, generated);
console.log(`[generate-rust-transform-tables] Wrote ${path.relative(repoRoot, outPath)}`);

/**
 * Read every table this generator renders out of the compiler package.
 *
 * @returns The extracted tables, keyed by the name `renderRust` expects.
 */
function readTables() {
    try {
        const core = readTableSource(
            path.join(repoRoot, 'packages/compiler/src/transform-core.ts'),
        );
        const keyTables = readTableSource(
            path.join(repoRoot, 'packages/compiler/src/sz-key-tables.ts'),
        );
        const units = readTableSource(path.join(repoRoot, 'packages/compiler/src/css-units.ts'));
        const keywords = readTableSource(
            path.join(repoRoot, 'packages/compiler/src/shadow-size-keywords.ts'),
        );
        const closedEnums = readTableSource(
            path.join(repoRoot, 'packages/compiler/src/closed-enum-tables.ts'),
        );
        const families = readTableSource(
            path.join(repoRoot, 'packages/compiler/src/keyword-families.ts'),
        );
        const varHostile = readTableSource(
            path.join(repoRoot, 'packages/compiler/src/var-hostile-keys.ts'),
        );
        const capabilities = readTableSource(
            path.join(repoRoot, 'packages/compiler/src/sz-capabilities.generated.ts'),
        );
        const propertyTypes = readTableSource(
            path.join(repoRoot, 'packages/compiler/src/property-types.ts'),
        );

        return {
            propertyMap: keyTables.stringObject('PROPERTY_MAP'),
            variantMap: core.stringObject('VARIANT_MAP'),
            booleanToClass: core.stringObject('BOOLEAN_TO_CLASS'),
            booleanShorthands: keyTables.stringSet('BOOLEAN_SHORTHANDS'),
            flagOnlyKeys: keyTables.stringSet('FLAG_ONLY_KEYS'),
            decimalBracketKeys: keyTables.stringSet('DECIMAL_BRACKET_KEYS'),
            numericTextKeys: keyTables.stringSet('NUMERIC_TEXT_KEYS'),
            numberBracketKeys: keyTables.stringSet('NUMBER_BRACKET_KEYS'),
            factorStringKeys: keyTables.stringSet('FACTOR_STRING_KEYS'),
            clampedFactorKeys: keyTables.stringSet('CLAMPED_FACTOR_KEYS'),
            booleanOnlyDynamicKeys: core.objectKeys('BOOLEAN_ONLY_DYNAMIC_VOCABULARY'),
            knownSpecialProperties: keyTables.stringSet('KNOWN_SPECIAL_PROPERTIES'),
            cssWideKeywords: keywords.stringSet('CSS_WIDE_KEYWORDS'),
            gridTrackKeywords: core.stringSet('GRID_TRACK_KEYWORDS'),
            gridLineNameKeys: core.stringSet('GRID_LINE_NAME_KEYS'),
            cssWideKeywordUtilities: core.stringSet('CSS_WIDE_KEYWORD_UTILITIES'),
            fractionSupportedProps: core.stringSet('FRACTION_SUPPORTED_PROPS'),
            listStyleKeywords: core.stringSet('LIST_STYLE_STANDARD'),
            colorProperties: propertyTypes.objectKeysWhere(
                'PROPERTY_CATEGORY_MAP',
                'PropertyCategory.COLOR',
            ),
            ...readCapabilities(capabilities),
            removedBooleanSugar: core.objectKeys('REMOVED_BOOLEAN_SUGAR'),
            removedBooleanSugarReplacement: core.objectOfStringObjects('REMOVED_BOOLEAN_SUGAR'),
            replacedKeys: core.stringSet('REPLACED_KEYS'),
            knownVariants: keyTables.stringSet('KNOWN_VARIANTS'),
            ariaStates: core.stringSet('ARIA_STATES'),
            specialVariants: core.stringSet('SPECIAL_VARIANTS'),
            suggestionMap: keyTables.stringObject('SUGGESTION_MAP'),
            splitShorthandKeys: keyTables.stringObject('SPLIT_SHORTHAND_KEYS'),
            cssVarTypeHints: core.stringObject('CSS_VAR_TYPE_HINTS'),
            alignmentKeys: core.stringSet('ALIGNMENT_KEYS'),
            arbitraryLengthUnits: units.stringSet('ARBITRARY_LENGTH_UNITS'),
            alignmentCssValueHints: core.stringObject('ALIGNMENT_CSS_VALUE_HINT'),
            migrationNotes: keyTables.stringObject('MIGRATION_NOTES'),
            closedEnumClasses: closedEnums.objectOfStringObjects('CLOSED_ENUM_CLASSES'),
            closedEnumAffixes: closedEnums.objectOfStringObjects('CLOSED_ENUM_AFFIXES'),
            closedEnumValueMoves: closedEnums.objectOfStringObjects('CLOSED_ENUM_VALUE_MOVES'),
            globalKeywordGroups: families.objectOfStringObjects('GLOBAL_KEYWORD_GROUPS'),
            varHostileWrongProperty: varHostile.stringSet('VAR_HOSTILE_WRONG_PROPERTY'),
            varHostileNoVarForm: varHostile.stringSet('VAR_HOSTILE_NO_VAR_FORM'),
        };
    } catch (error) {
        fail(error.message);
    }
}

/**
 * Read the capability table: its column letters as bits, and each row.
 *
 * @param capabilities - Extractors over `sz-capabilities.generated.ts`.
 * @returns The columns and the rows, rows with no column left out.
 */
function readCapabilities(capabilities) {
    const format = capabilities.literal('SZ_CAPABILITY_FORMAT');
    if (format !== SZ_CAPABILITY_READ_FORMAT) {
        throw new Error(
            `sz-capabilities.generated.ts has format ${format}; this reader knows ` +
                `${SZ_CAPABILITY_READ_FORMAT}. Update generate-rust-transform-tables.mjs.`,
        );
    }
    const capabilityColumns = CAPABILITY_COLUMNS.map((name, index) => ({
        name,
        letter: capabilities.literal(name),
        bit: 1 << index,
    }));
    const bitOf = new Map(capabilityColumns.map(({ letter, bit }) => [letter, bit]));
    const capabilityRows = capabilities
        .stringObject('SZ_CAPABILITIES')
        .map(([key, letters]) => [
            key,
            [...letters].reduce((bits, letter) => {
                const bit = bitOf.get(letter);
                if (bit === undefined)
                    throw new Error(`SZ_CAPABILITIES.${key} has column ${letter}`);
                return bits | bit;
            }, 0),
        ])
        .filter(([, bits]) => bits !== 0);
    return { capabilityColumns, capabilityRows };
}

function renderRust({
    propertyMap,
    variantMap,
    booleanToClass,
    booleanShorthands,
    flagOnlyKeys,
    decimalBracketKeys,
    numericTextKeys,
    numberBracketKeys,
    factorStringKeys,
    clampedFactorKeys,
    booleanOnlyDynamicKeys,
    knownSpecialProperties,
    cssWideKeywords,
    gridTrackKeywords,
    gridLineNameKeys,
    cssWideKeywordUtilities,
    fractionSupportedProps,
    listStyleKeywords,
    colorProperties,
    capabilityColumns,
    capabilityRows,
    removedBooleanSugar,
    removedBooleanSugarReplacement,
    replacedKeys,
    knownVariants,
    ariaStates,
    specialVariants,
    suggestionMap,
    splitShorthandKeys,
    cssVarTypeHints,
    alignmentKeys,
    arbitraryLengthUnits,
    alignmentCssValueHints,
    migrationNotes,
    closedEnumClasses,
    closedEnumAffixes,
    closedEnumValueMoves,
    globalKeywordGroups,
    varHostileWrongProperty,
    varHostileNoVarForm,
}) {
    return `// @generated by scripts/generate-rust-transform-tables.mjs
// Do not edit by hand.
#![allow(dead_code, clippy::match_same_arms, clippy::too_many_lines)]
#![allow(clippy::redundant_pub_crate)]

/// Lookup the Tailwind utility prefix for a csszyx property key.
pub(crate) fn property_prefix(key: &str) -> Option<&'static str> {
    match key {
${renderMatchArms(propertyMap)}
        _ => None,
    }
}

/// Lookup the emitted variant prefix for a csszyx variant key.
pub(crate) fn variant_prefix(key: &str) -> Option<&'static str> {
    match key {
${renderMatchArms(variantMap)}
        _ => None,
    }
}

/// Canonical-key suggestion for a removed/aliased sz key.
pub(crate) fn key_suggestion(key: &str) -> Option<&'static str> {
    match key {
${renderMatchArms(suggestionMap)}
        _ => None,
    }
}

/// The \`canonical-key\` form of a CSS shorthand csszyx writes as two keys,
/// which emits nothing as an alias does. Mirrors \`SPLIT_SHORTHAND_KEYS\`.
pub(crate) fn split_shorthand_form(key: &str) -> Option<&'static str> {
    match key {
${renderMatchArms(splitShorthandKeys)}
        _ => None,
    }
}

/// The data type a key's variable value is written with, in front of it
/// (\`bg-(position:--v)\`): Tailwind gives an untyped variable to the prefix's
/// default utility. Mirrors \`CSS_VAR_TYPE_HINTS\`.
pub(crate) fn css_var_type_hint(key: &str) -> Option<&'static str> {
    match key {
${renderMatchArms(cssVarTypeHints)}
        _ => None,
    }
}

/// The units a numeric value carries in brackets, never as a bare class.
/// Mirrors \`ARBITRARY_LENGTH_UNITS\`.
pub(crate) const ARBITRARY_LENGTH_UNITS: &[&str] = &[${arbitraryLengthUnits.map(rustString).join(', ')}];

/// Returns true when a key takes csszyx's short alignment values
/// (\`start\`, \`between\`), not the CSS longhand. Mirrors \`ALIGNMENT_KEYS\`.
pub(crate) fn is_alignment_key(key: &str) -> bool {
    matches!(
        key,
${renderMatchPatterns(alignmentKeys)}
    )
}

/// The short form of a CSS longhand alignment value, whose class on an
/// alignment key Tailwind has no utility for. Mirrors
/// \`ALIGNMENT_CSS_VALUE_HINT\`.
pub(crate) fn alignment_css_value_hint(value: &str) -> Option<&'static str> {
    match value {
${renderMatchArms(alignmentCssValueHints)}
        _ => None,
    }
}

/// Migration note for a removed sz key whose replacement needs a sentence.
pub(crate) fn key_migration_note(key: &str) -> Option<&'static str> {
    match key {
${renderMatchArms(migrationNotes)}
        _ => None,
    }
}

/// Lookup emitted classes for boolean shorthand keys with custom class names.
pub(crate) fn boolean_class(key: &str) -> Option<&'static str> {
    match key {
${renderMatchArms(booleanToClass)}
        _ => None,
    }
}

/// Returns true when a boolean true value maps directly to a class.
pub(crate) fn is_boolean_shorthand(key: &str) -> bool {
    matches!(
        key,
${renderMatchPatterns(booleanShorthands)}
    )
}

/// Returns true when a key takes only \`true\` or \`false\`: any other value
/// is reported (\`closed-enum-value\`, form \`flag\`) and its class is still
/// written.
pub(crate) fn is_flag_only(key: &str) -> bool {
    matches!(
        key,
${renderMatchPatterns(flagOnlyKeys)}
    )
}

/// Where a key sits among the numeric-key tables of \`sz-key-tables.ts\`
/// (ADR 0037), one bit per table: one string match for all five, where five
/// \`matches!\` cost the wasm artifact five chains of comparisons.
fn numeric_key_bits(key: &str) -> u8 {
    match key {
${renderNumericKeyBits({ decimalBracketKeys, numberBracketKeys, factorStringKeys, clampedFactorKeys, numericTextKeys })}
        _ => 0,
    }
}

/// Returns true when csszyx brackets a bare decimal on this key itself
/// (\`grow: 2.5\` → \`grow-[2.5]\`): the bare class has no rule, and the
/// bracket sets the property to the number written (ADR 0037).
pub(crate) fn brackets_bare_decimal(key: &str) -> bool {
    numeric_key_bits(key) & ${NUMERIC_KEY_BITS.decimalBracketKeys} != 0
}

/// Returns true when every number on this key brackets (\`aspect: 2\` →
/// \`aspect-[2]\`): the bare class is dead for any number (ADR 0037).
pub(crate) fn brackets_every_number(key: &str) -> bool {
    numeric_key_bits(key) & ${NUMERIC_KEY_BITS.numberBracketKeys} != 0
}

/// Returns true when a numeric string on this key is the CSS value itself
/// (\`opacity: '.5'\` → \`opacity-[0.5]\`) while a number keeps Tailwind's
/// scale (ADR 0037).
pub(crate) fn is_factor_string_key(key: &str) -> bool {
    numeric_key_bits(key) & ${NUMERIC_KEY_BITS.factorStringKeys} != 0
}

/// Returns true when this factor key's CSS function clamps at 1, so a string
/// above 1 is reported as \`clamped-factor\`.
pub(crate) fn clamps_factor_at_one(key: &str) -> bool {
    numeric_key_bits(key) & ${NUMERIC_KEY_BITS.clampedFactorKeys} != 0
}

/// Returns true when a key's string value is text, not a number, so a numeric
/// string keeps its string meaning (\`content: '4'\`).
pub(crate) fn keeps_numeric_string(key: &str) -> bool {
    numeric_key_bits(key) & ${NUMERIC_KEY_BITS.numericTextKeys} != 0
}

/// Returns true when a key's DYNAMIC value must lower to a conditional bare
/// class through __szBoolClass instead of the css-var strategy: React drops
/// booleans in \`style\`, and the valued utility targets a different CSS
/// property than the bare class.
pub(crate) fn is_boolean_only_dynamic(key: &str) -> bool {
    matches!(
        key,
${renderMatchPatterns(booleanOnlyDynamicKeys)}
    )
}

/// Returns true when a property is lowered by a dedicated object branch.
pub(crate) fn is_known_special_property(key: &str) -> bool {
    matches!(
        key,
${renderMatchPatterns(knownSpecialProperties)}
    )
}

/// Whether a \`_\`-separated segment of a grid template is a track keyword.
/// Mirrors \`GRID_TRACK_KEYWORDS\`.
pub(crate) fn is_grid_track_keyword(segment: &str) -> bool {
    matches!(
        segment,
${renderMatchPatterns(gridTrackKeywords)}
    )
}

/// Whether a key's CSS property takes grid line names in its value, the
/// aliases included. Mirrors \`GRID_LINE_NAME_KEYS\`.
pub(crate) fn takes_grid_line_names(key: &str) -> bool {
    matches!(
        key,
${renderMatchPatterns(gridLineNameKeys)}
    )
}

/// Whether a value is a CSS-wide keyword. Mirrors \`CSS_WIDE_KEYWORDS\`.
pub(crate) fn is_css_wide_keyword(value: &str) -> bool {
    matches!(
        value,
${renderMatchPatterns(cssWideKeywords)}
    )
}

/// Whether Tailwind serves \`<prefix>-<keyword>\` by name for a CSS-wide
/// keyword. Mirrors \`CSS_WIDE_KEYWORD_UTILITIES\`.
pub(crate) fn is_css_wide_keyword_utility(class: &str) -> bool {
    matches!(
        class,
${renderMatchPatterns(cssWideKeywordUtilities)}
    )
}

/// Properties that take a native Tailwind fraction (\`w-1/2\`, \`basis-1/3\`)
/// instead of brackets. Mirrors \`FRACTION_SUPPORTED_PROPS\`.
pub(crate) fn is_fraction_supported_prop(key: &str) -> bool {
    matches!(
        key,
${renderMatchPatterns(fractionSupportedProps)}
    )
}

/// List-style keywords Tailwind serves bare (\`list-disc\`); any other value
/// is bracketed. Mirrors \`LIST_STYLE_STANDARD\`.
pub(crate) fn is_list_style_keyword(value: &str) -> bool {
    matches!(
        value,
${renderMatchPatterns(listStyleKeywords)}
    )
}

/// Keys whose value is a colour alone (\`bg\`, \`color\`, \`fill\`). Mirrors the
/// \`PropertyCategory.COLOR\` entries of \`PROPERTY_CATEGORY_MAP\`.
pub(crate) fn is_color_property(key: &str) -> bool {
    matches!(
        key,
${renderMatchPatterns(colorProperties)}
    )
}

${capabilityColumns
    .map(
        ({ name, bit }) =>
            `/// A bit of [\`sz_capabilities\`]. Mirrors \`${name}\`.\npub(crate) const ${name}: u8 = ${bit};`,
    )
    .join('\n')}

/// The rows of \`SZ_CAPABILITIES\` that have a column, sorted by key bytes for
/// [\`sz_capabilities\`]'s binary search. A sorted slice costs the wasm
/// artifact ~400 gzip bytes less than a \`match\` over the same keys.
pub(crate) static SZ_CAPABILITY_ROWS: [(&str, u8); ${capabilityRows.length}] = [
${[...capabilityRows]
    .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map(([key, bits]) => `    (${rustString(key)}, ${bits}),`)
    .join('\n')}
];

/// How both lanes spell an sz key, as \`SZ_CAP_*\` bits. Mirrors
/// \`SZ_CAPABILITIES\`, which \`gen-sz-capabilities.mjs\` measured against the
/// Tailwind this repo pins: a spelling convention, not a verdict about a
/// project's Tailwind (PROJECT-RULES §4). A key with no column, or unknown, is \`0\`.
pub(crate) fn sz_capabilities(key: &str) -> u8 {
    SZ_CAPABILITY_ROWS
        .binary_search_by(|(row, _)| row.as_bytes().cmp(key.as_bytes()))
        .map_or(0, |index| SZ_CAPABILITY_ROWS[index].1)
}

/// Returns true when a key is a removed boolean-sugar alias (flex/absolute/
/// italic/...). A \`true\` value on such a key emits no class — the canonical
/// key with a value is the only spelling.
pub(crate) fn is_removed_boolean_sugar(key: &str) -> bool {
    matches!(
        key,
${renderMatchPatterns(removedBooleanSugar)}
    )
}

/// The canonical key and value that replace a removed boolean-sugar alias.
///
/// The pair, not a sentence: the build lane and the runtime lane word the
/// report differently, and baking one of their sentences into the table would
/// make the other read as a quotation of it.
pub(crate) fn removed_boolean_sugar_replacement(key: &str) -> Option<(&'static str, &'static str)> {
    match key {
${renderPairArms(removedBooleanSugarReplacement)}
        _ => None,
    }
}

/// Returns true when a key was canonical and got a new spelling, so its
/// removal message says it was replaced rather than that sugar was removed.
pub(crate) fn is_replaced_key(key: &str) -> bool {
    matches!(
        key,
${renderMatchPatterns(replacedKeys)}
    )
}

/// Returns true when a key is a known csszyx variant name.
pub(crate) fn is_known_variant(key: &str) -> bool {
    matches!(
        key,
${renderMatchPatterns(knownVariants)}
    )
}

/// Returns true when a key is a standard ARIA state.
pub(crate) fn is_aria_state(key: &str) -> bool {
    matches!(
        key,
${renderMatchPatterns(ariaStates)}
    )
}

/// Returns true when a key is a parametric/scope variant stem (group, peer,
/// has, not, data, aria, supports) that combines with dash/bracket syntax.
pub(crate) fn is_special_variant(key: &str) -> bool {
    matches!(
        key,
${renderMatchPatterns(specialVariants)}
    )
}

/// The utility a closed-enum key emits for one value, if the value is in its set.
///
/// These keys spell their value as the BARE Tailwind utility, so a value
/// outside the set used to ship as an unprefixed class name of exactly the
/// shape a project's own component CSS is made of. Returning \`None\` is what
/// lets the lowering drop it and the diagnostic name it.
pub(crate) fn closed_enum_class(key: &str, value: &str) -> Option<&'static str> {
    match (key, value) {
${renderClosedEnumArms(closedEnumClasses)}
        _ => None,
    }
}

/// Whether a key's value set is closed. Mirrors \`CLOSED_ENUM_CLASSES\`'s keys.
pub(crate) fn is_closed_enum_key(key: &str) -> bool {
    matches!(
        key,
${renderMatchPatterns(closedEnumClasses.map(([key]) => key))}
    )
}

/// The fixed part a closed-enum key wraps around a value outside its set, as
/// \`(prefix, suffix)\`. Keys absent here emit such a value verbatim.
pub(crate) fn closed_enum_affix(key: &str) -> Option<(&'static str, &'static str)> {
    match key {
${renderAffixArms(closedEnumAffixes)}
        _ => None,
    }
}

/// The key and value that replaced a value a closed key used to take, keyed by
/// the key and the old value. A value of \`true\` is the boolean flag.
pub(crate) fn closed_enum_value_move(key: &str, value: &str) -> Option<(&'static str, &'static str)> {
    match (key, value) {
${renderValueMoveArms(closedEnumValueMoves)}
        _ => None,
    }
}

/// The group keys a stand-alone keyword key resets, space-separated, when the
/// key holds one.
pub(crate) fn global_keyword_groups(key: &str) -> Option<&'static str> {
    match key {
${globalKeywordGroups.map(([key, fields]) => `        ${rustString(key)} => Some(${rustString(Object.fromEntries(fields).groups)}),`).join('\n')}
        _ => None,
    }
}

/// The stand-alone keyword key a group key belongs to.
pub(crate) fn global_keyword_for_group(key: &str) -> Option<&'static str> {
    match key {
${globalKeywordGroups
    .flatMap(([global, fields]) =>
        Object.fromEntries(fields)
            .groups.split(' ')
            .map(group => `        ${rustString(group)} => Some(${rustString(global)}),`),
    )
    .join('\n')}
        _ => None,
    }
}

/// The legal values of a closed-enum key, in table order, for the diagnostic.
pub(crate) fn closed_enum_values(key: &str) -> Option<&'static str> {
    match key {
${renderClosedEnumLists(closedEnumClasses)}
        _ => None,
    }
}

/// Returns true when a key's \`-(--var)\` form resolves to a DIFFERENT CSS
/// property than the literal form — Tailwind styles the element, just not the
/// way the author asked. See transform::var_hostile.
pub(crate) fn is_var_hostile_wrong_property(key: &str) -> bool {
    matches!(
        key,
${renderMatchPatterns(varHostileWrongProperty)}
    )
}

/// Returns true when a key's \`-(--var)\` form matches no Tailwind utility at
/// all — no rule is generated and the element is silently unstyled. See
/// transform::var_hostile.
pub(crate) fn is_var_hostile_no_var_form(key: &str) -> bool {
    matches!(
        key,
${renderMatchPatterns(varHostileNoVarForm)}
    )
}
`;
}

function renderClosedEnumArms(entries) {
    return entries
        .flatMap(([key, values]) =>
            values.map(
                ([value, className]) =>
                    `        (${rustString(key)}, ${rustString(value)}) => Some(${rustString(className)}),`,
            ),
        )
        .join('\n');
}

function renderClosedEnumLists(entries) {
    return entries
        .map(
            ([key, values]) =>
                `        ${rustString(key)} => Some(${rustString(values.map(([value]) => value).join(', '))}),`,
        )
        .join('\n');
}

function renderMatchArms(entries) {
    return entries
        .map(([key, value]) => `        ${rustString(key)} => Some(${rustString(value)}),`)
        .join('\n');
}

function renderValueMoveArms(entries) {
    return entries
        .map(([moved, fields]) => {
            const shape = Object.fromEntries(fields);
            const colon = moved.indexOf(':');
            return `        (${rustString(moved.slice(0, colon))}, ${rustString(moved.slice(colon + 1))}) => Some((${rustString(shape.key)}, ${rustString(shape.value)})),`;
        })
        .join('\n');
}

function renderAffixArms(entries) {
    return entries
        .map(([key, fields]) => {
            const shape = Object.fromEntries(fields);
            return `        ${rustString(key)} => Some((${rustString(shape.prefix)}, ${rustString(shape.suffix)})),`;
        })
        .join('\n');
}

function renderPairArms(entries) {
    return entries
        .map(([key, fields]) => {
            const shape = Object.fromEntries(fields);
            return `        ${rustString(key)} => Some((${rustString(shape.key)}, ${rustString(shape.value)})),`;
        })
        .join('\n');
}

/**
 * One match arm per key of the numeric-key tables, its bits OR-ed.
 *
 * @param {Record<keyof typeof NUMERIC_KEY_BITS, readonly string[]>} tables - The tables.
 * @returns {string} The arms, in first-seen key order.
 */
function renderNumericKeyBits(tables) {
    const bits = new Map();
    for (const [name, bit] of Object.entries(NUMERIC_KEY_BITS)) {
        for (const key of tables[name]) bits.set(key, (bits.get(key) ?? 0) | bit);
    }
    return [...bits].map(([key, value]) => `        ${rustString(key)} => ${value},`).join('\n');
}

function renderMatchPatterns(entries) {
    return entries
        .map((key, index) => `${index === 0 ? '        ' : '        | '}${rustString(key)}`)
        .join('\n');
}

function fail(message) {
    console.error(`[generate-rust-transform-tables] ${message}`);
    process.exit(1);
}
