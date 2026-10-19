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
 * (`property-types.ts`), which spells the same keys and goes first. Left in the
 * lowering's chunk it landed after the tables, and `./browser` measured 16,425
 * against 16,332 with it at the front (16,405 against 16,316 in a Vite build).
 * Both numbers pass their budgets, so these tests hold the layout.
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

    it('the property category map comes before it', () => {
        expect(specs.indexOf('./property-types.js')).toBeGreaterThanOrEqual(0);
        expect(specs.indexOf('./property-types.js')).toBeLessThan(capabilities);
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
