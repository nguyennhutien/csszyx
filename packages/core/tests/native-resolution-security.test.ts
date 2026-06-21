import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getNativePackageName } from '../native/index.js';

/**
 * Dependency-confusion guard. The native binary is resolved ONLY by its SCOPED
 * name (`@csszyx/core-<triple>`); an unscoped public package of the same base
 * name must never be able to shadow it. These lock the "no-shadow" property so a
 * refactor can't reintroduce an unscoped resolution path.
 */
const platformsSrc = readFileSync(
    fileURLToPath(new URL('../native/platforms.js', import.meta.url)),
    'utf8',
);
const loaderSrc = readFileSync(
    fileURLToPath(new URL('../native/index.js', import.meta.url)),
    'utf8',
);

describe('native binary resolution (dependency-confusion)', () => {
    it('declares every platform package under the @csszyx scope', () => {
        const names = [...platformsSrc.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
        expect(names.length).toBeGreaterThan(0);
        for (const name of names) {
            expect(name).toMatch(/^@csszyx\/core-/);
        }
    });

    it('resolves the host package name as scoped or null, never unscoped', () => {
        const name = getNativePackageName();
        if (name !== null) {
            expect(name).toMatch(/^@csszyx\/core-/);
        }
    });

    it('the loader requires only the scoped name (no unscoped fallback)', () => {
        // Every require()/import() of a core binary must go through the scoped
        // name; an unscoped `csszyx-core...` specifier would be shadowable.
        expect(loaderSrc).not.toMatch(/require\(\s*['"`]csszyx-core/);
        expect(loaderSrc).not.toMatch(/from\s*['"`]csszyx-core/);
        // The loader derives the name from the scoped platform table.
        expect(loaderSrc).toMatch(/getNativePackageName/);
    });
});
