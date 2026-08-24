/**
 * `csszyx migrate` on the native Rust core.
 *
 * The CLI's TypeScript transformer is still the shipped implementation; this
 * module exposes its Rust port through the same binding the build-time
 * transform uses, for the CLI to opt into with `CSSZYX_MIGRATE_ENGINE=rust`.
 * The port is held to the TypeScript byte for byte by the parity corpora in
 * `packages/core/tests`; this file only carries the options across and makes
 * the result read the way the TypeScript's does.
 *
 * @module
 */

import {
    CsszyxNativeUnavailableError,
    migrateBatch,
    migrateHtml,
    type NativeMigrateResult,
} from '@csszyx/core/native';

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
    customMap?: Record<string, unknown>;
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
            throw new RustMigrateUnavailableError(
                `${error.message}; native package: ${error.packageName ?? 'unsupported platform'}`,
            );
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
