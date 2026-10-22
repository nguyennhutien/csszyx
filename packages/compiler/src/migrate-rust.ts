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
// Imported directly, not through `./report.js`: Node loads this module, and
// the build makes `./report.js` the whole `@csszyx/compiler/report` subpath,
// where only these entries are needed.
import { NATIVE_MIGRATE_UNAVAILABLE } from './diagnostic-browser.generated.js';
import { CsszyxError } from './errors.js';
import { renderThrown } from './thrown-words.js';
import { checkNativeEngine } from './transform-rust.js';

/**
 * One entry of the migration-resolution file.
 *
 * An object maps the class to sz directly. A string is either another class
 * string to read instead, or one of the directives: `sz:keep` leaves the class
 * in `className`, `sz:remove` drops it, `sz:todo` marks it still unresolved.
 * `null` and `false` read as unresolved, which is what they meant before the
 * directives existed.
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
    /**
     * The same map, already serialised. A caller that sends one map with many
     * runs of files serialises it once and passes the string; when both are
     * given this one is used as is.
     */
    customMapJson?: string;
    /**
     * What the project's Tailwind answered for utilities a migrate table would
     * otherwise decide, keyed as {@link MigrateRustTableVerdict.class}: `true`
     * when it serves the class. A class with no answer is left to the table and
     * reported in `stats.tableVerdicts`.
     */
    served?: ReadonlyMap<string, boolean>;
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
    /** The project's answers, as for {@link MigrateRustOptions.served}. */
    served?: ReadonlyMap<string, boolean>;
}

/** A class a migrate table decided because the project's Tailwind was not asked. */
export interface MigrateRustTableVerdict {
    /** The utility, with its sign, without variants or `!`. */
    class: string;
    /** Whether the table took the class as served. */
    served: boolean;
}

/** The counts of one migrated file. */
export interface MigrateRustStats {
    classNamesTransformed: number;
    classNamesSkipped: number;
    classNamesSkippedComponent: number;
    classesUnrecognized: string[];
    /** Legacy sz keys rewritten; absent when the file was never parsed. */
    szKeysNormalized?: number;
    /** Classes a table decided unasked, with its verdict; absent when there were none. */
    tableVerdicts?: MigrateRustTableVerdict[];
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

/** What a {@link RustMigrateUnavailableError} names, as the loader's error names it. */
export type RustMigrateUnavailableArgs = CsszyxNativeUnavailableError['args'];

/**
 * The native migrate cannot run in this install. A csszyx error,
 * `native-migrate-unavailable`: migrate has no wasm lane, so it is its own
 * id rather than the loader's, whose error it keeps as its `cause` and whose
 * args it names.
 */
export class RustMigrateUnavailableError extends CsszyxError {
    /**
     * @param args - What the install is missing, as the loader's error names it.
     * @param options - What it wraps.
     * @param options.cause - The loader's error.
     */
    constructor(args: RustMigrateUnavailableArgs, options: { cause?: unknown } = {}) {
        super({
            code: 'native-migrate-unavailable',
            args,
            message: renderThrown(NATIVE_MIGRATE_UNAVAILABLE, args),
            cause: options.cause,
        });
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
            guarded(() => migrateBatch([]));
            availability = true;
        } catch (error) {
            // Only a missing addon is "unavailable"; another engine is an error.
            if (!(error instanceof RustMigrateUnavailableError)) throw error;
            availability = false;
        }
    }
    return availability;
}

/**
 * Migrate JSX/TSX sources with the native Rust core: one call for the whole
 * job, which keeps the results in input order without a cursor per file.
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
                customMapJson:
                    options.customMapJson ??
                    (options.customMap ? JSON.stringify(options.customMap) : undefined),
                ...servedLists(options.served),
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
                ...servedLists(options.served),
            }),
        ),
    );
}

/**
 * The project's answers as the two lists the binding takes.
 *
 * @param served - Answers by class, or none.
 * @returns The served and unserved classes; empty when there are no answers.
 */
function servedLists(served: ReadonlyMap<string, boolean> | undefined): {
    servedClasses?: string[];
    unservedClasses?: string[];
} {
    if (served === undefined) return {};
    const servedClasses: string[] = [];
    const unservedClasses: string[] = [];
    for (const [className, answer] of served) {
        (answer ? servedClasses : unservedClasses).push(className);
    }
    return { servedClasses, unservedClasses };
}

/**
 * Run a native call, naming the install problem when the binding is missing.
 *
 * @param call - The native call.
 * @returns Its result.
 */
function guarded<T>(call: () => T): T {
    try {
        checkNativeEngine();
        return call();
    } catch (error) {
        // The loader words it for the transform, which can fall back to the
        // wasm engine; migrate cannot, so it gets words of its own.
        if (error instanceof CsszyxNativeUnavailableError) {
            throw new RustMigrateUnavailableError(error.args, { cause: error });
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
    const { szKeysNormalized, tableVerdicts, ...rest } = result.stats;
    // A file no table decided anything in carries no field, as before it
    // existed, so a caller comparing whole results is not handed an empty list.
    const counts = tableVerdicts?.length ? { ...rest, tableVerdicts } : rest;
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
