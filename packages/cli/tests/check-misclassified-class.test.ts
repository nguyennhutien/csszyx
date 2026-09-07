/**
 * `csszyx check` — a className the toolkit classifies CONFIDENTLY and wrongly.
 *
 * `classify` matches by class prefix, so an app's own `tab-items-wrapper` is
 * read as a `tab-size` utility and routed to a node by a RULE rather than by
 * the fallback. The runtime warns about a class it cannot classify; it cannot
 * warn about this one, because from inside the runtime the answer looks
 * certain. Only an oracle — the project's own Tailwind — can tell the two
 * apart, and the earliest place that oracle exists on a developer's machine is
 * this command.
 *
 * The rule is deliberately narrow: it fires only when `classify` is confident
 * AND the project's Tailwind produces no CSS for the class. A class nothing
 * classifies (`dems-panel`) is the runtime's business and stays quiet here.
 *
 * It WARNS. The boundary between a real utility and an app's own class is
 * genuinely blurry — a custom `@utility`, a third-party plugin, a name built by
 * concatenation — and a check that fails a commit on a blurry call is a check
 * someone turns off, which costs more than the bug. See
 * `.agent/decisions/0022-class-diagnosis-four-surfaces.md`.
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
 * Build a temporary project with a real Tailwind beside it.
 *
 * @param files - Project-relative paths mapped to their contents.
 * @returns Absolute project root.
 */
function projectWith(files: Record<string, string>): string {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'csszyx-misclass-')));
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
 * Run the command over a fixture project.
 *
 * @param cwd - Project root.
 * @returns Everything the command printed, and the exit code it left.
 */
async function run(cwd: string): Promise<{ text: string; exitCode: number | string | undefined }> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await check({ cwd });
    return { text: log.mock.calls.map(c => c.join(' ')).join('\n'), exitCode: process.exitCode };
}

const CSS = '@import "tailwindcss";';

describe('csszyx check — a class the toolkit reads with false confidence', () => {
    it('names a custom class that collides with a utility prefix', async () => {
        const cwd = projectWith({
            'src/app.css': CSS,
            'src/Tabs.tsx': 'export const T = () => <div className="tab-items-wrapper p-4" />;\n',
        });
        const { text } = await run(cwd);
        expect(text).toContain('tab-items-wrapper');
        expect(text).toContain('src/Tabs.tsx');
    });

    it('warns without failing the run, because the boundary is blurry', async () => {
        const cwd = projectWith({
            'src/app.css': CSS,
            'src/Tabs.tsx': 'export const T = () => <div className="tab-items-wrapper" />;\n',
        });
        const { exitCode } = await run(cwd);
        expect(exitCode).toBeUndefined();
    });

    it('says which node the class was routed to, and how to pin it', async () => {
        const cwd = projectWith({
            'src/app.css': CSS,
            'src/Tabs.tsx': 'export const T = () => <div className="tab-items-wrapper" />;\n',
        });
        const { text } = await run(cwd);
        expect(text).toContain('inner');
        expect(text).toMatch(/inner: \['tab-items-wrapper'\]/);
    });

    it.each(['tab-4', 'list-disc', 'p-17', 'bg-red-500/50', 'md:p-4', 'p-[3px]'])(
        'stays quiet for %s, which Tailwind really serves',
        async token => {
            const cwd = projectWith({
                'src/app.css': CSS,
                'src/Ok.tsx': `export const O = () => <div className="${token}" />;\n`,
            });
            const { text } = await run(cwd);
            expect(text).not.toContain(token);
        },
    );

    it('stays quiet for a class nothing classifies — that is the runtime warning', async () => {
        const cwd = projectWith({
            'src/app.css': CSS,
            'src/Panel.tsx': 'export const P = () => <div className="dems-panel" />;\n',
        });
        const { text } = await run(cwd);
        expect(text).not.toContain('dems-panel');
    });

    it('stays quiet for a name the project defined itself', async () => {
        // The oracle reads the project's own stylesheet, so a custom utility is
        // a real class here even though it collides with the `tab-` prefix.
        const cwd = projectWith({
            'src/app.css': `${CSS}\n@utility tab-items-wrapper { padding: 1rem; }`,
            'src/Tabs.tsx': 'export const T = () => <div className="tab-items-wrapper" />;\n',
        });
        const { text } = await run(cwd);
        expect(text).not.toContain('tab-items-wrapper');
    });
});
