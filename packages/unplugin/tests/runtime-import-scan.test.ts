import { describe, expect, it } from 'vitest';

import { findRuntimeImportClause, importsRuntimeHelper } from '../src/runtime-import-scan.js';

/**
 * Linear replacements for the runtime-helper import regexes. The old
 * `\{[^{}]*\bNAME\b[^{}]*\}` matchers were quadratic-by-search; these tests
 * pin the exact semantics they replaced — including the word-boundary quirk
 * where `_sz` never matched inside `_szMerge` / `__szColorVar`.
 */
describe('importsRuntimeHelper', () => {
    it('detects a helper imported from @csszyx/runtime', () => {
        const code = "import { _sz, _szMerge } from '@csszyx/runtime';";
        expect(importsRuntimeHelper(code, '_sz')).toBe(true);
        expect(importsRuntimeHelper(code, '_szMerge')).toBe(true);
    });

    it('detects a re-export clause', () => {
        expect(
            importsRuntimeHelper("export { __szColorVar } from '@csszyx/runtime';", '__szColorVar'),
        ).toBe(true);
    });

    it('does not match a helper as a substring of another name', () => {
        // `\b_sz\b` never matched inside `_szMerge`/`__szColorVar`; exact
        // comparison agrees.
        const code = "import { _szMerge, __szColorVar } from '@csszyx/runtime';";
        expect(importsRuntimeHelper(code, '_sz')).toBe(false);
    });

    it('detects the spacing-var and unit-var helpers without substring confusion', () => {
        const code = "import { __szSpacingVar, __szUnitVar } from '@csszyx/runtime';";
        expect(importsRuntimeHelper(code, '__szSpacingVar')).toBe(true);
        expect(importsRuntimeHelper(code, '__szUnitVar')).toBe(true);
        expect(importsRuntimeHelper(code, '_sz')).toBe(false);
        expect(importsRuntimeHelper(code, '__szColorVar')).toBe(false);
    });

    it('handles aliased imports (the bound name is the outer name)', () => {
        expect(importsRuntimeHelper("import { _sz as sz } from '@csszyx/runtime';", '_sz')).toBe(
            true,
        );
    });

    it('ignores imports from other modules', () => {
        expect(importsRuntimeHelper("import { _sz } from 'other';", '_sz')).toBe(false);
    });

    it('stays linear on adversarial unterminated clauses', () => {
        // The counterexample shape for the old regex: a long open clause.
        const code = `import { ${'_sz/'.repeat(50_000)}`;
        const start = Date.now();
        expect(importsRuntimeHelper(code, '_sz')).toBe(false);
        expect(Date.now() - start).toBeLessThan(1000);
    });
});

describe('findRuntimeImportClause', () => {
    it('returns the statement and its prefix-with-body for appending', () => {
        const clause = findRuntimeImportClause("import { _sz } from '@csszyx/runtime';");
        expect(clause).not.toBeNull();
        expect(clause?.statement).toBe("import { _sz } from '@csszyx/runtime'");
        expect(clause?.prefixWithBody).toBe('import { _sz ');
    });

    it('reconstructs the same appended import the regex produced', () => {
        const code = "import { _sz } from '@csszyx/runtime';\nconst x = 1;";
        const clause = findRuntimeImportClause(code);
        expect(clause).not.toBeNull();
        if (!clause) {
            return;
        }
        const appended = code.replace(
            clause.statement,
            `${clause.prefixWithBody}, _szMerge } from '@csszyx/runtime'`,
        );
        expect(appended).toContain("import { _sz , _szMerge } from '@csszyx/runtime'");
    });

    it('ignores an export-from clause (cannot append imports to it)', () => {
        expect(findRuntimeImportClause("export { _sz } from '@csszyx/runtime';")).toBeNull();
    });

    it('returns null when no runtime import exists', () => {
        expect(findRuntimeImportClause("import { x } from 'other';")).toBeNull();
    });
});
