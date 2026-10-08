/**
 * Which file watcher `next watch` runs on, and that both keep the safelist in
 * step with the sources.
 *
 * macOS and Windows get Node's recursive `fs.watch`, one operating-system
 * stream for the whole tree; everything else keeps chokidar. Measured with the
 * same case on three runners and two Node releases: a file written into a
 * directory created while the watch runs, then deleted. Under CPU load chokidar
 * lost that file's events on macOS in about 1 run in 80 on CI and 1 in 17 on a
 * Mac mini, and none on Windows or Linux; the native stream lost none anywhere.
 * On Linux the native watch is Node's own per-file walk, which without the
 * `ignore` option Node 22 lacks would watch all of `node_modules`.
 */
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    chokidarNextWatchFactory,
    type NextWatchFactory,
    nativeNextWatchFactory,
    nextWatchFactoryFor,
    startNextWatch,
} from '../src/commands/next-watch.js';
import { linkTailwind } from './link-tailwind.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-cli-backends-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"app","private":true}\n', 'utf8');
    writeFileSync(join(dir, 'src/App.tsx'), 'export const App=()=> <div sz={{ p: 4 }} />;');
    return dir;
}

async function waitFor(assertion: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (assertion()) return;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${what}.`);
}

/**
 * Write the shard the Turbopack loader would for `sourcePath`.
 *
 * @param shardPath - Where the shard goes.
 * @param sourcePath - The source file it records.
 * @param className - The one class it records.
 */
function writeShard(shardPath: string, sourcePath: string, className: string): void {
    writeFileSync(
        shardPath,
        `${JSON.stringify({
            version: 1,
            cacheKey: 'manual',
            sourcePath,
            sourceHash: 'manual-source',
            classes: [className],
            timestamp: Date.now(),
            pid: process.pid,
        })}\n`,
        'utf8',
    );
}

describe('nextWatchFactoryFor', () => {
    it.each([
        ['darwin', nativeNextWatchFactory],
        ['win32', nativeNextWatchFactory],
        ['linux', chokidarNextWatchFactory],
        ['freebsd', chokidarNextWatchFactory],
    ] as const)('gives %s its watcher', (platform, factory) => {
        expect(nextWatchFactoryFor(platform)).toBe(factory);
    });
});

describe('chokidarNextWatchFactory', () => {
    it.each([
        ['one path', (root: string) => root],
        ['a list of paths', (root: string) => [root] as const],
    ])('starts on %s', async (_name, paths) => {
        // Only that it starts and stops: whether it delivers is asserted where
        // the command uses it.
        const root = tempRoot();
        const watcher = chokidarNextWatchFactory(paths(root), { ignoreInitial: true });
        await new Promise<void>((resolve, reject) => {
            watcher.once('ready', () => resolve());
            watcher.once('error', reject);
        });
        await watcher.close();
    });
});

// Chokidar runs only where the command picks it: on macOS it loses this very
// case under load, which is the reason it is not picked there.
const LANES: ReadonlyArray<readonly [string, NextWatchFactory]> = [
    ['native', nativeNextWatchFactory],
    ...(nextWatchFactoryFor() === chokidarNextWatchFactory
        ? [['chokidar', chokidarNextWatchFactory] as const]
        : []),
];

describe.each(LANES)('next watch on the %s watcher', (_name, factory) => {
    it('removes the shard of a source written into a new directory once it is deleted', async () => {
        const root = tempRoot();
        const session = await startNextWatch(
            { root, cwd: root, parserMode: 'wasm', debounceMs: 10, silent: true },
            { watch: factory },
        );
        try {
            const source = join(session.root, 'app/Card.tsx');
            const shardPath = join(session.root, '.csszyx/cache/safelist-shards/manual.json');
            mkdirSync(join(session.root, 'app'), { recursive: true });
            writeFileSync(source, 'export const Card=()=> <div />;');
            writeShard(shardPath, source, 'm-2');
            await waitFor(
                () => readFileSync(session.safelistOutputPath, 'utf8').includes('m-2'),
                'the shard to reach the safelist',
            );

            rmSync(source);
            await waitFor(
                () =>
                    !readFileSync(session.safelistOutputPath, 'utf8').includes('m-2') &&
                    !existsSync(shardPath),
                'the shard to be removed with its source',
            );
            expect(readFileSync(session.safelistOutputPath, 'utf8')).not.toContain('m-2');
            expect(existsSync(shardPath)).toBe(false);
        } finally {
            await session.close();
        }
    }, 40_000);
});

describe('a source whose events the watcher never delivers', () => {
    it('is reaped once it is gone from the disk', async () => {
        // The CI trace of the case above: the watcher reported `addDir app`
        // and then nothing for the file written into it, neither its `add`
        // nor its `unlink`, so no cycle ever ran to reap the shard. This
        // watcher drops every event for the source, the same shape on demand.
        const root = tempRoot();
        const dropped = (filePath: string): boolean => filePath.endsWith('Card.tsx');
        const lossy: NextWatchFactory = (paths, options) => {
            const watcher = nextWatchFactoryFor()(paths, options);
            const emit = watcher.emit.bind(watcher);
            watcher.emit = ((event: string, ...args: unknown[]) =>
                (event === 'all' && dropped(String(args[1]))) ||
                ((event === 'add' || event === 'unlink') && dropped(String(args[0])))
                    ? true
                    : emit(event, ...args)) as typeof watcher.emit;
            return watcher;
        };
        const session = await startNextWatch(
            { root, cwd: root, parserMode: 'wasm', debounceMs: 10, silent: true },
            { watch: lossy, sourceSweepMs: 50 },
        );
        try {
            const source = join(session.root, 'app/Card.tsx');
            const shardPath = join(session.root, '.csszyx/cache/safelist-shards/manual.json');
            mkdirSync(join(session.root, 'app'), { recursive: true });
            writeFileSync(source, 'export const Card=()=> <div />;');
            writeShard(shardPath, source, 'm-2');
            await waitFor(
                () => readFileSync(session.safelistOutputPath, 'utf8').includes('m-2'),
                'the shard to reach the safelist',
            );

            rmSync(source);
            await waitFor(
                () => !existsSync(shardPath),
                'the shard of a source removed without an event',
                5_000,
            );
            await waitFor(
                () => !readFileSync(session.safelistOutputPath, 'utf8').includes('m-2'),
                'the safelist to drop its class',
                5_000,
            );
            expect(existsSync(shardPath)).toBe(false);
            expect(readFileSync(session.safelistOutputPath, 'utf8')).not.toContain('m-2');
        } finally {
            await session.close();
        }
    }, 30_000);
});

describe('a removed directory', () => {
    it('reaps the shards of the sources it held', async () => {
        // A directory moved or deleted in one step can arrive as one event for
        // the directory and none for the files in it. The reconciliation it
        // prompts checks every shard's source on disk, which is what reaps them.
        const root = tempRoot();
        const emitter = new EventEmitter();
        const fake: NextWatchFactory = () => {
            setTimeout(() => emitter.emit('ready'), 0);
            return Object.assign(emitter, { close: async (): Promise<void> => {} });
        };
        const session = await startNextWatch(
            { root, cwd: root, parserMode: 'wasm', debounceMs: 10, silent: true },
            { watch: fake, deliveryProbeTimeoutMs: 50 },
        );
        try {
            const source = join(session.root, 'app/Card.tsx');
            const shardPath = join(session.root, '.csszyx/cache/safelist-shards/manual.json');
            mkdirSync(join(session.root, 'app'), { recursive: true });
            writeFileSync(source, 'export const Card=()=> <div />;');
            writeShard(shardPath, source, 'm-2');
            emitter.emit('all', 'add', shardPath);
            await waitFor(
                () => readFileSync(session.safelistOutputPath, 'utf8').includes('m-2'),
                'the shard to reach the safelist',
            );

            rmSync(join(session.root, 'app'), { recursive: true });
            emitter.emit('all', 'unlinkDir', join(session.root, 'app'));
            await waitFor(() => !existsSync(shardPath), 'the shard to be reaped');
            expect(existsSync(shardPath)).toBe(false);
        } finally {
            await session.close();
        }
    }, 40_000);
});

describe('a change the platform cannot name', () => {
    /**
     * A watcher whose events the test sends itself.
     *
     * @returns The emitter to send them through, and the factory that hands it out.
     */
    function scripted(): { emitter: EventEmitter; factory: NextWatchFactory } {
        const emitter = new EventEmitter();
        const factory: NextWatchFactory = () => {
            setTimeout(() => emitter.emit('ready'), 0);
            return Object.assign(emitter, { close: async (): Promise<void> => {} });
        };
        return { emitter, factory };
    }

    it('reconciles the shards, which picks up one written without an event', async () => {
        const root = tempRoot();
        const { emitter, factory } = scripted();
        const session = await startNextWatch(
            { root, cwd: root, parserMode: 'wasm', debounceMs: 10, silent: true },
            { watch: factory, deliveryProbeTimeoutMs: 50 },
        );
        try {
            const source = join(session.root, 'app/Card.tsx');
            const shardPath = join(session.root, '.csszyx/cache/safelist-shards/manual.json');
            mkdirSync(join(session.root, 'app'), { recursive: true });
            writeFileSync(source, 'export const Card=()=> <div />;');
            writeShard(shardPath, source, 'm-2');
            emitter.emit('all', 'rescan', session.root);
            await waitFor(
                () => readFileSync(session.safelistOutputPath, 'utf8').includes('m-2'),
                'the shard to reach the safelist',
            );

            rmSync(join(session.root, 'app'), { recursive: true });
            emitter.emit('all', 'rescan', session.root);
            await waitFor(() => !existsSync(shardPath), 'the shard to be reaped');
            expect(existsSync(shardPath)).toBe(false);
        } finally {
            await session.close();
        }
    }, 40_000);

    it('reads the stylesheets again, which picks up one edited without an event', async () => {
        const root = tempRoot();
        linkTailwind(root);
        mkdirSync(join(root, 'app'), { recursive: true });
        writeFileSync(join(root, 'app/globals.css'), '@import "tailwindcss";\n');
        const { emitter, factory } = scripted();
        const session = await startNextWatch(
            {
                root,
                cwd: root,
                parserMode: 'wasm',
                debounceMs: 10,
                silent: true,
                tailwindStylesheet: ['app/globals.css'],
            },
            { watch: factory, deliveryProbeTimeoutMs: 50 },
        );
        const facts = join(session.root, '.csszyx/cache/stylesheet-facts.json');
        try {
            expect(readFileSync(facts, 'utf8')).toContain('"prefix": null');
            writeFileSync(
                join(session.root, 'app/globals.css'),
                '@import "tailwindcss" prefix(tw);\n',
            );
            emitter.emit('all', 'rescan', session.root);
            await waitFor(
                () => readFileSync(facts, 'utf8').includes('"prefix": "tw"'),
                'the stylesheet facts to be recorded again',
            );
        } finally {
            await session.close();
        }
    }, 40_000);
});
