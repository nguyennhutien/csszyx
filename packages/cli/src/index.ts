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

// Migrate utilities — used by @csszyx/mcp-server.
//
// These run on the native engine and throw when the platform package is
// absent, which is the whole behaviour change: there is no longer a second
// implementation to fall back to.
export type {
    CsszyxTodoEntry,
    CsszyxTodoMap,
    MigrateRustResult as MigrateResult,
} from '@csszyx/compiler/migrate';
export type { GenerateTypesOptions } from './commands/generate-types.js';
export { generateTypes } from './commands/generate-types.js';
export type { GeneratorOptions } from './generator/type-generator.js';
export {
    generateAndWriteTypes,
    generateTypeDeclarations,
    writeDeclarationFile,
} from './generator/type-generator.js';
export { classNameToSzObject, migrateSource } from './migrate.js';
export type { ResolvedTheme, ScanResult } from './scanner/tailwind-scanner.js';
export {
    extractScreenKeys,
    extractSpacingKeys,
    findConfigFile,
    flattenColors,
    scanTailwindConfig,
} from './scanner/tailwind-scanner.js';
