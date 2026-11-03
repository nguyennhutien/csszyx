import { afterEach, expect, it, vi } from 'vitest';
import { check } from '../src/commands/check.js';
import { removeTailwindProjects, tailwindProject } from './helpers/tailwind-project.js';

vi.mock('node:fs/promises', async original => {
    const actual = await original<typeof import('node:fs/promises')>();
    return {
        ...actual,
        readFile: (...args: Parameters<typeof actual.readFile>) => {
            if (typeof args[0] === 'string' && args[0].endsWith('Vanished.tsx'))
                return Promise.reject(new Error('ENOENT: source disappeared'));
            return actual.readFile(...args);
        },
    };
});

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
    process.exitCode = undefined;
});

it('continues auditing readable files when a scanned source disappears before reading', async () => {
    const cwd = tailwindProject({
        'src/Vanished.tsx': 'export const A = () => <div sz={{ p: 4 }} />;',
        'src/Bad.tsx': 'export const B = () => <div sz={{ nonsenseKey: 4 }} />;',
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await check({ cwd, json: true });
    const report = JSON.parse(log.mock.calls.flat().join('\n'));
    expect(
        report.findings.some((finding: { file?: string }) => finding.file?.endsWith('Bad.tsx')),
    ).toBe(true);
    expect(
        report.findings.some((finding: { file?: string }) =>
            finding.file?.endsWith('Vanished.tsx'),
        ),
    ).toBe(false);
});
