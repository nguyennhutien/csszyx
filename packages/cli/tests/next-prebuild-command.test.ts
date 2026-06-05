import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { nextPrebuild } from '../src/commands/next-prebuild.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-cli-prebuild-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"app","private":true}\n', 'utf8');
    return dir;
}

describe('csszyx next-prebuild command', () => {
    it('resolves a glob, writes shards, and prints a JSON summary', async () => {
        const root = tempRoot();
        writeFileSync(
            join(root, 'src/App.tsx'),
            'export const App=()=> <div sz={{ p: 4, bg: "emerald-500" }} />;',
        );
        writeFileSync(join(root, 'src/Card.tsx'), 'export const Card=()=> <div sz={{ m: 2 }} />;');

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            const code = await nextPrebuild({
                root,
                cwd: root,
                mode: 'production',
                parserMode: 'babel',
                json: true,
            });
            expect(code).toBe(0);

            const printed = logSpy.mock.calls.flat().join('\n');
            const summary = JSON.parse(printed) as {
                ok: boolean;
                scannedCount: number;
                transformedCount: number;
                sourceCount: number;
                classCount: number;
                manifestPath: string;
                safelistOutputPath: string;
            };
            expect(summary.ok).toBe(true);
            expect(summary.scannedCount).toBe(2);
            expect(summary.transformedCount).toBe(2);
            expect(summary.sourceCount).toBe(2);
            expect(summary.classCount).toBeGreaterThanOrEqual(3);
            expect(existsSync(summary.manifestPath)).toBe(true);
            expect(readFileSync(summary.safelistOutputPath, 'utf8')).toContain('p-4');
        } finally {
            logSpy.mockRestore();
        }
    });

    it('discovers a root-level Next app directory by default', async () => {
        const root = tempRoot();
        mkdirSync(join(root, 'app'), { recursive: true });
        writeFileSync(
            join(root, 'app/page.tsx'),
            'export default function Page(){return <main sz={{ p: 6 }} />;}',
        );

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            const code = await nextPrebuild({
                root,
                cwd: root,
                mode: 'development',
                parserMode: 'babel',
                json: true,
            });
            expect(code).toBe(0);
            const printed = logSpy.mock.calls.flat().join('\n');
            const summary = JSON.parse(printed) as {
                scannedCount: number;
                safelistOutputPath: string;
            };
            expect(summary.scannedCount).toBe(1);
            expect(readFileSync(summary.safelistOutputPath, 'utf8')).toContain('p-6');
        } finally {
            logSpy.mockRestore();
        }
    });

    it('exits non-zero with reason when the pattern matches no files', async () => {
        const root = tempRoot();
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            const code = await nextPrebuild({
                root,
                cwd: root,
                pattern: 'src/**/*.does-not-exist',
                json: true,
            });
            expect(code).toBe(1);
            const printed = logSpy.mock.calls.flat().join('\n');
            const summary = JSON.parse(printed) as { ok: boolean; reason: string };
            expect(summary.ok).toBe(false);
            expect(summary.reason).toBe('no-files-matched');
        } finally {
            logSpy.mockRestore();
        }
    });

    it('honors --ignore patterns when resolving files', async () => {
        const root = tempRoot();
        writeFileSync(join(root, 'src/App.tsx'), 'export const App=()=> <div sz={{ p: 4 }} />;');
        mkdirSync(join(root, 'src/__skip__'), { recursive: true });
        writeFileSync(
            join(root, 'src/__skip__/Skipped.tsx'),
            'export const S=()=> <div sz={{ p: 99 }} />;',
        );

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            const code = await nextPrebuild({
                root,
                cwd: root,
                mode: 'production',
                parserMode: 'babel',
                json: true,
                extraIgnore: ['**/__skip__/**'],
            });
            expect(code).toBe(0);
            const printed = logSpy.mock.calls.flat().join('\n');
            const summary = JSON.parse(printed) as {
                scannedCount: number;
                safelistOutputPath: string;
            };
            expect(summary.scannedCount).toBe(1);
            expect(readFileSync(summary.safelistOutputPath, 'utf8')).toContain('p-4');
            expect(readFileSync(summary.safelistOutputPath, 'utf8')).not.toContain('p-99');
        } finally {
            logSpy.mockRestore();
        }
    });

    it('rejects invalid mode values with a JSON error', async () => {
        const root = tempRoot();
        writeFileSync(join(root, 'src/App.tsx'), 'export const App=()=> <div />;');
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            const code = await nextPrebuild({
                root,
                cwd: root,
                mode: 'staging' as 'production',
                json: true,
            });
            expect(code).toBe(1);
            const printed = logSpy.mock.calls.flat().join('\n');
            const summary = JSON.parse(printed) as { ok: boolean; reason: string };
            expect(summary.ok).toBe(false);
            expect(summary.reason).toContain('Invalid --mode');
        } finally {
            logSpy.mockRestore();
        }
    });

    it('rejects invalid parser mode values with a JSON error', async () => {
        const root = tempRoot();
        writeFileSync(join(root, 'src/App.tsx'), 'export const App=()=> <div />;');
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            const code = await nextPrebuild({
                root,
                cwd: root,
                parserMode: 'swc' as 'rust',
                json: true,
            });
            expect(code).toBe(1);
            const printed = logSpy.mock.calls.flat().join('\n');
            const summary = JSON.parse(printed) as { ok: boolean; reason: string };
            expect(summary.ok).toBe(false);
            expect(summary.reason).toContain('Invalid --parser-mode');
        } finally {
            logSpy.mockRestore();
        }
    });
});
