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
 * Runs after `packages/cli` is built and FAILS when it is not: a gate that
 * skips without its input reports green for work it did not do, which is how
 * this one went unrun for a release.
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

/**
 * A static import or re-export of the package or anything under it: with an
 * import clause (`import x from "…"`, `import{x}from"…"`), a bare side-effect
 * import (`import "tailwindcss"`), or an export-from clause. Whitespace is
 * optional throughout, so a minified spelling matches the same as a spaced one.
 *
 * The run before `from` excludes the line break as well as the semicolon: a
 * clause never spans one in this output, and allowing it let a semicolon-free
 * `export` swallow the lines after it and accuse a comment that merely names
 * the package.
 */
const STATIC_LOAD =
    /^[^\S\n]*(?:import\b(?:[^;\n]*?\bfrom)?|export\b[^;\n]*?\bfrom)[^\S\n]*['"]tailwindcss(?:\/[^'"\n]*)?['"]/m;

test('the import pattern reads every static spelling and no dynamic one', () => {
    const statics = [
        "import resolveConfig from 'tailwindcss/resolveConfig.js';",
        'import resolveConfig from"tailwindcss/resolveConfig.js";',
        'import{a}from"tailwindcss";',
        "import * as tw from 'tailwindcss';",
        "import 'tailwindcss';",
        'import"tailwindcss/index.css";',
        "export { default } from 'tailwindcss/resolveConfig.js';",
        "export * from 'tailwindcss';",
    ];
    // A clause never spans a line break in real output, and letting the run
    // cross one lets a semicolon-free `export` swallow the lines after it and
    // accuse a comment that merely mentions the package.
    const acrossLines = [
        "export function note() {}\n// this used to be import { Config } from 'tailwindcss'",
        'export const NOTE = [\n    "load it dynamically, never from \'tailwindcss\'"',
        "import x from './a'\n// once read from 'tailwindcss'",
    ];
    assert.deepEqual(
        acrossLines.filter(source => STATIC_LOAD.test(source)),
        [],
    );
    const dynamics = [
        "const m = await import('tailwindcss/resolveConfig.js');",
        "createRequire(import.meta.url).resolve('tailwindcss/resolveConfig.js');",
        "import type { Config } from 'tailwindcss';".replace('import type', '// import type'),
    ];
    assert.deepEqual(
        statics.filter(line => !STATIC_LOAD.test(line)),
        [],
    );
    assert.deepEqual(
        dynamics.filter(line => STATIC_LOAD.test(line)),
        [],
    );
});

test('packages/cli is built, so the chunks below are the ones being shipped', () => {
    assert.ok(existsSync(DIST), `${DIST} is missing — run \`pnpm build\` before this gate`);
});

test('no built CLI chunk imports tailwindcss statically', () => {
    const offenders = chunks(DIST).filter(file => STATIC_LOAD.test(readFileSync(file, 'utf8')));
    assert.deepEqual(
        offenders.map(file => path.relative(DIST, file)),
        [],
        'tailwindcss is an optional peer; load it through resolveTailwindV3, never a static import',
    );
});

test('the availability helper is the only place that loads the entry', () => {
    // `check` reads Tailwind's manifest for its version line, so the manifest
    // is not the tell; the `resolveConfig.js` entry is what only the guarded
    // path may load.
    const loaders = chunks(DIST).filter(file =>
        /['"]resolveConfig\.js['"]/.test(readFileSync(file, 'utf8')),
    );
    assert.deepEqual(
        loaders.map(file => path.relative(DIST, file)),
        ['chunks/tailwind-availability.mjs'],
        'only the availability helper may load tailwindcss/resolveConfig.js',
    );
});
