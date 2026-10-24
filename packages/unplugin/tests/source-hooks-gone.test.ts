/**
 * A file the project walk lists can be gone by the time its hooks are read:
 * deleted by another process between the listing and the read. It selects on
 * nothing then, and the build reads every other file as before.
 */
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const gone = vi.hoisted(() => ({ reads: [] as string[] }));

vi.mock('node:fs', async importOriginal => {
    const real = await importOriginal<typeof import('node:fs')>();
    return {
        ...real,
        readFileSync: ((...args: Parameters<typeof real.readFileSync>) => {
            const file = String(args[0]);
            if (/[\\/]Gone\.(?:vue|tsx)$/.test(file)) {
                gone.reads.push(file.slice(file.lastIndexOf('Gone')));
                throw Object.assign(new Error(`ENOENT: no such file, open '${file}'`), {
                    code: 'ENOENT',
                });
            }
            return real.readFileSync(...args);
        }) as typeof real.readFileSync,
    };
});

const { rollupPlugin, vitePlugin } = await import('../src/unplugin.js');
const { callHooks, removeTailwindProjects, tailwindProject } = await import(
    './tailwind-project.js'
);

afterEach(() => {
    gone.reads.length = 0;
    removeTailwindProjects();
    vi.restoreAllMocks();
});

/** A style block that selects on `shadow-md`, and one that selects on `shadow-lg`. */
const SELECTS_MD = '<style scoped>.card.shadow-md { outline: 0; }</style>\n';
const SELECTS_LG = '<style scoped>.card.shadow-lg { outline: 0; }</style>\n';
const COVERED =
    'export const A = () => <div className="card shadow-md" sz={{ shadow: "lg" }} />;\n';

describe('a file gone between the walk and its read', () => {
    it('selects on nothing in the Vite prescan, which reads every file in one scan', async () => {
        const root = tailwindProject('csszyx-source-hooks-gone-vite-', {
            'src/index.css': '@import "tailwindcss";\n',
            'src/A.tsx': COVERED,
            'src/Card.vue': SELECTS_MD,
            'src/Gone.vue': SELECTS_LG,
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const call = callHooks(
            vitePlugin({
                build: { cache: false },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command: 'build' });
        const { code } = (await call('transform', COVERED, join(root, 'src/A.tsx'))) as {
            code: string;
        };
        expect(gone.reads).toContain('Gone.vue');
        expect(code).toContain('card shadow-md shadow-lg');
    }, 60_000);

    it('selects on nothing, and the files beside it are still read', async () => {
        const root = tailwindProject('csszyx-source-hooks-gone-', {
            'src/index.css': '@import "tailwindcss";\n',
            'src/A.tsx': COVERED,
            'src/Card.vue': SELECTS_MD,
            'src/Gone.vue': SELECTS_LG,
            'src/Gone.tsx': 'export const G = () => <b className="group-[.shadow-lg]:p-2" />;\n',
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const [pre] = rollupPlugin({
            build: { cache: false },
            production: { mangle: false },
        }) as unknown as Array<{
            buildStart: (this: unknown) => Promise<void>;
            transform: (this: unknown, code: string, id: string) => { code: string };
        }>;
        const ctx = { warn() {}, meta: {} };
        await pre?.buildStart.call(ctx);
        const code = pre?.transform.call(ctx, COVERED, join(root, 'src/A.tsx'))?.code;
        expect(gone.reads).toEqual(expect.arrayContaining(['Gone.vue', 'Gone.tsx']));
        // `Card.vue` still keeps `shadow-md`, which `shadow-lg` would cover.
        expect(code).toContain('card shadow-md shadow-lg');
    }, 60_000);
});
