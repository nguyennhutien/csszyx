/**
 * `csszyx migrate` on the native Rust core.
 *
 * This is how `csszyx migrate` runs. It exposes the engine through the same
 * binding the build-time transform uses; the file carries the options across
 * and shapes the result, and holds no migration logic of its own.
 *
 * There is no second implementation to fall back to. On a platform with no
 * `@csszyx/core-<platform>` package these throw, which is the honest answer:
 * a silent second implementation is what the parity corpora existed to
 * police.
 *
 * @module
 */

import {
    CsszyxNativeUnavailableError,
    migrateBatch,
    migrateClassName,
    migrateHtml,
    migrateParseClass,
    type NativeMigrateResult,
} from '@csszyx/core/native';

/**
 * One entry of the migration-resolution file.
 *
 * An object maps the class to sz directly; a string names another class to
 * read instead; `null` drops the class; `false` keeps it in `className`.
 */
export type CsszyxTodoEntry = Record<string, unknown> | string | null | false;

/** The migration-resolution file: class names mapped to resolution entries. */
export type CsszyxTodoMap = Record<string, CsszyxTodoEntry>;

/** One source to migrate. */
export interface MigrateRustFile {
    /** Path used in warnings. */
    filename: string;
    /** Source contents. */
    source: string;
}

/** Options for migrating JSX/TSX sources. */
export interface MigrateRustOptions {
    /** Insert a `@sz-todo` comment above elements with unrecognized classes. */
    injectTodos?: boolean;
    /** Only normalize legacy sz keys; leave every className untouched. */
    keysOnly?: boolean;
    /** The parsed migration-resolution map. */
    customMap?: CsszyxTodoMap;
}

/** Options for migrating an HTML source. */
export interface MigrateRustHtmlOptions {
    /** Wrap the sz attribute value in outer braces. */
    braces?: boolean;
    /** Inject the first-paint guard before `</head>` (default true). */
    injectFouc?: boolean;
    /** Inject the runtime script before `</body>`. */
    injectRuntime?: 'local' | 'cdn' | false;
    /** The script URL for `cdn`. */
    cdnUrl?: string;
    /** The script path for `local`. */
    localPath?: string;
}

/** The counts of one migrated file. */
export interface MigrateRustStats {
    classNamesTransformed: number;
    classNamesSkipped: number;
    classNamesSkippedComponent: number;
    classesUnrecognized: string[];
    /** Legacy sz keys rewritten; absent when the file was never parsed. */
    szKeysNormalized?: number;
}

/** What migrate did to one file, in the shape the TypeScript transformer returns. */
export interface MigrateRustResult {
    code: string;
    changed: boolean;
    warnings: string[];
    stats: MigrateRustStats;
    potentiallyUnusedImports: string[];
}

/** What one whole `className` attribute becomes. */
export interface MigrateRustConversion {
    /** The merged sz object. */
    szObject: Record<string, unknown>;
    /** Tokens migrate could not convert, which stay in `className`. */
    unrecognized: string[];
    /** Tokens the resolution map said to keep in `className`. */
    keepInClassName: string[];
}

/** One Tailwind utility read as an sz prop and value. */
export interface MigrateRustParsedClass {
    /** The sz key. */
    prop: string;
    /** The sz value. */
    value: unknown;
    /** The single CSS property the utility sets, when the class names one. */
    cssProperty?: string;
    /** A companion prop: `text-sm/6` is `text` plus `leading`. */
    extra?: { prop: string; value: unknown };
}

/** The native migrate cannot run in this install. */
export class RustMigrateUnavailableError extends Error {
    /**
     * @param detail - What the install is missing.
     */
    constructor(detail: string) {
        super(`migrate: native engine unavailable - ${detail}`);
        this.name = 'RustMigrateUnavailableError';
    }
}

let availability: boolean | undefined;

/**
 * Whether the native migrate can run here: the platform package is installed
 * and exports the migrate entry points. Memoized.
 *
 * @returns True when `migrateRustBatch` and `migrateRustHtml` will work.
 */
export function isRustMigrateAvailable(): boolean {
    if (availability === undefined) {
        try {
            migrateBatch([]);
            availability = true;
        } catch {
            availability = false;
        }
    }
    return availability;
}

/**
 * Migrate JSX/TSX sources with the native Rust core: one call for the whole
 * job, because the boundary crossing costs more than the parse.
 *
 * @param files - Sources to migrate.
 * @param options - Migrate options.
 * @returns Results in input order.
 * @throws RustMigrateUnavailableError when the native engine cannot run here.
 */
export function migrateRustBatch(
    files: readonly MigrateRustFile[],
    options: MigrateRustOptions = {},
): MigrateRustResult[] {
    return guarded(() =>
        migrateBatch(
            files.map(file => ({ filename: file.filename, source: file.source })),
            {
                injectTodos: options.injectTodos,
                keysOnly: options.keysOnly,
                customMapJson: options.customMap ? JSON.stringify(options.customMap) : undefined,
            },
        ).map(readResult),
    );
}

/**
 * Migrate one HTML source with the native Rust core.
 *
 * @param source - HTML source.
 * @param options - HTML migrate options.
 * @returns The migrated source and its counts.
 * @throws RustMigrateUnavailableError when the native engine cannot run here.
 */
export function migrateRustHtml(
    source: string,
    options: MigrateRustHtmlOptions = {},
): MigrateRustResult {
    return guarded(() =>
        readResult(
            migrateHtml(source, {
                braces: options.braces,
                injectFouc: options.injectFouc,
                injectRuntime: options.injectRuntime || undefined,
                cdnUrl: options.cdnUrl,
                localPath: options.localPath,
            }),
        ),
    );
}

/**
 * Run a native call, naming the install problem when the binding is missing.
 *
 * @param call - The native call.
 * @returns Its result.
 */
function guarded<T>(call: () => T): T {
    try {
        return call();
    } catch (error) {
        if (error instanceof CsszyxNativeUnavailableError) {
            // Passed through, not decorated: the native layer answers in
            // migrate's own words and already names the platform package, so
            // appending it again said the same thing twice.
            throw new RustMigrateUnavailableError(error.message);
        }
        throw error;
    }
}

/**
 * The native result in the TypeScript transformer's shape: a count the file
 * never had is absent, not null.
 *
 * @param result - The native result.
 * @returns The same result with `szKeysNormalized` omitted when absent.
 */
function readResult(result: NativeMigrateResult): MigrateRustResult {
    const { szKeysNormalized, ...counts } = result.stats;
    return {
        code: result.code,
        changed: result.changed,
        warnings: result.warnings,
        // The HTML pass has no sz keys to normalize and the binding carries
        // that absence as undefined rather than null, so the count is tested
        // for rather than compared against one spelling of missing.
        stats: typeof szKeysNormalized === 'number' ? { ...counts, szKeysNormalized } : counts,
        potentiallyUnusedImports: result.potentiallyUnusedImports,
    };
}

/**
 * Convert one whole `className` attribute to an sz object.
 *
 * The class-level question the file entry points cannot answer: the corpus
 * round-trip, the per-key matrix and the sz golden all ask what a class
 * becomes, with no source file around it.
 *
 * @param className - The whole class attribute value.
 * @param customMap - The migration-resolution map.
 * @returns The sz object plus the tokens that stay in `className`.
 * @throws RustMigrateUnavailableError when the native engine cannot run here.
 */
export function migrateRustClassName(
    className: string,
    customMap?: Record<string, unknown>,
): MigrateRustConversion {
    return guarded(
        () =>
            JSON.parse(
                migrateClassName(className, customMap ? JSON.stringify(customMap) : undefined),
            ) as MigrateRustConversion,
    );
}

/**
 * Read one Tailwind utility as an sz prop and value.
 *
 * @param className - One Tailwind utility class.
 * @returns The parsed class, or null when the parser does not know it.
 * @throws RustMigrateUnavailableError when the native engine cannot run here.
 */
export function migrateRustParseClass(className: string): MigrateRustParsedClass | null {
    return guarded(() => JSON.parse(migrateParseClass(className)) as MigrateRustParsedClass | null);
}
