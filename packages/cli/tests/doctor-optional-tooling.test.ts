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
    tailwindLoaderFor: vi.fn(() => ({})),
}));

vi.mock('../src/scanner/tailwind-availability.js', () => ({
    resolveTailwindV3: availability.resolveTailwindV3,
    tailwindLoaderFor: availability.tailwindLoaderFor,
}));

import { doctor } from '../src/commands/doctor.js';

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    availability.resolveTailwindV3.mockReset();
    availability.tailwindLoaderFor.mockClear();
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
 * What `resolveTailwindV3` throws for one install state.
 *
 * @param state - The install state.
 * @param fields - What the state carries.
 * @param fields.version - The installed version.
 * @param fields.reason - What loading the entry threw.
 * @returns The rejection, shaped as the helper shapes it.
 */
function unavailable(
    state: 'absent' | 'wrong-major' | 'broken',
    fields: { version?: string; reason?: string } = {},
): Error {
    return Object.assign(new Error(`generate-types needs Tailwind CSS v3 (${state}).`), {
        state,
        ...fields,
    });
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
        availability.resolveTailwindV3.mockRejectedValue(unavailable('absent'));
        const output = await run(healthyProject(), true);
        expect(output).toContain('generate-types unavailable — tailwindcss v3 is an optional peer');
        expect(output).toContain('only if you need csszyx generate-types');
        // The build-output section can add its own issue; the tooling line never does.
        expect(output).not.toContain('Tailwind CSS not found');
    });

    // A rejection the helper did not classify carries no diagnosis, so none
    // is invented for it: the line repeats what was thrown.
    it('reports a non-Error rejection without crashing or diagnosing it', async () => {
        availability.resolveTailwindV3.mockRejectedValue('nope');
        const output = await run(healthyProject());
        expect(output).toContain('generate-types unavailable — nope');
        expect(output).not.toContain('Not needed on v4');
    });

    it('repeats an unclassified Error as thrown, without a diagnosis', async () => {
        availability.resolveTailwindV3.mockRejectedValue(new Error('EACCES: permission denied'));
        const output = await run(healthyProject());
        expect(output).toContain('generate-types unavailable — EACCES: permission denied');
        expect(output).not.toContain('Not needed on v4');
    });

    it('does not print the install hint unless asked', async () => {
        availability.resolveTailwindV3.mockRejectedValue(unavailable('absent'));
        const output = await run(healthyProject(), false);
        expect(output).not.toContain('only if you need csszyx generate-types');
    });

    it('names the installed version when it is not v3', async () => {
        availability.resolveTailwindV3.mockRejectedValue(
            unavailable('wrong-major', { version: '4.3.3' }),
        );
        const output = await run(healthyProject());
        expect(availability.tailwindLoaderFor).toHaveBeenCalledWith(expect.any(String), false);
        expect(output).toContain('tailwindcss 4.3.3 has no JavaScript config to read');
    });

    // A v3 whose entry does not load is a broken install, not a v4 project:
    // the helper names the version, the failure and the reinstall, and the
    // line keeps all three rather than reading as "nothing to do here".
    it('reports a v3 whose entry did not load as broken, with the reinstall', async () => {
        availability.resolveTailwindV3.mockRejectedValue(
            unavailable('broken', { version: '3.4.19', reason: 'Unexpected end of input' }),
        );
        const output = await run(healthyProject());
        expect(output).toContain(
            'tailwindcss 3.4.19 is installed but its resolveConfig entry did not load: ' +
                'Unexpected end of input',
        );
        expect(output).toContain('npm install --force tailwindcss@3');
        expect(output).not.toContain('Not needed on v4');
    });
});
