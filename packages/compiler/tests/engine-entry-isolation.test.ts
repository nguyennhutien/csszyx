/**
 * `transform-core.ts` is the browser lowering, the largest module of the
 * package. A process that imports `@csszyx/compiler/engine` or `/internal`
 * calls the engine and renders its diagnostics, and needs none of the
 * lowering: only the key and value tables the diagnostic renderer reads,
 * which live in leaf modules the lowering imports too. These walk the value
 * imports of both entries and fail when one reaches the lowering again.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { compilerSrc, reachable } from './helpers/value-import-graph.js';

const LOWERING = path.join(compilerSrc, 'transform-core.ts');

describe('the engine entries load no lowering', () => {
    it.each(['engine.ts', 'internal.ts'])('%s reaches no transform-core.ts', entry => {
        const reached = reachable([path.join(compilerSrc, entry)]);
        // The renderer is reached, so the walk followed the path the tables
        // are read on.
        expect(reached).toContain(path.join(compilerSrc, 'diagnostic-render-helpers.ts'));
        expect(reached).toContain(path.join(compilerSrc, 'sz-key-suggestion.ts'));
        expect(reached).not.toContain(LOWERING);
    });
});
