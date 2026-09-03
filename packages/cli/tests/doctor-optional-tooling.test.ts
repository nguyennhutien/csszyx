/**
 * `doctor` reports whether `generate-types` can run, and never counts the
 * answer as an issue: Tailwind v3 is an optional peer that most projects are
 * right not to have, and a `doctor` run in CI must stay green over it.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const availability = vi.hoisted(() => ({
    resolveTailwindV3: vi.fn<() => Promise<{ version: string }>>(),
}));

vi.mock('../src/scanner/tailwind-availability.js', () => ({
    resolveTailwindV3: availability.resolveTailwindV3,
}));

import { doctor } from '../src/commands/doctor.js';

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    availability.resolveTailwindV3.mockReset();
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A project directory with a package.json that declares csszyx and Tailwind,
 * so the only thing that varies between tests is the optional-tooling line.
 *
 * @returns The directory.
 */
function healthyProject(): string {
    const cwd = mkdtempSync(join(tmpdir(), 'csszyx-doctor-tooling-'));
    roots.push(cwd);
    writeFileSync(join(cwd, 'csszyx.config.ts'), 'export default {};');
    writeFileSync(
        join(cwd, 'package.json'),
        JSON.stringify({ devDependencies: { tailwindcss: '^4', csszyx: '^0.15' } }),
    );
    return cwd;
}

/**
 * Run doctor and return everything it printed.
 *
 * @param cwd - Project directory.
 * @param verbose - The `--verbose` flag.
 * @returns The joined log.
 */
async function run(cwd: string, verbose = false): Promise<string> {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        logs.push(parts.join(' '));
    });
    await doctor({ cwd, verbose });
    return logs.join('\n');
}

describe('doctor: optional tooling', () => {
    it('says generate-types is available with the v3 version', async () => {
        availability.resolveTailwindV3.mockResolvedValue({ version: '3.4.19' });
        const output = await run(healthyProject());
        expect(output).toContain('generate-types available (tailwindcss 3.4.19)');
    });

    it('reports an absent peer as information, not as an issue', async () => {
        availability.resolveTailwindV3.mockRejectedValue(
            new Error('generate-types needs Tailwind CSS v3, and this project has none installed.'),
        );
        const output = await run(healthyProject(), true);
        expect(output).toContain('generate-types unavailable — tailwindcss v3 is an optional peer');
        expect(output).toContain('only if you need csszyx generate-types');
        // The build-output section can add its own issue; the tooling line never does.
        expect(output).not.toContain('Tailwind CSS not found');
    });

    it('reports a non-Error rejection without crashing', async () => {
        availability.resolveTailwindV3.mockRejectedValue('nope');
        const output = await run(healthyProject());
        expect(output).toContain('generate-types unavailable');
        expect(output).toContain('(unknown version)');
    });

    it('does not print the install hint unless asked', async () => {
        availability.resolveTailwindV3.mockRejectedValue(
            new Error('generate-types needs Tailwind CSS v3, and this project has none installed.'),
        );
        const output = await run(healthyProject(), false);
        expect(output).not.toContain('only if you need csszyx generate-types');
    });

    it('names the installed version when it is not v3', async () => {
        availability.resolveTailwindV3.mockRejectedValue(
            new Error('generate-types needs Tailwind CSS v3, and this project has 4.3.3.'),
        );
        const output = await run(healthyProject());
        expect(output).toContain('tailwindcss 4.3.3 has no JavaScript config to read');
    });
});
