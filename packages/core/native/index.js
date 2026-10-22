import { createRequire } from 'node:module';

import { NATIVE_ENGINE_UNAVAILABLE } from './diagnostic-words.generated.js';
import { getNativePackageName } from './platforms.js';

const require = createRequire(import.meta.url);

let cachedBinding;
let cachedPackageName;

// The key `@csszyx/compiler/errors` brands every csszyx error under. This
// module cannot import the compiler, which imports it, so it writes the same
// key; the compiler's suite checks its `isCsszyxError` accepts this error.
const BRAND = Symbol.for('csszyx.error');
const CODE = NATIVE_ENGINE_UNAVAILABLE.id;

/**
 * The message of a {@link CsszyxNativeUnavailableError}: the registry's words
 * (`diagnostic-words.generated.js`), laid out as the compiler lays out a
 * thrown diagnostic: the code, the sentence, `help:`, `note:` and the link to
 * the code's page. The compiler's suite renders every form through its
 * renderer and checks this prints the same (`native-unavailable-words.test.ts`).
 *
 * @param {{form: 'no-platform-package' | 'not-installed' | 'missing-export' | 'stale-binding' | 'stale-binding-versions', platform?: string, packageName?: string, exportName?: string, nativeVersion?: string, coreVersion?: string}} args
 * @returns {string} The message.
 */
function messageOf(args) {
    const fill = template => template.replace(/\{(\w+)\}/g, (_, name) => args[name]);
    const { text, help, note } = NATIVE_ENGINE_UNAVAILABLE;
    return [
        `[csszyx] ${CODE}:`,
        `  ${fill(text[args.form])}`,
        `  help: ${fill(help[args.form])}`,
        `  note: ${fill(note)}`,
        `  docs: https://csszyx.com/e/${CODE}`,
    ].join('\n');
}

/**
 * The host as a platform package names it: `linux-x64`, `darwin-arm64`.
 *
 * @returns {string} The platform and the architecture.
 */
function hostPlatform() {
    return `${process.platform}-${process.arch}`;
}

/**
 * The args of a missing engine: the platform package that is not installed,
 * or the platform no prebuilt package covers.
 *
 * @param {string | null} packageName - The package the loader looked for.
 * @returns {{form: 'not-installed', packageName: string} | {form: 'no-platform-package', platform: string}} The args.
 */
function missingArgs(packageName) {
    return packageName
        ? { form: 'not-installed', packageName }
        : { form: 'no-platform-package', platform: hostPlatform() };
}

/**
 * The native engine cannot run here. A csszyx error: `code` is the registry
 * id `native-engine-unavailable`, `args` its form and what that form names,
 * and it carries the brand `isCsszyxError` recognises.
 */
export class CsszyxNativeUnavailableError extends Error {
    /**
     * @param {Parameters<typeof messageOf>[0]} [args]
     *   What is missing; by default the host's platform package, or the
     *   platform no prebuilt package covers.
     */
    constructor(args = missingArgs(getNativePackageName())) {
        super(messageOf(args));
        this.name = 'CsszyxNativeUnavailableError';
        this[BRAND] = true;
        this.code = CODE;
        this.args = args;
        this.packageName = args.packageName ?? null;
    }
}

export function loadNativeBinding(packageName = getNativePackageName()) {
    if (cachedBinding && cachedPackageName === packageName) {
        return cachedBinding;
    }

    if (!packageName) {
        throw new CsszyxNativeUnavailableError(missingArgs(null));
    }

    let loaded;
    try {
        loaded = require(packageName);
    } catch (err) {
        if (isModuleNotFoundForPackage(err, packageName)) {
            throw new CsszyxNativeUnavailableError(missingArgs(packageName));
        }
        throw err;
    }

    const binding = loaded?.default ?? loaded;
    if (typeof binding?.transformBatch !== 'function') {
        throw new CsszyxNativeUnavailableError({
            form: 'missing-export',
            packageName,
            exportName: 'transformBatch',
        });
    }

    cachedBinding = binding;
    cachedPackageName = packageName;
    return binding;
}

/**
 * The `version` of a package manifest, or undefined when it cannot be read.
 *
 * @param {string} specifier - The manifest, as `require` resolves it.
 * @returns {string | undefined} The version.
 */
function manifestVersion(specifier) {
    try {
        return require(specifier).version;
    } catch {
        return undefined;
    }
}

/**
 * The args of a platform package whose results `@csszyx/core` cannot read:
 * both versions when both manifests can be read and differ, since those are
 * what the user brings together, and the package alone otherwise. Equal
 * versions (a stale local build) would name two matching numbers, which
 * explains nothing.
 *
 * @param {string} packageName - The platform package that answered.
 * @returns {{form: 'stale-binding-versions', packageName: string, nativeVersion: string, coreVersion: string} | {form: 'stale-binding', packageName: string}} The args.
 */
function staleArgs(packageName) {
    const nativeVersion = manifestVersion(`${packageName}/package.json`);
    const coreVersion = manifestVersion('../package.json');
    return nativeVersion !== undefined && coreVersion !== undefined && nativeVersion !== coreVersion
        ? { form: 'stale-binding-versions', packageName, nativeVersion, coreVersion }
        : { form: 'stale-binding', packageName };
}

/**
 * Refuse a result an older platform package returned. Such a package still
 * exports the function, so the loader's export check passes; only the result
 * tells. Without this the caller fails on the first missing field, or, for
 * a field it reads per issue, prints a sentence with holes in it. Every result
 * has the same shape, so one is enough: the first that has an issue.
 *
 * @template T
 * @param {T[]} results - What the binding returned.
 * @param {(result: T) => boolean} current - Whether a result has this version's shape.
 * @returns {T[]} The results.
 */
function currentResults(results, current) {
    // A result with no issue says nothing about the shape of one, so judge the
    // first that has an issue, and the first result when none does.
    const judged = results.find(result => result.issues?.length > 0) ?? results[0];
    if (judged === undefined || current(judged)) return results;
    throw new CsszyxNativeUnavailableError(staleArgs(cachedPackageName));
}

export function transformBatch(_files, options) {
    const binding = loadNativeBinding();
    return currentResults(
        binding.transformBatch(_files, options),
        result =>
            Array.isArray(result.issues) &&
            result.issues.every(issue => typeof issue.argsJson === 'string'),
    );
}

/**
 * An entry point a platform package may predate: the binding loads, and the
 * function the caller needs is not on it. The migrate entry points and the
 * scans arrived after the first native packages shipped.
 *
 * What an unavailable engine means for migrate is decided by the caller that
 * knows: `@csszyx/compiler`'s migrate wrapper, which has no wasm lane to offer.
 *
 * @param {string} name - The export the caller needs.
 * @returns {Function} The binding's function.
 */
function laterExport(name) {
    const binding = loadNativeBinding();
    if (typeof binding[name] !== 'function') {
        throw new CsszyxNativeUnavailableError({
            form: 'missing-export',
            packageName: cachedPackageName,
            exportName: name,
        });
    }
    return binding[name];
}

/**
 * Reads the stylesheets each module imports, the names it re-exports and,
 * when asked, the values it exports for the cross-module registry.
 *
 * @param {Array<{filename: string, source: string}>} files - Modules to read.
 * @param {{registryEntries?: boolean}} [query] - Which optional answers to compute.
 * @returns {Array<{cssImports: string[], forwards: Array<{exportName: string, importedName: string, specifier: string}>, registryEntriesJson: string}>} One answer per module.
 */
export function scanModuleLinks(files, query) {
    const scan = laterExport('scanModuleLinks');
    // The 0.17 scan takes no query and answers without the registry entries.
    return currentResults(
        scan(files, query),
        result => query?.registryEntries !== true || typeof result.registryEntriesJson === 'string',
    );
}

/**
 * The engine's identity: the version of `@csszyx/core` the binary ships as and
 * the digest of the source it was built from. `@csszyx/compiler` compares both
 * with its own before the first call.
 *
 * @returns {{version: string, digest: string} | null} The identity, or null for
 *   a binary that predates it, which is older than any compiler that asks.
 */
export function engineIdentity() {
    const binding = loadNativeBinding();
    return typeof binding.engineIdentity === 'function' ? binding.engineIdentity() : null;
}

/**
 * Reads the global custom-property usages csszyx does not rewrite.
 *
 * @param {Array<{filename: string, source: string}>} files - Modules to read.
 * @param {{tokens?: string[]}} [query] - Which custom properties to report; every one when absent.
 * @returns {Array<Array<{kind: string, name: string, location: {filePath: string, line: number, column: number}, message: string}>>} One list per module.
 */
export function scanGlobalVarUsages(files, query) {
    return laterExport('scanGlobalVarUsages')(files, query);
}

export function migrateBatch(files, options) {
    return laterExport('migrateBatch')(files, options);
}

export function migrateHtml(source, options) {
    return laterExport('migrateHtml')(source, options);
}

export function migrateClassName(className, customMapJson) {
    return laterExport('migrateClassName')(className, customMapJson);
}

export function migrateParseClass(className) {
    return laterExport('migrateParseClass')(className);
}

function isModuleNotFoundForPackage(err, packageName) {
    if (err?.code !== 'MODULE_NOT_FOUND' && err?.code !== 'ERR_MODULE_NOT_FOUND') {
        return false;
    }

    return typeof err.message === 'string' && err.message.includes(packageName);
}

export { getNativePackageName };
