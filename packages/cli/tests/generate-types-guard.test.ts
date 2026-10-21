/**
 * `generate-types` asks whether Tailwind v3 is there before it reads a config,
 * and stops with the availability message when it is not — including when no
 * config was found, since a project with no `tailwind.config.js` is the state
 * the availability message exists to explain.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const availability = vi.hoisted(() => ({
    resolveTailwindV3: vi.fn<() => Promise<{ version: string }>>(),
    tailwindLoaderFor: vi.fn(() => ({})),
}));

vi.mock('../src/scanner/tailwind-availability.js', () => ({
    resolveTailwindV3: availability.resolveTailwindV3,
    tailwindLoaderFor: availability.tailwindLoaderFor,
}));

import { generateTypes } from '../src/commands/generate-types.js';

afterEach(() => {
    vi.restoreAllMocks();
    availability.resolveTailwindV3.mockReset();
    availability.tailwindLoaderFor.mockClear();
});

/**
 * Capture what a `generateTypes` run printed, with `process.exit` throwing.
 *
 * @param options - Options for the command under test.
 * @returns The error and normal output, joined.
 */
async function run(options: Parameters<typeof generateTypes>[0]): Promise<{
    errors: string;
    logs: string;
}> {
    const errors: string[] = [];
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
        errors.push(parts.join(' '));
    });
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        logs.push(parts.join(' '));
    });
    vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit');
    }) as never);
    await expect(generateTypes(options)).rejects.toThrow('exit');
    return { errors: errors.join('\n'), logs: logs.join('\n') };
}

describe('generate-types: the Tailwind guard', () => {
    it('resolves Tailwind beside an explicit nested config, not from the invocation cwd', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'csszyx-generate-types-root-'));
        const configPath = join(cwd, 'packages/legacy/tailwind.config.js');
        mkdirSync(dirname(configPath), { recursive: true });
        writeFileSync(configPath, 'export default {};');
        availability.resolveTailwindV3.mockRejectedValue(new Error('stop after recording root'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(process, 'exit').mockImplementation((() => {
            throw new Error('exit');
        }) as never);

        try {
            await expect(
                generateTypes({ cwd, config: 'packages/legacy/tailwind.config.js' }),
            ).rejects.toThrow('exit');
            expect(availability.tailwindLoaderFor).toHaveBeenCalledWith(dirname(configPath));
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    // A Tailwind v4 project has no `tailwind.config.js` by design, so config
    // discovery is exactly where its author arrives. Telling them to pass
    // `--config` sends them hunting for a file that cannot exist; the
    // availability message says the command has no job on v4 at all.
    it('answers the install state before reporting that no config was found', async () => {
        availability.resolveTailwindV3.mockRejectedValue(
            new Error('generate-types needs Tailwind CSS v3, and this project has 4.3.3.'),
        );
        const { errors } = await run({ cwd: mkdtempSync(join(tmpdir(), 'csszyx-gt-')) });
        expect(errors).toContain('❌ generate-types needs Tailwind CSS v3');
        expect(errors).not.toContain('Could not find tailwind.config.js');
    });

    it('still reports a missing config when Tailwind v3 is there to use it', async () => {
        availability.resolveTailwindV3.mockResolvedValue({ version: '3.4.19' });
        const { errors } = await run({ cwd: mkdtempSync(join(tmpdir(), 'csszyx-gt-')) });
        expect(errors).toContain('Could not find tailwind.config.js');
    });

    it('prints the availability message and exits before reading any config', async () => {
        availability.resolveTailwindV3.mockRejectedValue(
            new Error('generate-types needs Tailwind CSS v3, and this project has none installed.'),
        );
        const errors: string[] = [];
        vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
            errors.push(parts.join(' '));
        });
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
            logs.push(parts.join(' '));
        });
        const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
            throw new Error('exit');
        }) as never);

        await expect(generateTypes({ config: './nope.js' })).rejects.toThrow('exit');

        expect(exit).toHaveBeenCalledWith(1);
        expect(errors.join('\n')).toContain('❌ generate-types needs Tailwind CSS v3');
        // Nothing about reading a config was printed first.
        expect(logs.join('\n')).not.toContain('Reading config');
    });
});

describe('generate-types: a config it cannot read', () => {
    it('names a --config path that does not exist, in the registry words', async () => {
        availability.resolveTailwindV3.mockResolvedValue({ version: '3.4.19' });
        const cwd = mkdtempSync(join(tmpdir(), 'csszyx-gt-'));
        try {
            const { errors } = await run({ cwd, config: './nope.js' });
            expect(errors).toBe(
                `❌ [csszyx] tailwind-config-missing: ${join(cwd, 'nope.js')}\n` +
                    '  This Tailwind config does not exist, so `csszyx generate-types` cannot read the theme.\n' +
                    "  help: pass the path of the project's Tailwind config with `--config`, such as `--config ./tailwind.config.js`.\n" +
                    '  docs: https://csszyx.com/e/tailwind-config-missing',
            );
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('names a config that throws while loading, with what it threw', async () => {
        availability.resolveTailwindV3.mockResolvedValue({ version: '3.4.19' });
        const cwd = mkdtempSync(join(tmpdir(), 'csszyx-gt-'));
        writeFileSync(join(cwd, 'tailwind.config.mjs'), "throw new Error('theme is broken');\n");
        try {
            const { errors } = await run({ cwd, config: 'tailwind.config.mjs' });
            expect(errors).toBe(
                `❌ [csszyx] tailwind-config-unloadable: ${join(cwd, 'tailwind.config.mjs')}\n` +
                    '  This Tailwind config threw while loading, so `csszyx generate-types` cannot read the theme.\n' +
                    '  help: fix the error below so that Node can import the config.\n' +
                    '  note: the import failed with: theme is broken.\n' +
                    '  docs: https://csszyx.com/e/tailwind-config-unloadable',
            );
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('says it could not read the config for a failure with no registry words', async () => {
        // The guard answers with no `resolveConfig`, so resolving the theme throws.
        availability.resolveTailwindV3.mockResolvedValue({ version: '3.4.19' });
        const cwd = mkdtempSync(join(tmpdir(), 'csszyx-gt-'));
        writeFileSync(join(cwd, 'tailwind.config.mjs'), 'export default {};\n');
        try {
            const { errors } = await run({ cwd, config: 'tailwind.config.mjs' });
            expect(errors).toMatch(/^❌ Failed to read Tailwind config: .*resolveConfig/);
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });
});
