/**
 * The test-runner transform lane.
 *
 * A bundler plugin never runs under jest, so a rendered component carries `sz`
 * as a live prop and no `className`: every styling assertion reads the object
 * the author typed rather than the classes the browser gets, and the whole
 * defect class "this `sz` compiled to nothing" is invisible to the suite.
 *
 * Two sources answer, in order. The build's own transform cache holds the
 * output the bundler produced — including the cross-module `sz` objects and
 * `szv` factories a per-file compile cannot resolve — so it is read first,
 * keyed by the file's path and the hash of its current contents. When the file
 * has changed since that build, or was never built, the per-file compiler
 * answers instead, which is right for the inline and file-local shapes.
 *
 * Either answer is finished the way the plugin finishes it: the runtime
 * helpers the code calls are imported, and a dead key or value is printed.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { VERSION as compilerVersion } from '@csszyx/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTransformer, findCachedTransform } from '../src/jest-transform.js';

const roots: string[] = [];
afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/** The fields of one entry a test may vary; the rest is what the plugin writes. */
interface EntryShape {
    filename: string;
    source: string;
    code: string;
    name?: string;
    compilerVersion?: string;
    mangleVars?: boolean;
    timestamp?: string;
    usesRuntime?: boolean;
    diagnostics?: string[];
}

/**
 * Write one entry into a cache directory, shaped as the plugin writes it.
 *
 * @param root - The cache root.
 * @param entry - What the entry records.
 */
function writeEntry(root: string, entry: EntryShape): void {
    const dir = join(root, '9c');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, entry.name ?? 'entry.json'),
        JSON.stringify({
            filename: entry.filename,
            inputSha256: createHash('sha256').update(entry.source).digest('hex'),
            compilerVersion: entry.compilerVersion ?? compilerVersion,
            mangleVars: entry.mangleVars ?? false,
            timestamp: entry.timestamp,
            result: {
                code: entry.code,
                transformed: true,
                usesRuntime: entry.usesRuntime ?? false,
                diagnostics: entry.diagnostics,
            },
        }),
    );
}

/**
 * A transform cache directory holding one entry.
 *
 * @param filename - Absolute path the entry was produced for.
 * @param source - Source the entry was produced from.
 * @param code - Compiled output to store.
 * @param extra - Further fields of the entry.
 * @returns The cache root.
 */
function cacheWith(
    filename: string,
    source: string,
    code: string,
    extra: Partial<EntryShape> = {},
): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-jest-cache-'));
    roots.push(root);
    writeEntry(root, { filename, source, code, ...extra });
    return root;
}

/**
 * Capture every `console.warn` line while running one function.
 *
 * @param run - The function to observe.
 * @returns What it returned, and what it warned.
 */
function warned<T>(run: () => T): { value: T; lines: string[] } {
    const lines: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
    });
    return { value: run(), lines };
}

describe('reading the build cache', () => {
    const FILE = '/repo/src/Card.tsx';
    const SOURCE = 'export const A = () => <div sz={cardSz} />;';
    const CODE = 'export const A = () => <div className="p-4 rounded-lg" />;';

    it('answers with the build output when the file is unchanged', () => {
        expect(findCachedTransform(cacheWith(FILE, SOURCE, CODE), FILE, SOURCE)).toBe(CODE);
    });

    // The staleness rule, and the only one this lane can enforce: the entry
    // describes a source that is no longer on disk, so it describes nothing
    // about the file under test.
    it('refuses an entry whose source has changed since the build', () => {
        const root = cacheWith(FILE, SOURCE, CODE);
        expect(findCachedTransform(root, FILE, `${SOURCE}\n// edited`)).toBeNull();
    });

    it('answers null for a file the build never saw', () => {
        expect(
            findCachedTransform(cacheWith(FILE, SOURCE, CODE), '/repo/src/Other.tsx', SOURCE),
        ).toBeNull();
    });

    it('skips an entry a half-written build left unparseable', () => {
        // The cache is written during a build that can be interrupted, and a
        // truncated file must not take the whole lookup down with it — the
        // entry beside it may be the one that answers.
        const root = cacheWith(FILE, SOURCE, CODE);
        writeFileSync(join(root, '9c', '0torn.json'), '{"filename": "/repo/src/');
        // A JSON file that is not an entry, and a neighbour that is not JSON
        // at all — the plugin's cache directory holds more than these files.
        writeFileSync(join(root, '9c', '0other.json'), '{"result": {}}');
        writeFileSync(join(root, '9c', '0notes.txt'), 'not an entry');
        expect(findCachedTransform(root, FILE, SOURCE)).toBe(CODE);
    });

    it('refuses an entry that recorded no code', () => {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-jest-cache-'));
        roots.push(root);
        mkdirSync(join(root, '9c'));
        writeFileSync(
            join(root, '9c', 'entry.json'),
            JSON.stringify({
                filename: FILE,
                inputSha256: createHash('sha256').update(SOURCE).digest('hex'),
                compilerVersion,
                result: { transformed: false },
            }),
        );
        expect(findCachedTransform(root, FILE, SOURCE)).toBeNull();
    });

    it('answers null when the cache root is a file', () => {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-jest-cache-'));
        roots.push(root);
        writeFileSync(join(root, 'transform'), 'not a directory');
        expect(findCachedTransform(join(root, 'transform'), FILE, SOURCE)).toBeNull();
    });

    it('answers null when there is no cache at all', () => {
        expect(findCachedTransform(join(tmpdir(), 'csszyx-absent-cache'), FILE, SOURCE)).toBeNull();
    });

    // The plugin keys its cache on more than the source, so one file and
    // hash can carry several entries: a dev build and a production one with
    // mangled variables, or one from the compiler before an upgrade. Directory
    // order must not decide which a test sees.
    it('refuses an entry another compiler version wrote', () => {
        const root = cacheWith(FILE, SOURCE, CODE, { compilerVersion: '0.0.1' });
        expect(findCachedTransform(root, FILE, SOURCE)).toBeNull();
    });

    it('refuses an entry written with mangled variables', () => {
        const root = cacheWith(FILE, SOURCE, CODE, { mangleVars: true });
        expect(findCachedTransform(root, FILE, SOURCE)).toBeNull();
    });

    it('takes the newest of several qualifying entries', () => {
        const root = cacheWith(FILE, SOURCE, 'older', {
            name: 'a.json',
            timestamp: '2026-01-01T00:00:00.000Z',
        });
        writeEntry(root, {
            filename: FILE,
            source: SOURCE,
            code: 'newer',
            name: 'b.json',
            timestamp: '2026-02-01T00:00:00.000Z',
        });
        writeEntry(root, {
            filename: FILE,
            source: SOURCE,
            code: 'oldest',
            name: 'c.json',
            timestamp: '2025-12-01T00:00:00.000Z',
        });
        expect(findCachedTransform(root, FILE, SOURCE)).toBe('newer');
    });

    it('keeps the first of two entries no build stamped', () => {
        const root = cacheWith(FILE, SOURCE, 'first', { name: 'a.json' });
        writeEntry(root, { filename: FILE, source: SOURCE, code: 'second', name: 'b.json' });
        expect(findCachedTransform(root, FILE, SOURCE)).toBe('first');
    });

    // The plugin records the path with forward slashes; jest hands the
    // native one. On Windows they differ, and a miss there is silent — the
    // per-file compile answers, without the cross-module output.
    it('matches a path jest spells with backslashes', () => {
        const root = cacheWith(FILE, SOURCE, CODE);
        expect(findCachedTransform(root, String.raw`\repo\src\Card.tsx`, SOURCE)).toBe(CODE);
    });
});

describe('the transformer jest calls', () => {
    /**
     * Run one file through the transformer, as jest's sync `process` hook does.
     *
     * @param source - File contents.
     * @param filename - Absolute path of the file.
     * @param cacheRoot - Transform cache directory to consult, if any.
     * @returns The code jest would execute.
     */
    function run(source: string, filename: string, cacheRoot?: string): string {
        return createTransformer({ cacheRoot }).process(source, filename).code;
    }

    it('compiles an inline sz to the class the browser gets', () => {
        const code = run(
            'export const A = () => <div sz={{ p: 4, bg: "red-500" }} />;',
            '/repo/a.tsx',
        );
        expect(code).toContain('className="p-4 bg-red-500"');
        expect(code).not.toContain('sz=');
    });

    it('compiles an sz built from a const in the same file', () => {
        const code = run(
            [
                'const card = { p: 4, rounded: "lg" };',
                'export const A = () => <div sz={card} />;',
            ].join('\n'),
            '/repo/a.tsx',
        );
        expect(code).toContain('className="p-4 rounded-lg"');
    });

    // The cache is the only source that can answer for a cross-module object,
    // so it wins over the per-file compile whenever it has a matching entry.
    it('prefers the build output over its own per-file compile', () => {
        const source = 'export const A = () => <div sz={{ p: 4 }} />;';
        const built = 'export const A = () => <div className="from-the-build" />;';
        expect(run(source, '/repo/a.tsx', cacheWith('/repo/a.tsx', source, built))).toBe(built);
    });

    // A shape the per-file compile cannot resolve keeps the runtime path,
    // which calls a helper the plugin would have imported. Without the import
    // the module throws at render, on a name that says nothing about csszyx.
    it('imports the runtime helper a forwarded sz needs', () => {
        const code = run('export const A = props => <div sz={props.sz} />;', '/repo/a.tsx');
        expect(code).toContain('className={_sz(props.sz)}');
        expect(code).toContain("import { _sz } from '@csszyx/runtime';");
    });

    it('imports the runtime helper a cached entry says it needs', () => {
        const source = 'export const A = props => <div sz={props.sz} />;';
        const built = 'export const A = props => <div className={_sz(props.sz)} />;';
        const root = cacheWith('/repo/a.tsx', source, built, { usesRuntime: true });
        expect(run(source, '/repo/a.tsx', root)).toContain(
            "import { _sz } from '@csszyx/runtime';",
        );
    });

    // A file the compiler leaves alone is returned unchanged rather than
    // dropped: the suite still runs, and the diagnostic channel is what
    // reports the reason.
    it('leaves a file whose extension it was not given alone', () => {
        // jest hands the transformer every file matching its own pattern, so
        // the extension list is what keeps csszyx off a `.css` or a `.json`.
        const transformer = createTransformer({ extensions: ['.tsx'] });
        const source = 'export const A = () => <div sz={{ p: 4 }} />;';
        expect(transformer.process(source, '/repo/src/App.jsx').code).toBe(source);
    });

    it('returns a file it cannot compile unchanged', () => {
        const source = 'export const A = 1;';
        expect(run(source, '/repo/a.ts')).toBe(source);
    });
});

describe('what the transformer reports', () => {
    // The finding this lane exists to surface. The class is in the output,
    // as it is in the browser; the line is what tells the suite's author.
    it('prints a dead value', () => {
        const { lines } = warned(() =>
            createTransformer({ cacheRoot: '/nonexistent' }).process(
                "export const A = () => <div sz={{ display: 'bogus' }} />;",
                '/repo/a.tsx',
            ),
        );
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('/repo/a.tsx');
        expect(lines[0]).toContain('"display: bogus"');
    });

    it('prints a dead value a cached entry recorded', () => {
        const source = 'export const A = () => <div sz={{ p: 4 }} />;';
        const root = cacheWith('/repo/a.tsx', source, 'built', {
            diagnostics: ['[csszyx] Unknown property "zzz" in sz prop at src/a.tsx:1.'],
        });
        const { lines } = warned(() =>
            createTransformer({ cacheRoot: root }).process(source, '/repo/a.tsx'),
        );
        expect(lines.join('\n')).toContain('Unknown property "zzz"');
    });

    // A usage nudge says the runtime path was taken where a compiled one was
    // possible. Under jest the runtime path renders the same classes, so the
    // nudge is the plugin's business, not the suite's.
    it('keeps a usage nudge out of the test log', () => {
        const { lines } = warned(() =>
            createTransformer({ cacheRoot: '/nonexistent' }).process(
                'export const A = props => <div sz={props.sz} />;',
                '/repo/a.tsx',
            ),
        );
        expect(lines).toEqual([]);
    });
});

describe('the key jest caches the output under', () => {
    const SOURCE = 'export const A = () => <div sz={cardSz} />;';

    /**
     * The cache key for one file against one transform cache.
     *
     * @param cacheRoot - Transform cache directory to consult.
     * @returns The key.
     */
    function key(cacheRoot: string): string {
        return createTransformer({ cacheRoot }).getCacheKey(SOURCE, '/repo/a.tsx', {
            configString: '{}',
        });
    }

    it('is stable for the same file and the same build', () => {
        const root = cacheWith('/repo/a.tsx', SOURCE, 'built');
        expect(key(root)).toBe(key(root));
    });

    it('accepts a call without jest options', () => {
        const transformer = createTransformer({ cacheRoot: '/nonexistent' });
        expect(transformer.getCacheKey(SOURCE, '/repo/a.tsx')).toBe(
            transformer.getCacheKey(SOURCE, '/repo/a.tsx'),
        );
    });

    it('does not consult the cache for a file it would not compile', () => {
        const root = cacheWith('/repo/a.css', SOURCE, 'built');
        const transformer = createTransformer({ cacheRoot: root });
        const key = transformer.getCacheKey(SOURCE, '/repo/a.css', { configString: '{}' });
        expect(key).toBe(
            createTransformer({ cacheRoot: '/nonexistent' }).getCacheKey(SOURCE, '/repo/a.css', {
                configString: '{}',
            }),
        );
    });

    // jest's own key covers the file and its config. A rebuild after a change
    // in another module changes this file's output without changing this
    // file, and without this jest served the previous output — silently, on
    // the very shape the cache is read for.
    it('changes when the build output for an unchanged file changes', () => {
        const before = key(cacheWith('/repo/a.tsx', SOURCE, 'built-a'));
        const after = key(cacheWith('/repo/a.tsx', SOURCE, 'built-b'));
        expect(after).not.toBe(before);
    });

    it('changes when the build has no answer any more', () => {
        const built = key(cacheWith('/repo/a.tsx', SOURCE, 'built'));
        expect(key(join(tmpdir(), 'csszyx-absent-cache'))).not.toBe(built);
    });
});

describe('the cache index', () => {
    const SOURCE = 'export const A = () => <div sz={cardSz} />;';

    // Reading every entry once per file made a suite read the cache N times
    // over. The index reads each entry once — and still finds an entry a
    // rebuild wrote after the transformer was created, as in a watch run.
    it('finds an entry written after the first lookup', () => {
        const root = cacheWith('/repo/a.tsx', SOURCE, 'first');
        const transformer = createTransformer({ cacheRoot: root });
        expect(transformer.process(SOURCE, '/repo/a.tsx').code).toBe('first');
        writeEntry(root, {
            filename: '/repo/b.tsx',
            source: SOURCE,
            code: 'second',
            name: 'b.json',
        });
        expect(transformer.process(SOURCE, '/repo/b.tsx').code).toBe('second');
    });
});

/**
 * The index re-reads a directory it saw moving, and trusts one that has settled.
 *
 * A write landing in the same clock tick as a read leaves the directory's
 * modification time unchanged, so a time this recent proves nothing and the
 * next lookup has to read again — git's index applies the same racy-timestamp
 * rule. Once the time is old enough to be trusted, an unchanged time means an
 * unchanged directory and the cached entries stand.
 *
 * Both halves are pinned by moving the directory's clock rather than waiting on
 * the real one, because a test that waits is a test that measures the machine.
 */
describe('the cache index and a directory whose time is still moving', () => {
    const FILE = '/repo/src/Card.tsx';
    const OTHER = '/repo/src/Other.tsx';
    const SOURCE = 'export const A = () => <div sz={cardSz} />;';
    const CODE = 'export const A = () => <div className="p-4" />;';
    const OTHER_CODE = 'export const B = () => <div className="m-2" />;';

    /**
     * One fixed instant, far enough back to be past the settle window.
     *
     * Fixed, not computed per call: two calls a millisecond apart leave two
     * different times, and a different time is exactly what tells the index the
     * directory changed. The point here is a time that does NOT change.
     */
    const SETTLED_AT = new Date(Date.now() - 60_000);

    /**
     * Put a directory's modification time at that instant.
     *
     * @param dir - The directory to age.
     */
    function age(dir: string): void {
        utimesSync(dir, SETTLED_AT, SETTLED_AT);
    }

    // The transformer holds ONE index across every file Jest hands it, which is
    // where the rule earns its place; `findCachedTransform` builds a fresh index
    // per call and re-reads regardless.
    it('reads again when the directory was touched a moment ago', () => {
        const root = cacheWith(FILE, SOURCE, CODE);
        const transformer = createTransformer({ cacheRoot: root });
        expect(transformer.process(SOURCE, FILE).code).toBe(CODE);

        // A second entry, written so soon after the first read that the
        // directory's time cannot distinguish them. The index has to look again.
        writeEntry(root, {
            filename: OTHER,
            source: SOURCE,
            code: OTHER_CODE,
            name: 'second.json',
        });
        expect(transformer.process(SOURCE, OTHER).code).toBe(OTHER_CODE);
    });

    it('trusts a directory whose time has settled', () => {
        const root = cacheWith(FILE, SOURCE, CODE);
        age(join(root, '9c'));
        age(root);
        const transformer = createTransformer({ cacheRoot: root });
        expect(transformer.process(SOURCE, FILE).code).toBe(CODE);

        // Written behind the index's back: the directory's time is old enough to
        // be trusted and nothing touched it, so the entry stays unseen. A build
        // that writes the cache moves that time, which is what ends the trust.
        writeEntry(root, {
            filename: OTHER,
            source: SOURCE,
            code: OTHER_CODE,
            name: 'second.json',
        });
        age(join(root, '9c'));
        age(root);
        expect(transformer.process(SOURCE, OTHER).code).not.toBe(OTHER_CODE);
    });
});

/**
 * A timestamp the plugin did not write is not a timestamp to compare.
 *
 * The field is `unknown` on the way in — the cache is a directory of JSON files
 * a previous build wrote, and nothing stops a hand-edited or half-written one
 * from carrying an object there. Stringifying that gives `[object Object]`,
 * which sorts above every real ISO date, so the newest entry loses to the
 * broken one and the transform served is the stale one.
 */
describe('picking between entries with a damaged timestamp', () => {
    const FILE = '/repo/src/Card.tsx';
    const SOURCE = 'export const A = () => <div sz={cardSz} />;';
    const OLD = 'export const A = () => <div className="p-2" />;';
    const NEW = 'export const A = () => <div className="p-4" />;';

    it('prefers a real timestamp over one that is not a string', () => {
        const root = cacheWith(FILE, SOURCE, OLD, {
            timestamp: { broken: true } as unknown as string,
            name: 'damaged.json',
        });
        writeEntry(root, {
            filename: FILE,
            source: SOURCE,
            code: NEW,
            timestamp: '2026-01-01T00:00:00.000Z',
            name: 'good.json',
        });
        expect(findCachedTransform(root, FILE, SOURCE)).toBe(NEW);
    });
});
