/**
 * What a build removes, listed for an upgrade audit.
 *
 * Nothing prints when a build merges, so an app upgrading to 0.18 needs a way
 * to see every class the build drops: a later `sz` key over an earlier one it
 * covers (`merge-covered-key`), and a class-name class an `sz` class beside it
 * covers (`merge-covered-class`). The audit reads the same model and the same
 * first pass the build does.
 */
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { auditMerges } from '../src/merge-audit.js';
import { openStylesheetModel } from '../src/next-stylesheet-facts.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(removeTailwindProjects);

describe('the merge audit', () => {
    it('lists what each file loses, and to which rule', async () => {
        const files = {
            'src/A.tsx':
                'export const A = () => <><div className="card pb-2" sz={{ p: 4 }} />' +
                '<b sz={{ px: 2, p: 4 }} /></>;\n',
            'src/B.tsx': 'export const B = () => <div className="pb-2" sz={{ m: 2 }} />;\n',
        };
        const root = tailwindProject('csszyx-merge-audit-', {
            'src/index.css': '@import "tailwindcss";\n',
            ...files,
        });
        const { model } = await openStylesheetModel({
            root,
            cacheDir: join(root, '.csszyx/cache'),
        });
        const findings = auditMerges({
            model,
            classPrefix: null,
            files: Object.entries(files).map(([relative, source]) => ({
                path: join(root, relative),
                relative,
                source,
            })),
        });
        expect(findings).toEqual([
            { file: 'src/A.tsx', kind: 'merge-covered-key', classes: ['px-2'] },
            { file: 'src/A.tsx', kind: 'merge-covered-class', classes: ['pb-2'] },
        ]);
    }, 60_000);

    it('lists nothing a project class keeps', async () => {
        const source = 'export const A = () => <div className="reveal" sz={{ opacity: 100 }} />;\n';
        const root = tailwindProject('csszyx-merge-audit-hook-', {
            'src/index.css': '@import "tailwindcss";\n@utility reveal { opacity: 0; }\n',
            'src/A.tsx': source,
        });
        const { model } = await openStylesheetModel({
            root,
            cacheDir: join(root, '.csszyx/cache'),
        });
        const files = [{ path: join(root, 'src/A.tsx'), relative: 'src/A.tsx', source }];
        expect(auditMerges({ model, classPrefix: null, files })).toEqual([]);
    }, 60_000);
});
