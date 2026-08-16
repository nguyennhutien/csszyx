import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { watch } from 'chokidar';
import { afterEach, describe, expect, it } from 'vitest';

import { type NextWatchFactory, startNextWatch } from '../src/commands/next-watch.js';

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

/** How a timed-out wait explains itself. */
interface WaitOptions {
    /** How long to keep polling before giving up. */
    timeoutMs?: number;
    /** State to attach to the failure, evaluated only when giving up. */
    describe?: () => string;
}

/**
 * Wait for a filesystem watcher to reach a state.
 *
 * The budget is deliberately generous. This waits on a real watcher plus a
 * debounce, and the assertion is that the state is reached AT ALL — not that it
 * is reached quickly. A tight budget turns CPU contention into a failure: at
 * 3s this passed when run alone and failed reproducibly inside the full
 * parallel suite on macOS. A watcher that is genuinely broken never fires, so
 * the extra seconds cost nothing on a real regression.
 *
 * Giving up attaches the observed state, because a bare deadline is not a
 * diagnosis. This test has failed twice on CI reporting only that time ran
 * out, which leaves the two causes — the watcher never delivered the event, or
 * it delivered and nothing acted on it — indistinguishable from the log. The
 * state is gathered ONLY on failure, so a passing run pays nothing for it.
 *
 * @param assertion - Condition to poll until it holds.
 * @param options - Budget and the state to report when the budget runs out.
 */
async function waitFor(assertion: () => boolean, options: WaitOptions = {}): Promise<void> {
    const { timeoutMs = 15_000, describe: describeState } = options;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (assertion()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    const state = describeState?.();
    throw new Error(
        state === undefined
            ? 'Timed out waiting for watcher state.'
            : `Timed out waiting for watcher state.\n${state}`,
    );
}

/**
 * A watcher factory that copies every delivered event into `log`.
 *
 * Wraps the real chokidar rather than faking it: the question a failure has to
 * answer is what the REAL watcher delivered, and a fake would answer for
 * itself instead. Reading the log needs no production surface — the factory is
 * already injectable for lifecycle tests.
 *
 * @param log - Collector the events are appended to, in delivery order.
 * @returns Factory to pass as the `watch` dependency.
 */
function recordingWatch(log: string[]): NextWatchFactory {
    return (paths, options) => {
        const watcher = watch(paths, options);
        const started = Date.now();
        watcher.on('all', (event, filePath) => {
            log.push(`+${String(Date.now() - started).padStart(5)}ms ${event} ${filePath}`);
        });
        return watcher;
    };
}

/** One path a failure report should account for. */
interface WatchedPath {
    label: string;
    path: string;
    /** Whether the text matters, not just whether the file is there. */
    content?: boolean;
}

/**
 * Render everything needed to tell a deaf watcher from an idle one.
 *
 * Which files get their TEXT read is stated per entry rather than inferred
 * from the extension. The safelist is `csszyx-classes.html`, so an
 * extension rule written for a `.txt` would have silently dropped the one
 * value the assertion actually reads.
 *
 * @param log - Events the watcher delivered, in order.
 * @param paths - Files whose state the assertion depends on.
 * @returns Multi-line report for the failure message.
 */
function describeWatchState(log: readonly string[], paths: readonly WatchedPath[]): string {
    const lines = [
        log.length === 0
            ? 'events observed: NONE — the watcher delivered nothing at all'
            : `events observed: ${log.length}`,
    ];
    lines.push(...log.map(entry => `  ${entry}`));
    for (const { label, path: filePath, content } of paths) {
        const exists = existsSync(filePath);
        lines.push(`${label}: ${exists ? 'present' : 'absent'}  ${filePath}`);
        if (exists && content) {
            lines.push(`  text: ${JSON.stringify(readFileSync(filePath, 'utf8').slice(0, 400))}`);
        }
    }
    return lines.join('\n');
}

describe('waitFor reports what it saw', () => {
    it('names the observed state when it gives up', async () => {
        // A bare deadline message teaches nothing. This test exists because a
        // CI failure of the watcher test reported only that time ran out, so
        // the two candidate causes — the event never arrived, or it arrived
        // and was not acted on — stayed indistinguishable, and the next
        // failure would have been equally mute.
        await expect(
            waitFor(() => false, { timeoutMs: 30, describe: () => 'events observed: none' }),
        ).rejects.toThrow('events observed: none');
    });

    it('still says what it was waiting for', async () => {
        await expect(waitFor(() => false, { timeoutMs: 30 })).rejects.toThrow(
            'Timed out waiting for watcher state.',
        );
    });
});

describe('csszyx next-watch command', () => {
    it('materializes a new shard and removes it when its source is deleted', async () => {
        const root = tempRoot();
        const initialSource = join(root, 'src/App.tsx');
        const addedSource = join(root, 'app/Card.tsx');
        writeFileSync(initialSource, 'export const App=()=> <div sz={{ p: 4 }} />;');

        const events: string[] = [];
        const session = await startNextWatch(
            {
                root,
                cwd: root,
                parserMode: 'wasm',
                debounceMs: 10,
                silent: true,
            },
            { watch: recordingWatch(events) },
        );
        try {
            expect(readFileSync(session.safelistOutputPath, 'utf8')).toContain('p-4');

            mkdirSync(join(root, 'app'), { recursive: true });
            writeFileSync(addedSource, 'export const Card=()=> <div />;');
            const shardPath = join(root, '.csszyx/cache/safelist-shards/manual.json');
            const state = (): string =>
                describeWatchState(events, [
                    { label: 'safelist', path: session.safelistOutputPath, content: true },
                    { label: 'shard', path: shardPath },
                    { label: 'source', path: addedSource },
                ]);
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

            await waitFor(() => readFileSync(session.safelistOutputPath, 'utf8').includes('m-2'), {
                describe: state,
            });

            rmSync(addedSource);
            await waitFor(
                () =>
                    !readFileSync(session.safelistOutputPath, 'utf8').includes('m-2') &&
                    !existsSync(shardPath),
                { describe: state },
            );
        } finally {
            await session.close();
        }
    }, 30_000);

    it('fails startup when no source files match', async () => {
        const root = tempRoot();

        await expect(
            startNextWatch({
                root,
                cwd: root,
                pattern: 'src/**/*.tsx',
                parserMode: 'wasm',
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
                parserMode: 'wasm',
                debounceMs: '-1',
                silent: true,
            }),
        ).rejects.toThrow('Invalid --debounce-ms');
    });
});
