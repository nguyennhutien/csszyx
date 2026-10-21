/**
 * An app bundle lays the compiler's chunks out in the order `transform-core.ts`
 * first imports them. `closed-enum-tables.ts` and `sz-key-tables.ts` build into
 * one chunk, the engine entries' share; it has to come after the per-key
 * capability table (`sz-capabilities.generated.ts`), whose rows repeat
 * PROPERTY_MAP's keys within gzip's reach. With the closed-enum import at the
 * top, where the import sort puts it, `@csszyx/compiler/browser` measured
 * 16,561 gzip bytes against 16,425, and that stays under its budget, so the
 * size gate alone would not catch the drift.
 *
 * The capability rows share their chunk with the property category map
 * (`property-types.ts`), which spells the same keys. Left in the lowering's
 * chunk it landed after the tables, and `./browser` measured 16,425 against
 * 16,332 with it in the rows' chunk (16,405 against 16,316 in a Vite build).
 * Which of the two the chunk holds first is not pinned: swapping their imports
 * built a byte-identical chunk (2026-10-21), so the group, not the import
 * order, decides it. Both numbers pass their budgets, so these tests hold the
 * layout in the source; `moduleOrder` in `scripts/check-package-size.mjs`
 * holds it in what esbuild and Vite lay out from the build, in the CDN
 * bundles and in an installed app.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import buildConfig from '../tsdown.config.mjs';
import { compilerSrc, valueImports } from './helpers/value-import-graph.js';

describe('the browser lowering imports the capability table first', () => {
    const specs = valueImports(readFileSync(path.join(compilerSrc, 'transform-core.ts'), 'utf8'));
    const capabilities = specs.indexOf('./sz-capabilities.generated.js');

    it.each(['./sz-key-tables.js', './closed-enum-tables.js'])('%s comes after it', table => {
        expect(capabilities).toBeGreaterThanOrEqual(0);
        expect(specs.indexOf(table)).toBeGreaterThan(capabilities);
    });
});

describe('the per-key rows build into one chunk', () => {
    type Group = { name: string; test: RegExp };
    const builds = (buildConfig as (inline: object) => unknown)({}) as Array<{
        outputOptions?: { codeSplitting?: { groups?: Group[] } };
    }>;
    const groups = builds.flatMap(build => build.outputOptions?.codeSplitting?.groups ?? []);
    const source = (name: string): string => path.join(compilerSrc, name);
    const rows = groups.find(group => group.test.test(source('sz-capabilities.generated.ts')));

    it('holds the capability table and the property category map', () => {
        expect(rows).toBeDefined();
        expect(rows?.test.test(source('property-types.ts'))).toBe(true);
    });

    // The declaration build runs the same groups over a module per `.d.ts`; a
    // test that matched one put its placeholder code in the shipped chunk.
    it.each(['property-types.d.ts', 'sz-capabilities.generated.d.ts'])(
        'leaves the declaration module %s out',
        name => {
            expect(groups.some(group => group.test.test(source(name)))).toBe(false);
        },
    );
});
