/**
 * @csszyx/cli - Command line tools for csszyx.
 *
 * Library entry: programmatic exports only. Importing this module must
 * stay free of side effects (no argv parsing, no stdout) because
 * `@csszyx/mcp-server` imports it inside a stdio JSON-RPC process where
 * stray output corrupts the protocol stream. The executable lives in
 * `bin.ts`.
 *
 * @module @csszyx/cli
 */

export type { GenerateTypesOptions } from './commands/generate-types.js';
export { generateTypes } from './commands/generate-types.js';
export type { GeneratorOptions } from './generator/type-generator.js';
export {
    generateAndWriteTypes,
    generateTypeDeclarations,
    writeDeclarationFile,
} from './generator/type-generator.js';
// Migrate utilities — used by @csszyx/mcp-server
export type { TransformResult as MigrateResult } from './migrate/ast-transformer.js';
export { transformSource as migrateSource } from './migrate/ast-transformer.js';
export type { CsszyxTodoEntry, CsszyxTodoMap } from './migrate/variant-parser.js';
export { classNameToSzObject } from './migrate/variant-parser.js';
export type { ResolvedTheme, ScanResult } from './scanner/tailwind-scanner.js';
export {
    extractScreenKeys,
    extractSpacingKeys,
    findConfigFile,
    flattenColors,
    scanTailwindConfig,
} from './scanner/tailwind-scanner.js';
