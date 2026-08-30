import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { compile } from '@tailwindcss/node';
import postcss from 'postcss';
import { afterEach, describe, expect, it } from 'vitest';
import csszyxPostcss from '../src/postcss.js';
import { renderSafelistFile } from '../src/safelist-format.js';

const tailwindNodeRequire = createRequire(
    createRequire(import.meta.url).resolve('@tailwindcss/node'),
);
const { Scanner } = tailwindNodeRequire('@tailwindcss/oxide') as {
    Scanner: new (options: {
        sources: Array<{ base: string; pattern: string; negated: boolean }>;
    }) => { scan(): string[] };
};

const TAILWIND_NODE_MODULES = dirname(
    dirname(createRequire(import.meta.url).resolve('tailwindcss/package.json')),
);

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * @returns a fresh project root with an `app/` directory, realpath'd so the
 *   relative paths the plugin computes match what Tailwind resolves.
 */
function projectRoot(): string {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'csszyx-postcss-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'app'));
    mkdirSync(join(root, '.csszyx'));
    // Tailwind resolves `@import "tailwindcss"` from the stylesheet's own
    // directory; give the temp project the node_modules that holds tailwindcss.
    symlinkSync(TAILWIND_NODE_MODULES, join(root, 'node_modules'), 'dir');
    return root;
}

/**
 * @param root - project root the safelist files live under
 * @param css - stylesheet source
 * @param options - plugin options beyond `root`
 * @param options.safelistFiles - explicit safelist files, when not the default
 * @returns the stylesheet after the plugin ran on `<root>/app/globals.css`
 */
async function run(
    root: string,
    css: string,
    options: { safelistFiles?: string[] } = {},
): Promise<string> {
    const result = await postcss([csszyxPostcss({ root, ...options })]).process(css, {
        from: join(root, 'app/globals.css'),
    });
    return result.css;
}

describe('csszyx PostCSS plugin', () => {
    /**
     * `@source` at a file that does not exist registers nothing with
     * Tailwind: the scanner reports no file and no glob for it, so nothing
     * tells Next to recompile when csszyx writes the safelist later. Naming
     * the directory is what makes a file that appears after the first
     * compile count as a change.
     */
    it('tells the bundler to watch the safelist directory', async () => {
        const root = projectRoot();
        const result = await postcss([csszyxPostcss({ root })]).process(
            '@import "tailwindcss" source(none);\n',
            { from: join(root, 'app/globals.css') },
        );
        expect(result.messages).toContainEqual(
            expect.objectContaining({
                type: 'dir-dependency',
                plugin: 'csszyx',
                dir: join(root, '.csszyx'),
                glob: 'csszyx-classes.txt',
            }),
        );
    });

    it('adds an @source for the csszyx safelist, relative to the stylesheet', async () => {
        const root = projectRoot();
        const css = await run(root, '@import "tailwindcss" source(none);\n@source "../app";\n');
        expect(css).toBe(
            '@import "tailwindcss" source(none);\n' +
                '@source "../app";\n' +
                '@source "../.csszyx/csszyx-classes.txt";\n',
        );
    });

    it('does not stack directives when run again or when the author already wrote one', async () => {
        const root = projectRoot();
        const once = await run(
            root,
            '@import "tailwindcss";\n' +
                "@source '../.csszyx/csszyx-classes.txt';\n" +
                '@source inline("underline");\n',
        );
        const twice = await run(root, once);
        expect(twice).toBe(once);
        expect(once.match(/csszyx-classes\.txt/g)).toHaveLength(1);
    });

    it('leaves a stylesheet alone unless it imports tailwindcss', async () => {
        const root = projectRoot();
        for (const css of [
            '.a { color: red; }\n',
            '/* @import "tailwindcss"; */\n.a { color: red; }\n',
            '@import "tailwindcss-animate";\n',
        ]) {
            expect(await run(root, css)).toBe(css);
        }
    });

    it('leaves a stylesheet alone when PostCSS does not know its path', async () => {
        const css = '@import "tailwindcss";\n';
        const result = await postcss([csszyxPostcss()]).process(css, { from: undefined });
        expect(result.css).toBe(css);
    });

    it('takes explicit safelist files', async () => {
        const root = projectRoot();
        const css = await run(root, '@import "tailwindcss";\n', {
            safelistFiles: ['generated/classes.txt'],
        });
        expect(css).toBe('@import "tailwindcss";\n@source "../generated/classes.txt";\n');
    });

    it('defaults the project root to the working directory', async () => {
        const root = projectRoot();
        const previous = process.cwd();
        process.chdir(root);
        try {
            const result = await postcss([csszyxPostcss()]).process('@import "tailwindcss";\n', {
                from: join(root, 'app/globals.css'),
            });
            expect(result.css).toContain('@source "../.csszyx/csszyx-classes.txt";');
        } finally {
            process.chdir(previous);
        }
    });

    it('makes Tailwind read the safelist csszyx wrote, with nothing else named', async () => {
        const root = projectRoot();
        writeFileSync(
            join(root, '.csszyx/csszyx-classes.txt'),
            renderSafelistFile(['p-4', 'space-y-4']),
        );
        const css = await run(root, '@import "tailwindcss" source(none);\n');

        const compiler = await compile(css, { base: join(root, 'app'), onDependency() {} });
        // The header's words come back as candidates too; none is a utility,
        // so Tailwind drops them and only the safelist's classes become CSS.
        const candidates = new Scanner({ sources: compiler.sources }).scan();
        expect(candidates).toEqual(expect.arrayContaining(['p-4', 'space-y-4']));
        const built = compiler.build(candidates);
        expect(built).toContain('.p-4');
        expect(built).toContain(':not(:last-child)');
    });
});
