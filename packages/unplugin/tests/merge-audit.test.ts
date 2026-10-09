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

import { auditMerges, mergeFindingsOf } from '../src/merge-audit.js';
import { openStylesheetModel } from '../src/next-stylesheet-facts.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(removeTailwindProjects);

describe('the merge audit', () => {
    it('lists what each file loses, where, and to which rule', async () => {
        const files = {
            'src/A.tsx':
                'export const A = () => <><div className="card pb-2" sz={{ p: 4 }} />\n' +
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
            { file: 'src/A.tsx', line: 1, kind: 'merge-covered-class', className: 'pb-2' },
            { file: 'src/A.tsx', line: 2, kind: 'merge-covered-key', className: 'px-2', key: 'px' },
        ]);
    }, 60_000);

    it('places a removed key on its own line, and a nested one on its variant key', async () => {
        const source =
            'export const A = () => <><b sz={{ m: 1,\n' +
            '    pb: 2,\n' +
            '    p: 4 }} />\n' +
            '<i sz={[{ m: 1,\n' +
            '    hover: { pb: 2 } },\n' +
            '    { hover: { p: 4 } }]} /></>;\n';
        const root = tailwindProject('csszyx-merge-audit-lines-', {
            'src/index.css': '@import "tailwindcss";\n',
            'src/A.tsx': source,
        });
        const { model } = await openStylesheetModel({
            root,
            cacheDir: join(root, '.csszyx/cache'),
        });
        const files = [{ path: join(root, 'src/A.tsx'), relative: 'src/A.tsx', source }];
        expect(auditMerges({ model, classPrefix: null, files })).toEqual([
            { file: 'src/A.tsx', line: 2, kind: 'merge-covered-key', className: 'pb-2', key: 'pb' },
            {
                file: 'src/A.tsx',
                line: 5,
                kind: 'merge-covered-key',
                className: 'hover:pb-2',
                key: 'hover',
            },
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

describe('the findings of one first pass', () => {
    it('reads a pass with no merge lists as nothing removed', () => {
        expect(mergeFindingsOf({}, 'src/A.tsx', () => null)).toEqual([]);
    });
});
