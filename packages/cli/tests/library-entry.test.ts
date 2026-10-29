/**
 * Guards the library/bin split of the package entry points.
 *
 * `@csszyx/mcp-server` imports this package inside a stdio JSON-RPC
 * process, so importing the library entry must never parse argv or
 * write to stdout — a regression here silently corrupts the MCP
 * protocol stream for every npx consumer.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const libraryEntry = path.join(pkgRoot, 'dist', 'index.mjs');
const binEntry = path.join(pkgRoot, 'dist', 'bin.mjs');

describe('library entry (dist/index.mjs)', () => {
    it('is built', () => {
        expect(existsSync(libraryEntry)).toBe(true);
    });

    it('imports without writing to stdout or exiting', () => {
        const script = `
            const m = await import(${JSON.stringify(pathToFileURL(libraryEntry).href)});
            // Marker on stderr proves the import completed instead of exiting early.
            process.stderr.write('IMPORT_OK:' + Object.keys(m).sort().join(','));
        `;
        const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        expect(stdout).toBe('');
    });

    // The MCP tools load the check pass on use, after the import; a chunk that
    // shares a helper with the bin can import it and run `cli.parse()` then.
    it('reaches no chunk that loads the bin, however late it is loaded', () => {
        const reached = new Set<string>();
        const pending = ['index.mjs'];
        while (pending.length > 0) {
            const chunk = pending.pop() as string;
            if (reached.has(chunk)) continue;
            reached.add(chunk);
            const code = readFileSync(path.join(pkgRoot, 'dist', chunk), 'utf8');
            for (const [, imported] of code.matchAll(/(?:from|import\()\s*["']\.\/([^"']+)["']/g)) {
                pending.push(imported as string);
            }
        }
        expect([...reached]).not.toContain('bin.mjs');
    });

    it('exposes the programmatic surface used by @csszyx/mcp-server', async () => {
        const m = await import(pathToFileURL(libraryEntry).href);
        expect(typeof m.migrateSource).toBe('function');
        expect(typeof m.classNameToSzObject).toBe('function');
        expect(typeof m.generateTypes).toBe('function');
        expect(typeof m.scanTailwindConfig).toBe('function');
    });
});

describe('bin entry (dist/bin.mjs)', () => {
    it('is built with a shebang and reports the package version', () => {
        const output = execFileSync(process.execPath, [binEntry, '--version'], {
            encoding: 'utf8',
        });
        expect(output).toMatch(/^csszyx\/\d+\.\d+\.\d+/);
    });
});
