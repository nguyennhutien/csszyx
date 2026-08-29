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
import { parseSync } from 'oxc-parser';
import { describe, expect, it, vi } from 'vitest';

import { extractCrossModuleForwards } from '../src/cross-module-extract.js';
import { VAR_HOSTILE_NO_VAR_FORM, VAR_HOSTILE_WRONG_PROPERTY } from '../src/var-hostile-keys.js';

// The parser is wrapped, not replaced: the tests below count how often the
// extractor reaches it, because a parse per module was 8.9 s of a build over
// 18 000 files, and only a module with an `export {` clause can carry a forward.
vi.mock('oxc-parser', async importOriginal => {
    const actual = await importOriginal<typeof import('oxc-parser')>();
    return { ...actual, parseSync: vi.fn(actual.parseSync) };
});

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

    it('ignores a type-only import re-exported by name', () => {
        // The binding exists in the type world only, so forwarding it would
        // record a link to a value that is not there at runtime.
        expect(forwards("import type { C } from './styles';\nexport { C };")).toEqual([]);
        expect(forwards("import { type C } from './styles';\nexport { C };")).toEqual([]);
    });

    it('ignores a string-named import and a string-named export', () => {
        // Legal syntax, but not a name a token module is written with — and a
        // re-export cannot spell it either, so a link keyed by one resolves for
        // nobody.
        expect(forwards('import { "a-b" as c } from \'./styles\';\nexport { c };')).toEqual([]);
        expect(forwards('export { cardSz as "a-b" } from \'./styles\';')).toEqual([]);
    });

    it('is unbothered by an import that binds nothing', () => {
        // A side-effect import has no specifiers at all; walking it must not
        // throw and must not invent a binding.
        expect(forwards("import './styles';\nexport { cardSz } from './base';")).toEqual([
            { exportName: 'cardSz', importedName: 'cardSz', specifier: './base' },
        ]);
    });

    it('reads nothing from a module with no export at all', () => {
        expect(forwards("import { cardSz } from './styles';\nconsole.log(cardSz);")).toEqual([]);
    });
});

describe('which modules are parsed at all', () => {
    // A forward is always an `export { ... }` clause - with or without `from`,
    // since the two-statement form re-exports an imported binding by name.
    // Every other export shape declares its value here, and `export *` names
    // nothing. So a module with no `export {` in its text cannot carry one and
    // is not worth a parse, whatever else it imports.
    it('does not parse a module whose exports all declare their value', () => {
        vi.mocked(parseSync).mockClear();

        expect(
            forwards(
                "import { cardSz } from './styles';\nexport function Card() { return cardSz; }\nexport const x = 1;\nexport default Card;\n",
            ),
        ).toEqual([]);

        expect(parseSync).not.toHaveBeenCalled();
    });

    it('does not parse a module that only re-exports a namespace', () => {
        vi.mocked(parseSync).mockClear();

        expect(forwards("export * from './styles';\nexport * as ns from './more';\n")).toEqual([]);

        expect(parseSync).not.toHaveBeenCalled();
    });

    it('still reads a clause separated from `export` by a comment', () => {
        expect(forwards("export /* the card */ { cardSz } from './styles';")).toEqual([
            { exportName: 'cardSz', importedName: 'cardSz', specifier: './styles' },
        ]);
        expect(forwards("export // line\n{ cardSz } from './styles';")).toEqual([
            { exportName: 'cardSz', importedName: 'cardSz', specifier: './styles' },
        ]);
    });

    it('still reads a clause written without spaces or on the next line', () => {
        expect(forwards("export{cardSz}from'./styles';")).toEqual([
            { exportName: 'cardSz', importedName: 'cardSz', specifier: './styles' },
        ]);
        expect(forwards("export\n{\n  cardSz,\n} from './styles';")).toEqual([
            { exportName: 'cardSz', importedName: 'cardSz', specifier: './styles' },
        ]);
    });

    it('reads a clause that follows a type-only clause', () => {
        expect(
            forwards("export type { T } from './types';\nexport { cardSz } from './styles';"),
        ).toEqual([{ exportName: 'cardSz', importedName: 'cardSz', specifier: './styles' }]);
    });
});

describe('the var-hostile key sets', () => {
    it('keeps the two reasons apart', () => {
        // A key belongs to exactly one of them: one set is "the var form emits
        // a class for a DIFFERENT property", the other is "there is no var form
        // at all". A key in both would make the diagnostic depend on which set
        // a reader consulted first.
        const both = [...VAR_HOSTILE_WRONG_PROPERTY].filter(key =>
            VAR_HOSTILE_NO_VAR_FORM.has(key),
        );

        expect(both).toEqual([]);
        expect(VAR_HOSTILE_WRONG_PROPERTY.size).toBeGreaterThan(0);
        expect(VAR_HOSTILE_NO_VAR_FORM.size).toBeGreaterThan(0);
    });
});
