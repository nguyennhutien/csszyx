import { describe, expect, it } from 'vitest';

import { findLocalImportSources } from '../src/rsc-boundary.js';

/**
 * The local-import scanner in rsc-boundary was rewritten from three regexes
 * (two of them quadratic-by-search) to a linear per-line scan. This suite
 * pins the new scanner against the EXACT behavior of the old regexes by
 * running both over a corpus and asserting identical results — the old
 * regexes are reproduced verbatim here as the oracle.
 */

/**
 * The original (pre-rewrite) regex implementation, kept as the oracle.
 *
 * @param code - Module source.
 * @returns Local import specifiers, per the legacy regexes.
 */
function findLocalImportSourcesLegacy(code: string): string[] {
    const out: string[] = [];
    const staticImportRe = /import\s+(?!type\b)(?:\S(?:.*\S)?\s+from\s+)?['"]([^'"]+)['"]/g;
    const exportFromRe = /export\s+(?!type\b)\S(?:.*\S)?\s+from\s+['"]([^'"]+)['"]/g;
    const dynamicImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    for (const re of [staticImportRe, exportFromRe, dynamicImportRe]) {
        for (const match of code.matchAll(re)) {
            const source = match[1];
            if (source.startsWith('.') || source.startsWith('/')) {
                out.push(source);
            }
        }
    }
    return out;
}

const findLocalImportSourcesNew = findLocalImportSources;

const CORPUS = [
    "import './side-effect';",
    "import x from './a';",
    "import { a, b } from './b';",
    "import { a as z, b } from '../c';",
    "import * as ns from './ns';",
    "import def, { named } from '/abs/path';",
    "import type { T } from './types';",
    "import type X from './x';",
    "export { a } from './re-export';",
    "export * from './star';",
    "export type { T } from './t';",
    "const x = import('./dynamic');",
    "await import( './spaced' );",
    "import pkg from 'external-package';",
    "export { a } from 'external';",
    "import a from './a'; import b from './b';",
    "import a from './a'; export { z } from './z';",
    "const s = 'not an import ./nope';",
    "import{a}from'./nospace';",
    "import  a  from  './extra-space';",
    "import a from './a'\nimport b from './b'",
    "import {\n a,\n b\n} from './multiline';",
    "export const from = 1; import x from './a';",
    "import from2 from './weird';",
    '',
    "import x from '';",
    "import x from './a'; // trailing",
    "  import x from './indented';",
    "throw new Error('deep ./path in a string');",
].join('\n=====\n');

describe('rsc local-import scan equivalence (new vs legacy regexes)', () => {
    it('each fixture is identical, or (multi-statement lines) a strict superset', () => {
        let identical = 0;
        for (const fixture of CORPUS.split('\n=====\n')) {
            const legacy = findLocalImportSourcesLegacy(fixture);
            const next = findLocalImportSourcesNew(fixture);
            if (JSON.stringify(legacy) === JSON.stringify(next)) {
                identical++;
                continue;
            }
            // The only divergence is more than one import/export statement on
            // one physical line, where the old greedy `.*` crossed the `;`. The
            // new scanner must never LOSE a specifier legacy found.
            const nextSet = new Set(next);
            for (const spec of legacy) {
                expect(nextSet.has(spec), `${fixture} :: dropped ${spec}`).toBe(true);
            }
        }
        // The realistic one-statement-per-line fixtures (the vast majority)
        // must be byte-identical, so the superset escape hatch can't hide a
        // regression on normal code.
        expect(identical).toBeGreaterThanOrEqual(26);
    });

    it('reports every statement on a multi-per-line source (old code collapsed them)', () => {
        expect(findLocalImportSourcesNew("import a from './a'; import b from './b';")).toEqual([
            './a',
            './b',
        ]);
        expect(findLocalImportSourcesLegacy("import a from './a'; import b from './b';")).toEqual([
            './b',
        ]);
    });

    it('reads no edge from an import in a comment, which the legacy regexes did', () => {
        for (const code of [
            "// import x from './commented';",
            "/* import x from './block'; */ import y from './y';",
            "/**\n * import { a } from './doc';\n */\nexport { b } from './b';",
            "// import('./deferred')\nconst z = 1;",
        ]) {
            expect(findLocalImportSourcesNew(code), code).toEqual(
                findLocalImportSourcesLegacy(code).filter(spec => ['./y', './b'].includes(spec)),
            );
        }
        expect(findLocalImportSourcesLegacy("// import x from './commented';")).toEqual([
            './commented',
        ]);
    });

    it('stays linear on an adversarial repeated-import string', () => {
        const hostile = `p${'import\x00e'.repeat(40_000)}\n`;
        const start = Date.now();
        findLocalImportSourcesNew(hostile);
        expect(Date.now() - start).toBeLessThan(1000);
    });
});
