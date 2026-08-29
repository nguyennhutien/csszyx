/**
 * How `csszyx migrate` sends a repository to the native engine.
 *
 * One call for every file held every source and every result at once — about
 * five times the sources' size, over a gigabyte on a 20 000-file repository.
 * Files now go in runs of at most 25 files or 2 MiB, whichever fills first,
 * and each run is written before the next is read. Two things that used to
 * be free follow from that: a run that fails must not take the files around
 * it down, and the resolution map must not be serialised once per run.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrate } from '../src/commands/migrate.js';

interface RecordedCall {
    files: string[];
    bytes: number;
    customMapJson: unknown;
}

const control = vi.hoisted(() => ({
    calls: [] as Array<{ files: string[]; bytes: number; customMapJson: unknown }>,
    /** Basenames the engine refuses: any call carrying one throws. */
    refuse: new Set<string>(),
    /** Drop the last result of every call, as an engine that lost a file would. */
    truncate: false,
    /** Throw the unavailable error from the first call that carries files (the probe passes). */
    unavailableAfterProbe: false,
    /** Throw the unavailable error from a one-file call, as a retry makes. */
    unavailableOnSingle: false,
    /** Refuse with a bare string instead of an Error. */
    refuseWithString: false,
}));

vi.mock('@csszyx/compiler/migrate', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler/migrate')>();
    return {
        ...actual,
        migrateRustBatch: (...args: Parameters<typeof actual.migrateRustBatch>) => {
            const [files, options] = args;
            const names = files.map(file => file.filename.split('/').pop() ?? file.filename);
            control.calls.push({
                files: names,
                bytes: files.reduce((sum, file) => sum + file.source.length, 0),
                customMapJson: (options as { customMapJson?: unknown } | undefined)?.customMapJson,
            });
            const unavailable = () =>
                new actual.RustMigrateUnavailableError('the engine went away mid-run');
            if (control.unavailableAfterProbe && files.length > 0) throw unavailable();
            if (control.unavailableOnSingle && files.length === 1) throw unavailable();
            if (names.some(name => control.refuse.has(name))) {
                if (control.refuseWithString) throw 'refused, as a string';
                throw new Error('the engine refused this source');
            }
            const results = actual.migrateRustBatch(...args);
            return control.truncate ? results.slice(0, -1) : results;
        },
    };
});

const tempDirs: string[] = [];
const COMPONENT = (name: string, filler = '') =>
    `export const ${name} = () => <div className="p-4 btn">${filler}</div>;\n`;

/**
 * @param files - Basename to source.
 * @returns A project directory holding them under `src/`.
 */
function fixture(files: Record<string, string>): string {
    const cwd = mkdtempSync(join(tmpdir(), 'csszyx-migrate-chunk-'));
    tempDirs.push(cwd);
    mkdirSync(join(cwd, 'src'));
    for (const [name, source] of Object.entries(files))
        writeFileSync(join(cwd, 'src', name), source);
    return cwd;
}

/** @returns Everything the command printed through console.log. */
function mute(): string[] {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        logs.push(parts.join(' '));
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    return logs;
}

/**
 * @returns Calls that reached the engine, excluding the empty availability probe.
 */
function engineCalls(): RecordedCall[] {
    return control.calls.filter(call => call.files.length > 0);
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    control.calls.length = 0;
    control.refuse.clear();
    control.truncate = false;
    control.unavailableAfterProbe = false;
    control.unavailableOnSingle = false;
    control.refuseWithString = false;
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

describe('how many files one engine call carries', () => {
    it('sends at most 25 files per call and every file exactly once', async () => {
        const files: Record<string, string> = {};
        for (let index = 0; index < 60; index++)
            files[`C${String(index).padStart(2, '0')}.tsx`] = COMPONENT(`C${index}`);
        mute();

        await migrate({ cwd: fixture(files), dryRun: true });

        const calls = engineCalls();
        expect(calls.length).toBeGreaterThanOrEqual(3);
        for (const call of calls) expect(call.files.length).toBeLessThanOrEqual(25);
        expect(calls.flatMap(call => call.files).sort()).toEqual(Object.keys(files).sort());
    });

    it('closes a call at 2 MiB even when it holds only a few files', async () => {
        // Three 1.2 MiB files: the second one tips the run over 2 MiB, so the
        // third starts a run of its own.
        const big = COMPONENT('Big', 'x'.repeat(1.2 * 1024 * 1024));
        mute();

        await migrate({ cwd: fixture({ 'A.tsx': big, 'B.tsx': big, 'C.tsx': big }), dryRun: true });

        const sizes = engineCalls().map(call => call.files.length);
        expect(sizes).toEqual([2, 1]);
        expect(
            engineCalls()
                .flatMap(call => call.files)
                .sort(),
        ).toEqual(['A.tsx', 'B.tsx', 'C.tsx']);
    });

    it('keeps an HTML file in its place: the run before it is sent first', async () => {
        mute();

        await migrate({
            cwd: fixture({
                'a.tsx': COMPONENT('A'),
                'b.html': '<html><body><div class="p-4"></div></body></html>',
                'c.tsx': COMPONENT('C'),
            }),
            dryRun: true,
        });

        // The two JSX files are never in one call: the HTML file between them
        // flushed the first before the second was read.
        expect(engineCalls().map(call => call.files)).toEqual([['a.tsx'], ['c.tsx']]);
    });
});

describe('a file the engine refuses', () => {
    it('is named and skipped while every other file in its run still migrates', async () => {
        const files: Record<string, string> = {};
        for (let index = 0; index < 30; index++)
            files[`C${String(index).padStart(2, '0')}.tsx`] = COMPONENT(`C${index}`);
        files['Bad.tsx'] = COMPONENT('Bad');
        control.refuse.add('Bad.tsx');
        const logs = mute();
        const cwd = fixture(files);

        await migrate({ cwd });

        expect(readFileSync(join(cwd, 'src/Bad.tsx'), 'utf8')).toContain('className="p-4 btn"');
        for (const name of Object.keys(files)) {
            if (name === 'Bad.tsx') continue;
            expect(readFileSync(join(cwd, 'src', name), 'utf8'), name).not.toContain(
                'className="p-4 btn"',
            );
        }
        expect(logs.join('\n')).toMatch(/Could not migrate .*Bad\.tsx.*refused/);
        expect(process.exitCode).toBe(1);
    });

    it('does not turn a refused run into a refused repository', async () => {
        // The run that carried Bad.tsx failed as a whole; the retry that
        // follows sends the others on their own, so the engine sees every
        // good file in a call without the bad one.
        const files: Record<string, string> = {};
        for (let index = 0; index < 5; index++) files[`C${index}.tsx`] = COMPONENT(`C${index}`);
        files['Bad.tsx'] = COMPONENT('Bad');
        control.refuse.add('Bad.tsx');
        mute();

        await migrate({ cwd: fixture(files), dryRun: true });

        const soloGood = engineCalls().filter(
            call => call.files.length === 1 && call.files[0] !== 'Bad.tsx',
        );
        expect(soloGood.map(call => call.files[0]).sort()).toEqual([
            'C0.tsx',
            'C1.tsx',
            'C2.tsx',
            'C3.tsx',
            'C4.tsx',
        ]);
    });
});

describe('an engine that becomes unavailable after the probe let the run start', () => {
    // Nothing behind it either way: the message is printed, the command exits
    // non-zero, and no file is touched, exactly as when the probe catches it.
    it('stops the command from a run', async () => {
        control.unavailableAfterProbe = true;
        const logs = mute();
        const cwd = fixture({ 'A.tsx': COMPONENT('A') });

        await migrate({ cwd });

        expect(readFileSync(join(cwd, 'src/A.tsx'), 'utf8')).toContain('className="p-4 btn"');
        expect(logs.join('\n')).toContain('went away mid-run');
        expect(process.exitCode).toBe(1);
    });

    it('stops the command from a one-file retry', async () => {
        control.refuse.add('Bad.tsx');
        control.unavailableOnSingle = true;
        const logs = mute();
        const cwd = fixture({ 'A.tsx': COMPONENT('A'), 'Bad.tsx': COMPONENT('Bad') });

        await migrate({ cwd });

        expect(logs.join('\n')).toContain('went away mid-run');
        expect(process.exitCode).toBe(1);
    });
});

describe('an engine that refuses with something that is not an Error', () => {
    it('still names the file and quotes what it threw', async () => {
        control.refuse.add('Bad.tsx');
        control.refuseWithString = true;
        const logs = mute();

        await migrate({ cwd: fixture({ 'Bad.tsx': COMPONENT('Bad') }), dryRun: true });

        expect(logs.join('\n')).toMatch(/Could not migrate .*Bad\.tsx.*refused, as a string/);
        expect(process.exitCode).toBe(1);
    });
});

describe('an engine that answers a run with fewer results than files', () => {
    it('names the file without a result instead of shifting the others', async () => {
        const files: Record<string, string> = {};
        for (let index = 0; index < 5; index++) files[`C${index}.tsx`] = COMPONENT(`C${index}`);
        control.truncate = true;
        const logs = mute();
        const cwd = fixture(files);

        await migrate({ cwd });

        const untouched = Object.keys(files).filter(name =>
            readFileSync(join(cwd, 'src', name), 'utf8').includes('className="p-4 btn"'),
        );
        expect(untouched).toHaveLength(1);
        expect(logs.join('\n')).toMatch(/Could not migrate .*returned no result/);
        expect(process.exitCode).toBe(1);
    });

    it('holds for a file retried on its own', async () => {
        // The run is refused, the retry sends each file alone, and an empty
        // answer to a one-file call is the same missing result.
        control.refuse.add('Bad.tsx');
        control.truncate = true;
        const logs = mute();

        await migrate({
            cwd: fixture({ 'A.tsx': COMPONENT('A'), 'Bad.tsx': COMPONENT('Bad') }),
            dryRun: true,
        });

        expect(logs.join('\n')).toMatch(/Could not migrate .*A\.tsx.*returned no result/);
        expect(logs.join('\n')).toMatch(/Could not migrate .*Bad\.tsx.*refused/);
        expect(process.exitCode).toBe(1);
    });
});

describe('the resolution map', () => {
    it('is serialised once for the whole run, not once per call', async () => {
        const files: Record<string, string> = {};
        for (let index = 0; index < 30; index++)
            files[`C${String(index).padStart(2, '0')}.tsx`] = COMPONENT(`C${index}`);
        const cwd = fixture(files);
        writeFileSync(join(cwd, 'map.json'), JSON.stringify({ btn: { p: 8 } }));
        mute();

        await migrate({ cwd, dryRun: true, resolveTodos: 'map.json' });

        const calls = engineCalls();
        expect(calls.length).toBeGreaterThanOrEqual(2);
        const [first] = calls;
        expect(typeof first?.customMapJson).toBe('string');
        for (const call of calls) expect(call.customMapJson).toBe(first?.customMapJson);
    });
});
