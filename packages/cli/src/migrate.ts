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
import { szDiagnosticError } from '@csszyx/compiler';
import { CsszyxError } from '@csszyx/compiler/errors';
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
import { OPTIONS_OBJECT_REQUIRED, szRender } from '@csszyx/compiler/report';

export type {
    CsszyxTodoEntry,
    CsszyxTodoMap,
    MigrateRustConversion,
    MigrateRustHtmlOptions,
    MigrateRustOptions,
    MigrateRustParsedClass,
    MigrateRustResult,
} from '@csszyx/compiler/migrate';

/** Options for {@link migrateSource}. */
export interface MigrateSourceOptions extends MigrateRustOptions {
    /** Path used in warnings. */
    readonly filename: string;
}

/**
 * Migrate one JSX/TSX source.
 *
 * The path sat beside the source as a second string, so a call that swapped
 * them type-checked; it is a key of the options.
 *
 * @param source - Source file contents.
 * @param options - The path used in warnings, and the migrate options.
 * @param rest - nothing; a third argument is refused.
 * @returns The migrated source and its counts.
 * @throws RustMigrateUnavailableError when this install has no native engine.
 * @throws {CsszyxError} `options-object-required`, when called the way the
 * positional shape took, or without `filename`.
 */
export function migrateSource(
    source: string,
    options: MigrateSourceOptions,
    ...rest: never[]
): MigrateRustResult {
    if (
        rest.length > 0 ||
        typeof options !== 'object' ||
        options === null ||
        typeof options.filename !== 'string'
    ) {
        throw szDiagnosticError('options-object-required', { form: 'migrate-source' });
    }
    const { filename, ...migrateOptions } = options;
    const [result] = migrateRustBatch([{ filename, source }], migrateOptions);
    // A batch of one answers exactly once; the engine returns results in
    // input order and never drops one.
    return result as MigrateRustResult;
}

/** Options for {@link classNameToSzObject}. */
export interface ClassNameToSzObjectOptions {
    /** The migration-resolution map. */
    customMap?: CsszyxTodoMap;
}

/** The keys {@link ClassNameToSzObjectOptions} has. */
const CLASS_NAME_OPTION_KEYS: ReadonlySet<string> = new Set(['customMap']);

/**
 * Convert one whole `className` attribute to an sz object.
 *
 * @param className - The whole class attribute value.
 * @param options - The migration-resolution map.
 * @param rest - nothing; a third argument is refused.
 * @returns The sz object plus the tokens that stay in `className`.
 * @throws RustMigrateUnavailableError when this install has no native engine.
 * @throws {CsszyxError} `options-object-required`, when the options are not
 * one object of the keys above: a map passed in their place, the 0.17 shape,
 * would otherwise read no `customMap` and leave every mapped class unresolved.
 */
export function classNameToSzObject(
    className: string,
    options: ClassNameToSzObjectOptions = {},
    // `never[]` rejects a third argument where the types are read; the throw
    // catches a call from JavaScript, or a map typed loosely enough for `tsc`.
    ...rest: never[]
): MigrateRustConversion {
    // A plain object: a `Map` or a class instance has no own keys to name and
    // is still not the options.
    const proto =
        typeof options === 'object' && options !== null
            ? Object.getPrototypeOf(options)
            : undefined;
    const isObject = proto === Object.prototype || proto === null;
    const unknown = isObject
        ? Object.keys(options).filter(key => !CLASS_NAME_OPTION_KEYS.has(key))
        : [];
    if (rest.length > 0 || !isObject || unknown.length > 0) {
        const args =
            rest.length > 0 || !isObject
                ? ({ form: 'class-name-to-sz-object' } as const)
                : ({ form: 'class-name-to-sz-object-option', options: unknown } as const);
        throw new CsszyxError({
            code: 'options-object-required',
            args,
            message: szRender({ diagnostic: OPTIONS_OBJECT_REQUIRED, args, at: '' }),
        });
    }
    return migrateRustClassName(className, options);
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
