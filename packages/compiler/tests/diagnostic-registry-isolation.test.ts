/**
 * `diagnostic-registry.generated.ts` holds every diagnostic in one object, which
 * no bundler tree-shakes per key, so it is Node-only. These walk the value
 * imports of every browser-facing source, through the compiler subpaths it
 * imports, and fail when one reaches the registry.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    browserRoots,
    compilerBrowserSubpaths,
    compilerEntry,
    compilerSrc,
    reachable,
    valueImports,
} from './helpers/value-import-graph.js';

const REGISTRY = path.join(compilerSrc, 'diagnostic-registry.generated.ts');

describe('the diagnostic registry stays out of browser bundles', () => {
    it('is reached from no browser source, through any compiler subpath it imports', () => {
        const reached = reachable(browserRoots());
        expect(reached).toContain(path.join(compilerSrc, 'transform-core.ts'));
        expect(reached).not.toContain(REGISTRY);
    });

    it('is reached from no compiler browser entry, the development reporter included', () => {
        const subpaths = compilerBrowserSubpaths();
        expect(subpaths).toContain('./browser');
        expect(subpaths).toContain('./report');
        const reached = reachable(
            subpaths.map(subpath => compilerEntry(`@csszyx/compiler${subpath.slice(1)}`)),
        );
        // The reporter's templates and the helpers that fill them are reached,
        // so the walk followed the path a development warning prints on.
        expect(reached).toContain(path.join(compilerSrc, 'diagnostic-browser.generated.ts'));
        expect(reached).toContain(path.join(compilerSrc, 'diagnostic-computed.ts'));
        expect(reached).not.toContain(REGISTRY);
    });

    it('is found through a dynamic import and a compiler subpath', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'csszyx-isolation-'));
        const entry = path.join(dir, 'entry.ts');
        writeFileSync(entry, "export const load = () => import('./lazy.js');\n");
        writeFileSync(
            path.join(dir, 'lazy.ts'),
            "import { transformSource } from '@csszyx/compiler/engine';\nexport { transformSource };\n",
        );
        try {
            const reached = reachable([entry]);
            expect(reached).toContain(path.join(dir, 'lazy.ts'));
            expect(reached).toContain(path.join(compilerSrc, 'engine.ts'));
        } finally {
            rmSync(dir, { recursive: true });
        }
        expect(
            valueImports("import type { X } from './a.js';\nexport type { Y } from './a.js';"),
        ).toEqual([]);
        expect(() => compilerEntry('@csszyx/compiler/no-such-subpath')).toThrow('no ESM entry');
    });

    it('would be reached if the compiler root re-exported it', () => {
        const line = "export { SZ_DIAGNOSTIC_REGISTRY } from './diagnostic-registry.generated.js';";
        expect(valueImports(line)).toEqual(['./diagnostic-registry.generated.js']);
        expect(reachable([path.join(compilerSrc, 'index.ts')])).toContain(
            path.join(compilerSrc, 'diagnostic-codes.generated.ts'),
        );
    });
});
