/**
 * The webpack-compatible loader entry and the production guards — the core
 * suite drives runNextTurboLoader directly, so the callback protocol, query
 * options, the mangle boundary, and the not-prebuilt error had no coverage.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import nextTurboLoader, {
    type NextTurboLoaderContext,
    runNextTurboLoader,
} from '../src/next-turbo-loader.js';

const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-next-loader-entry-'));
    tempDirs.push(dir);
    return dir;
}

function writeSource(root: string, source: string): string {
    const filename = join(root, 'src/App.tsx');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(filename, source, 'utf8');
    return filename;
}

const baseOptions = {
    parserMode: 'babel' as const,
    config: { mangleVars: false },
    nextVersion: '16.2.7',
    csszyxVersion: '0.9.0',
    compilerVersion: '0.9.0',
    nativeVersion: '0.9.0-test',
    writeOptions: { retryDelayMs: 0 },
};

function loaderContext(
    root: string,
    filename: string,
    extra: Partial<NextTurboLoaderContext> = {},
): NextTurboLoaderContext {
    return {
        resourcePath: filename,
        rootContext: root,
        context: join(root, 'src'),
        mode: 'development',
        addDependency: () => {},
        ...extra,
    } as NextTurboLoaderContext;
}

const source = 'export const App = () => <div sz={{ p: 4 }} />;';

describe('nextTurboLoader default export', () => {
    it('reports the result through the loader callback when present', () => {
        const root = tempRoot();
        const filename = writeSource(root, source);
        let received: { error: unknown; code?: string } | null = null;
        const ctx = loaderContext(root, filename, {
            getOptions: () => baseOptions,
            callback: (error, code) => {
                received = { error, code };
            },
        });
        expect(nextTurboLoader.call(ctx, source)).toBeUndefined();
        expect(received?.error).toBeNull();
        expect(received?.code).toContain('className');
    });

    it('returns the code synchronously without a callback', () => {
        const root = tempRoot();
        const filename = writeSource(root, source);
        const ctx = loaderContext(root, filename, { getOptions: () => baseOptions });
        expect(nextTurboLoader.call(ctx, source)).toContain('className');
    });

    it('routes failures through the callback, or throws without one', () => {
        const root = tempRoot();
        const filename = writeSource(root, source);
        const failing = { ...baseOptions, mode: 'production' as const };
        let callbackError: unknown = null;
        const withCallback = loaderContext(root, filename, {
            getOptions: () => failing,
            callback: error => {
                callbackError = error;
            },
        });
        expect(nextTurboLoader.call(withCallback, source)).toBeUndefined();
        expect(String(callbackError)).toContain('production cache is not ready');

        const withoutCallback = loaderContext(root, filename, { getOptions: () => failing });
        expect(() => nextTurboLoader.call(withoutCallback, source)).toThrow(
            /production cache is not ready/,
        );
    });

    it('reads options from a webpack-style query when getOptions is absent', () => {
        const root = tempRoot();
        const filename = writeSource(root, source);
        const ctx = loaderContext(root, filename, { query: baseOptions });
        expect(nextTurboLoader.call(ctx, source)).toContain('className');
        // A string query is ignored rather than trusted.
        const stringQuery = loaderContext(root, filename, { query: '?raw' });
        expect(nextTurboLoader.call(stringQuery, source)).toContain('className');
    });
});

describe('production guards', () => {
    it('rejects production variable mangling under Turbopack', () => {
        const root = tempRoot();
        const filename = writeSource(root, source);
        const ctx = loaderContext(root, filename);
        expect(() =>
            runNextTurboLoader(source, ctx, {
                ...baseOptions,
                mode: 'production',
                compilerOptions: { mangleVars: true },
            }),
        ).toThrow(/does not support production CSS variable mangling/);
        // Same signal when the config carries the flag instead.
        expect(() =>
            runNextTurboLoader(source, ctx, {
                ...baseOptions,
                mode: 'production',
                config: { mangleVars: true },
            }),
        ).toThrow(/does not support production CSS variable mangling/);
    });

    it('allows it when the escape hatch is set (then fails on the manifest guard)', () => {
        const root = tempRoot();
        const filename = writeSource(root, source);
        const ctx = loaderContext(root, filename);
        expect(() =>
            runNextTurboLoader(source, ctx, {
                ...baseOptions,
                mode: 'production',
                compilerOptions: { mangleVars: true },
                allowProductionMangling: true,
            }),
        ).toThrow(/production cache is not ready/);
    });
});
