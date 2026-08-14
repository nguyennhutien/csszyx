import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import {
    BOOLEAN_SHORTHANDS,
    KNOWN_VARIANTS,
    MASK_SIDES,
    MIGRATION_NOTES,
    NEGATIVE_ALLOWED,
    PROPERTY_MAP,
    SPECIAL_VARIANTS,
    SUGGESTION_MAP,
} from '../../compiler/src/transform-core.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '../src/tooling.generated.ts');
const check = process.argv.includes('--check');

const THEME_TYPE_CATEGORIES = Object.freeze({
    CT_Colors: 'colors',
    CT_Spacings: 'spacings',
    CT_Fonts: 'fonts',
    CT_TextSizes: 'textSizes',
    CT_FontWeights: 'fontWeights',
    CT_Radii: 'radii',
    CT_Shadows: 'shadows',
});

/** Derive theme-fed properties from the compiler's public type graph. */
const readThemeValueProperties = async validPropertyKeys => {
    const source = await readFile(resolve(here, '../../compiler/src/types/sz-props.ts'), 'utf8');
    const sourceFile = ts.createSourceFile('sz-props.ts', source, ts.ScriptTarget.Latest, true);
    const aliases = new Map();
    for (const statement of sourceFile.statements) {
        if (ts.isTypeAliasDeclaration(statement)) aliases.set(statement.name.text, statement.type);
    }

    const categoriesFor = (node, seen = new Set()) => {
        const categories = new Set();
        const visit = child => {
            if (ts.isTypeReferenceNode(child) && ts.isIdentifier(child.typeName)) {
                const name = child.typeName.text;
                const category = THEME_TYPE_CATEGORIES[name];
                if (category) categories.add(category);
                const alias = aliases.get(name);
                if (alias && !seen.has(name)) {
                    const nextSeen = new Set(seen).add(name);
                    for (const nested of categoriesFor(alias, nextSeen)) categories.add(nested);
                }
            }
            ts.forEachChild(child, visit);
        };
        visit(node);
        return categories;
    };

    const properties = Object.fromEntries(
        Object.values(THEME_TYPE_CATEGORIES).map(category => [category, new Set()]),
    );
    for (const statement of sourceFile.statements) {
        if (!ts.isInterfaceDeclaration(statement) || !statement.name.text.endsWith('Props'))
            continue;
        for (const member of statement.members) {
            if (!ts.isPropertySignature(member) || !member.type || !member.name) continue;
            const name =
                ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
                    ? member.name.text
                    : null;
            if (!name || !validPropertyKeys.has(name)) continue;
            for (const category of categoriesFor(member.type)) properties[category].add(name);
        }
    }
    return Object.fromEntries(
        Object.entries(properties).map(([category, values]) => [category, [...values].sort()]),
    );
};

/** Read the top-level VALUE_SUGGESTIONS keys without executing the module.
 * value-suggestions.ts sits in a commonjs package, so importing it from this
 * ESM script hits loader interop edge cases; parsing its AST is hermetic. */
const readValueSuggestionKeys = async () => {
    const source = await readFile(resolve(here, '../src/value-suggestions.ts'), 'utf8');
    const sourceFile = ts.createSourceFile('value-suggestions.ts', source, ts.ScriptTarget.Latest);
    const keys = [];
    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (
                !ts.isIdentifier(declaration.name) ||
                declaration.name.text !== 'VALUE_SUGGESTIONS' ||
                !declaration.initializer ||
                !ts.isObjectLiteralExpression(declaration.initializer)
            )
                continue;
            for (const property of declaration.initializer.properties) {
                if (!ts.isPropertyAssignment(property)) continue;
                if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
                    keys.push(property.name.text);
            }
        }
    }
    return keys;
};

// Drift gate: every curated value key must be a real sz key, or its suggestions
// are dead (never surface at a value slot). Runs in both generate and --check.
const validKeys = new Set([...Object.keys(PROPERTY_MAP), ...BOOLEAN_SHORTHANDS]);
const orphanKeys = (await readValueSuggestionKeys()).filter(key => !validKeys.has(key));
if (orphanKeys.length > 0) {
    throw new Error(
        `value-suggestions.ts keys absent from PROPERTY_MAP ∪ BOOLEAN_SHORTHANDS (dead suggestions): ${orphanKeys.join(', ')}`,
    );
}

const themeValueProperties = await readThemeValueProperties(validKeys);

const serialize = value => JSON.stringify(value, null, 4);
const serializeFrozenRecord = value => {
    const entries = Object.entries(value).map(
        ([key, values]) =>
            `        ${key}: Object.freeze(${serialize(values).replaceAll('\n', '\n        ')}),`,
    );
    return `Object.freeze({\n${entries.join('\n')}\n    })`;
};
const generated = `/** GENERATED by packages/tooling-metadata/scripts/generate.mjs. */
export const METADATA_SCHEMA_VERSION = 1 as const;
export const PROPERTY_MAP = ${serialize(PROPERTY_MAP)} as const;
export const BOOLEAN_SHORTHANDS = ${serialize([...BOOLEAN_SHORTHANDS].sort())} as const;
export const KNOWN_VARIANTS = ${serialize([...KNOWN_VARIANTS].sort())} as const;
/** Variants that take a nested KEY rather than a value: \`group: { hover: … }\`,
 * \`data: { active: … }\`. They live outside KNOWN_VARIANTS because the compiler
 * resolves them by descending, so a consumer that validates top-level keys
 * against KNOWN_VARIANTS alone reports every one of them as an unknown prop. */
export const SPECIAL_VARIANTS = ${serialize([...SPECIAL_VARIANTS].sort())} as const;
export const SUGGESTION_MAP = ${serialize(SUGGESTION_MAP)} as const;
/** Sides of the linear mask slot, in the compiler's order. Editor tooling
 * offers exactly these, so a side added to the compiler shows up without a
 * second list to remember. */
export const MASK_SIDES = ${serialize([...MASK_SIDES])} as const;
/** Removed keys whose replacement is a SHAPE, not another key name — rendered
 * as "was removed: <note>", never through the did-you-mean template. */
export const MIGRATION_NOTES = ${serialize(MIGRATION_NOTES)} as const;
/** sz keys whose utility accepts a negative value (\`{ mt: '-4' }\` → \`-mt-4\`).
 * Derived from the compiler's NEGATIVE_ALLOWED, which is keyed by Tailwind
 * prefix; editors need the sz-key view to offer negative value completions. */
export const NEGATIVE_VALUE_KEYS = ${serialize(
    Object.keys(PROPERTY_MAP)
        .filter(key => NEGATIVE_ALLOWED.has(PROPERTY_MAP[key]))
        .sort(),
)} as const;
/** Generated-theme declaration categories understood by editor integrations. */
export type ThemeValueCategory = ${Object.values(THEME_TYPE_CATEGORIES)
    .map(category => `'${category}'`)
    .join(' | ')};
/** Canonical sz properties fed by each generated Tailwind theme namespace. */
export const THEME_VALUE_PROPERTIES: Readonly<Record<ThemeValueCategory, readonly string[]>> =
    ${serializeFrozenRecord(themeValueProperties)};
export { VALUE_SUGGESTIONS } from './value-suggestions';
`;

if (check) {
    const current = await readFile(outputPath, 'utf8').catch(() => '');
    if (current !== generated) {
        throw new Error('tooling metadata is stale; run pnpm --filter @csszyx/tooling-metadata generate');
    }
} else {
    await writeFile(outputPath, generated);
}
