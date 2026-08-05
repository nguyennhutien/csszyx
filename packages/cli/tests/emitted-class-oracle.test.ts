import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    createEmittedClassOracle,
    findTailwindCssEntry,
    type TailwindLoader,
    type TailwindModule,
} from '../src/scanner/emitted-class-oracle.js';

const REPO = path.resolve(import.meta.dirname, '../../..');

/** Stylesheet that pulls in stock Tailwind and nothing else. */
const STOCK = '@import "tailwindcss";';

/**
 * Build a ready oracle over the repository's own Tailwind, failing the test
 * when it degrades — these cases are about what Tailwind serves, so a skip
 * would pass them vacuously.
 *
 * @param css - Stylesheet content to load the design system from.
 * @returns The ready oracle.
 */
async function readyOracle(css: string = STOCK) {
    const oracle = await createEmittedClassOracle({ resolveFrom: REPO, css, cssBase: REPO });
    if (!oracle.ok) {
        throw new Error(`expected a ready oracle, got skip: ${oracle.reason}`);
    }
    return oracle;
}

describe('createEmittedClassOracle — what Tailwind actually serves', () => {
    // Every case here pairs the class under test with a known-dead probe, so a
    // stub that reports nothing dead cannot satisfy the assertion.
    it('does not call a class Tailwind serves dead', async () => {
        const oracle = await readyOracle();
        expect(oracle.findDead(['p-4', 'bg-red-500', 'zz-probe'])).toEqual(['zz-probe']);
    });

    it('calls a class Tailwind does not serve dead', async () => {
        const oracle = await readyOracle();
        expect(oracle.findDead(['p-4', 'zz-not-a-class'])).toEqual(['zz-not-a-class']);
    });

    it('accepts a token the project theme declares', async () => {
        const oracle = await readyOracle('@import "tailwindcss";\n@theme { --color-brand: #123; }');
        expect(oracle.findDead(['bg-brand', 'zz-probe'])).toEqual(['zz-probe']);
    });

    it('accepts a breakpoint the project theme declares, and rejects a typo of it', async () => {
        const oracle = await readyOracle(
            '@import "tailwindcss";\n@theme { --breakpoint-tablet: 900px; }',
        );
        expect(oracle.findDead(['tablet:p-4', 'zz-probe'])).toEqual(['zz-probe']);
        expect(oracle.findDead(['tablt:p-4'])).toEqual(['tablt:p-4']);
    });

    // The unknown-key warning tells authors to define the class with Tailwind's
    // @utility. An oracle that could not see those definitions would report the
    // very class it just asked for as dead.
    it('accepts a class the project defines with @utility', async () => {
        const oracle = await readyOracle(
            '@import "tailwindcss";\n@utility dems-panel { padding: 1rem; }',
        );
        expect(oracle.findDead(['dems-panel', 'zz-probe'])).toEqual(['zz-probe']);
    });

    it('resolves a stylesheet the project imports by relative path', async () => {
        const base = path.join(REPO, 'packages/cli/tests/fixtures/oracle');
        const oracle = await createEmittedClassOracle({
            resolveFrom: REPO,
            css: '@import "tailwindcss";\n@import "./tokens.css";',
            cssBase: base,
        });
        if (!oracle.ok) throw new Error(`expected a ready oracle, got skip: ${oracle.reason}`);
        expect(oracle.findDead(['bg-imported', 'zz-probe'])).toEqual(['zz-probe']);
    });
});

describe('createEmittedClassOracle — degrading instead of failing', () => {
    const loaderOf =
        (module: TailwindModule | null): TailwindLoader =>
        async () =>
            module;

    it('skips when Tailwind cannot be resolved from the project', async () => {
        const oracle = await createEmittedClassOracle(
            { resolveFrom: '/nowhere', css: STOCK, cssBase: '/nowhere' },
            loaderOf(null),
        );
        expect(oracle).toEqual({ ok: false, reason: expect.stringContaining('not resolve') });
    });

    it('skips when the project pins a Tailwind older than v4', async () => {
        const oracle = await createEmittedClassOracle(
            { resolveFrom: REPO, css: STOCK, cssBase: REPO },
            loaderOf({ version: '3.4.19', root: REPO, loadDesignSystem: undefined }),
        );
        expect(oracle.ok).toBe(false);
        expect(oracle.ok === false && oracle.reason).toContain('3.4.19');
    });

    it('skips when the Tailwind build has no design-system entry point', async () => {
        const oracle = await createEmittedClassOracle(
            { resolveFrom: REPO, css: STOCK, cssBase: REPO },
            loaderOf({ version: '4.3.3', root: REPO, loadDesignSystem: undefined }),
        );
        expect(oracle.ok).toBe(false);
        expect(oracle.ok === false && oracle.reason).toContain('__unstable__loadDesignSystem');
    });

    it('skips when the stylesheet cannot be compiled', async () => {
        const oracle = await createEmittedClassOracle({
            resolveFrom: REPO,
            css: '@import "./this-file-is-not-there.css";',
            cssBase: REPO,
        });
        expect(oracle.ok).toBe(false);
    });

    // Exercises the REAL resolver, not an injected one: a project outside any
    // node_modules tree is the ordinary case for this branch.
    it('skips when the real resolver finds no Tailwind above the project', async () => {
        const oracle = await createEmittedClassOracle({
            resolveFrom: os.tmpdir(),
            css: STOCK,
            cssBase: os.tmpdir(),
        });
        expect(oracle.ok).toBe(false);
        expect(oracle.ok === false && oracle.reason).toContain('could not resolve');
    });

    it('skips when querying the design system throws', async () => {
        const oracle = await createEmittedClassOracle(
            { resolveFrom: REPO, css: STOCK, cssBase: REPO },
            loaderOf({
                version: '4.3.3',
                root: REPO,
                loadDesignSystem: async () => ({
                    candidatesToCss: () => {
                        throw new Error('candidate parser exploded');
                    },
                }),
            }),
        );
        expect(oracle.ok).toBe(false);
        expect(oracle.ok === false && oracle.reason).toContain('candidate parser exploded');
    });

    // If Tailwind ever stops reporting an unservable class as null, every dead
    // class would read as alive and the caller would pass vacuously.
    it('skips when the design system stops reporting dead classes', async () => {
        const oracle = await createEmittedClassOracle(
            { resolveFrom: REPO, css: STOCK, cssBase: REPO },
            loaderOf({
                version: '4.3.3',
                root: REPO,
                loadDesignSystem: async () => ({
                    candidatesToCss: (candidates: readonly string[]) => candidates.map(() => ''),
                }),
            }),
        );
        expect(oracle.ok).toBe(false);
        expect(oracle.ok === false && oracle.reason).toContain('no longer reports');
    });
});

describe('findTailwindCssEntry — locating the stylesheet to compile', () => {
    const write = (root: string, files: Record<string, string>): void => {
        for (const [name, content] of Object.entries(files)) {
            const file = path.join(root, name);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, content, 'utf8');
        }
    };

    const roots: string[] = [];
    const tempRoot = (): string => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-oracle-')));
        roots.push(root);
        return root;
    };
    afterEach(() => {
        for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
    });

    it('finds the stylesheet that pulls in Tailwind', async () => {
        const root = tempRoot();
        write(root, {
            'src/app.css': '@import "tailwindcss";\n@theme { --color-brand: #123; }',
            'src/other.css': '.hand-written { color: red; }',
        });
        expect(await findTailwindCssEntry(root)).toBe(path.join(root, 'src/app.css'));
    });

    it('accepts the single-quoted spelling', async () => {
        const root = tempRoot();
        write(root, { 'app.css': "@import 'tailwindcss';" });
        expect(await findTailwindCssEntry(root)).toBe(path.join(root, 'app.css'));
    });

    it('ignores a stylesheet inside a dependency', async () => {
        const root = tempRoot();
        write(root, { 'node_modules/pkg/dist/x.css': '@import "tailwindcss";' });
        expect(await findTailwindCssEntry(root)).toBeNull();
    });

    it('prefers the shallowest entry so the result does not depend on scan order', async () => {
        const root = tempRoot();
        write(root, {
            'deep/nested/late.css': '@import "tailwindcss";',
            'app.css': '@import "tailwindcss";',
        });
        expect(await findTailwindCssEntry(root)).toBe(path.join(root, 'app.css'));
    });

    it('returns null when the project has no Tailwind entry', async () => {
        const root = tempRoot();
        write(root, { 'src/plain.css': 'body { margin: 0; }' });
        expect(await findTailwindCssEntry(root)).toBeNull();
    });
});
