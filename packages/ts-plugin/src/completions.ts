import {
    BOOLEAN_SHORTHANDS,
    KNOWN_VARIANTS,
    METADATA_SCHEMA_VERSION,
    OBJECT_ONLY_PROPERTY_KEYS,
    type ObjectFormMember,
    type ObjectValueForm,
    PROPERTY_MAP,
    valueSuggestionsFor,
} from '@csszyx/tooling-metadata';
import type ts from 'typescript/lib/tsserverlibrary';

// Rank csszyx entries just below a host's exact local identifiers ('11') and
// above its global/keyword suggestions ('15'): in the empty-prefix discovery
// case the type-blind sz object otherwise buries these keys under ~900 globals,
// while an exact local match still wins.
const SORT_PREFIX = '14:csszyx:';
const IDENTIFIER_START = /[A-Z_$]/i;
const IDENTIFIER_PART = /[\w$]/;
const BACKSLASH = String.fromCodePoint(92);
export const DATA_OWNER = '@csszyx/ts-plugin';

/** Quote a value as a single-quoted string literal, escaping backslashes before
 * quotes so a value containing either cannot break out of the literal.
 * @param value - Raw value text.
 * @returns The safely quoted insertion text.
 */
function singleQuoted(value: string): string {
    const escapedBackslashes = replaceEvery(value, BACKSLASH, BACKSLASH.repeat(2));
    const escaped = replaceEvery(escapedBackslashes, "'", `${BACKSLASH}'`);
    return `'${escaped}'`;
}

/**
 * Replace every literal occurrence without requiring the ES2021 String library.
 * @param value - Source text.
 * @param search - Literal text to replace.
 * @param replacement - Text inserted for each occurrence.
 * @returns The replaced text.
 */
function replaceEvery(value: string, search: string, replacement: string): string {
    return value.split(search).join(replacement);
}

/** Describe an sz key by the Tailwind utility family it emits.
 * @param name - Canonical sz key.
 * @returns A greyed label hint, e.g. "→ bg-*", or a generic csszyx tag.
 */
function keyDetail(name: string): string {
    const prefix = (PROPERTY_MAP as Readonly<Record<string, string>>)[name];
    return prefix ? `→ ${prefix}-*` : 'csszyx';
}

/** Test whether a metadata key can be emitted as an unquoted object key.
 * @param name - Candidate metadata key.
 * @returns Whether the key is a JavaScript identifier.
 */
function isIdentifier(name: string): boolean {
    if (!name || !IDENTIFIER_START.test(name[0] ?? '')) return false;
    for (let index = 1; index < name.length; index += 1)
        if (!IDENTIFIER_PART.test(name[index] ?? '')) return false;
    return true;
}

const KEY_NAMES = Object.freeze(
    [
        ...Object.keys(PROPERTY_MAP),
        ...OBJECT_ONLY_PROPERTY_KEYS,
        ...BOOLEAN_SHORTHANDS,
        ...KNOWN_VARIANTS,
    ].filter((name, index, names) => isIdentifier(name) && names.indexOf(name) === index),
);

/** Build one namespaced completion entry.
 * @param tsMod - TypeScript instance injected by the host.
 * @param name - User-visible completion label.
 * @param group - Stable ranking and details group.
 * @param index - Stable rank within the group.
 * @param replacementSpan - Bounded source span replaced on acceptance.
 * @param insertText - Optional syntax-safe insertion text.
 * @returns A project-independent completion entry.
 */
function entry(
    tsMod: typeof ts,
    name: string,
    group: 'key' | 'value',
    index: number,
    replacementSpan: ts.TextSpan,
    insertText?: string,
): ts.CompletionEntry {
    const isValue = group === 'value';
    return {
        name,
        // Values read as strings (string icon); keys as object members.
        kind: isValue
            ? tsMod.ScriptElementKind.string
            : tsMod.ScriptElementKind.memberVariableElement,
        kindModifiers: '',
        sortText: `${SORT_PREFIX}${group}:${String(index).padStart(4, '0')}:${name}`,
        labelDetails: { description: isValue ? 'csszyx value' : keyDetail(name) },
        replacementSpan,
        insertText,
        data: { owner: DATA_OWNER, schema: 1, group, name } as unknown as ts.CompletionEntryData,
    };
}

/** Build bounded sz key completions.
 * @param tsMod - TypeScript instance injected by the host.
 * @param limit - Maximum entries to return.
 * @param replacementSpan - Source span replaced on acceptance.
 * @param shouldStop - Cooperative deadline and cancellation check.
 * @param exclude - Sibling keys already assigned in the object; suggesting a
 * key twice in one object is never useful (duplicates override silently).
 * @param prefix - Text inserted before the key, for a slot whose previous
 * property is missing its comma.
 * @returns Key completion entries, or an empty list for an unsupported schema.
 */
export function buildSzKeyEntries(
    tsMod: typeof ts,
    limit: number,
    replacementSpan: ts.TextSpan,
    shouldStop: () => boolean = () => false,
    exclude?: ReadonlySet<string>,
    prefix?: string,
): ts.CompletionEntry[] {
    if (METADATA_SCHEMA_VERSION !== 1) return [];
    const result: ts.CompletionEntry[] = [];
    for (const name of KEY_NAMES) {
        if (result.length % 32 === 0 && shouldStop()) break;
        if (result.length >= limit) break;
        if (exclude?.has(name)) continue;
        result.push(
            entry(tsMod, name, 'key', result.length, replacementSpan, keyInsertText(name, prefix)),
        );
    }
    return result;
}

/** Insertion text for one key entry.
 *
 * Undefined for the ordinary slot, so the editor inserts the label and nothing
 * about the common path changes.
 *
 * @param name - Key label.
 * @param prefix - Separator text to prepend, when the slot needs one.
 * @returns Insert text, or undefined to use the label.
 */
function keyInsertText(name: string, prefix?: string): string | undefined {
    return prefix === undefined ? undefined : `${prefix}${name}`;
}

/** Build key entries for a structured object-value form (e.g. `{ color, op }`).
 * @param tsMod - TypeScript instance injected by the host.
 * @param form - The form whose members are the only valid keys.
 * @param replacementSpan - Source span replaced on acceptance.
 * @param exclude - Members already assigned in the object.
 * @param prefix - Text inserted before the key, for a slot whose previous
 * property is missing its comma.
 * @returns Member key entries with per-member hints.
 */
export function buildFormKeyEntries(
    tsMod: typeof ts,
    form: ObjectValueForm,
    replacementSpan: ts.TextSpan,
    exclude?: ReadonlySet<string>,
    prefix?: string,
): ts.CompletionEntry[] {
    if (METADATA_SCHEMA_VERSION !== 1) return [];
    const result: ts.CompletionEntry[] = [];
    for (const member of form.members) {
        if (exclude?.has(member.name)) continue;
        const item = entry(
            tsMod,
            member.name,
            'key',
            result.length,
            replacementSpan,
            keyInsertText(member.name, prefix),
        );
        result.push({ ...item, labelDetails: { description: member.detail } });
    }
    return result;
}

/** Build value entries from a structured-form member's curated list.
 * @param tsMod - TypeScript instance injected by the host.
 * @param member - The form member owning the value slot.
 * @param limit - Maximum entries to return.
 * @param replacementSpan - Source span replaced on acceptance.
 * @param quoted - Whether the cursor is already inside a string literal.
 * @param shouldStop - Cooperative deadline and cancellation check.
 * @returns Value completion entries (numbers bare, strings quoted).
 */
export function buildMemberValueEntries(
    tsMod: typeof ts,
    member: ObjectFormMember,
    limit: number,
    replacementSpan: ts.TextSpan,
    quoted: boolean,
    shouldStop: () => boolean = () => false,
): ts.CompletionEntry[] {
    if (METADATA_SCHEMA_VERSION !== 1) return [];
    const result: ts.CompletionEntry[] = [];
    for (const name of member.values.slice(0, limit)) {
        if (result.length % 32 === 0 && shouldStop()) break;
        const numeric = name !== '' && Number.isFinite(Number(name));
        result.push(
            entry(
                tsMod,
                name,
                'value',
                result.length,
                replacementSpan,
                quoted || numeric ? name : singleQuoted(name),
            ),
        );
    }
    if (result[0]) result[0].isRecommended = true;
    return result;
}

/** Build bounded values for one sz property.
 * @param tsMod - TypeScript instance injected by the host.
 * @param property - Canonical sz property name.
 * @param limit - Maximum entries to return.
 * @param replacementSpan - Source span replaced on acceptance.
 * @param quoted - Whether the cursor is already inside a string literal.
 * @param shouldStop - Cooperative deadline and cancellation check.
 * @returns Value completion entries.
 */
export function buildSzValueEntries(
    tsMod: typeof ts,
    property: string,
    limit: number,
    replacementSpan: ts.TextSpan,
    quoted: boolean,
    shouldStop: () => boolean = () => false,
): ts.CompletionEntry[] {
    if (METADATA_SCHEMA_VERSION !== 1) return [];
    // Positives first, then their negative counterparts — the `limit` slice
    // below must never drop a positive to make room for `-4`.
    const values = valueSuggestionsFor(property);
    const result: ts.CompletionEntry[] = [];
    for (const name of values.slice(0, limit)) {
        if (result.length % 32 === 0 && shouldStop()) break;
        const numeric = name !== '' && Number.isFinite(Number(name));
        result.push(
            entry(
                tsMod,
                name,
                'value',
                result.length,
                replacementSpan,
                quoted || numeric ? name : singleQuoted(name),
            ),
        );
    }
    // Preselect the curated top value: an unquoted value slot is an expression
    // position, so the surrounding list may contain in-scope identifiers — the
    // recommended flag keeps Tab/Enter landing on the sz value.
    if (result[0]) result[0].isRecommended = true;
    return result;
}

/** Resolve documentation only for entries owned by this plugin.
 * @param tsMod - TypeScript instance injected by the host.
 * @param name - Completion name requested by the host.
 * @param data - Opaque completion payload returned by the host.
 * @returns Details for csszyx data, otherwise undefined for base-service delegation.
 */
export function completionDetails(
    tsMod: typeof ts,
    name: string,
    data: unknown,
): ts.CompletionEntryDetails | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const owner = Object.getOwnPropertyDescriptor(data, 'owner');
    const schema = Object.getOwnPropertyDescriptor(data, 'schema');
    const group = Object.getOwnPropertyDescriptor(data, 'group');
    if (owner?.value !== DATA_OWNER || schema?.value !== 1) return undefined;
    return {
        name,
        kind: tsMod.ScriptElementKind.memberVariableElement,
        kindModifiers: '',
        displayParts: [{ kind: 'text', text: name }],
        documentation: [
            {
                kind: 'text',
                text: `csszyx ${group?.value === 'value' ? 'value' : 'sz key'} completion`,
            },
        ],
        tags: [],
    };
}
