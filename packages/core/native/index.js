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
                    'Use build.parser: "oxc" or "babel" until the native package is installed.',
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
    // A binding loaded by explicit path (e.g. workspace test preload) is the
    // same artefact the default platform-package name would resolve to, so
    // we honour any cached binding once it is in place. Tests can preload
    // via `loadNativeBinding(absolutePackageDir)` and `transformBatch()`
    // will still see it on subsequent default-key calls.
    if (cachedBinding) {
        return cachedBinding;
    }

    if (!packageName) {
        throw new CsszyxNativeUnavailableError(
            'csszyx native Rust transform is not available on this platform. Use build.parser: "oxc" or "babel".',
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
            `csszyx native package ${packageName} does not export transformBatch(). Use build.parser: "oxc" or "babel".`,
            packageName,
        );
    }

    cachedBinding = binding;
    cachedPackageName = packageName;
    return binding;
}

export function transformBatch(_files) {
    const binding = loadNativeBinding();
    return binding.transformBatch(_files);
}

function isModuleNotFoundForPackage(err, packageName) {
    if (err?.code !== 'MODULE_NOT_FOUND' && err?.code !== 'ERR_MODULE_NOT_FOUND') {
        return false;
    }

    return typeof err.message === 'string' && err.message.includes(packageName);
}

export { getNativePackageName };
