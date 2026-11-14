import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    injectNextRuntimeImports,
    runtimeHelperGroupsFromUsage,
} from '../src/next-runtime-injection.js';

describe('the helpers the engine calls', () => {
    it('are the ones the plugin imports', () => {
        // The engine renames a helper the file spells; one the plugin did not
        // know would be imported under its own name, which its calls no longer use.
        const rust = readFileSync(
            new URL('../../core/src/transform/helper_names.rs', import.meta.url),
            'utf8',
        );
        const table = /pub const HELPERS: &\[&str\] = &\[([^\]]*)\]/.exec(rust)?.[1] ?? '';
        const engine = [...table.matchAll(/"([^"]+)"/g)].map(match => match[1]);
        const plugin = runtimeHelperGroupsFromUsage({
            usesRuntime: true,
            usesMerge: true,
            usesSzcn: true,
            usesSzPart: true,
            usesSzvPick: true,
            usesSzvPick1: true,
            usesColorVar: true,
            usesSpacingVar: true,
            usesUnitVar: true,
            usesBoolClass: true,
            usesClassMark: true,
        }).all;
        expect(engine.length).toBeGreaterThan(0);
        expect([...plugin].sort()).toEqual([...engine].sort());
    });
});

const NO_PREFIX_REGISTRATION =
    "import { registerSzClassPrefix as __szRegisterClassPrefix } from '@csszyx/runtime';\n" +
    '__szRegisterClassPrefix(null);\n';

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
            code:
                NO_PREFIX_REGISTRATION +
                "import { _sz } from '@csszyx/runtime';\nexport const App = () => _sz({ p: 4 });",
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
            "'use client';\n" +
                NO_PREFIX_REGISTRATION +
                "import { _szMerge } from '@csszyx/runtime';\nexport const App = () => _szMerge('p-4');",
        );
    });

    it('preserves leading trivia and a use server directive before injected imports', () => {
        const source =
            '/* license */\n// server action\n\n"use server";\nexport const run = () => _sz({});';
        const result = injectNextRuntimeImports(source, { usesRuntime: true });

        expect(result.code).toBe(
            '/* license */\n// server action\n\n"use server";\n' +
                NO_PREFIX_REGISTRATION +
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
            NO_PREFIX_REGISTRATION +
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

    it('imports a helper the engine renamed under the name its calls use', () => {
        // The module spells `_szMerge` itself, so the engine called the helper
        // through `_szMerge$1`; the author's own import of it changes nothing.
        const code =
            "import { _szMerge } from '@csszyx/runtime';\nexport const App = () => _szMerge$1(c, 'p-4');";
        const usage = {
            usesMerge: true,
            usesSzPart: true,
            helperAliases: ['_szMerge$1', '_szPart$3'],
        };
        const result = injectNextRuntimeImports(code, usage);

        expect(result.injected).toEqual(['_szMerge', '_szPart']);
        expect(result.code).toContain(
            "import { _szMerge as _szMerge$1, _szPart as _szPart$3 } from '@csszyx/runtime';",
        );
        // A second pass over its own output adds nothing.
        expect(injectNextRuntimeImports(result.code, usage).code).toBe(result.code);
    });

    it('reads the slim helpers a module imports from `/merge` itself', () => {
        const code = "import { _szcn, _szPart } from '@csszyx/runtime/merge';\nexport const x = 1;";
        const result = injectNextRuntimeImports(code, {
            usesSzPart: true,
            usesSzcn: true,
            usesSzvPick: true,
            szPartArgsProvable: true,
        });

        expect(result.injected).toEqual(['__szvPick']);
        expect(result.code).toBe(`import { __szvPick } from '@csszyx/runtime';\n${code}`);
    });
});
