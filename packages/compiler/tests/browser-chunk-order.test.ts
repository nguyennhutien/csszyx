/**
 * An app bundle lays the compiler's chunks out in the order `transform-core.ts`
 * first imports them. `closed-enum-tables.ts` and `sz-key-tables.ts` build into
 * one chunk, the engine entries' share; it has to come after the per-key
 * capability table (`sz-capabilities.generated.ts`, a chunk of its own), whose
 * rows repeat PROPERTY_MAP's keys within gzip's reach. With the closed-enum
 * import at the top, where the import sort puts it, `@csszyx/compiler/browser`
 * measured 16,561 gzip bytes against 16,425, and that stays under its budget,
 * so the size gate alone would not catch the drift.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { compilerSrc, valueImports } from './helpers/value-import-graph.js';

describe('the browser lowering imports the capability table first', () => {
    const specs = valueImports(readFileSync(path.join(compilerSrc, 'transform-core.ts'), 'utf8'));
    const capabilities = specs.indexOf('./sz-capabilities.generated.js');

    it.each(['./sz-key-tables.js', './closed-enum-tables.js'])('%s comes after it', table => {
        expect(capabilities).toBeGreaterThanOrEqual(0);
        expect(specs.indexOf(table)).toBeGreaterThan(capabilities);
    });
});
