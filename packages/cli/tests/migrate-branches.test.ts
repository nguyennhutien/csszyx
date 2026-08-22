/**
 * Branch coverage for the migrate command's edge paths: empty/no-match scans,
 * the gitignore check, keys-only skipping HTML, files with no migratable
 * attribute, component-className skips, unrecognized-class overflow, audit's
 * all-recognized branch, write failures, and unresolved-marker strip corner cases.
 */
import fs, { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import readline from 'node:readline';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrate } from '../src/commands/migrate.js';

const tempDirs: string[] = [];
function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-mig-br-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

function mute(): string[] {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...p: unknown[]) => logs.push(p.join(' ')));
    vi.spyOn(console, 'info').mockImplementation((...p: unknown[]) => logs.push(p.join(' ')));
    return logs;
}

describe('migrate scan-result branches', () => {
    it('reports the generic no-files message on an empty project (default cwd path)', async () => {
        const logs = mute();
        const dir = tempRoot();
        const prev = process.cwd();
        try {
            process.chdir(dir);
            await migrate({}); // no cwd → exercises `options.cwd || process.cwd()`
        } finally {
            process.chdir(prev);
        }
        expect(logs.join('\n')).toContain('No JSX/TSX/HTML files found');
    });

    it('reports the pattern-specific no-files message when a custom pattern matches nothing', async () => {
        const logs = mute();
        const dir = tempRoot();
        writeFileSync(join(dir, 'App.tsx'), 'export const A = () => <div className="p-4" />;');
        await migrate({ cwd: dir, pattern: '**/*.nomatch' });
        expect(logs.join('\n')).toContain('No files found matching pattern');
    });

    it('does not print the .gitignore tip when .csszyx is already ignored', async () => {
        const logs = mute();
        const dir = tempRoot();
        writeFileSync(join(dir, '.gitignore'), 'node_modules\n.csszyx/\n');
        writeFileSync(join(dir, 'App.tsx'), 'export const A = () => <div className="p-4" />;');
        await migrate({ cwd: dir, dryRun: true });
        expect(logs.join('\n')).not.toContain('add .csszyx/ to your .gitignore');
    });
});

describe('migrate per-file skip branches', () => {
    it('keys-only skips HTML files and normalizes legacy sz keys in JSX', async () => {
        const logs = mute();
        const dir = tempRoot();
        writeFileSync(join(dir, 'page.html'), '<div class="p-4">x</div>');
        writeFileSync(
            join(dir, 'App.tsx'),
            "export const A = () => <span sz={{ fontWeight: 'bold', padding: 2 }} />;",
        );
        await migrate({ cwd: dir, keysOnly: true });
        const tsx = readFileSync(join(dir, 'App.tsx'), 'utf8');
        // Legacy keys normalized to canonical.
        expect(tsx).toContain('weight:');
        expect(tsx).toContain('p:');
        // HTML untouched (keys-only skips it).
        expect(readFileSync(join(dir, 'page.html'), 'utf8')).toBe('<div class="p-4">x</div>');
        expect(logs.join('\n')).toContain('legacy sz keys normalized');
    });

    it('skips files that carry neither className nor sz', async () => {
        mute();
        const dir = tempRoot();
        writeFileSync(join(dir, 'plain.tsx'), 'export const P = () => 1;');
        const before = readFileSync(join(dir, 'plain.tsx'), 'utf8');
        await migrate({ cwd: dir });
        expect(readFileSync(join(dir, 'plain.tsx'), 'utf8')).toBe(before);
    });

    it('keeps a className on a component element and counts it as a component skip', async () => {
        const logs = mute();
        const dir = tempRoot();
        writeFileSync(
            join(dir, 'Comp.tsx'),
            'export const C = () => <div className="p-4"><Card className="m-2" /></div>;',
        );
        await migrate({ cwd: dir, dryRun: true });
        expect(logs.join('\n')).toContain('kept on components');
    });
});

describe('migrate reporting overflow and audit branches', () => {
    it('truncates the unrecognized-class list past ten entries', async () => {
        const logs = mute();
        const dir = tempRoot();
        const classes = Array.from({ length: 14 }, (_, i) => `mysteryklass${i}`).join(' ');
        writeFileSync(
            join(dir, 'Many.tsx'),
            `export const M = () => <div className="p-4 ${classes}" />;`,
        );
        await migrate({ cwd: dir, dryRun: true });
        const out = logs.join('\n');
        expect(out).toContain('Unrecognized classes (14)');
        expect(out).toContain('...'); // slice(0, 10) + ellipsis
    });

    it('audit reports 100% recognition when every class is known', async () => {
        const logs = mute();
        const dir = tempRoot();
        writeFileSync(
            join(dir, 'Ok.tsx'),
            'export const O = () => <div className="p-4 m-2 flex" />;',
        );
        await migrate({ cwd: dir, audit: true });
        expect(logs.join('\n')).toContain('100% of your classes');
        expect(fs.existsSync(join(dir, '.csszyx-todo.json'))).toBe(false);
    });
});

describe('migrate write-failure branches', () => {
    it('warns but continues when a transformed file cannot be written back', async () => {
        const logs = mute();
        const dir = tempRoot();
        const target = join(dir, 'App.tsx');
        writeFileSync(target, 'export const A = () => <div className="p-4 bg-blue-500" />;');
        const real = fs.writeFileSync;
        // migrate writes to the path fast-glob found, which is spelled with
        // forward slashes on every platform; match on the file, not the
        // separator, or the spy never fires on Windows and nothing is denied.
        const isTarget = (p: string): boolean => path.resolve(p) === path.resolve(target);
        vi.spyOn(fs, 'writeFileSync').mockImplementation(((p: fs.PathOrFileDescriptor, ...rest) => {
            if (typeof p === 'string' && isTarget(p)) throw new Error('EACCES: denied');
            return (real as unknown as (...a: unknown[]) => unknown)(p, ...rest);
        }) as typeof fs.writeFileSync);
        await migrate({ cwd: dir });
        expect(logs.join('\n')).toContain('Could not write');
    });

    it('warns when the audit todo file cannot be written', async () => {
        const logs = mute();
        const dir = tempRoot();
        writeFileSync(
            join(dir, 'Custom.tsx'),
            'export const C = () => <div className="p-4 btn-brandx" />;',
        );
        const todoPath = join(dir, '.csszyx-todo.json');
        const real = fs.writeFileSync;
        vi.spyOn(fs, 'writeFileSync').mockImplementation(((p: fs.PathOrFileDescriptor, ...rest) => {
            if (typeof p === 'string' && p === todoPath) throw new Error('EACCES: denied');
            return (real as unknown as (...a: unknown[]) => unknown)(p, ...rest);
        }) as typeof fs.writeFileSync);
        await migrate({ cwd: dir, audit: true });
        expect(logs.join('\n')).toContain('Could not write');
    });
});

describe('migrate TTY prompt branch', () => {
    it('injects @sz-todo comments when the interactive prompt is answered yes', async () => {
        mute();
        const dir = tempRoot();
        writeFileSync(
            join(dir, 'App.tsx'),
            'export const A = () => <div className="p-4 total-mysteryx">x</div>;',
        );
        const originalTTY = process.stdout.isTTY;
        Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
        vi.spyOn(readline, 'createInterface').mockReturnValue({
            question: (_q: string, cb: (answer: string) => void) => cb('y'),
            close: () => {},
        } as unknown as readline.Interface);
        try {
            await migrate({ cwd: dir });
        } finally {
            Object.defineProperty(process.stdout, 'isTTY', {
                value: originalTTY,
                configurable: true,
            });
        }
        const out = readFileSync(join(dir, 'App.tsx'), 'utf8');
        expect(out).toContain('@sz-todo');
    });
});

describe('migrate @sz-todo strip corner cases', () => {
    it('strips a complete single-line todo (with trailing newline) while keeping a plain comment', async () => {
        mute();
        const dir = tempRoot();
        const file = join(dir, 'K.tsx');
        writeFileSync(
            file,
            [
                'export const K = () => (<div>',
                '{/* keep-this-comment */}',
                '{/* @sz-todo: real-note */}',
                '<span className="p-4 mysteryclassx">x</span>',
                '</div>);',
            ].join('\n'),
        );
        await migrate({ cwd: dir, audit: true });
        writeFileSync(join(dir, '.csszyx-todo.json'), JSON.stringify({ mysteryclassx: { m: 1 } }));
        await migrate({ cwd: dir, resolveTodos: '.csszyx-todo.json' });
        const out = readFileSync(file, 'utf8');
        // The complete marker with content (and its trailing newline) was removed.
        expect(out).not.toContain('real-note');
        // An ordinary comment is left untouched.
        expect(out).toContain('keep-this-comment');
        expect(out).toContain('m: 1');
    });
});
