import { describe, expect, it } from 'vitest';

import { injectNextRuntimeImports } from '../src/next-runtime-injection.js';

describe('Next runtime import injection', () => {
    it('does nothing when no runtime helpers are used', () => {
        expect(injectNextRuntimeImports('export const x = 1;', {})).toEqual({
            code: 'export const x = 1;',
            injected: [],
        });
    });

    it('injects missing helpers at the top of a normal module', () => {
        expect(
            injectNextRuntimeImports('export const App = () => _sz({ p: 4 });', {
                usesRuntime: true,
            }),
        ).toEqual({
            code: "import { _sz } from '@csszyx/runtime';\nexport const App = () => _sz({ p: 4 });",
            injected: ['_sz'],
        });
    });

    it('preserves use client directive before injected imports', () => {
        const result = injectNextRuntimeImports(
            "'use client';\nexport const App = () => _szMerge('p-4');",
            {
                usesMerge: true,
            },
        );

        expect(result.injected).toEqual(['_szMerge']);
        expect(result.code).toBe(
            "'use client';\nimport { _szMerge } from '@csszyx/runtime';\nexport const App = () => _szMerge('p-4');",
        );
    });

    it('preserves leading trivia and a use server directive before injected imports', () => {
        const source =
            '/* license */\n// server action\n\n"use server";\nexport const run = () => _sz({});';
        const result = injectNextRuntimeImports(source, { usesRuntime: true });

        expect(result.code).toBe(
            '/* license */\n// server action\n\n"use server";\n' +
                "import { _sz } from '@csszyx/runtime';\n" +
                'export const run = () => _sz({});',
        );
    });

    it('injects only helpers missing from an existing runtime import', () => {
        const result = injectNextRuntimeImports(
            "import { _sz } from '@csszyx/runtime';\nexport const App = () => _szMerge('p-4');",
            {
                usesRuntime: true,
                usesMerge: true,
                usesColorVar: true,
            },
        );

        expect(result.injected).toEqual(['_szMerge', '__szColorVar']);
        expect(result.code).toBe(
            "import { _szMerge, __szColorVar } from '@csszyx/runtime';\nimport { _sz } from '@csszyx/runtime';\nexport const App = () => _szMerge('p-4');",
        );
    });

    it('injects the spacing-var and unit-var helpers when their flags are set', () => {
        const result = injectNextRuntimeImports('export const App = ({ w, angle }) => null;', {
            usesSpacingVar: true,
            usesUnitVar: true,
        });

        expect(result.injected).toEqual(['__szSpacingVar', '__szUnitVar']);
        expect(result.code).toBe(
            "import { __szSpacingVar, __szUnitVar } from '@csszyx/runtime';\nexport const App = ({ w, angle }) => null;",
        );
    });

    it('skips spacing-var and unit-var helpers that are already imported', () => {
        const code =
            "import { __szSpacingVar, __szUnitVar } from '@csszyx/runtime';\nexport const x = 1;";
        const result = injectNextRuntimeImports(code, {
            usesSpacingVar: true,
            usesUnitVar: true,
        });

        expect(result.injected).toEqual([]);
        expect(result.code).toBe(code);
    });

    it('splits provable szPart helpers between slim and barrel entries', () => {
        const result = injectNextRuntimeImports('export const x = 1;', {
            usesSzPart: true,
            usesSzcn: true,
            usesSzvPick: true,
            usesSzvPick1: true,
            szPartArgsProvable: true,
        });

        expect(result.injected).toEqual(['_szcn', '_szPart', '__szvPick', '__szvPick1']);
        expect(result.code).toContain("import { _szcn, _szPart } from '@csszyx/runtime/merge';");
        expect(result.code).toContain("import { __szvPick, __szvPick1 } from '@csszyx/runtime';");
    });

    it('supports each half of the slim split independently', () => {
        const mergeOnly = injectNextRuntimeImports('export const x = 1;', {
            usesSzPart: true,
            szPartArgsProvable: true,
        });
        expect(mergeOnly.code).toContain("from '@csszyx/runtime/merge'");
        expect(mergeOnly.code).not.toContain("from '@csszyx/runtime';");

        const barrelOnly = injectNextRuntimeImports('export const x = 1;', {
            usesSzvPick: true,
            szPartArgsProvable: true,
        });
        expect(barrelOnly.code).toContain("from '@csszyx/runtime';");
        expect(barrelOnly.code).not.toContain("from '@csszyx/runtime/merge'");
    });
});
