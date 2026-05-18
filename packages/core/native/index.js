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

export function loadNativeBinding() {
    throw new CsszyxNativeUnavailableError();
}

export function transformBatch(_files) {
    const binding = loadNativeBinding();
    return binding.transformBatch(_files);
}

function isMusl() {
    if (typeof process.report?.getReport !== 'function') {
        return false;
    }

    const report = process.report.getReport();
    return !report.header?.glibcVersionRuntime;
}
