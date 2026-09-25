/**
 * Which classes a merge may remove or be removed by.
 *
 * Only Tailwind's own utilities, and only those the project's CSS does not
 * select on. A class from `@utility`, a plugin or plain CSS, and a Tailwind
 * class a project rule selects, keep no merge signature: nothing removes them
 * and they remove nothing, the way the build and `szcn` treated every class
 * before 0.18. Their raw signature stays readable for diagnostics.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    defaultTailwindLoader,
    type TailwindLoader,
} from '../../tailwind-oracle/src/emitted-class-oracle.js';
import { MERGE_TABLE_FILE, writeMergeRegistration } from '../src/merge-registration.js';
import { prepareNextStylesheetFacts } from '../src/next-stylesheet-facts.js';
import { openProjectStyleModel, originWarning } from '../src/project-style-model.js';
import { vitePlugin } from '../src/unplugin.js';
import { RESOLVED_UNSERVED_VIRTUAL_ID } from '../src/virtual-modules.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

const HOOKS =
    '@import "tailwindcss";\n@utility reveal { opacity: 0; }\n.card.shadow-md { outline: 1px solid; }\n';
const STRICT_PLUGIN =
    'export default { handler({ addUtilities }) {\n' +
    '    if (addUtilities.name !== "addUtilities") throw new Error("not the real API");\n' +
    '} };\n';

/**
 * A model over one project.
 *
 * @param files - Files to write; every `.css` file is handed to the model.
 * @returns The model and its root.
 */
async function modelOf(files: Record<string, string>) {
    const root = tailwindProject('csszyx-merge-scope-', files);
    const css = Object.keys(files)
        .filter(file => file.endsWith('.css'))
        .map(file => join(root, file));
    return { root, model: await openProjectStyleModel(root, css) };
}

describe('the signature a merge reads', () => {
    it("is Tailwind's own utilities' only", async () => {
        const { model } = await modelOf({
            'app.css':
                '@import "tailwindcss";\n@theme { --spacing-brand: 3px; }\n' +
                '@utility reveal { opacity: 0; }\n.card.shadow-md { outline: 1px solid; }',
        });
        expect(model.mergeSignature('opacity-100')).not.toBeNull();
        expect(model.mergeSignature('p-brand')).not.toBeNull();
        expect(model.mergeSignature('reveal')).toBeNull();
        expect(model.mergeSignature('shadow-md')).toBeNull();
        expect(model.mergeSignature('shadow-lg')).not.toBeNull();
        // Diagnostics still read what each class sets.
        expect(model.signature('reveal')).not.toBeNull();
        expect(model.signature('shadow-md')).not.toBeNull();
        expect(originWarning(model, '/')).toBeNull();
    });

    it('is withheld when any root reads the class as the project’s', async () => {
        const { model } = await modelOf({
            'a.css': '@import "tailwindcss";\n.card.shadow-md { outline: 1px solid; }',
            'b.css': '@import "tailwindcss";',
        });
        // Both roots serve it with the same CSS, so the raw signature agrees.
        expect(model.signature('shadow-md')).not.toBeNull();
        expect(model.mergeSignature('shadow-md')).toBeNull();
        expect(model.mergeSignature('shadow-lg')).not.toBeNull();
    });

    it('is withheld for every class when they cannot be told apart, and the build says so', async () => {
        // A plugin that refuses the API with its class registrars silenced: the
        // second compile throws, and no class can be shown to be Tailwind's.
        const { model, root } = await modelOf({
            'app.css': '@import "tailwindcss";\n@plugin "./strict.mjs";',
            'strict.mjs':
                'export default { handler({ addUtilities }) {\n' +
                '    if (addUtilities.name !== "addUtilities") throw new Error("not the real API");\n' +
                '} };\n',
        });
        expect(model.signature('p-4')).not.toBeNull();
        expect(model.mergeSignature('p-4')).toBeNull();
        expect(originWarning(model, root)).toBe(
            [
                '[csszyx] csszyx merges no class in this build: app.css did not compile with its `@utility` blocks and plugin classes taken out (not the real API).',
                '  help: report it at https://github.com/nguyennhutien/csszyx/issues with the plugin or `@utility` block the stylesheet uses.',
                '  note: every class is kept: `{ pb: 2, p: 4 }` emits `pb-2 p-4`, a `className` class stays next to the `sz` classes, and `szcn` removes only exact repeats.',
            ].join('\n'),
        );
    });
});

describe('a stylesheet no Tailwind entry imports', () => {
    // Imported from a component, or written for a page: the build walks it,
    // and a rule in it selects on the class as surely as one in the entry.
    it('makes the Tailwind classes it selects on hooks', async () => {
        const { model } = await modelOf({
            'src/index.css': '@import "tailwindcss";\n',
            'src/card.css': '.card.shadow-md { outline: 2px solid red; }\n',
        });
        expect(model.entries.map(entry => entry.role)).toEqual(['root', 'not-root']);
        expect(model.mergeSignature('shadow-md')).toBeNull();
        expect(model.mergeSignature('shadow-lg')).not.toBeNull();
    });

    it('makes a class its attribute selector matches a hook', async () => {
        const { model } = await modelOf({
            'src/index.css': '@import "tailwindcss";\n',
            'src/card.css': '.card [class~="shadow-md"] { outline: 0; }\n',
        });
        expect(model.mergeSignature('shadow-md')).toBeNull();
        expect(model.mergeSignature('shadow-lg')).not.toBeNull();
    });

    // One the build cannot resolve still selects on the element once the
    // bundler resolves it, so its rules are read all the same.
    it('makes the Tailwind classes it selects on hooks even when it does not compile', async () => {
        const { model } = await modelOf({
            'src/index.css': '@import "tailwindcss";\n',
            'src/card.css': '@import "./missing.css";\n.card.shadow-md { outline: 0; }\n',
        });
        expect(model.entries.map(entry => entry.role)).toEqual(['root', 'failed']);
        expect(model.mergeSignature('shadow-md')).toBeNull();
    });
});

describe('stylesheets a named list leaves out', () => {
    // Naming the stylesheets narrows what decides the prefix and the table, not
    // which rules select on an element: a component still imports its own CSS.
    it('are read for the classes their rules select on', async () => {
        const root = tailwindProject('csszyx-merge-scope-named-', {
            'src/index.css': '@import "tailwindcss";\n',
            'src/card.css': '.card.shadow-md { outline: 0; }\n',
        });
        const model = await openProjectStyleModel(root, [join(root, 'src/index.css')], {
            hookStylesheets: [join(root, 'src/card.css'), join(root, 'src/gone.css')],
        });
        expect(model.entries).toHaveLength(1);
        expect(model.mergeSignature('shadow-md')).toBeNull();
        expect(model.mergeSignature('shadow-lg')).not.toBeNull();
    });

    it('by `next prebuild` with `--tailwind-stylesheet`', async () => {
        const root = tailwindProject('csszyx-merge-scope-named-next-', {
            'package.json': '{ "name": "app" }\n',
            'app/globals.css': '@import "tailwindcss";\n',
            'app/card.css': '.card.shadow-md { outline: 0; }\n',
        });
        const facts = await prepareNextStylesheetFacts({
            explicitRoot: root,
            tailwindStylesheet: ['app/globals.css'],
        });
        expect(facts.model.mergeSignature('shadow-md')).toBeNull();
    }, 60_000);

    it('by a bundler build with `tailwindStylesheet`', async () => {
        const root = tailwindProject('csszyx-merge-scope-named-vite-', {
            'src/index.css': '@import "tailwindcss";\n',
            'src/card.css': '.card.shadow-md { outline: 0; }\n',
            'src/App.tsx':
                'export const A = () => <p className="shadow-md shadow-lg pb-2 p-4" />;\n',
        });
        const call = callHooks(
            vitePlugin({
                tailwindStylesheet: 'src/index.css',
                build: { cache: false },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command: 'serve' });
        const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
        await call('transform', app, join(root, 'src/App.tsx'));
        const table = ((await call('load', RESOLVED_UNSERVED_VIRTUAL_ID)) as string).split(
            'registerMergeSignatures(',
        )[1];
        expect(table).toContain('\\"pb-2\\"');
        expect(table).not.toContain('\\"shadow-md\\"');
    }, 60_000);
});

describe('what opening the model costs', () => {
    /**
     * How many design systems one model open compiles.
     *
     * @param files - The project; every `.css` file is handed over.
     * @returns The number of `loadDesignSystem` calls.
     */
    async function compiles(files: Record<string, string>): Promise<number> {
        const root = tailwindProject('csszyx-merge-scope-cost-', files);
        let calls = 0;
        const loadTailwind: TailwindLoader = async from => {
            const tailwind = await defaultTailwindLoader(from);
            if (tailwind === null) return null;
            const load = tailwind.loadDesignSystem as (...args: unknown[]) => Promise<unknown>;
            return {
                ...tailwind,
                loadDesignSystem: async (...args: unknown[]) => {
                    calls += 1;
                    return load(...args);
                },
            };
        };
        const css = Object.keys(files)
            .filter(file => file.endsWith('.css'))
            .map(file => join(root, file));
        const model = await openProjectStyleModel(root, css, { loadTailwind });
        model.mergeSignature('p-4');
        model.mergeSignature('p-4');
        return calls;
    }

    it.each([
        {
            name: 'a root that declares nothing',
            expected: 1,
            files: { 'a.css': '@import "tailwindcss";' },
        },
        {
            name: 'a root with @utility',
            expected: 2,
            files: { 'a.css': '@import "tailwindcss";\n@utility x { opacity: 0 }' },
        },
        {
            name: 'a root with @plugin',
            expected: 2,
            files: {
                'a.css': '@import "tailwindcss";\n@plugin "./p.mjs";',
                'p.mjs': 'export default { handler() {} };',
            },
        },
        {
            name: 'two roots with @utility',
            expected: 4,
            files: {
                'a.css': '@import "tailwindcss";\n@utility x { opacity: 0 }',
                'b.css': '@import "tailwindcss";\n@utility y { opacity: 0 }',
            },
        },
    ])(
        'is $expected compiles for $name, however often a merge asks',
        async ({ files, expected }) => {
            expect(await compiles(files)).toBe(expected);
        },
    );
});

describe('the table a Next command writes', () => {
    it('leaves out the project’s classes, as the bundler’s does', async () => {
        const root = tailwindProject('csszyx-merge-scope-settle-', {
            'package.json': '{ "name": "app" }\n',
            'app/globals.css': HOOKS,
        });
        const facts = await prepareNextStylesheetFacts({ explicitRoot: root });
        writeMergeRegistration({
            root,
            model: facts.model,
            classes: ['reveal', 'opacity-100', 'shadow-md', 'shadow-lg', 'pb-2', 'p-4'],
            authoredClasses: [],
            mergeLiterals: [],
        });
        const table = readFileSync(join(root, '.csszyx', MERGE_TABLE_FILE), 'utf8');
        expect(table).toContain('"pb-2"');
        expect(table).not.toContain('"reveal"');
        expect(table).not.toContain('"shadow-md"');
    }, 60_000);
});

/**
 * Where a source file reads a member named `signature`: `x.signature`,
 * `x['signature']`, or `{ signature }` taken apart from an object.
 *
 * @param file - Path of the file.
 * @param text - Its source.
 * @returns One `file: expression` per read.
 */
function signatureReads(file: string, text: string): string[] {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const reads: string[] = [];
    const at = (node: ts.Node) => `${file}: ${node.getText(source)}`;
    const visit = (node: ts.Node): void => {
        const named =
            (ts.isPropertyAccessExpression(node) && node.name.text === 'signature') ||
            (ts.isElementAccessExpression(node) &&
                ts.isStringLiteralLike(node.argumentExpression) &&
                node.argumentExpression.text === 'signature') ||
            (ts.isBindingElement(node) &&
                ts.isObjectBindingPattern(node.parent) &&
                (node.propertyName ?? node.name).getText(source) === 'signature');
        if (named) reads.push(at(node));
        ts.forEachChild(node, visit);
    };
    visit(source);
    return reads;
}

describe('no table is built from the raw signature', () => {
    // A table built from `signature` would let a merge remove a hook again.
    it('is read only by the style model and its merge signature', () => {
        const dir = join(import.meta.dirname, '../src');
        const reads = readdirSync(dir)
            .filter(file => file.endsWith('.ts'))
            .flatMap(file => signatureReads(file, readFileSync(join(dir, file), 'utf8')));
        expect(reads).toEqual([
            // The model's own aggregation over its roots.
            'project-style-model.ts: entry.signature',
            // A stamp of the files a theme scan read; not a merge signature.
            'theme-groups-file.ts: cached.signature',
        ]);
    });

    it.each([
        ['a call', 'model.signature(c);'],
        ['an element access', "model['signature'](c);"],
        ['a destructured read', 'const { signature } = model;'],
        ['a renamed destructured read', 'const { signature: read } = model;'],
    ])('finds %s', (_, text) => {
        expect(signatureReads('x.ts', text)).toHaveLength(1);
    });
});

describe.each(['rust', 'wasm'] as const)('a Vite build (%s)', parser => {
    /**
     * Transform one component on a Vite dev server over a project.
     *
     * @param files - The project's files; `src/App.tsx` is transformed.
     * @returns The emitted classes and the table the page registers.
     */
    async function serve(files: Record<string, string>) {
        const root = tailwindProject('csszyx-merge-scope-vite-', files);
        const call = callHooks(
            vitePlugin({
                build: { cache: false, parser },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command: 'serve' });
        const app = files['src/App.tsx'] as string;
        const { code } = (await call('transform', app, join(root, 'src/App.tsx'))) as {
            code: string;
        };
        const table = (await call('load', RESOLVED_UNSERVED_VIRTUAL_ID)) as string;
        return {
            classes: [...code.matchAll(/className[=:]\s*"([^"]*)"/g)].map(match => match[1]),
            // Serialized inside a `JSON.parse` string, so every quote is escaped.
            table: table.split('registerMergeSignatures(')[1] ?? '',
        };
    }

    it('keeps a project class an sz key names next to the key that covers it', async () => {
        const { classes, table } = await serve({
            'src/index.css': HOOKS,
            'src/App.tsx':
                'export const A = () => <><p sz={{ reveal: true, opacity: 100 }} />' +
                '<p sz={{ pb: 2, p: 4 }} /><p className="card shadow-md shadow-lg" /></>;\n',
        });
        expect(classes).toEqual(['reveal opacity-100', 'p-4', 'card shadow-md shadow-lg']);
        // Nor does `szcn` remove them at run time: the table keeps only classes
        // in a covering pair, and these two are no longer in one.
        expect(table).toContain('\\"pb-2\\"');
        expect(table).not.toContain('\\"reveal\\"');
        expect(table).not.toContain('\\"shadow-md\\"');
    }, 60_000);
});

describe('when the classes cannot be told apart', () => {
    it('a production build says so', async () => {
        const root = tailwindProject('csszyx-merge-scope-prod-', {
            'src/index.css': '@import "tailwindcss";\n@plugin "./strict.mjs";\n',
            'src/strict.mjs': STRICT_PLUGIN,
            'src/App.tsx': 'export const A = () => <p sz={{ pb: 2, p: 4 }} />;\n',
        });
        vi.stubEnv('NODE_ENV', 'production');
        const warnings: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
            warnings.push(args.map(String).join(' '));
        });
        const call = callHooks(
            vitePlugin({
                build: { cache: false },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command: 'build' });
        const { code } = (await call(
            'transform',
            'export const A = () => <p sz={{ pb: 2, p: 4 }} />;\n',
            join(root, 'src/App.tsx'),
        )) as { code: string };

        expect(code).toContain('className="pb-2 p-4"');
        expect(warnings.filter(line => line.includes('merges no class'))).toHaveLength(1);
    }, 60_000);

    it('`next prebuild` says so', async () => {
        const root = tailwindProject('csszyx-merge-scope-next-', {
            'package.json': '{ "name": "app" }\n',
            'app/globals.css': '@import "tailwindcss";\n@plugin "./strict.mjs";\n',
            'app/strict.mjs': STRICT_PLUGIN,
        });
        const facts = await prepareNextStylesheetFacts({ explicitRoot: root });
        expect(facts.warning).toContain(
            'csszyx merges no class in this build: app/globals.css did not compile with its `@utility` blocks and plugin classes taken out (not the real API).',
        );
    }, 60_000);
});
