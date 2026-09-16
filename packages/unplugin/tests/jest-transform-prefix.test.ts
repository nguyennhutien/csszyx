/**
 * The jest transformer lowers `sz` with the project's Tailwind prefix.
 *
 * jest transforms synchronously, one file at a time, and reading the prefix
 * means compiling the stylesheets, which is asynchronous. So the transformer
 * reads the facts file a bundler build or `csszyx next prebuild` records, and
 * when there is none it reads the stylesheets once in a child process. The
 * prefix is part of jest's cache key and of which build output it may reuse:
 * output lowered under one prefix is wrong under another.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { VERSION as compilerVersion } from '@csszyx/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTransformer } from '../src/jest-transform.js';
import { writeNextStylesheetFacts } from '../src/next-stylesheet-facts.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

// Wrapped, not replaced: the child that reads the stylesheets is real, and a
// test can count how many were started.
vi.mock('node:child_process', async importOriginal => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

const SOURCE = 'export const A = () => <div sz={{ p: 4 }} />;';
const PREFIXED = '@import "tailwindcss" prefix(tw);\n';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

/**
 * A project with one component and the given global stylesheet.
 *
 * @param css - `src/index.css`.
 * @param extra - More files, relative to the root.
 * @returns The root, the component path and the transform cache directory.
 */
function project(
    css: string,
    extra: Record<string, string> = {},
): { root: string; file: string; cacheRoot: string } {
    const root = tailwindProject('csszyx-jest-prefix-', {
        'src/index.css': css,
        'src/A.tsx': SOURCE,
        ...extra,
    });
    return {
        root,
        file: join(root, 'src/A.tsx'),
        cacheRoot: join(root, '.csszyx/cache/transform'),
    };
}

describe('the jest transformer and the Tailwind prefix', () => {
    it('lowers with the prefix a build recorded', async () => {
        const { root, file, cacheRoot } = project(PREFIXED);
        await writeNextStylesheetFacts({ root, cacheDir: join(root, '.csszyx/cache') });

        const { code } = createTransformer({ root, cacheRoot }).process(SOURCE, file);

        expect(code).toContain('className="tw:p-4"');
    }, 60_000);

    it('reads the stylesheets itself, once per worker, when nothing recorded them', () => {
        const { root, file, cacheRoot } = project(PREFIXED);
        vi.mocked(spawnSync).mockClear();
        const transformer = createTransformer({ root, cacheRoot });

        const { code } = transformer.process(SOURCE, file);
        transformer.process(SOURCE, file);

        expect(code).toContain('className="tw:p-4"');
        expect(spawnSync).toHaveBeenCalledTimes(1);
        expect(existsSync(join(root, '.csszyx/cache/stylesheet-facts.json'))).toBe(true);
    }, 60_000);

    it('re-resolves the prefix after a stylesheet edit in the same watch worker', () => {
        const { root, file, cacheRoot } = project('@import "tailwindcss";\n');
        const transformer = createTransformer({ root, cacheRoot });

        expect(transformer.process(SOURCE, file).code).toContain('className="p-4"');
        writeFileSync(join(root, 'src/index.css'), PREFIXED);

        expect(transformer.process(SOURCE, file).code).toContain('className="tw:p-4"');
    }, 60_000);

    it('passes on what the child says about a stray stylesheet, and still lowers', () => {
        const { root, file, cacheRoot } = project(PREFIXED, {
            'legacy/old.css': '@import "./gone.css";\n',
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const { code } = createTransformer({ root, cacheRoot }).process(SOURCE, file);

        expect(code).toContain('className="tw:p-4"');
        expect(warn.mock.calls.flat().join('\n')).toContain('legacy/old.css');
    }, 60_000);

    it('fails the file when the stylesheets give no single prefix, every time it is asked', () => {
        const { root, file, cacheRoot } = project(PREFIXED, {
            'legacy/old.css': '@import "tailwindcss";\n',
        });
        vi.mocked(spawnSync).mockClear();
        const transformer = createTransformer({ root, cacheRoot });

        expect(() => transformer.process(SOURCE, file)).toThrow('set different prefixes');
        expect(() => transformer.process(SOURCE, file)).toThrow('set different prefixes');
        // The failure is settled once too: every file would otherwise start a child.
        expect(spawnSync).toHaveBeenCalledTimes(1);
    }, 60_000);

    it('retries a failed prefix resolution after its stylesheet is repaired', () => {
        const { root, file, cacheRoot } = project(PREFIXED, {
            'legacy/old.css': '@import "tailwindcss";\n',
        });
        const transformer = createTransformer({ root, cacheRoot });

        expect(() => transformer.process(SOURCE, file)).toThrow('set different prefixes');
        writeFileSync(join(root, 'legacy/old.css'), PREFIXED);

        expect(transformer.process(SOURCE, file).code).toContain('className="tw:p-4"');
    }, 60_000);

    it('reads only the stylesheets it is told the app loads', () => {
        const { root, file, cacheRoot } = project(PREFIXED, {
            'legacy/old.css': '@import "tailwindcss";\n',
        });

        const { code } = createTransformer({
            root,
            cacheRoot,
            tailwindStylesheet: 'src/index.css',
        }).process(SOURCE, file);

        expect(code).toContain('className="tw:p-4"');
    }, 60_000);

    it('keys the jest cache on the prefix', async () => {
        const prefixed = project(PREFIXED);
        const stock = project('@import "tailwindcss";\n');
        for (const { root } of [prefixed, stock]) {
            await writeNextStylesheetFacts({ root, cacheDir: join(root, '.csszyx/cache') });
        }

        const keyOf = ({ root, cacheRoot }: { root: string; cacheRoot: string }) =>
            createTransformer({ root, cacheRoot }).getCacheKey(SOURCE, '/repo/src/A.tsx');

        expect(keyOf(prefixed)).not.toBe(keyOf(stock));
    }, 60_000);

    it('does not reuse build output lowered under another prefix', async () => {
        const { root, file, cacheRoot } = project(PREFIXED);
        await writeNextStylesheetFacts({ root, cacheDir: join(root, '.csszyx/cache') });
        const entry = (classPrefix: string | null, code: string) => ({
            filename: file,
            inputSha256: createHash('sha256').update(SOURCE).digest('hex'),
            compilerVersion,
            mangleVars: false,
            classPrefix,
            result: { code, transformed: true },
        });
        mkdirSync(join(cacheRoot, 'aa'), { recursive: true });
        writeFileSync(join(cacheRoot, 'aa/stale.json'), JSON.stringify(entry(null, 'stale')));

        const transformer = createTransformer({ root, cacheRoot });
        expect(transformer.process(SOURCE, file).code).toContain('className="tw:p-4"');

        writeFileSync(join(cacheRoot, 'aa/fresh.json'), JSON.stringify(entry('tw', 'fresh')));
        expect(transformer.process(SOURCE, file).code).toBe('fresh');
    }, 60_000);
});

describe('the project a jest transformer reads the prefix for', () => {
    it("is the jest project's rootDir, not the directory jest was started from", () => {
        // jest started at a monorepo root runs each app under `projects`, and
        // hands the transformer that app's rootDir with every file.
        const { root, file } = project(PREFIXED);
        const elsewhere = tailwindProject('csszyx-jest-cwd-', {
            'src/index.css': '@import "tailwindcss";\n',
        });
        vi.spyOn(process, 'cwd').mockReturnValue(elsewhere);

        const { code } = createTransformer().process(SOURCE, file, { config: { rootDir: root } });

        expect(code).toContain('className="tw:p-4"');
    }, 60_000);
});
