/**
 * `--ignore` keeps another app's Tailwind entry out of the vote.
 *
 * Every entry under the root votes on the prefix, and a disagreement stops the
 * command. A directory the command is told to ignore may hold another app with
 * its own entry. The patterns also go into the facts record, because the
 * Turbopack loader walks the project itself and has to leave the same paths out.
 */
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FSWatcher } from 'chokidar';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { nextPrebuild } from '../src/commands/next-prebuild.js';
import { startNextWatch } from '../src/commands/next-watch.js';
import { linkTailwind } from './link-tailwind.js';

const tempDirs: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A Next app beside a directory that holds another app's Tailwind entry.
 *
 * @returns Absolute project root.
 */
function appBesideAnother(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-cli-ignore-css-')));
    tempDirs.push(root);
    writeFileSync(join(root, 'package.json'), '{"name":"app","private":true}\n');
    linkTailwind(root);
    mkdirSync(join(root, 'app'), { recursive: true });
    mkdirSync(join(root, 'other'), { recursive: true });
    writeFileSync(join(root, 'app/globals.css'), '@import "tailwindcss" prefix(tw);\n');
    writeFileSync(join(root, 'app/page.tsx'), 'export default () => <div sz={{ p: 4 }} />;\n');
    writeFileSync(join(root, 'other/entry.css'), '@import "tailwindcss" prefix(old);\n');
    return root;
}

/**
 * The facts record a command left behind.
 *
 * @param root - Absolute project root.
 * @returns The parsed record.
 */
function recordedFacts(root: string): { ignore: string[]; facts: { prefix: string } | null } {
    return JSON.parse(readFileSync(join(root, '.csszyx/cache/stylesheet-facts.json'), 'utf8'));
}

/**
 * A watcher that becomes ready and reports nothing.
 *
 * @returns The watcher factory.
 */
function idleWatcher(): () => FSWatcher {
    const emitter = new EventEmitter();
    const watcher = Object.assign(emitter, {
        add: () => watcher,
        close: async (): Promise<void> => {},
    }) as unknown as FSWatcher;
    return () => {
        setTimeout(() => emitter.emit('ready'), 0);
        return watcher;
    };
}

describe('next prebuild --ignore', () => {
    it('stops over the other entry when it is not ignored', async () => {
        const root = appBesideAnother();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const code = await nextPrebuild({ root, cwd: root, parserMode: 'wasm', json: true });

        expect(code).toBe(1);
    }, 60_000);

    it('reads the prefix of the entries left, and records the patterns it was given', async () => {
        const root = appBesideAnother();
        vi.spyOn(console, 'log').mockImplementation(() => {});

        const code = await nextPrebuild({
            root,
            cwd: root,
            parserMode: 'wasm',
            json: true,
            extraIgnore: ['other/**'],
        });

        expect(code).toBe(0);
        expect(recordedFacts(root).facts?.prefix).toBe('tw');
        // Only what the user passed: the built-in source ignores cover
        // `node_modules`, where a package stylesheet an import reaches lives.
        expect(recordedFacts(root).ignore).toEqual(['other/**']);
    }, 60_000);
});

describe('next prebuild with a pattern it cannot honour', () => {
    it('stops on a negated pattern and names it', async () => {
        const root = appBesideAnother();
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});

        const code = await nextPrebuild({
            root,
            cwd: root,
            parserMode: 'wasm',
            json: true,
            extraIgnore: ['other/**', '!other/keep.css'],
        });

        expect(code).toBe(1);
        expect(log.mock.calls.flat().join('\n')).toContain('!other/keep.css');
    }, 60_000);

    it('names the `--ignore` flag when the entries disagree', async () => {
        const root = appBesideAnother();
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await nextPrebuild({ root, cwd: root, parserMode: 'wasm', json: true });

        expect(log.mock.calls.flat().join('\n')).toContain('with the `--ignore` flag');
    }, 60_000);
});

describe('next watch --ignore', () => {
    it('reads the prefix of the entries left, and records the patterns it was given', async () => {
        const root = appBesideAnother();

        const session = await startNextWatch(
            {
                root,
                cwd: root,
                parserMode: 'wasm',
                debounceMs: 10,
                silent: true,
                extraIgnore: ['other/**'],
            },
            { watch: idleWatcher(), deliveryProbeTimeoutMs: 50 },
        );
        await session.close();

        expect(recordedFacts(root).facts?.prefix).toBe('tw');
        expect(recordedFacts(root).ignore).toEqual(['other/**']);
    }, 60_000);
});
