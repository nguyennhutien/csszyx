/**
 * A throwaway project that resolves Tailwind v4 the way a real one does.
 *
 * Each project carries its own `node_modules/tailwindcss`: without it,
 * resolution walks up into whatever tree the fixture sits in, and inside this
 * repository that finds the v3 copy `csszyx migrate` pins.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../../../..');
const TAILWIND_V4 = path.dirname(
    createRequire(path.join(REPO, 'package.json')).resolve('tailwindcss/package.json'),
);
const roots: string[] = [];

/**
 * Materialise a project with Tailwind v4 installed.
 *
 * @param files - Project-relative paths mapped to their contents.
 * @returns Absolute project root.
 */
export function tailwindProject(files: Record<string, string>): string {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'csszyx-project-')));
    roots.push(root);
    mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    symlinkSync(TAILWIND_V4, path.join(root, 'node_modules/tailwindcss'), 'junction');
    writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n', 'utf8');
    for (const [relative, content] of Object.entries(files)) {
        const file = path.join(root, relative);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, content, 'utf8');
    }
    return root;
}

/** Remove every project {@link tailwindProject} made. */
export function removeTailwindProjects(): void {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}
