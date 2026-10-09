/**
 * A project directory the loader cannot write its ES-module copy into — a
 * read-only checkout, a container mount — still loads its config: the loader
 * imports the original file instead, and Node prints its own warning about
 * the package type rather than the config failing.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const refuse = vi.hoisted(() => ({ code: null as string | null }));

vi.mock('node:fs', async importOriginal => {
    const real = await importOriginal<typeof import('node:fs')>();
    return {
        ...real,
        writeFileSync: (...args: Parameters<typeof real.writeFileSync>) => {
            if (refuse.code !== null && String(args[0]).includes('.timestamp-')) {
                // `''` stands for a failure that carries no code at all.
                throw refuse.code === ''
                    ? new Error('refused without a code')
                    : Object.assign(new Error(`${refuse.code}: refused`), { code: refuse.code });
            }
            return real.writeFileSync(...args);
        },
    };
});

const { loadDiagnosticPolicy } = await import('../src/csszyx-config-file.js');

const roots: string[] = [];

afterEach(() => {
    refuse.code = null;
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * A project whose `csszyx.config.ts` Node would read as CommonJS.
 *
 * @returns The root.
 */
function project(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-config-unwritable-'));
    roots.push(root);
    fs.writeFileSync(
        path.join(root, 'csszyx.config.ts'),
        'export default { diagnostics: { rules: { "dead-class": "warn" } } };\n',
    );
    return root;
}

describe('a config whose ES-module copy cannot be written', () => {
    it.each(['EACCES', 'EROFS', 'EPERM'])('imports the original on %s', async code => {
        refuse.code = code;
        const root = project();
        const urls: string[] = [];

        const loaded = await loadDiagnosticPolicy(root, url => {
            urls.push(url);
            return import(url);
        });

        expect(loaded.problems).toEqual([]);
        expect(loaded.policy.levelOf({ rule: 'dead-class' })).toBe('warn');
        expect(urls).toHaveLength(1);
        expect(urls[0]).toMatch(/csszyx\.config\.ts\?mtime=/);
    });

    it.each([
        ['ENOSPC', 'ENOSPC'],
        ['', 'refused without a code'],
    ])('still reports any other write failure (%s)', async (code, said) => {
        refuse.code = code;
        const root = project();

        const loaded = await loadDiagnosticPolicy(root, url => import(url));

        expect(loaded.problems[0]).toMatchObject({ severity: 'error' });
        expect(loaded.problems[0]?.message).toContain(said);
    });
});
