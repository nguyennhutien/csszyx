/**
 * One `--ignore` list, several readers, the same answer.
 *
 * The Next commands hand the list to fast-glob to find the sources, and to the
 * shared matcher to prune the watcher and to keep another app's stylesheets out
 * of the Tailwind prefix vote. Wherever they read a pattern differently, an
 * app's sources are skipped while its entry still votes, or the reverse. This
 * runs them over one real tree, so the matcher follows what fast-glob does and
 * not a description of it.
 *
 * A directory is asked a different question from a file. `legacy/*` matches
 * the directory `legacy/deep`, yet fast-glob still reads the files inside it,
 * so a walker that pruned every matching directory would drop them.
 */
import { EventEmitter } from 'node:events';
import {
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    type Stats,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import {
    createRootIgnoreMatcher,
    prepareNextStylesheetFacts,
} from '@csszyx/unplugin/next-prebuild';
import type { FSWatcher } from 'chokidar';
import fg from 'fast-glob';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startNextWatch } from '../src/commands/next-watch.js';

const FILES = [
    'legacy/a.css',
    'legacy/deep/d.css',
    'legacy/deep/er/e.css',
    'legacy.css',
    'legacy-next/n.css',
    'docs/x.css',
    'docs/sub/f.css',
    'app/g.css',
    'src/k.css',
    'src/__skip__/in/s.css',
    '.hid/h.css',
];

const PATTERNS = [
    'legacy',
    'legacy/',
    'legacy/*',
    'legacy/**',
    './legacy/**',
    './legacy',
    'legacy/deep',
    'docs/*',
    '**/__skip__',
    '**/__skip__/**',
    'leg*',
    'l*/deep',
    '*.css',
    '**/d.css',
    '.hid',
    '{legacy,docs}',
    '{legacy,docs}/**',
    'legacy/{deep,nope}',
    'LEGACY',
    '/legacy/**',
    'src/[_k]*',
    'nothing/**',
];

let root: string;

beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-ignore-parity-')));
    for (const file of FILES) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), '');
    }
    // `next watch` stops when no source file matches its pattern.
    writeFileSync(join(root, 'app/page.tsx'), 'export default () => <div sz={{ p: 4 }} />;\n');
    writeFileSync(join(root, 'package.json'), '{"name":"parity","private":true}\n');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

/**
 * Every directory on the way to a file, relative to the root.
 *
 * @returns The directories, each once.
 */
function directories(): string[] {
    const found = new Set<string>();
    for (const file of FILES) {
        for (let dir = dirname(file); dir !== '.'; dir = dirname(dir)) found.add(dir);
    }
    return [...found];
}

/**
 * The files fast-glob keeps for one pattern.
 *
 * @param pattern - The ignore pattern.
 * @returns Root-relative paths.
 */
function keptByFastGlob(pattern: string): Set<string> {
    return new Set(fg.sync('**/*.css', { cwd: root, dot: true, ignore: [pattern] }));
}

/**
 * The directories a predicate prunes that still hold a file fast-glob keeps.
 *
 * @param prunes - Whether the predicate skips a directory.
 * @param kept - The files fast-glob keeps.
 * @returns Offending directories, each with the kept file it would lose.
 */
function wrongPrunes(prunes: (directory: string) => boolean, kept: Set<string>): string[] {
    return directories()
        .filter(dir => prunes(join(root, dir)))
        .flatMap(dir =>
            [...kept].filter(file => file.startsWith(`${dir}/`)).map(file => `${dir} -> ${file}`),
        );
}

describe('the shared ignore matcher against fast-glob', () => {
    it.each(PATTERNS)('leaves out the same files: %s', pattern => {
        const kept = keptByFastGlob(pattern);
        const matcher = createRootIgnoreMatcher(root, [pattern]);

        const byFastGlob = FILES.filter(file => !kept.has(file));
        const byMatcher = FILES.filter(file => matcher.ignoresFile(join(root, file)));

        expect(byMatcher).toEqual(byFastGlob);
    });

    it.each(PATTERNS)('prunes no directory that holds a kept file: %s', pattern => {
        const matcher = createRootIgnoreMatcher(root, [pattern]);

        expect(wrongPrunes(dir => matcher.coversTree(dir), keptByFastGlob(pattern))).toEqual([]);
    });

    it.each(PATTERNS)('walks the stylesheets fast-glob keeps: %s', async pattern => {
        // The walk never enters a dot directory, whatever the patterns say.
        const kept = [...keptByFastGlob(pattern)].filter(file => !file.startsWith('.'));
        const cacheDir = mkdtempSync(join(tmpdir(), 'csszyx-ignore-parity-cache-'));
        try {
            const { record } = await prepareNextStylesheetFacts({
                explicitRoot: root,
                cacheDir,
                ignore: [pattern],
            });

            expect(record.candidates.map(file => relative(root, file)).sort()).toEqual(kept.sort());
        } finally {
            rmSync(cacheDir, { recursive: true, force: true });
        }
    });
});

describe('the watcher against fast-glob', () => {
    /**
     * The predicate `next watch` hands chokidar for one pattern.
     *
     * @param pattern - The ignore pattern.
     * @returns chokidar's `ignored` option.
     */
    async function watcherPredicate(
        pattern: string,
    ): Promise<(path: string, stats?: Stats) => boolean> {
        let ignored: unknown;
        const emitter = new EventEmitter();
        const watcher = Object.assign(emitter, {
            add: () => watcher,
            close: async (): Promise<void> => {},
        }) as unknown as FSWatcher;
        const session = await startNextWatch(
            {
                root,
                cwd: root,
                parserMode: 'wasm',
                debounceMs: 10,
                silent: true,
                extraIgnore: [pattern],
            },
            {
                watch: (_paths, options) => {
                    ignored = options.ignored;
                    setTimeout(() => emitter.emit('ready'), 0);
                    return watcher;
                },
                deliveryProbeTimeoutMs: 50,
            },
        );
        await session.close();
        return ignored as (path: string, stats?: Stats) => boolean;
    }

    it.each(PATTERNS)(
        'prunes no directory that holds a kept file: %s',
        async pattern => {
            const ignored = await watcherPredicate(pattern);
            const kept = keptByFastGlob(pattern);

            // chokidar asks first with no stats, and again with them while it crawls.
            expect(wrongPrunes(dir => ignored(dir), kept)).toEqual([]);
            expect(wrongPrunes(dir => ignored(dir, statSync(dir)), kept)).toEqual([]);
        },
        60_000,
    );

    it.each(PATTERNS)(
        'leaves out the same files once it knows they are files: %s',
        async pattern => {
            const ignored = await watcherPredicate(pattern);
            const kept = keptByFastGlob(pattern);

            const byFastGlob = FILES.filter(file => !kept.has(file));
            const byWatcher = FILES.filter(file =>
                ignored(join(root, file), statSync(join(root, file))),
            );

            expect(byWatcher).toEqual(byFastGlob);
        },
        60_000,
    );
});
