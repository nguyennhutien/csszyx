/**
 * Make a fixture root resolve Tailwind v4 the way an installed project does.
 *
 * The Next commands compile the project's own stylesheets to read its prefix,
 * so a fixture without Tailwind proves nothing about that. The package is
 * linked, not copied, so it is the same Tailwind every other suite measures.
 *
 * NOT a `.test.ts` file: vitest must not collect it as a suite.
 */
import { mkdirSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../../..');

/**
 * Link the repository's Tailwind into a fixture root.
 *
 * @param root - Absolute fixture root.
 */
export function linkTailwind(root: string): void {
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(
        dirname(createRequire(join(REPO, 'package.json')).resolve('tailwindcss/package.json')),
        join(root, 'node_modules/tailwindcss'),
        'junction',
    );
}
