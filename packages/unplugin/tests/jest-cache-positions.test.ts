/**
 * A diagnostic jest replays from the build's transform cache names the line and
 * column the build would.
 *
 * The cache stores each span as the engine's byte offset (schema 19) and places
 * it again against the source on read. The jest transformer reads the same
 * entries through its own index, so it has to place them too, or a finding
 * replayed from a build prints `file:undefined:undefined`.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { VERSION as compilerVersion, transformSource } from '@csszyx/compiler';
import { afterEach, expect, it, vi } from 'vitest';

import { createTransformer } from '../src/jest-transform.js';
import { writeTransformCache } from '../src/transform-cache.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
});

it('places a cached diagnostic at its line and column', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-jest-cache-positions-')));
    roots.push(root);
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{ "name": "app" }\n');
    const file = join(root, 'src/A.tsx');
    const source = "export const A = () => (\n    <div sz={{ workBreak: 'all' }} />\n);\n";
    writeFileSync(file, source);
    const cacheRoot = join(root, '.csszyx/cache/transform');
    const result = transformSource(source, file);
    expect(result.issues?.[0]?.line).toBe(2);
    writeTransformCache(
        cacheRoot,
        {
            pluginVersion: 'test',
            compilerVersion,
            parserMode: 'rust',
            producer: 'rust',
            filename: file,
            source,
        },
        // Marked so the replay is the cached one, not a fresh transform.
        { ...result, code: `${result.code}\n// from-cache` },
    );
    const lines: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
    });

    const { code } = createTransformer({ root, cacheRoot }).process(source, file);

    expect(code).toContain('// from-cache');
    const finding = lines.find(line => line.includes('Unknown property'));
    expect(finding).toContain(`${file}:2:`);
    expect(finding).not.toContain('undefined');
});
