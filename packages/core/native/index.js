import { createRequire } from 'node:module';

import { getNativePackageName } from './platforms.js';

const require = createRequire(import.meta.url);

let cachedBinding;
let cachedPackageName;

/**
 * What a caller can do instead, per thing they were trying to run.
 *
 * The transform has a second implementation and migrate does not: the wasm
 * artifact is built without the migrate feature. Offering `build.parser` to a
 * migrate user would send them to a bundler option that cannot help with the
 * command they ran, so the recourse is chosen by what they asked for.
 */
const RECOURSE = {
    transform:
        'The wasm build of the engine (build.parser: "wasm") covers this platform until the native package is installed.',
    migrate:
        'migrate has no second implementation to fall back to, so it stops here rather than answering differently. Building and the runtime are unaffected.',
};

const NEEDS = {
    transform: 'csszyx native Rust transform is not available for this install.',
    migrate: 'csszyx migrate needs the native engine, and this install has none.',
};

export class CsszyxNativeUnavailableError extends Error {
    constructor(message, packageName = getNativePackageName(), purpose = 'transform') {
        super(
            message ??
                [
                    NEEDS[purpose],
                    packageName
                        ? `Expected optional package: ${packageName}.`
                        : 'No prebuilt package covers this platform.',
                    RECOURSE[purpose],
                ].join(' '),
        );
        this.name = 'CsszyxNativeUnavailableError';
        this.code = 'CSSZYX_NATIVE_UNAVAILABLE';
        this.packageName = packageName;
    }
}

export function loadNativeBinding(packageName = getNativePackageName(), purpose = 'transform') {
    if (cachedBinding && cachedPackageName === packageName) {
        return cachedBinding;
    }

    if (!packageName) {
        throw new CsszyxNativeUnavailableError(undefined, null, purpose);
    }

    let loaded;
    try {
        loaded = require(packageName);
    } catch (err) {
        if (isModuleNotFoundForPackage(err, packageName)) {
            throw new CsszyxNativeUnavailableError(undefined, packageName, purpose);
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
 * The load is asked for on migrate's behalf, so a missing platform package is
 * reported in migrate's terms rather than the transform's — see RECOURSE.
 *
 * @param {string} name - The export the caller needs.
 * @returns {Function} The binding's function.
 */
function migrateExport(name) {
    const binding = loadNativeBinding(getNativePackageName(), 'migrate');
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
