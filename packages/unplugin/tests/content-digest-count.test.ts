/**
 * A Vite build hashes each source text once.
 *
 * The prescan and the transform read the same text for several memos and the
 * diagnostic limiter, and used to digest it again for each. They now share
 * one digest per text, so each file a project adds costs one SHA-256. This is
 * the bundler lanes' plugin; the jest and Next loader lanes keep their own.
 */
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const hashes = vi.hoisted(() => ({ count: 0 }));

// Wrapped, not replaced: the digests are real, and a test can count them.
vi.mock('node:crypto', async importOriginal => {
    const crypto = await importOriginal<typeof import('node:crypto')>();
    const createHash: typeof crypto.createHash = (algorithm, options) => {
        if (algorithm === 'sha256') hashes.count++;
        return crypto.createHash(algorithm, options);
    };
    return { ...crypto, default: { ...crypto, createHash }, createHash };
});

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

/**
 * The SHA-256 digests one prescan and one transform of every file take.
 *
 * @param count - Components in the project.
 * @returns The digests.
 */
async function hashesFor(count: number): Promise<number> {
    const files: Record<string, string> = { 'src/index.css': '@import "tailwindcss";\n' };
    for (let index = 0; index < count; index++) {
        // Unique to this project, so no text is one the memo kept from before.
        files[`src/C${index}.tsx`] =
            `// ${count}\nexport const C${index} = () => <div sz={{ p: ${index % 8} }} />;\n`;
    }
    const root = tailwindProject('csszyx-digest-count-', files);
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const call = callHooks(
        vitePlugin({
            build: { cache: false },
            production: { mangle: false },
        }) as unknown as Record<string, unknown>[],
    );
    hashes.count = 0;
    await call('configResolved', { root, command: 'build' });
    for (let index = 0; index < count; index++) {
        const file = `src/C${index}.tsx`;
        await call('transform', files[file], join(root, file));
    }
    return hashes.count;
}

describe('a Vite build', () => {
    it('digests each added file once', async () => {
        const few = await hashesFor(4);
        const many = await hashesFor(16);

        // A floor too: a build that stopped digesting would pass the bound.
        expect(few).toBeGreaterThan(0);
        expect(many - few).toBeLessThanOrEqual(12);
    }, 60_000);
});
