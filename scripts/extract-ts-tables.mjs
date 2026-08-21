// Read named table declarations out of a TypeScript source file.
//
// Two scripts need the same thing — the literal value of a named `const` in the
// compiler package. `pnpm gen:rust-tables` renders those tables into the Rust
// engine's generated module; `pnpm check:var-hostile-keys` compares one of them
// against the pinned Tailwind. Both used to reach for the value with a regex,
// and a regex is the wrong tool for two reasons that both end in a silent
// answer:
//
//   - It matches the SHAPE of the declaration. `const X: Record<string, string>
//     = {…}` and `const X = {…} as const satisfies Y` need different patterns,
//     so adding or removing a type annotation makes the reader return nothing
//     rather than fail. Finding the declaration by IDENTIFIER cannot miss that
//     way, and throws when the name is genuinely absent.
//   - It matches quoted text anywhere in range, comments included. A sentence
//     with a quoted word inside a table body reads as another entry.
//
// TypeScript is already a dependency of this repo and its parser answers both
// questions directly, so these extractors stay small: find the declaration,
// unwrap `as const` / `satisfies`, read the literal.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

/**
 * Open a TypeScript or TSX source file for table extraction.
 *
 * @param filePath - Path to the `.ts`/`.tsx` file holding the declarations.
 * @returns Extractors bound to that file.
 */
export function readTableSource(filePath) {
    const label = path.basename(filePath);
    const sourceFile = ts.createSourceFile(
        filePath,
        readFileSync(filePath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    /**
     * Find a top-level-or-nested variable declaration by its identifier.
     *
     * @param name - The declared name.
     * @returns The declaration node.
     */
    function declarationOf(name) {
        let found;
        (function visit(node) {
            if (found) return;
            if (
                ts.isVariableDeclaration(node) &&
                ts.isIdentifier(node.name) &&
                node.name.text === name
            ) {
                found = node;
                return;
            }
            ts.forEachChild(node, visit);
        })(sourceFile);
        if (!found) throw new Error(`Could not find ${name} in ${label}`);
        return found;
    }

    /**
     * The declaration's initializer with `as const` / `satisfies` peeled off.
     *
     * A type-locked literal (`{…} as const satisfies SzProps`) must extract
     * like a plain one.
     *
     * @param name - The declared name.
     * @returns The unwrapped initializer expression.
     */
    function initializerOf(name) {
        let initializer = declarationOf(name).initializer;
        while (
            initializer &&
            (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer))
        ) {
            initializer = initializer.expression;
        }
        if (!initializer) throw new Error(`${name} in ${label} has no initializer`);
        return initializer;
    }

    /**
     * Read a property key as text, quoted or not.
     *
     * @param name - The declared name, for the error message.
     * @param key - The property-name node.
     * @returns The key text.
     */
    function keyText(name, key) {
        if (ts.isIdentifier(key) || ts.isStringLiteral(key) || ts.isNumericLiteral(key)) {
            return key.text;
        }
        throw new Error(`${name} in ${label} has an unsupported key: ${key.getText(sourceFile)}`);
    }

    /**
     * Read a string literal's VALUE, escapes already resolved.
     *
     * @param name - The declared name, for the error message.
     * @param node - The literal node.
     * @returns The string value.
     */
    function stringText(name, node) {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            return node.text;
        }
        throw new Error(
            `${name} in ${label} expected a string literal, got: ${node.getText(sourceFile)}`,
        );
    }

    /**
     * The object literal an object-shaped table declares.
     *
     * @param name - The declared name.
     * @returns Its properties, each asserted to be a plain assignment.
     */
    function objectProperties(name) {
        const initializer = initializerOf(name);
        if (!ts.isObjectLiteralExpression(initializer)) {
            throw new Error(`${name} in ${label} must be an object literal`);
        }
        return initializer.properties.map(property => {
            if (!ts.isPropertyAssignment(property)) {
                throw new Error(`${name} in ${label} contains a non-property assignment`);
            }
            return property;
        });
    }

    return {
        /**
         * `{ key: 'value' }` as entries, in source order.
         *
         * @param name - The declared name.
         * @returns Key/value pairs.
         */
        stringObject(name) {
            return objectProperties(name).map(property => [
                keyText(name, property.name),
                stringText(name, property.initializer),
            ]);
        },

        /**
         * `{ outer: { inner: 'value' } }` as entries, in source order.
         *
         * One table holds a removed key's replacement as a SHAPE — the
         * canonical key and the value to put on it — so a single string cannot
         * carry it and `stringObject` cannot read it.
         *
         * @param name - The declared name.
         * @returns Outer key paired with its inner key/value pairs.
         */
        objectOfStringObjects(name) {
            return objectProperties(name).map(property => {
                const outer = keyText(name, property.name);
                if (!ts.isObjectLiteralExpression(property.initializer)) {
                    throw new Error(`${name}.${outer} in ${label} must be an object literal`);
                }
                const inner = property.initializer.properties.map(member => {
                    if (!ts.isPropertyAssignment(member)) {
                        throw new Error(`${name}.${outer} in ${label} must be plain properties`);
                    }
                    return [
                        keyText(`${name}.${outer}`, member.name),
                        stringText(`${name}.${outer}`, member.initializer),
                    ];
                });
                return [outer, inner];
            });
        },

        /**
         * The keys of an object-shaped table, in source order.
         *
         * @param name - The declared name.
         * @returns The keys.
         */
        objectKeys(name) {
            return objectProperties(name).map(property => keyText(name, property.name));
        },

        /**
         * `new Set([...])` as an array of its members, in source order.
         *
         * @param name - The declared name.
         * @returns The members.
         */
        stringSet(name) {
            const initializer = initializerOf(name);
            if (
                !ts.isNewExpression(initializer) ||
                initializer.arguments?.length !== 1 ||
                !ts.isArrayLiteralExpression(initializer.arguments[0])
            ) {
                throw new Error(`${name} in ${label} must be new Set([...])`);
            }
            return initializer.arguments[0].elements.map(element => stringText(name, element));
        },

        /**
         * `{ group: ['a', 'b'] }` as a record of string arrays.
         *
         * @param name - The declared name.
         * @returns Group mapped to its members.
         */
        stringArrayRecord(name) {
            return Object.fromEntries(
                objectProperties(name).map(property => {
                    if (!ts.isArrayLiteralExpression(property.initializer)) {
                        throw new Error(
                            `${name} in ${label} maps ${keyText(name, property.name)} to ` +
                                'something other than an array literal',
                        );
                    }
                    return [
                        keyText(name, property.name),
                        property.initializer.elements.map(element => stringText(name, element)),
                    ];
                }),
            );
        },
    };
}
