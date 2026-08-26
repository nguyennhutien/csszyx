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
 * Both failures answer in migrate's own words rather than the transform's.
 * The transform offers `build.parser: "wasm"` when its platform package is
 * missing, and that is a real answer for a transform — but migrate has no
 * wasm artifact to fall back to, and `build.parser` is a bundler option that
 * has nothing to do with the command the user ran. Repeating it would send
 * someone whose only recourse is the platform package to a setting that
 * cannot help them.
 *
 * @param {string} name - The export the caller needs.
 * @returns {Function} The binding's function.
 */
function migrateExport(name) {
    let binding;
    try {
        binding = loadNativeBinding();
    } catch (err) {
        if (err?.code !== 'CSSZYX_NATIVE_UNAVAILABLE') throw err;
        throw new CsszyxNativeUnavailableError(
            [
                `csszyx migrate needs the native engine, and this install has none.`,
                err.packageName
                    ? `Install the optional package for this platform: ${err.packageName}.`
                    : 'No prebuilt package covers this platform.',
                'migrate has no second implementation to fall back to, so it stops here rather than answering differently. Building and the runtime are unaffected.',
            ].join(' '),
            err.packageName,
        );
    }
    if (typeof binding[name] !== 'function') {
        throw new CsszyxNativeUnavailableError(
            `csszyx native package ${cachedPackageName} predates migrate and does not export ${name}(). Update @csszyx/core and its platform package to a version that carries migrate.`,
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
