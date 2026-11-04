/**
 * Importing the plugin loads no framework adapter.
 *
 * The Vue and Svelte adapters lower a `.vue` or `.svelte` file and nothing
 * else, so a React or Solid build has no use for them. The plugin imported both
 * at the top of the module, so every build loaded both, and a project that
 * used neither still depended on their versions matching the rest of csszyx to
 * load its config. Each now loads when the build meets the first file it
 * lowers.
 *
 * Recorded, not poisoned by name: a child process registers a resolve hook
 * and imports an entry, so any route to an adapter shows. It runs in a child
 * because the hook has to be in place before the first import.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Prelude that records every module the child resolves. */
const RECORD = `
    const { registerHooks } = require('node:module');
    const resolved = [];
    registerHooks({
        resolve(specifier, context, next) {
            const result = next(specifier, context);
            resolved.push(result.url);
            return result;
        },
    });
    // Packages, not modules: one adapter is several files.
    const adapters = () =>
        new Set(resolved.map(url => /(vue|svelte)-adapter\\//.exec(url)?.[1]).filter(Boolean)).size;
    // The template kit both adapters share, and the source-map writer it
    // pulls in: only a build that meets a template file needs either.
    const templateKit = () =>
        new Set(
            resolved
                .map(url => /(compiler\\/dist\\/template)\\.|\\/(magic-string)\\//.exec(url))
                .filter(Boolean)
                .map(match => match[1] ?? match[2]),
        ).size;
    // Packages of one framework, by name, from any adapter.
    const frameworkPackages = name =>
        resolved.filter(url => new RegExp('/(@' + name + '/|' + name + '/|' + name + '-adapter/)').test(url)).length;
`;

/**
 * How many adapter packages a child resolves running `script`.
 *
 * @param script - CommonJS run in the child; it calls `done()` when finished.
 * @returns The count.
 */
function adaptersLoaded(script: string): number {
    return recorded('adapters()', script) as number;
}

/**
 * What the child's recorder counts after it runs `script`.
 *
 * @param count - The recorder expression to print, e.g. `templateKit()`.
 * @param script - CommonJS run in the child; it calls `done()` when finished.
 * @param parse - Reads the child's output; a number by default.
 * @returns The count.
 */
function recorded(
    count: string,
    script: string,
    parse: (out: string) => unknown = Number,
): unknown {
    const out = execFileSync(
        process.execPath,
        [
            '-e',
            `${RECORD}\nconst done = () => process.stdout.write(JSON.stringify(${count}));\n${script}`,
        ],
        { encoding: 'utf8', cwd: PACKAGE },
    );
    return parse(out);
}

/** Every entry the package exports, as built. */
const ENTRIES = Object.values(
    JSON.parse(readFileSync(path.join(PACKAGE, 'package.json'), 'utf8')).exports as Record<
        string,
        string | { import?: string | { default?: string }; default?: string }
    >,
).map(target => {
    if (typeof target === 'string') return target;
    const esm = target.import;
    return (typeof esm === 'string' ? esm : esm?.default) ?? (target.default as string);
});

describe('the plugin entries', () => {
    it.each(['vue', 'svelte'])(
        'records a %s adapter import, so a zero below means something',
        framework => {
            expect(adaptersLoaded(`import('@csszyx/${framework}-adapter').then(done);`)).toBe(1);
        },
    );

    it.each(ENTRIES)('%s loads no framework adapter on import', entry => {
        expect(
            adaptersLoaded(`import(${JSON.stringify(path.join(PACKAGE, entry))}).then(done);`),
        ).toBe(0);
    });
});

describe('the template kit', () => {
    it('is recorded when imported, so a zero below means something', () => {
        expect(recorded('templateKit()', "import('@csszyx/compiler/template').then(done);")).toBe(
            2,
        );
    });

    it.each(ENTRIES)('%s loads neither the template kit nor magic-string on import', entry => {
        expect(
            recorded(
                'templateKit()',
                `import(${JSON.stringify(path.join(PACKAGE, entry))}).then(done);`,
            ),
        ).toBe(0);
    });
});

describe('each adapter', () => {
    it.each([
        ['svelte', 'vue'],
        ['vue', 'svelte'],
    ])('the %s adapter loads nothing of %s', (framework, other) => {
        const counts = recorded(
            `[frameworkPackages(${JSON.stringify(framework)}), frameworkPackages(${JSON.stringify(other)})]`,
            `import('@csszyx/${framework}-adapter').then(done);`,
            JSON.parse,
        ) as [number, number];
        // Its own packages are counted, so the zero for the other means something.
        expect(counts[0]).toBeGreaterThan(0);
        expect(counts[1]).toBe(0);
    });
});
