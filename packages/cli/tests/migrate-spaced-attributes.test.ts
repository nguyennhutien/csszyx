/**
 * Migrate picks a file by whether it holds an attribute to migrate. JSX and
 * HTML both allow whitespace around an attribute's `=`, so `className = "…"`,
 * `sz = {{…}}` and `class = "…"` are attributes like any other; a file that
 * spells them that way was skipped, untouched and unreported.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrate } from '../src/commands/migrate.js';

let cwd: string;

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    cwd = mkdtempSync(join(tmpdir(), 'csszyx-spaced-'));
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'fixture' }));
    mkdirSync(join(cwd, 'src'));
});

afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
});

/**
 * Write a file under `src/`.
 *
 * @param name - The file name.
 * @param text - Its content.
 * @returns Its path.
 */
function write(name: string, text: string): string {
    const file = join(cwd, 'src', name);
    writeFileSync(file, text);
    return file;
}

describe('migrate reads an attribute whatever the space around its `=`', () => {
    it.each([
        [
            'className = "…"',
            'Spaced.tsx',
            'export const A = () => <div className = "flex p-4" />;\n',
        ],
        ['className="…"', 'Tight.tsx', 'export const A = () => <div className="flex p-4" />;\n'],
        ['class = "…" in HTML', 'spaced.html', '<div class = "flex p-4">x</div>\n'],
    ])('migrates %s', async (_spelling, name, text) => {
        const file = write(name, text);

        await migrate({ cwd });

        expect(readFileSync(file, 'utf8')).not.toBe(text);
    });

    it.each([
        [
            'sz = {{…}}',
            'Spaced.tsx',
            "export const A = () => <div sz = {{ fontWeight: 'bold' }} />;\n",
        ],
        ['sz={{…}}', 'Tight.tsx', "export const A = () => <div sz={{ fontWeight: 'bold' }} />;\n"],
    ])('normalizes the keys of %s', async (_spelling, name, text) => {
        const file = write(name, text);

        await migrate({ cwd, keysOnly: true });

        expect(readFileSync(file, 'utf8')).toContain('weight');
        expect(readFileSync(file, 'utf8')).not.toContain('fontWeight');
    });
});
