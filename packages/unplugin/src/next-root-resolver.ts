/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Source used to resolve a Next app root. */
export type NextAppRootSource = 'explicit' | 'loader-root-context' | 'loader-context' | 'cwd';

/** Inputs available to loader/watch/prebuild root resolution. */
export interface NextAppRootInput {
    explicitRoot?: string;
    loaderRootContext?: string;
    loaderContext?: string;
    cwd?: string;
}

/** Resolved Next app root plus the source that won. */
export interface NextAppRootResolution {
    root: string;
    source: NextAppRootSource;
}

/**
 * Resolve the app root used to scope Next Turbopack cache and state.
 *
 * @param input Root candidates ordered by trust level.
 * @returns Absolute root and source.
 */
export function resolveNextAppRoot(input: NextAppRootInput): NextAppRootResolution {
    if (input.explicitRoot) {
        return { root: path.resolve(input.explicitRoot), source: 'explicit' };
    }
    if (input.loaderRootContext) {
        const rootContextRoot = findNearestPackageRoot(input.loaderRootContext);
        if (input.loaderContext) {
            const loaderContextRoot = findNearestPackageRoot(input.loaderContext);
            if (isNestedPackageRoot(rootContextRoot, loaderContextRoot)) {
                return { root: loaderContextRoot, source: 'loader-context' };
            }
        }
        return { root: rootContextRoot, source: 'loader-root-context' };
    }
    if (input.loaderContext) {
        return { root: findNearestPackageRoot(input.loaderContext), source: 'loader-context' };
    }
    return { root: findNearestPackageRoot(input.cwd ?? process.cwd()), source: 'cwd' };
}

/**
 * Resolve a cache path under one app root.
 *
 * @param appRoot Resolved app root.
 * @param cacheDir User configured cache dir. Defaults to `.csszyx/cache`.
 * @returns Absolute cache path scoped under `appRoot`.
 */
export function resolveNextAppCacheDir(appRoot: string, cacheDir = '.csszyx/cache'): string {
    return path.resolve(appRoot, cacheDir);
}

/**
 *
 * @param start
 */
function findNearestPackageRoot(start: string): string {
    let current = path.resolve(start);
    try {
        const stat = fs.statSync(current);
        if (stat.isFile()) {
            current = path.dirname(current);
        }
    } catch {
        // Missing paths are still resolved upward from the provided directory.
    }

    for (;;) {
        if (fs.existsSync(path.join(current, 'package.json'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return path.resolve(start);
        }
        current = parent;
    }
}

/**
 *
 * @param parentRoot
 * @param candidateRoot
 */
function isNestedPackageRoot(parentRoot: string, candidateRoot: string): boolean {
    const relative = path.relative(parentRoot, candidateRoot);
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}
