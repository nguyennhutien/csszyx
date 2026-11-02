/**
 * Engine-boundary edges of `csszyx check`.
 *
 * The scan runs the real engine over every file, so two things must hold that
 * the happy-path suite never exercises: a fallback whose classes were still
 * collected is the build log's note, not a check finding, while one whose
 * classes were never collected is; and a file the engine cannot process at
 * all is named and fails the run, without stopping the scan of the rest.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CsszyxError } from '@csszyx/compiler/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { check } from '../src/commands/check.js';

/** Codes an engine throws when it cannot run at all, on any file. */
const ENGINE_DOWN_CODES = [
    'engine-version-skew',
    'native-engine-unavailable',
    'wasm-engine-unavailable',
] as const;

vi.mock('@csszyx/compiler/engine', async importActual => {
    const actual = await importActual<typeof import('@csszyx/compiler/engine')>();
    return {
        ...actual,
        transformSource: (
            source: string,
            options?: Parameters<typeof actual.transformSource>[1],
        ) => {
            const file = options?.filename;
            const down = ENGINE_DOWN_CODES.find(code => file?.includes(`down-${code}`));
            if (down !== undefined) {
                throw new CsszyxError({
                    code: down,
                    args: {},
                    message: `[csszyx] ${down}: the engine cannot run here.`,
                });
            }
            if (file?.includes('ThrowsText')) {
                // A binding can throw something that is not an Error.
                throw 'binding gave up\nwith a second line';
            }
            if (file?.includes('Explodes')) {
                throw new Error('engine rejected this module');
            }
            if (file?.includes('Cached')) {
                // A result cached before the engine reported codes has no issues.
                const result = actual.transformSource(source, options);
                return { ...result, issues: undefined };
            }
            return actual.transformSource(source, options);
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
        expect(process.exitCode).toBe(1);
    });

    it('names a file the engine throws on and fails, even when nothing else is wrong', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cwd = projectWith({
            'src/Explodes.tsx': 'export const E = () => <div sz={{ p: 4 }} />;',
            'src/Fine.tsx': 'export const F = () => <div sz={{ p: 2 }} />;',
        });

        await check({ cwd });

        const printed = [log, warn]
            .flatMap(spy => spy.mock.calls.map(call => call.join(' ')))
            .join('\n');
        expect(printed).toContain('src/Explodes.tsx: engine rejected this module');
        expect(printed).toContain('1 file(s) were not checked');
        expect(printed).not.toContain('Fine.tsx');
        expect(process.exitCode).toBe(1);
    });

    it.each(ENGINE_DOWN_CODES)(
        'stops and fails when the engine cannot run (%s), not reporting a clean project',
        async code => {
            const log = vi.spyOn(console, 'log').mockImplementation(() => {});
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const error = vi.spyOn(console, 'error').mockImplementation(() => {});
            const cwd = projectWith({
                [`src/down-${code}.tsx`]: 'export const D = () => <div sz={{ pading: 4 }} />;',
            });

            await check({ cwd });

            const printed = [log, warn, error]
                .flatMap(spy => spy.mock.calls.map(call => call.join(' ')))
                .join('\n');
            expect(printed).toContain(`[csszyx] ${code}:`);
            expect(printed).toContain('no file was checked');
            expect(printed).not.toContain('No sz issues');
            expect(process.exitCode).toBe(1);
        },
    );

    it('writes no JSON report when the engine cannot run', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const cwd = projectWith({
            'src/down-engine-version-skew.tsx': 'export const D = () => <div sz={{ p: 4 }} />;',
        });

        await check({ cwd, json: true });

        expect(log).not.toHaveBeenCalled();
        // The reason goes to stderr, so a run with stdout piped still says why.
        const printed = error.mock.calls.map(call => call.join(' ')).join('\n');
        expect(printed).toContain('[csszyx] engine-version-skew:');
        expect(printed).toContain('no file was checked');
        expect(process.exitCode).toBe(1);
    });

    it('names a file whose engine threw something other than an Error, by its first line', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const log = vi.mocked(console.log);
        const cwd = projectWith({
            'src/ThrowsText.tsx': 'export const T = () => <div sz={{ p: 4 }} />;',
        });

        await check({ cwd });

        const printed = [log, warn, info]
            .flatMap(spy => spy.mock.calls.map(call => call.join(' ')))
            .join('\n');
        expect(printed).toContain('src/ThrowsText.tsx: binding gave up');
        expect(printed).not.toContain('with a second line');
        expect(process.exitCode).toBe(1);
    });
});
