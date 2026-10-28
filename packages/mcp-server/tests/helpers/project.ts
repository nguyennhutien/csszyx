/**
 * Throwaway project roots for the tools that read the project they run in.
 *
 * A root with Tailwind carries its own `node_modules/tailwindcss`, linked to
 * the v4 this package resolves, so the oracle finds what a real project's
 * would and nothing from the tree the fixture sits in.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const TAILWIND_V4 = dirname(createRequire(import.meta.url).resolve('tailwindcss/package.json'));
const roots: string[] = [];

/**
 * Materialise a project root.
 *
 * @param files - Project-relative paths mapped to their contents.
 * @param options - Fixture switches.
 * @param options.tailwind - False for a project with Tailwind not installed.
 * @returns The absolute root; {@link removeProjects} deletes it.
 */
export function project(
    files: Record<string, string> = {},
    options: { tailwind?: boolean } = {},
): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-mcp-project-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), '{ "name": "p", "private": true }');
    if (options.tailwind !== false) {
        mkdirSync(join(root, 'node_modules'));
        symlinkSync(TAILWIND_V4, join(root, 'node_modules', 'tailwindcss'), 'dir');
    }
    for (const [relative, content] of Object.entries(files)) {
        const file = join(root, relative);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
    }
    return root;
}

/** Remove every root {@link project} made. */
export function removeProjects(): void {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}
