import { createRequire } from 'node:module';

import { getNativePackageName } from './platforms.js';

const require = createRequire(import.meta.url);

let cachedBinding;
let cachedPackageName;

const PREFIX = 'csszyx native engine unavailable: ';
const NOTE = 'note: the wasm engine ships inside @csszyx/core and produces the same output';
// migrate exists only on the native engine, so the note above would promise a
// fallback that is not there and the install help would send a reader to
// reinstall a package they already have.
const MIGRATE_NOTE = 'note: migrate runs on the native engine only; there is no wasm lane for it';
const MIGRATE_HELP =
    'update @csszyx/core and its platform package together, to a version that carries migrate';
const INSTALL_HELP =
    'it is an optional dependency of @csszyx/core; reinstall without skipping optional packages, or set build.parser: "wasm"';
const WASM_HELP = 'set build.parser: "wasm"; the wasm engine ships inside @csszyx/core';

/** @param {string | undefined} what @param {string | null} packageName @returns {string} What is missing. */
function missingText(what, packageName) {
    return what === undefined ? defaultMissing(packageName) : what;
}

/** @param {string | null} packageName @returns {string} What is missing, absent a more specific reason. */
function defaultMissing(packageName) {
    return packageName
        ? `${packageName} is not installed`
        : 'no prebuilt package covers this platform';
}

/** @param {string | undefined} help @param {string | null} packageName @returns {string} What to do. */
function helpText(help, packageName) {
    return help === undefined ? defaultHelp(packageName) : help;
}

/** @param {string | null} packageName @returns {string} What to do, absent a more specific action. */
function defaultHelp(packageName) {
    return packageName ? INSTALL_HELP : WASM_HELP;
}

/**
 * One line per thing the reader needs: what is missing, what to do, what
 * still holds. `detail` is the message without the fixed prefix, for a
 * caller that re-prefixes it under its own name.
 */
export class CsszyxNativeUnavailableError extends Error {
    constructor(what, packageName = getNativePackageName(), help, note = NOTE) {
        const detail = [
            missingText(what, packageName),
            `help: ${helpText(help, packageName)}`,
            note,
        ].join('\n');
        super(PREFIX + detail);
        this.name = 'CsszyxNativeUnavailableError';
        this.code = 'CSSZYX_NATIVE_UNAVAILABLE';
        this.packageName = packageName;
        this.detail = detail;
        this.help = helpText(help, packageName);
        // A caller that rewrites this message for its own lane still has to
        // keep advice written for one specific failure. Without this flag the
        // only way to tell "the generic install help" from "update both
        // packages together" is to read the words, and the wrapper that does
        // rewrite kept sending a reader to reinstall a package they had.
        this.helpIsExplicit = help !== undefined;
    }
}

export function loadNativeBinding(packageName = getNativePackageName()) {
    if (cachedBinding && cachedPackageName === packageName) {
        return cachedBinding;
    }

    if (!packageName) {
        throw new CsszyxNativeUnavailableError(undefined, null);
    }

    let loaded;
    try {
        loaded = require(packageName);
    } catch (err) {
        if (isModuleNotFoundForPackage(err, packageName)) {
            throw new CsszyxNativeUnavailableError(undefined, packageName);
        }
        throw err;
    }

    const binding = loaded?.default ?? loaded;
    if (typeof binding?.transformBatch !== 'function') {
        throw new CsszyxNativeUnavailableError(
            `${packageName} does not export transformBatch()`,
            packageName,
            `reinstall ${packageName} at the version of @csszyx/core, or set build.parser: "wasm"`,
        );
    }

    cachedBinding = binding;
    cachedPackageName = packageName;
    return binding;
}

export function transformBatch(_files, options) {
    const binding = loadNativeBinding();
    return binding.transformBatch(_files, options);
}

/**
 * The migrate entry points arrived after the first native packages shipped,
 * so a binding may load and still lack them.
 *
 * What an unavailable engine means for migrate is decided by the caller that
 * knows: `@csszyx/compiler`'s migrate wrapper, which has no wasm lane to offer.
 *
 * @param {string} name - The export the caller needs.
 * @returns {Function} The binding's function.
 */
function migrateExport(name) {
    const binding = loadNativeBinding();
    if (typeof binding[name] !== 'function') {
        throw new CsszyxNativeUnavailableError(
            `csszyx native package ${cachedPackageName} predates migrate and does not export ${name}()`,
            cachedPackageName,
            MIGRATE_HELP,
            MIGRATE_NOTE,
        );
    }
    return binding[name];
}

export function migrateBatch(files, options) {
    return migrateExport('migrateBatch')(files, options);
}

export function migrateHtml(source, options) {
    return migrateExport('migrateHtml')(source, options);
}

export function migrateClassName(className, customMapJson) {
    return migrateExport('migrateClassName')(className, customMapJson);
}

export function migrateParseClass(className) {
    return migrateExport('migrateParseClass')(className);
}

function isModuleNotFoundForPackage(err, packageName) {
    if (err?.code !== 'MODULE_NOT_FOUND' && err?.code !== 'ERR_MODULE_NOT_FOUND') {
        return false;
    }

    return typeof err.message === 'string' && err.message.includes(packageName);
}

export { getNativePackageName };
