import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { szcn } from '../../runtime/src/merge-classes.js';
import {
    __resetMergeSignaturesForTests,
    type MergeSignatureTable,
    registerMergeSignatures,
} from '../../runtime/src/merge-signatures.js';
import { collectMergeCallClassNames } from '../src/authored-class-scanner.js';
import { writeMergeRegistration } from '../src/merge-registration.js';
import { createMergeSignatureTable } from '../src/merge-signature.js';
import { openProjectStyleModel } from '../src/project-style-model.js';
import {
    linkTailwindIntegration,
    removeTailwindProjects,
    tailwindProject,
} from './tailwind-project.js';

afterEach(() => {
    __resetMergeSignaturesForTests();
    removeTailwindProjects();
});

/**
 * Run the generated module the way a bundle would, capturing what it registers.
 *
 * @param file - Path of the generated module.
 * @returns The two registrations.
 */
function registrations(file: string): { unserved: unknown; table: unknown } {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toContain('___CSSZYX_');
    let unserved: unknown;
    let table: unknown;
    runInNewContext(source.replace(/^import .*;$/m, ''), {
        registerUnservedClasses(value: unknown) {
            unserved = value;
        },
        registerMergeSignatures(value: unknown) {
            table = value;
        },
    });
    return { unserved, table };
}

describe('the runtime registration the Next lane writes', () => {
    it('registers the classes the design system serves nothing for and the merge table', async () => {
        const root = tailwindProject('csszyx-next-unserved-', {
            'app.css': '@import "tailwindcss";',
        });
        const model = await openProjectStyleModel(root, [join(root, 'app.css')]);
        const written = writeMergeRegistration({
            root,
            model,
            classes: ['pb-2', 'p-4'],
            authoredClasses: ['tab-items-wrapper', 'p-4'],
            mergeLiterals: ['text-sm'],
        });

        expect(written.changed).toBe(true);
        const { unserved, table } = registrations(written.path);
        expect(unserved).toEqual(['tab-items-wrapper']);
        expect(table).toEqual(
            createMergeSignatureTable(['pb-2', 'p-4', 'tab-items-wrapper', 'text-sm'], candidate =>
                model.signature(candidate),
            ),
        );
        registerMergeSignatures(table as MergeSignatureTable);
        expect(szcn('pb-2', 'p-4')).toBe('p-4');
    }, 60_000);

    it('writes a CommonJS twin that registers the same data, for jest', async () => {
        // jest in its default mode transforms no `.mjs` and cannot require an
        // ES module, so a suite imports this twin instead.
        const root = tailwindProject('csszyx-next-unserved-cjs-', {
            'app.css': '@import "tailwindcss";',
        });
        const model = await openProjectStyleModel(root, [join(root, 'app.css')]);
        const written = writeMergeRegistration({
            root,
            model,
            classes: ['pb-2', 'p-4'],
            authoredClasses: ['tab-items-wrapper'],
            mergeLiterals: [],
        });

        const source = readFileSync(written.path.replace(/\.mjs$/, '.cjs'), 'utf8');
        expect(source).not.toMatch(/^import /m);
        let unserved: unknown;
        let table: unknown;
        runInNewContext(source, {
            JSON,
            require: (id: string) => {
                expect(id).toBe('@csszyx/runtime');
                return {
                    registerUnservedClasses: (value: unknown) => {
                        unserved = value;
                    },
                    registerMergeSignatures: (value: unknown) => {
                        table = value;
                    },
                };
            },
        });
        expect({ unserved, table }).toEqual(registrations(written.path));
    }, 60_000);

    it('carries the classes Tailwind scans beside the census the shards carry', async () => {
        const root = tailwindProject('csszyx-next-unserved-scan-', {
            'app.css': '@import "tailwindcss";',
            'lib/sizes.ts': "export const sizes = { sm: 'px-2 text-sm', lg: 'px-6 text-lg' };\n",
        });
        linkTailwindIntegration(root);
        const model = await openProjectStyleModel(root, [join(root, 'app.css')]);

        const written = writeMergeRegistration({
            root,
            model,
            classes: [],
            authoredClasses: [],
            mergeLiterals: [],
        });

        const { table } = registrations(written.path);
        expect(Object.keys((table as MergeSignatureTable)[0])).toEqual(
            expect.arrayContaining(['px-2', 'px-6', 'text-sm', 'text-lg']),
        );
    }, 60_000);

    it('leaves the file alone when nothing it registers changed', async () => {
        const root = tailwindProject('csszyx-next-unserved-same-', {
            'app.css': '@import "tailwindcss";',
        });
        const model = await openProjectStyleModel(root, [join(root, 'app.css')]);
        const input = {
            root,
            model,
            classes: ['p-4'],
            authoredClasses: [],
            mergeLiterals: [],
        };
        const first = writeMergeRegistration(input);
        const before = statSync(first.path).mtimeMs;
        await new Promise(resolve => setTimeout(resolve, 20));

        const second = writeMergeRegistration(input);

        // Turbopack re-runs every module that imports the file when it changes,
        // so a rewrite with the same bytes would be a rebuild for nothing.
        expect(second.changed).toBe(false);
        expect(statSync(second.path).mtimeMs).toBe(before);
    }, 60_000);

    it('registers nothing when no stylesheet gave a design system', () => {
        const root = tailwindProject('csszyx-next-unserved-none-', {});
        const written = writeMergeRegistration({
            root,
            model: null,
            classes: ['p-4'],
            authoredClasses: ['tab-items-wrapper'],
            mergeLiterals: [],
        });
        // No design system is no answer: every class keeps the placement it
        // has today, and every merge keeps both sides.
        expect(registrations(written.path)).toEqual({ unserved: [], table: [{}, []] });
    });
});

describe('class names written inside a merge call', () => {
    it('reads every string literal, through nested parentheses', () => {
        const source = [
            'const a = szcn(\'p-4 gap-2\', "text-sm");',
            "const b = _szcn(pick('unrelated'), 'mt-2');",
            "const c = szcn(cond ? 'left' : 'right');",
            "notSzcn('skipped');",
        ].join('\n');
        expect([...collectMergeCallClassNames(source)].sort()).toEqual([
            'gap-2',
            'left',
            'mt-2',
            'p-4',
            'right',
            'text-sm',
            'unrelated',
        ]);
    });

    it('splits a padded literal without keeping the padding', () => {
        const source = 'szcn(\'  p-4   gap-2 \', " ");';
        expect([...collectMergeCallClassNames(source)].sort()).toEqual(['gap-2', 'p-4']);
    });
});
