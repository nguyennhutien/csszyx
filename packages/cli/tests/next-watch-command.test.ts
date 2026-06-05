import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startNextWatch } from '../src/commands/next-watch.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-cli-watch-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"app","private":true}\n', 'utf8');
    return dir;
}

async function waitFor(assertion: () => boolean, timeoutMs = 3_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (assertion()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Timed out waiting for watcher state.');
}

describe('csszyx next-watch command', () => {
    it('materializes a new shard and removes it when its source is deleted', async () => {
        const root = tempRoot();
        const initialSource = join(root, 'src/App.tsx');
        const addedSource = join(root, 'app/Card.tsx');
        writeFileSync(initialSource, 'export const App=()=> <div sz={{ p: 4 }} />;');

        const session = await startNextWatch({
            root,
            cwd: root,
            parserMode: 'babel',
            debounceMs: 10,
            silent: true,
        });
        try {
            expect(readFileSync(session.safelistOutputPath, 'utf8')).toContain('p-4');

            mkdirSync(join(root, 'app'), { recursive: true });
            writeFileSync(addedSource, 'export const Card=()=> <div />;');
            const shardPath = join(root, '.csszyx/cache/safelist-shards/manual.json');
            writeFileSync(
                shardPath,
                `${JSON.stringify({
                    version: 1,
                    cacheKey: 'manual',
                    sourcePath: addedSource,
                    sourceHash: 'manual-source',
                    classes: ['m-2'],
                    timestamp: Date.now(),
                    pid: process.pid,
                })}\n`,
                'utf8',
            );

            await waitFor(() => readFileSync(session.safelistOutputPath, 'utf8').includes('m-2'));

            rmSync(addedSource);
            await waitFor(
                () =>
                    !readFileSync(session.safelistOutputPath, 'utf8').includes('m-2') &&
                    !existsSync(shardPath),
            );
        } finally {
            await session.close();
        }
    });

    it('fails startup when no source files match', async () => {
        const root = tempRoot();

        await expect(
            startNextWatch({
                root,
                cwd: root,
                pattern: 'src/**/*.tsx',
                parserMode: 'babel',
                silent: true,
            }),
        ).rejects.toThrow('No source files matched');
    });

    it('rejects invalid parser mode before starting chokidar', async () => {
        const root = tempRoot();
        writeFileSync(join(root, 'src/App.tsx'), 'export const App=()=> <div />;');

        await expect(
            startNextWatch({
                root,
                cwd: root,
                parserMode: 'swc' as 'rust',
                silent: true,
            }),
        ).rejects.toThrow('Invalid --parser-mode');
    });

    it('rejects invalid debounce values before starting chokidar', async () => {
        const root = tempRoot();
        writeFileSync(join(root, 'src/App.tsx'), 'export const App=()=> <div />;');

        await expect(
            startNextWatch({
                root,
                cwd: root,
                parserMode: 'babel',
                debounceMs: '-1',
                silent: true,
            }),
        ).rejects.toThrow('Invalid --debounce-ms');
    });
});
