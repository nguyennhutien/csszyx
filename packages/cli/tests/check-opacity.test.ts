/**
 * `csszyx check` judging opacity modifiers from the compiled stylesheet.
 *
 * Tailwind v4 wraps every `/N` modifier in `color-mix()`, which dims ANY
 * valid color — so the old token-text heuristic flagged working output and
 * was pure noise (six false hits was the entire output of a field user's
 * otherwise-clean run). The one shape that genuinely breaks is a token whose
 * var() chain ends in a bare comma triplet: substituted into `color-mix()`,
 * the declaration is invalid CSS and the browser drops it. That answer lives
 * in the project's own stylesheet, which this command already compiles, so
 * the verdict here is exact — warn when the modifier provably does not
 * survive, stay silent otherwise.
 *
 * Fixtures symlink the repo's real Tailwind v4, same as the dead-class suite:
 * the command resolves the project's own install, and without one every case
 * would pass as a skip.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { check } from '../src/commands/check.js';

const REPO = path.resolve(import.meta.dirname, '../../..');
const TAILWIND_V4 = path.dirname(
    createRequire(path.join(REPO, 'package.json')).resolve('tailwindcss/package.json'),
);
const roots: string[] = [];

/**
 * Materialise a project that resolves Tailwind v4 the way a real one does.
 *
 * @param files - Project-relative paths mapped to their contents.
 * @returns Absolute project root.
 */
function projectWith(files: Record<string, string>): string {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'csszyx-check-op-')));
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

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

/**
 * Run the command over a project and return everything it printed.
 *
 * @param cwd - Project root.
 * @returns Concatenated report text.
 */
async function reportFor(cwd: string): Promise<string> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await check({ cwd });
    return log.mock.calls.map(call => call.join(' ')).join('\n');
}

const ENTRY_CSS = `@import "tailwindcss";
@theme {
    --color-broken: var(--v-broken);
    --color-fine: rgb(var(--v-fine));
    --color-direct: 17, 119, 224;
    --color-good: oklch(0.6 0.1 250);
}
:root {
    --v-broken: 17, 119, 224;
    --v-fine: 17, 119, 224;
}
`;

describe('csszyx check — opacity modifiers judged from the compiled rule', () => {
    it('reports a modifier whose token resolves to a bare comma triplet, and only that one', async () => {
        const cwd = projectWith({
            'src/app.css': ENTRY_CSS,
            'src/Broken.tsx':
                "export const B = () => <div sz={{ bg: { color: 'broken', op: 30 } }} />;",
            // The wrapped triplet and the oklch token both dim correctly under
            // color-mix() — flagging them is the noise this pass replaces.
            'src/Fine.tsx':
                "export const F = () => <div sz={{ bg: { color: 'fine', op: 30 }, hover: { bg: { color: 'good', op: 50 } } }} />;",
        });

        const report = await reportFor(cwd);

        expect(report).toContain('bg-broken/30');
        expect(report).toContain('17, 119, 224');
        expect(report).toContain('Broken.tsx');
        expect(report).not.toContain('bg-fine/30');
        expect(report).not.toContain('bg-good/50');
        expect(process.exitCode).toBe(1);
    });

    it('reports a token DEFINED as a bare triplet, without any var chain', async () => {
        const cwd = projectWith({
            'src/app.css': ENTRY_CSS,
            'src/Direct.tsx':
                "export const D = () => <div sz={{ color: { color: 'direct', op: 25 } }} />;",
        });

        const report = await reportFor(cwd);

        expect(report).toContain('text-direct/25');
        expect(process.exitCode).toBe(1);
    });

    it('passes over a class the stylesheet has no rule for at all', async () => {
        // A dead class is the other pass's finding. This one reads compiled
        // rules, and a class with no rule has nothing to read: it has to be
        // skipped rather than counted as a surviving modifier or crashed on.
        // Both findings come out of one scan, so they are asserted together.
        const cwd = projectWith({
            'src/app.css': ENTRY_CSS,
            // Carries a modifier AND has no rule: the theme defines no such
            // token, so it reaches this pass and has nothing to read.
            'src/Dead.tsx':
                "export const D = () => <div sz={{ bg: { color: 'nope-token', op: 30 } }} />;",
            'src/Broken.tsx':
                "export const B = () => <div sz={{ bg: { color: 'broken', op: 30 } }} />;",
        });

        const report = await reportFor(cwd);

        expect(report).toContain('bg-nope-token/30');
        expect(report).toContain('bg-broken/30');
        expect(process.exitCode).toBe(1);
    });

    it('stays silent when every modifier survives', async () => {
        const cwd = projectWith({
            'src/app.css': ENTRY_CSS,
            'src/Fine.tsx':
                "export const F = () => <div sz={{ bg: { color: 'fine', op: 30 } }} />;",
        });

        const report = await reportFor(cwd);

        expect(report).not.toContain('opacity');
        expect(process.exitCode).not.toBe(1);
    });

    it('stays silent when the var chain leaves the stylesheet it can see', async () => {
        // `--elsewhere` is defined in some file this command never read — the
        // verdict cannot be proven, and an exact pass does not guess.
        const cwd = projectWith({
            'src/app.css':
                '@import "tailwindcss";\n@theme { --color-mystery: var(--elsewhere); }\n',
            'src/Mystery.tsx':
                "export const M = () => <div sz={{ bg: { color: 'mystery', op: 40 } }} />;",
        });

        const report = await reportFor(cwd);

        expect(report).not.toContain('bg-mystery/40');
        expect(process.exitCode).not.toBe(1);
    });
});
