import { EventEmitter } from 'node:events';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FSWatcher } from 'chokidar';
import { afterEach, describe, expect, it } from 'vitest';

import { startNextWatch } from '../src/commands/next-watch.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-cli-ready-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"app","private":true}\n', 'utf8');
    writeFileSync(join(dir, 'src/App.tsx'), 'export const App=()=> <div sz={{ p: 4 }} />;');
    return dir;
}

interface FakeWatcher {
    /**
     * Factory handed to the session. The watcher is built here rather than up
     * front because the session resolves its source glob before it ever asks
     * for a watcher, and a watcher that announced readiness during that gap
     * would announce it to nobody.
     */
    factory: () => FSWatcher;
    /** Paths this watcher has reported, in order. */
    delivered: string[];
    stop: () => void;
}

/**
 * A watcher whose delivery is separate from its readiness.
 *
 * The real failure this models is an operating system one: on macOS the
 * recursive watch is registered before the event stream behind it starts
 * flowing, so chokidar announces `ready` while writes are still going
 * unreported — and unreported means lost, not late, because nothing replays
 * them. Reproducing that with a real watcher costs a race that only shows up
 * in about one run in seven. Splitting the two signals apart makes the same
 * gap exact: this fake announces `ready` immediately and only then begins
 * observing, and when `deliver` is false it never observes at all.
 *
 * @param shardsDir Directory the session materializes its shards into.
 * @param deliver Whether the watcher ever reports anything after `ready`.
 * @returns The watcher plus the log of what it reported.
 */
function createLateWatcher(shardsDir: string, deliver: boolean): FakeWatcher {
    const emitter = new EventEmitter();
    const delivered: string[] = [];
    let timer: ReturnType<typeof setInterval> | undefined;

    const entries = (): string[] => (existsSync(shardsDir) ? readdirSync(shardsDir) : []);

    const begin = (): void => {
        // `ignoreInitial: true` — whatever the prebuild already wrote is not an
        // event, so the baseline is taken at the moment readiness is claimed.
        const known = new Set(entries());
        emitter.emit('ready');
        if (!deliver) {
            return;
        }
        timer = setInterval(() => {
            const current = entries();
            for (const name of current) {
                if (!known.has(name)) {
                    known.add(name);
                    delivered.push(name);
                    emitter.emit('all', 'add', join(shardsDir, name));
                }
            }
            for (const name of [...known]) {
                if (!current.includes(name)) {
                    known.delete(name);
                    delivered.push(`unlink:${name}`);
                    emitter.emit('all', 'unlink', join(shardsDir, name));
                }
            }
        }, 5);
    };

    const stop = (): void => {
        if (timer !== undefined) {
            clearInterval(timer);
            timer = undefined;
        }
    };

    const watcher = Object.assign(emitter, {
        close: async (): Promise<void> => stop(),
    }) as unknown as FSWatcher;

    return {
        factory: () => {
            setTimeout(begin, 0);
            return watcher;
        },
        delivered,
        stop,
    };
}

describe('csszyx next-watch readiness', () => {
    it('does not report ready until the watcher has actually delivered an event', async () => {
        const root = tempRoot();
        const shardsDir = join(root, '.csszyx/cache/safelist-shards');
        const { factory, delivered, stop } = createLateWatcher(shardsDir, true);

        const session = await startNextWatch(
            { root, cwd: root, parserMode: 'wasm', debounceMs: 10, silent: true },
            { watch: factory },
        );

        try {
            expect(
                delivered.length,
                'the session reported ready while its watcher had delivered nothing — every edit made in that window is dropped with no way to notice',
            ).toBeGreaterThan(0);
        } finally {
            await session.close();
            stop();
        }
    }, 30_000);

    it('starts anyway when the watcher never reports the probe', async () => {
        const root = tempRoot();
        const shardsDir = join(root, '.csszyx/cache/safelist-shards');
        const { factory, stop } = createLateWatcher(shardsDir, false);

        // A watcher this broken must not cost the session its startup: the
        // prebuilt safelist is already correct, and hanging here would trade a
        // degraded watch for no output at all.
        const session = await startNextWatch(
            { root, cwd: root, parserMode: 'wasm', debounceMs: 10, silent: true },
            { watch: factory, deliveryProbeTimeoutMs: 150 },
        );

        try {
            expect(existsSync(session.safelistOutputPath)).toBe(true);
        } finally {
            await session.close();
            stop();
        }
    }, 30_000);

    it('leaves no probe behind and never counts it as a shard', async () => {
        const root = tempRoot();
        const shardsDir = join(root, '.csszyx/cache/safelist-shards');
        const { factory, stop } = createLateWatcher(shardsDir, true);

        const session = await startNextWatch(
            { root, cwd: root, parserMode: 'wasm', debounceMs: 10, silent: true },
            { watch: factory },
        );

        try {
            expect(
                readdirSync(shardsDir),
                'the probe outlived the startup that created it',
            ).not.toContain('.csszyx-watch-probe');
            expect(
                readFileSync(session.safelistOutputPath, 'utf8'),
                'the probe reached the safelist, so it was read as a shard',
            ).not.toContain('csszyx-watch-probe');
        } finally {
            await session.close();
            stop();
        }
    }, 30_000);
});
