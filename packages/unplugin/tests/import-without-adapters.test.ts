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
`;

/**
 * How many adapter packages a child resolves running `script`.
 *
 * @param script - CommonJS run in the child; it calls `done()` when finished.
 * @returns The count.
 */
function adaptersLoaded(script: string): number {
    const out = execFileSync(
        process.execPath,
        [
            '-e',
            `${RECORD}\nconst done = () => process.stdout.write(String(adapters()));\n${script}`,
        ],
        { encoding: 'utf8', cwd: PACKAGE },
    );
    return Number(out);
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
