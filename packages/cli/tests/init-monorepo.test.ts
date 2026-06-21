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
});
