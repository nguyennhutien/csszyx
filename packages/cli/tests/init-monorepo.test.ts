import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isInsideWorkspace, tailwindImportBlock } from '../src/commands/init.js';

describe('tailwindImportBlock', () => {
    it('writes a bare import outside a monorepo', () => {
        expect(tailwindImportBlock('/app/src', '/app', false)).toBe('@import "tailwindcss";\n');
    });

    it('scopes content detection with source(none) inside a monorepo', () => {
        const out = tailwindImportBlock('/repo/apps/web/src', '/repo/apps/web', true);
        expect(out).toContain('@import "tailwindcss" source(none);');
        expect(out).toContain('@source "..";'); // src/ -> package root
    });

    it('uses "." when the CSS entry sits at the package root', () => {
        const out = tailwindImportBlock('/repo/apps/web', '/repo/apps/web', true);
        expect(out).toContain('@source ".";');
    });

    it('emits a posix @source path (no backslashes)', () => {
        const out = tailwindImportBlock(path.join('/repo', 'app', 'src'), '/repo/app', true);
        expect(out).not.toContain('\\');
    });
});

describe('isInsideWorkspace', () => {
    let dir: string;
    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'csszyx-ws-'));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('detects a pnpm-workspace.yaml ancestor', async () => {
        await writeFile(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
        const pkg = path.join(dir, 'packages', 'web');
        await mkdir(pkg, { recursive: true });
        expect(await isInsideWorkspace(pkg)).toBe(true);
    });

    it('detects a package.json "workspaces" ancestor', async () => {
        await writeFile(
            path.join(dir, 'package.json'),
            JSON.stringify({ workspaces: ['packages/*'] }),
        );
        const pkg = path.join(dir, 'packages', 'web');
        await mkdir(pkg, { recursive: true });
        expect(await isInsideWorkspace(pkg)).toBe(true);
    });

    it('returns false for a standalone project', async () => {
        await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'solo' }));
        expect(await isInsideWorkspace(dir)).toBe(false);
    });

    it('walks past a package.json that is not JSON', async () => {
        await writeFile(path.join(dir, 'package.json'), '{ not json');
        const pkg = path.join(dir, 'web');
        await mkdir(pkg);
        expect(await isInsideWorkspace(pkg)).toBe(false);
    });

    it('answers for the nearest workspace root before a farther unreadable one', async () => {
        // Every ancestor is asked at once; the answer is still the walk's.
        await mkdir(path.join(dir, 'package.json'));
        const pkg = path.join(dir, 'repo', 'web');
        await mkdir(pkg, { recursive: true });
        await writeFile(path.join(dir, 'repo', 'nx.json'), '{}');
        expect(await isInsideWorkspace(pkg)).toBe(true);
    });

    it('fails on an unreadable package.json no nearer root answered for', async () => {
        // A directory where the file should be: the read fails with EISDIR,
        // which is not the missing file the walk steps past.
        await mkdir(path.join(dir, 'package.json'));
        const pkg = path.join(dir, 'web');
        await mkdir(pkg);
        await expect(isInsideWorkspace(pkg)).rejects.toMatchObject({ code: 'EISDIR' });
    });
});
