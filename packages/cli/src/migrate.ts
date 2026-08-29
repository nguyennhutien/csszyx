/**
 * The programmatic migrate surface, on the engine that ships.
 *
 * `@csszyx/mcp-server` and the migrate test suites call migrate a file at a
 * time and a class at a time. The engine takes a batch, so the per-file entry
 * here is a batch of one — kept because a caller with one snippet should not
 * have to know that.
 *
 * There is no TypeScript implementation behind these any more. On a platform
 * with no `@csszyx/core-<platform>` package they throw rather than degrade,
 * which is the honest answer: a silent second implementation is what the
 * parity corpora existed to police.
 *
 * @module
 */
import {
    type CsszyxTodoMap,
    type MigrateRustConversion,
    type MigrateRustHtmlOptions,
    type MigrateRustOptions,
    type MigrateRustParsedClass,
    type MigrateRustResult,
    migrateRustBatch,
    migrateRustClassName,
    migrateRustHtml,
    migrateRustParseClass,
} from '@csszyx/compiler/migrate';

export type {
    CsszyxTodoEntry,
    CsszyxTodoMap,
    MigrateRustConversion,
    MigrateRustHtmlOptions,
    MigrateRustOptions,
    MigrateRustParsedClass,
    MigrateRustResult,
} from '@csszyx/compiler/migrate';

/**
 * Migrate one JSX/TSX source.
 *
 * @param source - Source file contents.
 * @param filePath - Path used in warnings.
 * @param options - Migrate options.
 * @returns The migrated source and its counts.
 * @throws RustMigrateUnavailableError when this install has no native engine.
 */
export function migrateSource(
    source: string,
    filePath: string,
    options: MigrateRustOptions = {},
): MigrateRustResult {
    const [result] = migrateRustBatch([{ filename: filePath, source }], options);
    // A batch of one answers exactly once; the engine returns results in
    // input order and never drops one.
    return result as MigrateRustResult;
}

/**
 * Convert one whole `className` attribute to an sz object.
 *
 * @param className - The whole class attribute value.
 * @param customMap - The migration-resolution map.
 * @returns The sz object plus the tokens that stay in `className`.
 * @throws RustMigrateUnavailableError when this install has no native engine.
 */
export function classNameToSzObject(
    className: string,
    customMap?: CsszyxTodoMap,
): MigrateRustConversion {
    return migrateRustClassName(className, customMap);
}

/**
 * Migrate one HTML source.
 *
 * @param source - HTML source.
 * @param options - HTML migrate options.
 * @returns The migrated source and its counts.
 * @throws RustMigrateUnavailableError when this install has no native engine.
 */
export function migrateHtml(
    source: string,
    options: MigrateRustHtmlOptions = {},
): MigrateRustResult {
    return migrateRustHtml(source, options);
}

/**
 * Read one Tailwind utility as an sz prop and value.
 *
 * @param className - One Tailwind utility class.
 * @returns The parsed class, or null when the parser does not know it.
 * @throws RustMigrateUnavailableError when this install has no native engine.
 */
export function parseClass(className: string): MigrateRustParsedClass | null {
    return migrateRustParseClass(className);
}
