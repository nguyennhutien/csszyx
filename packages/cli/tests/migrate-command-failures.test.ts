/**
 * What `csszyx migrate` does when the job cannot be done as asked.
 *
 * Migrate reads every candidate file before it migrates any and asks the
 * engine once, so a single file the process cannot open is in a position to
 * cost the whole run rather than itself. And an install with no engine has
 * nothing to fall back to, so the sentence naming the package to add is the
 * only help there is — worth nothing if it arrives as a stack trace.
 *
 * The command already fails soft when the glob scan throws. These hold the
 * same bar for the two failures a user is most likely to meet.
 */
import fs, { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrate } from '../src/commands/migrate.js';

const control = vi.hoisted(() => ({ unavailable: false, other: false }));

vi.mock('@csszyx/compiler/migrate', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler/migrate')>();
    return {
        ...actual,
        migrateRustBatch: (...args: Parameters<typeof actual.migrateRustBatch>) => {
            // Standing in for a platform with no `@csszyx/core-<platform>`
            // package. The real thing cannot be reached on a machine that has
            // one, and this is the branch a user on an uncovered platform
            // takes on their first run.
            if (control.unavailable) {
                throw new actual.RustMigrateUnavailableError(
                    'install the optional package for this platform: @csszyx/core-sunos-x64.',
                );
            }
            if (control.other) throw new Error('the engine refused the resolution map');
            return actual.migrateRustBatch(...args);
        },
    };
});

const tempDirs: string[] = [];

/**
 * A project with two migratable files, so "the run stopped" is visible as
 * files left alone rather than as a count.
 *
 * @returns The project directory.
 */
function fixture(): string {
    const cwd = mkdtempSync(join(tmpdir(), 'csszyx-migrate-fail-'));
    tempDirs.push(cwd);
    mkdirSync(join(cwd, 'src'));
    writeFileSync(
        join(cwd, 'src/Alpha.tsx'),
        'export const Alpha = () => <div className="p-4">a</div>;\n',
    );
    writeFileSync(
        join(cwd, 'src/Beta.tsx'),
        'export const Beta = () => <div className="m-2">b</div>;\n',
    );
    return cwd;
}

/**
 * @returns The lines the command printed, all of which go through console.log.
 */
function mute(): string[] {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        logs.push(parts.join(' '));
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    return logs;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    control.unavailable = false;
    control.other = false;
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

describe('an install with no native engine', () => {
    it('says which package to install instead of throwing at the caller', async () => {
        control.unavailable = true;
        const logs = mute();
        const cwd = fixture();

        await expect(migrate({ cwd })).resolves.toBeUndefined();

        const printed = logs.join('\n');
        expect(printed).toContain('native engine unavailable');
        expect(printed).toContain('@csszyx/core-sunos-x64');
        // The message is the whole value of this path; a stack frame in the
        // output means the crash dump came back.
        expect(printed).not.toContain('at migrateRustBatch');
    });

    it('exits non-zero, so a script does not read the stop as a clean run', async () => {
        control.unavailable = true;
        mute();

        await migrate({ cwd: fixture() });

        expect(process.exitCode).toBe(1);
    });

    it('does not swallow an engine failure that is something else', async () => {
        // The guard exists for the one failure migrate can explain. Anything
        // else reaching it quietly would turn a real fault into a clean run.
        control.other = true;
        mute();

        await expect(migrate({ cwd: fixture() })).rejects.toThrow('refused the resolution map');
    });

    it('leaves every file exactly as it found it', async () => {
        control.unavailable = true;
        mute();
        const cwd = fixture();

        await migrate({ cwd });

        expect(readFileSync(join(cwd, 'src/Alpha.tsx'), 'utf8')).toContain('className="p-4"');
        expect(readFileSync(join(cwd, 'src/Beta.tsx'), 'utf8')).toContain('className="m-2"');
    });
});

describe('one file the process cannot read', () => {
    /**
     * Fail the read of one path and let every other read through.
     *
     * Spied rather than made unreadable on disk: `chmod 000` does not stop
     * root, and the container this suite also runs in is root, so the
     * permission itself would be a no-op there while passing on a laptop.
     *
     * @param endsWith - The path suffix to refuse.
     */
    function refuseReadOf(endsWith: string): void {
        const real = fs.readFileSync;
        vi.spyOn(fs, 'readFileSync').mockImplementation(((
            path: fs.PathOrFileDescriptor,
            options,
        ) => {
            if (String(path).endsWith(endsWith)) {
                const error: NodeJS.ErrnoException = new Error(
                    `EACCES: permission denied, open '${String(path)}'`,
                );
                error.code = 'EACCES';
                throw error;
            }
            return real(path, options);
        }) as typeof fs.readFileSync);
    }

    it('migrates every other file rather than losing the whole run', async () => {
        const logs = mute();
        const cwd = fixture();
        refuseReadOf('Beta.tsx');

        await expect(migrate({ cwd })).resolves.toBeUndefined();

        expect(readFileSync(join(cwd, 'src/Alpha.tsx'), 'utf8')).toContain('sz={{');
        expect(logs.join('\n')).not.toContain('at ');
    });

    it('names the file it skipped and why', async () => {
        const logs = mute();
        const cwd = fixture();
        refuseReadOf('Beta.tsx');

        await migrate({ cwd });

        const printed = logs.join('\n');
        expect(printed).toContain('Beta.tsx');
        expect(printed).toContain('EACCES');
    });
});
