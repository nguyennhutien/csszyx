/**
 * What a production line leaves out, for the `/e/<code>` pages.
 *
 * A production browser bundle prints a diagnostic's args as JSON in place of
 * its sentence. Some sentences name a value the renderer works out from a
 * compiler table (`COMPUTED` in the registry): `{"form":"removed","key":"maskFrom"}`
 * does not say what to write, because the note lives in `MIGRATION_NOTES`.
 * These rows carry, per key such a line can name, the args and the computed
 * values, read from the same compiler sources the engine's generated tables
 * come from, so a page fills the registry's own `help` and `note` with them.
 *
 * Each row mirrors one lookup in `packages/compiler/src/diagnostic-computed.ts`
 * and the form the engine picks for the key; none reruns the lowering.
 * `packages/compiler/tests/docs-lookups-differential.test.ts` drives every row
 * through the runtime and both engines and holds it to what they report.
 *
 * `closed-enum-value`'s production form (`sibling-group`) has no rows: its
 * `help` names only args (`groupKey`, `groupValue`), and which stray values
 * reach it is the lowering's search, which a table here would copy.
 *
 * @module
 */

import path from 'node:path';

import { readTableSource } from '../extract-ts-tables.mjs';

const compilerSrc = path.resolve(import.meta.dirname, '../../packages/compiler/src');

/**
 * @typedef {object} LookupTables
 * @property {Record<string, string>} migrationNotes - `MIGRATION_NOTES`.
 * @property {Record<string, string>} suggestionMap - `SUGGESTION_MAP`.
 * @property {Record<string, { key: string, value: string }>} removedBooleanSugar - `REMOVED_BOOLEAN_SUGAR`.
 * @property {string[]} replacedKeys - `REPLACED_KEYS`.
 * @property {Record<string, Record<string, string>>} closedEnumClasses - `CLOSED_ENUM_CLASSES`.
 * @property {Record<string, { key: string, value: string }>} closedEnumValueMoves - `CLOSED_ENUM_VALUE_MOVES`.
 * @property {Record<string, { groups?: string }>} globalKeywordGroups - `GLOBAL_KEYWORD_GROUPS`.
 */

/**
 * @typedef {object} LookupRow
 * @property {Record<string, string>} args - What the production line prints.
 * @property {Record<string, string>} values - The computed values its words name.
 * @property {true} [engine] - Only the build reports it: the runtime never sees
 *   the opaque value this form is about, so no browser bundle prints it.
 */

/**
 * Nested entries as an object of objects.
 *
 * @param {Array<[string, Array<[string, string]>]>} entries - Outer key, inner pairs.
 * @returns {Record<string, Record<string, string>>} The object.
 */
function nested(entries) {
    return Object.fromEntries(entries.map(([key, inner]) => [key, Object.fromEntries(inner)]));
}

/**
 * Read the compiler tables the computed values come from.
 *
 * @returns {LookupTables} The tables.
 */
export function readLookupTables() {
    const source = file => readTableSource(path.join(compilerSrc, file));
    const core = source('transform-core.ts');
    const keys = source('sz-key-tables.ts');
    const closedEnums = source('closed-enum-tables.ts');
    const families = source('keyword-families.ts');
    return {
        migrationNotes: Object.fromEntries(keys.stringObject('MIGRATION_NOTES')),
        suggestionMap: Object.fromEntries(keys.stringObject('SUGGESTION_MAP')),
        removedBooleanSugar: nested(core.objectOfStringObjects('REMOVED_BOOLEAN_SUGAR')),
        replacedKeys: core.stringSet('REPLACED_KEYS'),
        closedEnumClasses: nested(closedEnums.objectOfStringObjects('CLOSED_ENUM_CLASSES')),
        closedEnumValueMoves: nested(closedEnums.objectOfStringObjects('CLOSED_ENUM_VALUE_MOVES')),
        globalKeywordGroups: nested(families.objectOfStringObjects('GLOBAL_KEYWORD_GROUPS')),
    };
}

/**
 * The rows of every id whose production line needs a computed value, by id.
 *
 * @param {LookupTables} tables - The compiler tables.
 * @returns {Record<string, LookupRow[]>} The rows.
 */
export function productionLookups(tables) {
    const {
        migrationNotes,
        suggestionMap,
        removedBooleanSugar,
        closedEnumClasses,
        closedEnumValueMoves,
        globalKeywordGroups,
    } = tables;
    const replaced = new Set(tables.replacedKeys);
    // `enumAllowed`, `canonicalAllowed`: the values in table order.
    const allowed = key => Object.keys(closedEnumClasses[key] ?? {}).join(', ');
    // `groups`.
    const groupsOf = key => (globalKeywordGroups[key]?.groups ?? '').split(' ').join(', ');
    // `movedValue`: `true` bare, otherwise quoted.
    const literal = value => (value === 'true' ? 'true' : `'${value}'`);
    const aliasesOf = key =>
        Object.keys(suggestionMap).filter(alias => suggestionMap[alias] === key);
    return {
        // The forms `push_unknown_key_diagnostics`, `push_removed_sugar_diagnostics`
        // and `push_runtime_alias_diagnostics` in the engine report.
        'removed-key': [
            ...Object.entries(migrationNotes).map(([key, note]) => ({
                args: { form: 'removed', key },
                values: { note },
            })),
            ...Object.entries(removedBooleanSugar).map(([key, to]) => ({
                args: {
                    form: replaced.has(key) ? 'sugar-replaced' : 'sugar',
                    key,
                    replacement: `${to.key}: '${to.value}'`,
                },
                values: {},
            })),
            ...[...replaced]
                .filter(key => !(key in removedBooleanSugar) && key in suggestionMap)
                .map(key => ({
                    args: { form: 'replaced', key, replacement: `${suggestionMap[key]}: true` },
                    values: {},
                })),
            ...Object.keys(globalKeywordGroups).flatMap(canonical =>
                aliasesOf(canonical).map(key => ({
                    args: { form: 'runtime-alias', key, replacement: canonical },
                    engine: true,
                    values: {
                        canonical,
                        canonicalAllowed: allowed(canonical),
                        groups: groupsOf(canonical),
                    },
                })),
            ),
        ],
        // `movedOf` looks a move up under the key, then under its canonical key.
        'moved-value': Object.entries(closedEnumValueMoves).flatMap(([at, to]) => {
            const [key, value] = at.split(/:(.*)/s);
            return [key, ...aliasesOf(key)].map(written => ({
                args: { form: 'value', key: written, value },
                values: { movedKey: to.key, movedValue: literal(to.value) },
            }));
        }),
    };
}
