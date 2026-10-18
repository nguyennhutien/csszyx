/**
 * Engine-boundary edges of `csszyx check`.
 *
 * The scan runs the real engine over every file, so two things must hold that
 * the happy-path suite never exercises: a fallback whose classes were still
 * collected is the build log's note, not a check finding, while one whose
 * classes were never collected is; and a file the engine cannot process at
 * all must be skipped rather than abort the whole project scan.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { check } from '../src/commands/check.js';

vi.mock('@csszyx/compiler/engine', async importActual => {
    const actual = await importActual<typeof import('@csszyx/compiler/engine')>();
    return {
        ...actual,
        transformSource: (source: string, file?: string, options?: unknown) => {
            if (file?.includes('Explodes')) {
                throw new Error('engine rejected this module');
            }
            if (file?.includes('Cached')) {
                // A result cached before the engine reported codes has no issues.
                const result = actual.transformSource(
                    source,
                    file,
                    options as Parameters<typeof actual.transformSource>[2],
                );
                return { ...result, issues: undefined };
            }
            return actual.transformSource(
                source,
                file,
                options as Parameters<typeof actual.transformSource>[2],
            );
        },
    };
});

const dirs: string[] = [];

function projectWith(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-cli-check-edge-'));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
        const full = join(dir, rel);
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, content);
    }
    return dir;
}

afterEach(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

describe('csszyx check engine edges', () => {
    it('leaves a fallback whose classes were collected to the build log', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        // A forwarded prop is `fallback-nudge`: the caller's literal is
        // collected where the caller writes it.
        const cwd = projectWith({
            'src/Fallback.tsx': 'export const C = ({ s }) => <div sz={s} />;',
        });

        await check({ cwd, json: true });

        const { findings } = JSON.parse(log.mock.calls.flat().join('\n'));
        expect(
            findings.filter((finding: { rule: string }) => finding.rule === 'sz-diagnostic'),
        ).toEqual([]);
        expect(process.exitCode).not.toBe(1);
    });

    it('lists a fallback whose classes were never collected, and fails on it', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        // A variant key holding a runtime value: nothing collects what it holds,
        // so its classes get no CSS.
        const cwd = projectWith({
            'src/Variant.tsx': 'export const C = ({ h }) => <div sz={{ p: 4, hover: h }} />;',
        });

        await check({ cwd, json: true });

        const { findings } = JSON.parse(log.mock.calls.flat().join('\n'));
        expect(findings).toContainEqual(
            expect.objectContaining({
                rule: 'sz-diagnostic',
                kind: 'fallback-missing-css',
                file: 'src/Variant.tsx',
                level: 'error',
                args: expect.objectContaining({ site: 'sz-variant-key', keyPath: 'hover' }),
            }),
        );
        expect(process.exitCode).toBe(1);
    });

    it('lists a file it could not parse once, by its first syntax error', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        // The build log names every syntax error; a broken file is one finding.
        const cwd = projectWith({
            'src/Broken.tsx':
                'export const A = ({ c }) => <div sz={{ p: c ? 4 : 2 }} />;\nreturn 1;\nreturn 2;',
        });

        await check({ cwd, json: true });

        const { findings } = JSON.parse(log.mock.calls.flat().join('\n'));
        const parseErrors = findings.filter(
            (finding: { kind: string }) => finding.kind === 'parse-error',
        );
        expect(parseErrors).toHaveLength(1);
        expect(parseErrors[0]).toMatchObject({
            line: 2,
            column: 1,
            args: {
                form: 'syntax',
                message: "A 'return' statement can only be used within a function body.",
            },
        });
    });

    it('reads a result without issues as a file with no findings', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = projectWith({
            'src/Cached.tsx': 'export const C = () => <div sz={{ pading: 4 }} />;',
        });

        await check({ cwd, json: true });

        const { findings } = JSON.parse(log.mock.calls.flat().join('\n'));
        expect(
            findings.filter((finding: { rule: string }) => finding.rule === 'sz-diagnostic'),
        ).toEqual([]);
    });

    it('skips a file the engine throws on and still checks the rest', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = projectWith({
            'src/Explodes.tsx': 'export const E = () => <div sz={{ p: 4 }} />;',
            'src/Bad.tsx': 'export const Bad = () => <div sz={{ pading: 4 }} />;',
        });

        await check({ cwd });

        const reported = log.mock.calls.map(call => call.join(' ')).join('\n');
        expect(reported).toContain('pading');
        expect(reported).not.toContain('Explodes');
        expect(process.exitCode).toBe(1);
    });
});
