/**
 * `csszyx check` failing on a theme token named after a built-in keyword.
 *
 * Declaring `--color-balance` does not add a colour class. `text-balance` is
 * already a static utility, so Tailwind merges the readings and the class
 * carries `text-wrap: balance` AND the colour — measured on tailwindcss 4.3.3.
 * szcn then keeps both classes rather than merging, and stylesheet order
 * decides the winner instead of the argument order szcn promises.
 *
 * That is wrong output, not a missed optimisation, so this exits non-zero.
 * `--allow-token` is the deliberate way out: the exemption becomes a line in a
 * diff someone reviews rather than a check nobody runs.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { check } from '../src/commands/check.js';
import { removeTailwindProjects, tailwindProject } from './helpers/tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

/**
 * Run the command and return everything it printed.
 *
 * @param cwd - Project root.
 * @param allowToken - Token names to accept.
 * @returns Concatenated report text.
 */
async function reportFor(cwd: string, allowToken?: string[]): Promise<string> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await check({ cwd, allowToken });
    return log.mock.calls.map(call => call.join(' ')).join('\n');
}

const APP = `export const A = () => <div sz={{ p: 4 }} />;`;

describe('csszyx check — a theme token that shadows a built-in', () => {
    it('fails, naming the file, the line and the class it changes', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";\n@theme {\n  --color-balance: #0af;\n}\n',
            'src/App.tsx': APP,
        });

        const report = await reportFor(cwd);

        expect(report).toContain('src/app.css:3');
        expect(report).toContain('balance');
        expect(report).toContain('text-balance');
        expect(process.exitCode).toBe(1);
    });

    it('finds a collision under a prefix the token is not obviously named for', async () => {
        // A colour feeds `bg-` as well, so `--color-cover` changes `bg-cover`.
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";\n@theme {\n  --color-cover: #0af;\n}\n',
            'src/App.tsx': APP,
        });

        expect(await reportFor(cwd)).toContain('bg-cover');
        expect(process.exitCode).toBe(1);
    });

    it('passes once the project accepts the name deliberately', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";\n@theme {\n  --color-balance: #0af;\n}\n',
            'src/App.tsx': APP,
        });

        const report = await reportFor(cwd, ['balance']);

        expect(report).not.toContain('text-balance');
        expect(process.exitCode).toBeUndefined();
    });

    it('passes for a theme whose names nothing else claims', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";\n@theme {\n  --color-brand: #0af;\n}\n',
            'src/App.tsx': APP,
        });

        expect(await reportFor(cwd)).not.toContain('shadow');
        expect(process.exitCode).toBeUndefined();
    });

    it('covers a namespace other than colours', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";\n@theme {\n  --text-balance: 4rem;\n}\n',
            'src/App.tsx': APP,
        });

        expect(await reportFor(cwd)).toContain('text-balance');
        expect(process.exitCode).toBe(1);
    });
});

// The collision question needs a SECOND compile of the same stylesheet, with
// probe tokens appended, and that compile is this package's instrumentation
// rather than anything the project asked for. When it is the instrumentation
// that fails, the project must not be the one blamed for it.
describe('csszyx check — when the probe compile cannot be made', () => {
    it('says nothing about theme collisions rather than failing the project', async () => {
        // A plugin that refuses to run twice in one process. The project's own
        // stylesheet compiles — the whole rest of the command works on it — and
        // only the probe compile fails, so a report here would fail CI over a
        // token this package injected.
        const cwd = tailwindProject({
            'src/once.cjs':
                'let compiles = 0;\n' +
                'module.exports = function onceOnlyPlugin() {\n' +
                '    compiles += 1;\n' +
                "    if (compiles > 1) throw new Error('this plugin refuses a second compile');\n" +
                '};\n',
            'src/app.css':
                '@import "tailwindcss";\n@plugin "./once.cjs";\n@theme {\n  --color-balance: #0af;\n}\n',
            'src/App.tsx': APP,
        });

        const report = await reportFor(cwd);

        // `--color-balance` is the collision the first case in this file fails
        // on, so a quiet run here is the branch and not an empty fixture.
        expect(report).not.toContain('text-balance');
        expect(process.exitCode).toBeUndefined();
    });
});
