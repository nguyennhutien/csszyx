import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { injectNextPlugin, setupSzTypes } from '../src/commands/init.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-init-security-'));
    tempDirs.push(root);
    return root;
}

describe('init config file safety', () => {
    it('creates a Next config when no candidate exists', async () => {
        const root = tempRoot();

        await expect(injectNextPlugin(root)).resolves.toBe(true);
        expect(readFileSync(join(root, 'next.config.js'), 'utf8')).toContain('csszyx');
    });

    it('reads the first existing candidate without check-then-read logic', async () => {
        const root = tempRoot();
        mkdirSync(root, { recursive: true });
        writeFileSync(join(root, 'next.config.mjs'), 'export default { csszyx: true };\n');

        await expect(injectNextPlugin(root)).resolves.toBe(true);
    });

    it('leaves an unknown existing Next config unchanged', async () => {
        const root = tempRoot();
        const configPath = join(root, 'next.config.ts');
        const original = 'export default { reactStrictMode: true };\n';
        writeFileSync(configPath, original);

        await expect(injectNextPlugin(root)).resolves.toBe(false);
        expect(readFileSync(configPath, 'utf8')).toBe(original);
    });
});

describe('init sz JSX types', () => {
    it('creates csszyx-env.d.ts with the @csszyx/types/jsx reference', async () => {
        const root = tempRoot();

        await setupSzTypes(root);

        const env = readFileSync(join(root, 'csszyx-env.d.ts'), 'utf8');
        expect(env).toContain('/// <reference types="@csszyx/types/jsx" />');
    });

    it('does not duplicate the reference when run twice', async () => {
        const root = tempRoot();

        await setupSzTypes(root);
        await setupSzTypes(root);

        const env = readFileSync(join(root, 'csszyx-env.d.ts'), 'utf8');
        expect(env.match(/@csszyx\/types\/jsx/g)).toHaveLength(1);
    });

    it('adds the env file to an existing tsconfig include array', async () => {
        const root = tempRoot();
        writeFileSync(join(root, 'tsconfig.json'), '{\n  "include": ["src"]\n}\n');

        await setupSzTypes(root);

        expect(readFileSync(join(root, 'tsconfig.json'), 'utf8')).toContain('csszyx-env.d.ts');
    });
});
