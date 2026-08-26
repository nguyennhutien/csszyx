import { createRequire } from 'node:module';

import { getNativePackageName } from './platforms.js';

const require = createRequire(import.meta.url);

let cachedBinding;
let cachedPackageName;

export class CsszyxNativeUnavailableError extends Error {
    constructor(message, packageName = getNativePackageName()) {
        super(
            message ??
                [
                    'csszyx native Rust transform is not available for this install.',
                    packageName ? `Expected optional package: ${packageName}.` : null,
                    'The wasm build of the engine (build.parser: "wasm") covers this platform until the native package is installed.',
                ]
                    .filter(Boolean)
                    .join(' '),
        );
        this.name = 'CsszyxNativeUnavailableError';
        this.code = 'CSSZYX_NATIVE_UNAVAILABLE';
        this.packageName = packageName;
    }
}

export function loadNativeBinding(packageName = getNativePackageName()) {
    if (cachedBinding && cachedPackageName === packageName) {
        return cachedBinding;
    }

    if (!packageName) {
        throw new CsszyxNativeUnavailableError(
            'csszyx native Rust transform is not available on this platform. The wasm build of the engine (build.parser: "wasm") covers it.',
            null,
        );
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
            `csszyx native package ${packageName} does not export transformBatch(). The wasm build of the engine (build.parser: "wasm") still covers this platform.`,
            packageName,
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
 * @param {string} name - The export the caller needs.
 * @returns {Function} The binding's function.
 */
function migrateExport(name) {
    const binding = loadNativeBinding();
    if (typeof binding[name] !== 'function') {
        throw new CsszyxNativeUnavailableError(
            `csszyx native package ${cachedPackageName} predates migrate and does not export ${name}(). Update @csszyx/core and its platform package, or run migrate without CSSZYX_MIGRATE_ENGINE=rust.`,
            cachedPackageName,
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
