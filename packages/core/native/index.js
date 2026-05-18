import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const PACKAGE_BY_PLATFORM = new Map([
    ['linux-x64-gnu', '@csszyx/core-linux-x64-gnu'],
    ['linux-x64-musl', '@csszyx/core-linux-x64-musl'],
    ['linux-arm64-gnu', '@csszyx/core-linux-arm64-gnu'],
    ['linux-arm64-musl', '@csszyx/core-linux-arm64-musl'],
    ['darwin-x64', '@csszyx/core-darwin-x64'],
    ['darwin-arm64', '@csszyx/core-darwin-arm64'],
    ['win32-x64-msvc', '@csszyx/core-win32-x64-msvc'],
    ['win32-arm64-msvc', '@csszyx/core-win32-arm64-msvc'],
]);

let cachedBinding;

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

export function getNativePackageName() {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'linux') {
        const libc = isMusl() ? 'musl' : 'gnu';
        return PACKAGE_BY_PLATFORM.get(`${platform}-${arch}-${libc}`) ?? null;
    }

    if (platform === 'win32') {
        return PACKAGE_BY_PLATFORM.get(`${platform}-${arch}-msvc`) ?? null;
    }

    return PACKAGE_BY_PLATFORM.get(`${platform}-${arch}`) ?? null;
}

export function loadNativeBinding(packageName = getNativePackageName()) {
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

function isMusl() {
    if (typeof process.report?.getReport !== 'function') {
        return false;
    }

    const report = process.report.getReport();
    return !report.header?.glibcVersionRuntime;
}
