/**
 * Re-exports: the shapes where a module EXPORTS a name it does not DECLARE.
 *
 * The value extractor answers from one module's own text, so a barrel — the
 * module every design-system consumer actually imports from — recorded nothing
 * and every importer through it fell back to the runtime. Reading the value is
 * not possible here by construction: it lives in a module this parse has never
 * seen. What IS readable is the LINK — which module, under which name — and
 * that is what this extractor returns, for a later pass to follow against a
 * registry that has read the other modules too.
 *
 * A forward is deliberately not a "kind of value". It carries no object, and a
 * consumer that mistook one for a value would compile against nothing.
 */
import { describe, expect, it } from 'vitest';

import { extractCrossModuleForwards } from '../src/cross-module-extract.js';

/**
 * Extract forwards from one module.
 *
 * @param source - Module source text.
 * @returns The forwards, declaration order preserved.
 */
function forwards(source: string) {
    return extractCrossModuleForwards(source, '/p/index.ts');
}

describe('the re-export form', () => {
    it('reads `export { X } from` as a link to the provider', () => {
        expect(forwards("export { cardSz } from './styles';")).toEqual([
            { exportName: 'cardSz', importedName: 'cardSz', specifier: './styles' },
        ]);
    });

    it('keeps the two names apart when the re-export renames', () => {
        // The importer writes `card`; the provider declares `cardSz`. Recording
        // one name for both would look up a binding that does not exist in the
        // module being forwarded to.
        expect(forwards("export { cardSz as card } from './styles';")).toEqual([
            { exportName: 'card', importedName: 'cardSz', specifier: './styles' },
        ]);
    });

    it('forwards a provider default under the name the barrel gives it', () => {
        expect(forwards("export { default as card } from './styles';")).toEqual([
            { exportName: 'card', importedName: 'default', specifier: './styles' },
        ]);
    });

    it('reads several clauses of one statement', () => {
        expect(forwards("export { a, b as c } from './styles';")).toEqual([
            { exportName: 'a', importedName: 'a', specifier: './styles' },
            { exportName: 'c', importedName: 'b', specifier: './styles' },
        ]);
    });
});

describe('the two-statement form', () => {
    it('reads an imported binding re-exported by name', () => {
        // Written as two statements, this is the same promise as the one-line
        // re-export: the name leaves this module, the value never entered it.
        expect(forwards("import { cardSz } from './styles';\nexport { cardSz };")).toEqual([
            { exportName: 'cardSz', importedName: 'cardSz', specifier: './styles' },
        ]);
    });

    it('follows the local alias back to the provider name', () => {
        expect(
            forwards("import { cardSz as local } from './styles';\nexport { local as card };"),
        ).toEqual([{ exportName: 'card', importedName: 'cardSz', specifier: './styles' }]);
    });

    it('reads a default import re-exported by name', () => {
        expect(forwards("import card from './styles';\nexport { card };")).toEqual([
            { exportName: 'card', importedName: 'default', specifier: './styles' },
        ]);
    });

    it('reads the export list written before the import', () => {
        // Statement order is not evaluation order for bindings, so the whole
        // top level has to be indexed before the lists are read.
        expect(forwards("export { cardSz };\nimport { cardSz } from './styles';")).toEqual([
            { exportName: 'cardSz', importedName: 'cardSz', specifier: './styles' },
        ]);
    });
});

describe('what is not a forward', () => {
    it('ignores a name this module declares', () => {
        // Declared here means the value extractor can read it, and recording a
        // link as well would give the resolver two answers for one name.
        expect(forwards('export const cardSz = { p: 4 };')).toEqual([]);
        expect(forwards('const cardSz = { p: 4 };\nexport { cardSz };')).toEqual([]);
    });

    it('ignores a type-only re-export', () => {
        expect(forwards("export type { Card } from './styles';")).toEqual([]);
        expect(forwards("export { type Card } from './styles';")).toEqual([]);
    });

    it('ignores a namespace import re-exported whole', () => {
        // `export { S }` where `S` is `import * as S` exports an object of many
        // names, not one style. Nothing here denotes a single value.
        expect(forwards("import * as S from './styles';\nexport { S };")).toEqual([]);
    });

    it('ignores `export *`, which names nothing', () => {
        // A star carries no export name, so it cannot be filed under one. It
        // needs the provider's whole export list, which is a different question
        // from following one link.
        expect(forwards("export * from './styles';")).toEqual([]);
    });

    it('ignores a namespace re-export', () => {
        expect(forwards("export * as S from './styles';")).toEqual([]);
    });

    it('reads nothing from a module with no export at all', () => {
        expect(forwards("import { cardSz } from './styles';\nconsole.log(cardSz);")).toEqual([]);
    });
});
