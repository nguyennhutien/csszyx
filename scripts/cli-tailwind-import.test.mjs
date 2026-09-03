/**
 * `tailwindcss` must reach the CLI only through a dynamic import.
 *
 * It is an optional peer that `generate-types` alone needs. A static
 * `import … from 'tailwindcss/…'` in any chunk loads the package when the
 * chunk loads, before the availability guard can run, so a project without
 * Tailwind gets a resolver stack trace instead of the message written for it
 * — and the guard would look like it works right up until someone changes the
 * import back. This reads the built chunks, since a string in source can be
 * a template that `init` writes for the user rather than an import.
 *
 * Runs after `packages/cli` is built; skips with a reason when it is not.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DIST = path.resolve(import.meta.dirname, '../packages/cli/dist');

/**
 * Every `.mjs` file below a directory.
 *
 * @param {string} dir Directory to walk.
 * @returns {string[]} Absolute file paths.
 */
function chunks(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...chunks(full));
        else if (entry.endsWith('.mjs')) out.push(full);
    }
    return out;
}

const STATIC_IMPORT = /^\s*import\b[^;]*?\bfrom\s+['"]tailwindcss(?:\/[^'"]*)?['"]/m;

test('no built CLI chunk imports tailwindcss statically', {
    skip: !existsSync(DIST) && 'packages/cli is not built',
}, () => {
    const offenders = chunks(DIST).filter(file => STATIC_IMPORT.test(readFileSync(file, 'utf8')));
    assert.deepEqual(
        offenders.map(file => path.relative(DIST, file)),
        [],
        'tailwindcss is an optional peer; load it through resolveTailwindV3, never a static import',
    );
});

test('the availability helper is the only place that resolves the package', {
    skip: !existsSync(DIST) && 'packages/cli is not built',
}, () => {
    // The bundler may rename the `createRequire` binding (`require$1`), so
    // match the call shape rather than the identifier.
    const resolvers = chunks(DIST).filter(file =>
        /\.resolve\(['"]tailwindcss\/resolveConfig\.js['"]\)/.test(readFileSync(file, 'utf8')),
    );
    assert.equal(
        resolvers.length,
        1,
        `expected one resolver chunk, found: ${resolvers.map(f => path.relative(DIST, f)).join(', ')}`,
    );
});
