/**
 * The options `next-prebuild` and `next-watch` accept, read off the built
 * binary's `--help` output. They share the eight that say where the Next app
 * is, how it is parsed and where the safelist goes; each adds its own on top.
 *
 * This pins the flags and their descriptions, not their order: the two
 * commands register the shared eight from one table, and where that table
 * sits in the chain is presentation, not contract.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const binEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/bin.mjs');

/**
 * @param command - The subcommand to ask for help on.
 * @returns Flag and description pairs, as `--help` prints them.
 */
function helpOptions(command: string): Array<[string, string]> {
    const help = execFileSync(process.execPath, [binEntry, command, '--help'], {
        encoding: 'utf8',
    });
    const options: Array<[string, string]> = [];
    for (const raw of help.split('\n')) {
        const line = raw.trim();
        // `-h, --help` is cac's own and starts with `-h`.
        if (!line.startsWith('--')) continue;
        const gap = line.indexOf('  ');
        if (gap === -1) continue;
        options.push([line.slice(0, gap), line.slice(gap).trim()]);
    }
    return options;
}

const SHARED: ReadonlyArray<readonly [string, string]> = [
    ['--root <dir>', 'Next app root (defaults to cwd)'],
    ['--cwd <dir>', 'Current working directory'],
    ['--parser-mode <mode>', 'rust | wasm (default: rust)'],
    [
        '--output-file <path>',
        'Tailwind @source safelist output (default: .csszyx/csszyx-classes.txt)',
    ],
    ['--cache-dir <dir>', 'Cache directory relative to root (default: .csszyx/cache)'],
    ['--ignore <patterns>', 'Extra glob patterns to ignore (comma-separated)'],
    [
        '--imported-static-sz',
        'Compile a plain exported sz object into the modules that import it (default)',
    ],
    [
        '--no-imported-static-sz',
        'Leave imported sz objects to the runtime; pass the same to the loader (default: true)',
    ],
];

describe('next-prebuild and next-watch options', () => {
    it('next-prebuild takes the shared options plus --mode and --json', () => {
        const options = helpOptions('next-prebuild');
        expect(options).toEqual(
            expect.arrayContaining([
                ...SHARED,
                ['--mode <mode>', 'development | production (default: production)'],
                ['--json', 'Emit a single JSON result instead of formatted text'],
            ]),
        );
        expect(options).toHaveLength(SHARED.length + 2);
    });

    it('next-watch takes the shared options plus --debounce-ms', () => {
        const options = helpOptions('next-watch');
        expect(options).toEqual(
            expect.arrayContaining([
                ...SHARED,
                ['--debounce-ms <ms>', 'Safelist materialization debounce (default: 50)'],
            ]),
        );
        expect(options).toHaveLength(SHARED.length + 1);
    });
});
