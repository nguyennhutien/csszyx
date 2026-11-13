/**
 * A string that holds a lone UTF-16 surrogate is never compiled.
 *
 * JavaScript strings are UTF-16 and may hold an unpaired surrogate
 * (`"\uD800"`); a Rust `str` cannot. The parser hands such a value over with
 * no text form, so the engine has nothing exact to put in a class name. Any
 * text it wrote instead would be invented: an earlier parser release spelled
 * each lone surrogate as U+FFFD plus its code unit in hex, and the first port
 * to the new parser spelled it `\uXXXX`. Neither is what the runtime renders.
 *
 * So the build declines: the attribute or call that needs the value keeps its
 * runtime path, the rest of the file still compiles, and the diagnostic says
 * why. Specifiers with a lone surrogate name no module the build knows.
 */
import { describe, expect, it } from 'vitest';

import {
    ENGINES,
    GLOBAL_VAR_SCANNERS,
    LINK_SCANNERS,
    type ParityEngine,
    scanOneFile,
} from './engine-parity-harness.js';

const FILE = { filename: '/p/t.tsx' };

/** No text a lone surrogate could have been turned into. */
const INVENTED = /\\u[dD][89a-fA-F][0-9a-fA-F]{2}|�/;

/**
 * Run one source through an engine and keep what the assertions read.
 *
 * @param engine - Engine artifact under test.
 * @param source - Module source.
 * @returns Emitted code, collected classes and diagnostic codes with args.
 */
function run(engine: ParityEngine, source: string) {
    const result = engine(source, FILE);
    return {
        code: result.code ?? '',
        classes: [...(result.classes ?? [])],
        issues: (result.issues ?? []).map(issue => [issue.code, issue.args] as const),
        diagnostics: (result.diagnostics ?? []).map(String),
    };
}

/** The diagnostic an `sz` attribute with a lone surrogate reports. */
const SZ_LONE = [
    'fallback-missing-css',
    expect.objectContaining({ site: 'sz', shape: 'lone-surrogate' }),
] as const;

describe.each(ENGINES)('a lone surrogate in an sz attribute (%s)', (_name, engine) => {
    it('keeps an sz value with a lone surrogate at runtime', () => {
        const out = run(engine, 'export const A = () => <div sz={{ bg: "red\\uD800" }} />;');

        expect(out.code).toContain('className={_sz({ bg: "red\\uD800" })}');
        expect(out.classes.join(' ')).not.toMatch(INVENTED);
        expect(out.issues).toEqual([SZ_LONE]);
        expect(out.diagnostics[0]).toContain('lone UTF-16 surrogate');
    });

    it('keeps an sz key with a lone surrogate at runtime', () => {
        const out = run(engine, 'export const A = () => <div sz={{ "p\\uD800": 4 }} />;');

        expect(out.code).toContain('className={_sz({ "p\\uD800": 4 })}');
        expect(out.classes.join(' ')).not.toMatch(INVENTED);
        expect(out.issues).toEqual([SZ_LONE]);
    });

    it('keeps a template with a lone surrogate at runtime', () => {
        const out = run(engine, 'export const A = () => <div sz={{ bg: `red\\uDC00` }} />;');

        expect(out.code).toContain('className={_sz({ bg: `red\\uDC00` })}');
        expect(out.issues).toEqual([SZ_LONE]);
    });

    it('keeps an array, a ternary and a partial object with one at runtime', () => {
        const out = run(
            engine,
            [
                'export const A = ({ c, x }) => <>',
                '<div sz={["p-4", "a\\uD800"]} />',
                '<div sz={c ? { bg: "a\\uD800" } : { p: 4 }} />',
                '<div sz={{ bg: "a\\uD800", m: x }} />',
                '</>;',
            ].join('\n'),
        );

        expect(out.code).toContain('className={_sz(["p-4", "a\\uD800"])}');
        expect(out.code).toContain('className={_sz(c ? { bg: "a\\uD800" } : { p: 4 })}');
        expect(out.code).toContain('className={_sz({ bg: "a\\uD800", m: x })}');
        expect(out.classes.join(' ')).not.toMatch(INVENTED);
        expect(out.issues).toEqual([SZ_LONE, SZ_LONE, SZ_LONE]);
    });

    it('keeps a value read from a module const at runtime', () => {
        const out = run(
            engine,
            [
                'const s = { bg: "a\\uD800" };',
                'const C = "b\\uD800";',
                'export const A = () => <><div sz={s} /><div sz={{ bg: C }} /></>;',
            ].join('\n'),
        );

        expect(out.code).toContain('className={_sz(s)}');
        expect(out.code).toContain('className={_sz({ bg: C })}');
        expect(out.classes.join(' ')).not.toMatch(INVENTED);
        expect(out.issues).toEqual([SZ_LONE, SZ_LONE]);
    });

    it('still compiles every other sz in the file', () => {
        const out = run(
            engine,
            'export const A = () => <><div sz={{ bg: "a\\uD800" }} /><div sz={{ p: 4 }} /></>;',
        );

        expect(out.code).toContain('className={_sz({ bg: "a\\uD800" })}');
        expect(out.code).toContain('<div className="p-4" />');
        expect(out.classes).toContain('p-4');
    });

    it('compiles a surrogate pair, written or escaped', () => {
        const out = run(
            engine,
            'export const A = () => <><div sz={{ content: "\'😀\'" }} /><div sz={{ content: "\'\\uD83D\\uDE00\'" }} /></>;',
        );

        expect(out.code).toContain('<div className="content-[\'😀\']" />');
        expect(out.code).not.toContain('_sz(');
        expect(out.issues).toEqual([]);
    });

    it('compiles a pair written as two braced escapes', () => {
        // oxc issue 29382 reports `\u{D834}\u{DF06}` read as two lone
        // surrogates. The parser this engine pins joins them into U+1D306, the
        // value JavaScript gives the string, so it compiles. Were a parser to
        // read it as lone again, the policy above would keep it at runtime and
        // this test would say so.
        const out = run(
            engine,
            'export const A = () => <div sz={{ content: "\'\\u{D834}\\u{DF06}\'" }} />;',
        );

        expect(out.code).toContain('<div className="content-[\'𝌆\']" />');
        expect(out.issues).toEqual([]);
    });
});

describe.each(ENGINES)('a lone surrogate in a catalog call (%s)', (_name, engine) => {
    it('collects no class from an szv config that holds one', () => {
        const out = run(
            engine,
            "import { szv } from '@csszyx/runtime';\nexport const t = szv({ base: { bg: 'a\\uD800' }, variants: { c: { b: { p: 4 } } } });",
        );

        expect(out.classes.join(' ')).not.toMatch(INVENTED);
        expect(out.issues).toEqual([
            [
                'fallback-missing-css',
                expect.objectContaining({ site: 'szv', shape: 'lone-surrogate' }),
            ],
        ]);
    });

    it('collects no class from an szr argument that holds one', () => {
        const out = run(
            engine,
            "import { szr } from '@csszyx/runtime';\nexport const a = szr({ bg: 'a\\uD800' });",
        );

        expect(out.classes).toEqual([]);
        expect(out.issues).toEqual([
            [
                'fallback-missing-css',
                expect.objectContaining({ site: 'szr', shape: 'lone-surrogate' }),
            ],
        ]);
    });

    it('collects no class from a dynamic() argument that holds one', () => {
        const out = run(
            engine,
            "import { dynamic } from '@csszyx/runtime';\nexport const a = dynamic({ bg: 'a\\uD800' });",
        );

        expect(out.classes).toEqual([]);
        expect(out.issues).toEqual([]);
    });

    it('leaves an szs slot map that holds one unchanged', () => {
        const out = run(
            engine,
            [
                'export const A = () => <>',
                '<Card szs={{ root: "a\\uD800" }} />',
                '<Card szs={{ root: { bg: "a\\uD800" } }} />',
                '</>;',
            ].join('\n'),
        );

        expect(out.code).toContain('<Card szs={{ root: "a\\uD800" }} />');
        expect(out.code).toContain('<Card szs={{ root: { bg: "a\\uD800" } }} />');
        expect(out.classes).toEqual([]);
        expect(out.issues.map(([code]) => code)).toEqual(['szs-slot-map', 'szs-slot-map']);
    });
});

describe.each(LINK_SCANNERS)('a lone surrogate in a module link (%s)', (_name, scan) => {
    it('reads no style text and no load from a string that holds one', () => {
        const [links] = scan(
            [
                {
                    filename: '/p/a.tsx',
                    source: [
                        "import('./a\\uD800.css');",
                        "export const A = () => <><style>{'.a\\uD800 {}'}</style><style>{`.b\\uD800 {}`}</style><style>{'.c {}'}</style></>;",
                    ].join('\n'),
                },
            ],
            { moduleFacts: true, styleTexts: true },
        );

        expect(links?.loads).toEqual([]);
        expect(links?.styleCss).toEqual(['.c {}']);
    });
});

describe.each(GLOBAL_VAR_SCANNERS)('a lone surrogate in a global var usage (%s)', (_name, scan) => {
    it('reports no name read from a string that holds one', () => {
        const usages = scanOneFile(scan)(
            [
                "const token = '--a\\uD800';",
                'document.documentElement.style.setProperty(token, c);',
                "document.documentElement.style.setProperty('--b\\uD800', c);",
                'export const A = () => <div className={`bg-[var(--c\\uD800)]`} />;',
                "document.documentElement.style.setProperty('--ok', c);",
            ].join('\n'),
            '/p/a.tsx',
        );

        expect(usages.map(usage => usage.name)).toEqual(['--ok']);
    });
});
