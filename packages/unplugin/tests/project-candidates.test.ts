/**
 * The classes the project's Tailwind finds in its sources.
 *
 * The merge table is only as wide as the census it is built from, and a
 * census of `className` attributes and `szcn(...)` literals misses the most
 * common layout of a component library: a map of variants
 * (`const sizes = { sm: 'px-2 text-sm' }`) whose strings reach `szcn` through a
 * variable. Tailwind already finds every one of those strings, because it has
 * to generate their CSS; the model reads the same sources the same way.
 */
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openProjectStyleModel } from '../src/project-style-model.js';
import {
    linkTailwindIntegration,
    removeTailwindProjects,
    tailwindProject,
} from './tailwind-project.js';

afterEach(removeTailwindProjects);

const SIZES = "export const sizes = { sm: 'px-2 text-sm', lg: 'px-6 text-lg' };\n";

describe('the candidates of a project', () => {
    it('are the class names Tailwind finds in every source it scans', async () => {
        const root = tailwindProject('csszyx-candidates-', {
            'src/app.css': '@import "tailwindcss";\n',
            'src/sizes.ts': SIZES,
        });
        linkTailwindIntegration(root);
        const model = await openProjectStyleModel(root, [join(root, 'src/app.css')]);

        expect(model.candidates()).toEqual(
            expect.arrayContaining(['px-2', 'text-sm', 'px-6', 'text-lg']),
        );
    }, 60_000);

    it('follow `source(none)` and `@source` the way Tailwind does', async () => {
        const root = tailwindProject('csszyx-candidates-scoped-', {
            'app/app.css': '@import "tailwindcss" source(none);\n@source "../lib";\n',
            'lib/sizes.ts': SIZES,
            'other/ignored.ts': "export const x = 'gap-7';\n",
        });
        linkTailwindIntegration(root);
        const model = await openProjectStyleModel(root, [join(root, 'app/app.css')]);

        const candidates = model.candidates();
        expect(candidates).toEqual(expect.arrayContaining(['px-2', 'text-lg']));
        expect(candidates).not.toContain('gap-7');
    }, 60_000);

    it('skip automatic detection inside a monorepo, which walks node_modules too', async () => {
        // An entry with no `source(...)` scans its whole package, and in a
        // workspace that reaches every linked package: measured at 26,942
        // files and 10 s on one playground. The build already warns about that
        // setup; the merge table does not pay for it again.
        const root = tailwindProject('csszyx-candidates-monorepo-', {
            'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
            'apps/web/package.json': '{ "name": "web" }\n',
            'apps/web/app.css': '@import "tailwindcss";\n',
            'apps/web/sizes.ts': SIZES,
        });
        linkTailwindIntegration(root);
        const web = join(root, 'apps/web');
        const model = await openProjectStyleModel(web, [join(web, 'app.css')]);

        expect(model.candidates()).toEqual([]);
    }, 60_000);

    it('still scan a scoped entry inside a monorepo', async () => {
        const root = tailwindProject('csszyx-candidates-monorepo-scoped-', {
            'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
            'apps/web/package.json': '{ "name": "web" }\n',
            'apps/web/app.css': '@import "tailwindcss" source("./src");\n',
            'apps/web/src/sizes.ts': SIZES,
        });
        linkTailwindIntegration(root);
        const web = join(root, 'apps/web');
        const model = await openProjectStyleModel(web, [join(web, 'app.css')]);

        expect(model.candidates()).toEqual(expect.arrayContaining(['px-2', 'text-lg']));
    }, 60_000);

    it('are empty when the project has no Tailwind scanner to ask', async () => {
        // No integration installed: the census stays what the build saw, the
        // merge keeps what it cannot prove, and nothing fails.
        const root = tailwindProject('csszyx-candidates-none-', {
            'src/app.css': '@import "tailwindcss";\n',
            'src/sizes.ts': SIZES,
        });
        const model = await openProjectStyleModel(root, [join(root, 'src/app.css')]);

        expect(model.candidates()).toEqual([]);
    }, 60_000);
});
