import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { nextPrebuild } from '../src/commands/next-prebuild.js';
import { linkTailwind } from './link-tailwind.js';

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

/**
 * An app root that resolves Tailwind v4 the way an installed project does.
 *
 * @param css - The app's global stylesheet.
 * @returns Absolute project root.
 */
function tailwindApp(css: string): string {
    const root = realpathSync(tempRoot());
    linkTailwind(root);
    mkdirSync(join(root, 'app'), { recursive: true });
    writeFileSync(join(root, 'app/globals.css'), css, 'utf8');
    writeFileSync(join(root, 'app/page.tsx'), 'export default () => <div sz={{ p: 4 }} />;\n');
    return root;
}

describe('csszyx next-prebuild command', () => {
    it('records the stylesheet facts first and safelists the prefixed classes', async () => {
        const root = tailwindApp('@import "tailwindcss" prefix(tw);\n');
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            const code = await nextPrebuild({
                root,
                cwd: root,
                mode: 'development',
                parserMode: 'wasm',
                json: true,
            });
            expect(code).toBe(0);

            const summary = JSON.parse(logSpy.mock.calls.flat().join('\n')) as {
                safelistOutputPath: string;
            };
            expect(readFileSync(summary.safelistOutputPath, 'utf8').split('\n')).toContain(
                'tw:p-4',
            );
            expect(existsSync(join(root, '.csszyx/cache/stylesheet-facts.json'))).toBe(true);
        } finally {
            logSpy.mockRestore();
        }
    }, 60_000);

    it('reads only the stylesheets it is told the app loads', async () => {
        const root = tailwindApp('@import "tailwindcss" prefix(tw);\n');
        mkdirSync(join(root, 'legacy'), { recursive: true });
        writeFileSync(join(root, 'legacy/old.css'), '@import "tailwindcss";\n');
        // A leftover that never reaches Tailwind and no longer compiles: a warning, not a stop.
        writeFileSync(join(root, 'legacy/broken.css'), '@import "./gone.css";\n');
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            const code = await nextPrebuild({
                root,
                cwd: root,
                mode: 'development',
                parserMode: 'wasm',
                tailwindStylesheet: ['app/globals.css', 'legacy/broken.css'],
                json: true,
            });

            expect(code).toBe(0);
            expect(warnSpy.mock.calls.flat().join('\n')).toContain('legacy/broken.css');
        } finally {
            logSpy.mockRestore();
        }
    }, 60_000);

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
                parserMode: 'wasm',
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
                parserMode: 'wasm',
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
                parserMode: 'wasm',
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
