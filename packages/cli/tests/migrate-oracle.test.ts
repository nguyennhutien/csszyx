/**
 * `csszyx migrate` asking the project's own Tailwind where a migrate table
 * would decide (PROJECT-RULES §4, ADR 0012).
 *
 * A few refusals — a sign on `auto`, a fraction on a key without one, a sign
 * on a fraction, a modifier on a value that is not a colour — were read off a
 * table baked from the Tailwind this repository pins. The project's Tailwind
 * is the one whose verdict counts: a class it serves migrates (when an sz
 * value lowers back to it), a class it does not serve stays in `className`,
 * and only a project with no Tailwind v4 to ask falls back to the table.
 *
 * Each fixture carries its own `node_modules/tailwindcss` (see
 * `helpers/tailwind-project.ts`), so the command resolves what a real
 * project resolves.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrate } from '../src/commands/migrate.js';
import { removeTailwindProjects, tailwindProject } from './helpers/tailwind-project.js';

/** How the second pass — a file migrated again with the answers — fails. */
const control = vi.hoisted(() => ({
    secondPass: null as 'error' | 'unavailable' | null,
    seen: new Set<string>(),
}));

vi.mock('@csszyx/compiler/migrate', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler/migrate')>();
    /**
     * Throw as asked when a source comes back a second time, and only then.
     *
     * @param sources - The sources of the call.
     */
    const failOnSecondPass = (sources: readonly string[]): void => {
        const again = sources.some(source => control.seen.has(source));
        for (const source of sources) control.seen.add(source);
        if (!again || control.secondPass === null) return;
        if (control.secondPass === 'unavailable') {
            throw new actual.RustMigrateUnavailableError({
                form: 'not-installed',
                packageName: '@csszyx/core-went-away',
            });
        }
        throw new Error('the engine refused the second pass');
    };
    return {
        ...actual,
        migrateRustBatch: (...args: Parameters<typeof actual.migrateRustBatch>) => {
            failOnSecondPass(args[0].map(file => file.source));
            return actual.migrateRustBatch(...args);
        },
        migrateRustHtml: (...args: Parameters<typeof actual.migrateRustHtml>) => {
            failOnSecondPass([args[0]]);
            return actual.migrateRustHtml(...args);
        },
    };
});

afterEach(() => {
    control.secondPass = null;
    control.seen.clear();
    removeTailwindProjects();
    vi.restoreAllMocks();
    process.exitCode = undefined;
});

/**
 * Migrate a project and read one file back.
 *
 * @param cwd - Project root.
 * @param file - Project-relative path to read.
 * @returns The file after the run.
 */
async function migrated(cwd: string, file: string): Promise<string> {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await migrate({ cwd, injectTodos: false });
    return readFileSync(path.join(cwd, file), 'utf8');
}

/** A stylesheet that serves a class the table refuses. */
const SERVES_NEGATIVE_AUTO = '@import "tailwindcss";\n@utility -z-auto { z-index: auto; }\n';

describe('csszyx migrate — the project answers where a table would', () => {
    it('migrates a class the project serves and the table refused', async () => {
        const cwd = tailwindProject({
            'src/app.css': SERVES_NEGATIVE_AUTO,
            'src/App.tsx': 'export const App = () => <div className="-z-auto p-4" />;\n',
        });

        const after = await migrated(cwd, 'src/App.tsx');

        expect(after).toContain("z: '-auto'");
        expect(after).not.toContain('className');
    });

    it('keeps a class the project does not serve, whatever the table says', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";\n',
            'src/App.tsx': 'export const App = () => <div className="-m-1/2 -z-auto p-4" />;\n',
        });

        const after = await migrated(cwd, 'src/App.tsx');

        expect(after).toContain('className="-m-1/2 -z-auto"');
        expect(after).toContain('p: 4');
    });

    it('falls back to the table when there is no Tailwind v4 to ask', async () => {
        const cwd = tailwindProject(
            {
                'src/app.css': SERVES_NEGATIVE_AUTO,
                'src/App.tsx': 'export const App = () => <div className="-z-auto p-4" />;\n',
            },
            { tailwind: false },
        );

        const after = await migrated(cwd, 'src/App.tsx');

        expect(after).toContain('className="-z-auto"');
    });

    it('asks every stylesheet, and a class one of them serves is served', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";\n',
            'src/landing.css': SERVES_NEGATIVE_AUTO,
            'src/App.tsx': 'export const App = () => <div className="-z-auto p-4" />;\n',
        });

        const after = await migrated(cwd, 'src/App.tsx');

        expect(after).toContain("z: '-auto'");
    });

    it('asks with the prefix the stylesheet sets', async () => {
        // Under `prefix(tw)` the bare `w-1/2` is not a class at all; the
        // project serves `tw:w-1/2`, which is the class that was written.
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss" prefix(tw);\n',
            'src/App.tsx': 'export const App = () => <div className="tw:w-1/2" />;\n',
        });

        const after = await migrated(cwd, 'src/App.tsx');

        expect(after).toContain("w: '1/2'");
    });

    it('answers for markup too', async () => {
        const cwd = tailwindProject({
            'src/app.css': SERVES_NEGATIVE_AUTO,
            'index.html': '<html><body><div class="-z-auto p-4"></div></body></html>\n',
        });

        const after = await migrated(cwd, 'index.html');

        expect(after).toContain("z: '-auto'");
        expect(after).not.toContain('class=');
    });

    it('migrates again only the files an answer changes', async () => {
        const cwd = tailwindProject({
            'src/app.css': SERVES_NEGATIVE_AUTO,
            'src/Changed.tsx': 'export const A = () => <div className="-z-auto p-4" />;\n',
            'src/Plain.tsx': 'export const B = () => <div className="p-4" />;\n',
            'src/Agreed.tsx': 'export const C = () => <div className="-m-1/2 p-4" />;\n',
        });

        await migrated(cwd, 'src/Changed.tsx');
        const read = (file: string): string => readFileSync(path.join(cwd, file), 'utf8');

        expect(read('src/Changed.tsx')).toContain("z: '-auto'");
        expect(read('src/Plain.tsx')).toContain('sz={{ p: 4 }}');
        expect(read('src/Agreed.tsx')).toContain('className="-m-1/2"');
    });

    it("keeps the tables' answer when the engine refuses the second pass", async () => {
        control.secondPass = 'error';
        const jsx = tailwindProject({
            'src/app.css': SERVES_NEGATIVE_AUTO,
            'src/App.tsx': 'export const App = () => <div className="-z-auto p-4" />;\n',
        });
        const html = tailwindProject({
            'src/app.css': SERVES_NEGATIVE_AUTO,
            'index.html': '<html><body><div class="-z-auto p-4"></div></body></html>\n',
        });

        expect(await migrated(jsx, 'src/App.tsx')).toContain('className="-z-auto"');
        expect(await migrated(html, 'index.html')).toContain('class="-z-auto"');
        expect(process.exitCode).toBeUndefined();
    });

    it('stops as it would on the first pass when the engine goes away', async () => {
        control.secondPass = 'unavailable';
        const cwd = tailwindProject({
            'src/app.css': SERVES_NEGATIVE_AUTO,
            'src/App.tsx': 'export const App = () => <div className="-z-auto p-4" />;\n',
        });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await migrate({ cwd, injectTodos: false });

        expect(process.exitCode).toBe(1);
        expect(log.mock.calls.join('\n')).toContain(
            '`@csszyx/core-went-away` is not installed, so migrate cannot run.',
        );
    });
});
