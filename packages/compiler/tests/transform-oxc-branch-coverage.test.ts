import { describe, expect, it } from 'vitest';

import type { TransformOxcResult } from '../src/transform-oxc.js';
import { OxcNotImplementedError, transformOxc } from '../src/transform-oxc.js';

/**
 * Branch-coverage tests for the oxc-parser transform path
 * (`src/transform-oxc.ts`). Each test feeds a specific TSX source through
 * {@link transformOxc} and asserts the compiled output, exercising a
 * documented uncovered branch. Real inputs, real assertions only.
 */

type Opts = Parameters<typeof transformOxc>[2];

/**
 * Transform a TSX source and return the full result.
 * @param src - TSX source to compile.
 * @param file - Virtual filename passed to the transformer.
 * @param opts - Optional transform options.
 * @returns The full oxc transform result.
 */
const run = (src: string, file = 'F.tsx', opts?: Opts): TransformOxcResult =>
    transformOxc(src, file, opts);

/**
 * Transform a TSX source and return the emitted code.
 * @param src - TSX source to compile.
 * @param file - Virtual filename passed to the transformer.
 * @param opts - Optional transform options.
 * @returns The rewritten source code.
 */
const code = (src: string, file = 'F.tsx', opts?: Opts): string => run(src, file, opts).code;

/**
 * Collect the emitted classes as a sorted array for stable assertions.
 * @param result - A transform result to read classes from.
 * @returns The emitted class names, sorted.
 */
const classesOf = (result: TransformOxcResult): string[] => [...result.classes].sort();

describe('transform-oxc: early exits & parse', () => {
    it('returns the source untouched when it never mentions sz', () => {
        const src = 'export const A = () => <div className="x" />;';
        const result = run(src);
        expect(result.transformed).toBe(false);
        expect(result.code).toBe(src);
    });

    it('throws on oxc parse errors', () => {
        expect(() => transformOxc('const sz = <div className=;', 'F.tsx')).toThrow(
            /oxc-parser errors/,
        );
    });

    it('parses JSX inside a plain .js file (jsx lang override)', () => {
        expect(code('export const A = () => <div sz={{ p: 4 }} />;', 'legacy.js')).toContain('p-4');
    });

    it('compiles a basic sz object', () => {
        expect(code('export const A = () => <div sz={{ p: 4 }} />;')).toContain('p-4');
    });
});

describe('transform-oxc: szRecover', () => {
    it('emits a recovery token for a valid "csr" mode', () => {
        const result = run('export const A = () => <div sz={{ p: 4 }} szRecover="csr" />;');
        expect(result.code).toContain('data-sz-recovery-token=');
        expect(result.recoveryTokens.size).toBe(1);
    });

    it('uses <member> element name for a member-expression tag', () => {
        const result = run('export const A = () => <Card.Header sz={{ p: 4 }} szRecover="csr" />;');
        const token = [...result.recoveryTokens.values()][0];
        expect(token?.component).toBe('<member>');
    });

    it('skips token emission when already tagged', () => {
        const result = run(
            'export const A = () => <div data-sz-recovery-token="old" sz={{ p: 4 }} szRecover="csr" />;',
        );
        expect(result.recoveryTokens.size).toBe(0);
    });

    it('diagnoses a dynamic (non-literal) szRecover value', () => {
        const result = run('export const A = ({ m }) => <div sz={{ p: 4 }} szRecover={m} />;');
        expect(result.diagnostics.join('\n')).toContain('only string-literal values');
    });

    it('diagnoses an unknown szRecover mode', () => {
        const result = run('export const A = () => <div sz={{ p: 4 }} szRecover="bogus" />;');
        expect(result.diagnostics.join('\n')).toContain('unknown mode "bogus"');
    });
});

describe('transform-oxc: className raw collection', () => {
    it('splits an existing className into raw tokens, dropping blanks', () => {
        const result = run('export const A = () => <div className=" a  b " sz={{ p: 4 }} />;');
        expect([...result.rawClassNames].sort()).toEqual(['a', 'b']);
    });
});

describe('transform-oxc: szs slot maps', () => {
    it('compiles object + class-string slots to szsc', () => {
        const result = run(
            'export const A = () => <Panel szs={{ body: { p: 4 }, head: "text-red-500" }} />;',
        );
        expect(result.code).toContain('szsc={{ body: "p-4", head: "text-red-500" }}');
        expect(classesOf(result)).toEqual(['p-4', 'text-red-500']);
    });

    it('supports number, negative, boolean and nested pure-literal slot values', () => {
        const result = run(
            'export const A = () => <Panel szs={{ a: { mt: -2, opacity: 100, hover: { p: 1 } } }} />;',
        );
        expect(result.code).toContain('szsc={{');
        expect(result.code).toContain('-mt-2');
    });

    it('emits szsc={{}} for an empty slot map', () => {
        expect(code('export const A = () => <Panel szs={{}} />;')).toContain('szsc={{}}');
    });

    it('warns that szs has no effect on a host element', () => {
        const result = run('export const A = () => <div szs={{ body: { p: 4 } }} />;');
        expect(result.diagnostics.join('\n')).toContain('no effect on a host element');
    });

    it.each([
        ['a non-object value', 'export const A = () => <Panel szs="nope" />;'],
        ['a computed slot key', 'export const A = ({ k }) => <Panel szs={{ [k]: { p: 4 } }} />;'],
        ['an identifier slot value', 'export const A = ({ v }) => <Panel szs={{ body: v }} />;'],
    ])('rejects szs with %s', (_label, source) => {
        const result = run(source);
        expect(result.diagnostics.join('\n')).toContain('every slot must be an identifier key');
    });
});

describe('transform-oxc: sz string & missing value', () => {
    it('accepts a string sz value as raw classes', () => {
        expect(code('export const A = () => <div sz="p-4 m-2" />;')).toContain(
            'className="p-4 m-2"',
        );
    });

    it('throws on an sz attribute with no value', () => {
        expect(() => transformOxc('export const A = () => <div sz />;', 'F.tsx')).toThrow(
            OxcNotImplementedError,
        );
    });
});

describe('transform-oxc: conditional sz values', () => {
    it('lowers a ternary sz object to a className ternary', () => {
        const out = code('export const A = ({ on }) => <div sz={on ? { p: 1 } : { m: 2 }} />;');
        expect(out).toContain('className={on ? "p-1" : "m-2"}');
    });

    it('resolves object-literal branches referenced by identifier', () => {
        const out = code(
            'const A1 = { p: 1 }; const B1 = { m: 2 }; export const C = ({ on }) => <div sz={on ? A1 : B1} />;',
        );
        expect(out).toContain('? "p-1" : "m-2"');
    });

    it('falls back to runtime when a ternary branch is dynamic', () => {
        const result = run(
            'export const A = ({ on, v }) => <div sz={on ? { p: v } : { m: 2 }} />;',
        );
        expect(result.usesRuntime).toBe(true);
        expect(result.code).toContain('_sz(');
    });

    it('resolves a const conditional binding used as sz', () => {
        const out = code(
            'export const A = ({ on }) => { const cls = on ? { p: 1 } : { m: 2 }; return <div sz={cls} />; };',
        );
        expect(out).toContain('? "p-1" : "m-2"');
    });

    it('throws when a conditional sz is combined with a className', () => {
        expect(() =>
            transformOxc(
                'export const A = ({ on }) => <div className="x" sz={on ? { p: 1 } : { m: 2 }} />;',
                'F.tsx',
            ),
        ).toThrow(OxcNotImplementedError);
    });
});

describe('transform-oxc: identifier-bound sz', () => {
    it('compiles an sz object referenced by a local const binding', () => {
        expect(
            code('const box = { p: 4, m: 2 }; export const A = () => <div sz={box} />;'),
        ).toContain('className="p-4 m-2"');
    });
});

describe('transform-oxc: array composition', () => {
    it('deep-merges an all-static-object array at build time', () => {
        const result = run('export const A = () => <div sz={[{ p: 4 }, { m: 2 }]} />;');
        expect(result.code).toMatch(/className="p-4 m-2"|className="m-2 p-4"/);
    });

    it('emits _szcn for a mixed static + class-string array', () => {
        const result = run('export const A = () => <div sz={[{ p: 4 }, "extra-class"]} />;');
        expect(result.code).toContain('_szcn(');
        expect(result.usesSzcn).toBe(true);
    });

    it('joins an existing string className as the first _szcn argument', () => {
        const out = code('export const A = () => <div className="base" sz={[{ p: 4 }, "z"]} />;');
        expect(out).toContain('_szcn("base",');
    });

    it('joins an existing expression className as the first _szcn argument', () => {
        const out = code(
            'export const A = ({ cls }) => <div className={cls} sz={[{ p: 4 }, "z"]} />;',
        );
        expect(out).toContain('_szcn(cls,');
    });

    it('compiles a `cond && { … }` guard element into a conditional _szcn arg', () => {
        const out = code('export const A = ({ on }) => <div sz={[{ p: 4 }, on && { m: 2 }]} />;');
        expect(out).toContain('on && "m-2"');
    });

    it('keeps a `cond && "string"` guard element', () => {
        const out = code('export const A = ({ on }) => <div sz={[{ p: 4 }, on && "hi"]} />;');
        expect(out).toContain('on && "hi"');
    });

    it('drops an empty `cond && {}` guard but stays on the szcn lane', () => {
        const out = code('export const A = ({ on }) => <div sz={[{ p: 4 }, on && {}, "z"]} />;');
        expect(out).toContain('_szcn(');
        expect(out).not.toContain('&&');
    });

    it('wraps a dynamic guard right-hand side in _szPart', () => {
        const result = run(
            'export const A = ({ on, v }) => <div sz={[{ p: 4 }, on && { m: v }]} />;',
        );
        expect(result.code).toContain('_szPart(');
        expect(result.usesSzPart).toBe(true);
    });

    it('wraps a dynamic object element in _szPart', () => {
        const result = run('export const A = ({ v }) => <div sz={[{ p: 4 }, { m: v }]} />;');
        expect(result.code).toContain('_szPart(');
    });

    it('drops falsy and undefined array elements', () => {
        const result = run(
            'export const A = () => <div sz={[false, null, undefined, { p: 4 }]} />;',
        );
        expect(result.code).toContain('p-4');
    });

    it('falls back to runtime for an array with a spread element', () => {
        const result = run(
            'export const A = ({ rest, on }) => <div sz={[{ p: 4 }, on && { m: 2 }, ...rest]} />;',
        );
        expect(result.usesRuntime).toBe(true);
        expect(result.code).toContain('_sz(');
        expect(classesOf(result)).toEqual(expect.arrayContaining(['p-4', 'm-2']));
    });
});

describe('transform-oxc: conditional spread & nested conditional', () => {
    it('lowers `{ ...(cond ? a : b), static }` into a className ternary', () => {
        const out = code(
            'export const A = ({ on }) => <div sz={{ ...(on ? { p: 1 } : { m: 2 }), block: true }} />;',
        );
        expect(out).toContain('className={on ?');
    });

    it('renders an empty conditional-spread branch as undefined', () => {
        const out = code('export const A = ({ on }) => <div sz={{ ...(on ? {} : { m: 2 }) }} />;');
        expect(out).toContain('on ? undefined :');
    });

    it('returns null (runtime) when a conditional-spread branch is unresolvable', () => {
        const result = run(
            'export const A = ({ on, x }) => <div sz={{ ...(on ? x : { m: 2 }) }} />;',
        );
        expect(result.usesRuntime).toBe(true);
    });

    it('hoists a single nested conditional into a template-literal className', () => {
        const out = code(
            "export const A = ({ on }) => <div sz={{ bg: 'white', borderColor: { color: on ? 'red-700' : 'charcoal', op: 18 } }} />;",
        );
        expect(out).toContain('${on ?');
    });
});

describe('transform-oxc: partial (static + dynamic) objects', () => {
    it('keeps static classes and emits a style var for a dynamic prop', () => {
        const result = run('export const A = ({ v }) => <div sz={{ p: 4, m: v }} />;');
        expect(result.code).toContain('p-4');
        expect(result.code).toContain('style={{');
        expect(result.code).toMatch(/m-\(--/);
    });

    it('merges a dynamic-partial sz with an expression className via _szMerge', () => {
        const out = code('export const A = ({ cls, v }) => <div className={cls} sz={{ m: v }} />;');
        expect(out).toContain('_szMerge(cls,');
    });

    it('merges a dynamic-partial sz with a string className', () => {
        const out = code('export const A = ({ v }) => <div className="base" sz={{ m: v }} />;');
        expect(out).toMatch(/className="base m-\(--/);
    });

    it('emits a spacing helper style value', () => {
        expect(code('export const A = ({ v }) => <div sz={{ p: v }} />;')).toContain(
            '__szSpacingVar(v, "p")',
        );
    });

    it('emits a color __szColorVar style value and flags usesColorVar', () => {
        const result = run('export const A = ({ c }) => <div sz={{ bg: c }} />;');
        expect(result.code).toContain('__szColorVar(c)');
        expect(result.usesColorVar).toBe(true);
    });

    it('emits a deg unit helper for a dynamic angle prop', () => {
        expect(code('export const A = ({ a }) => <div sz={{ rotate: a }} />;')).toContain(
            '__szUnitVar(a, "deg", "rotate")',
        );
    });

    it('emits an ms unit helper for a dynamic duration prop', () => {
        expect(code('export const A = ({ d }) => <div sz={{ duration: d }} />;')).toContain(
            '__szUnitVar(d, "ms", "duration")',
        );
    });

    it('emits a passthrough style value for a unitless prop', () => {
        expect(code('export const A = ({ z }) => <div sz={{ z: z }} />;')).toContain(
            '"--_sz-z": z',
        );
    });

    it('lowers a single literal-branch conditional prop into a className ternary', () => {
        const out = code('export const A = ({ on }) => <div sz={{ p: on ? 1 : 2 }} />;');
        expect(out).toContain('on ? "p-1" : "p-2"');
    });

    it('keeps a static prefix beside a conditional prop', () => {
        const out = code('export const A = ({ on }) => <div sz={{ m: 2, p: on ? 1 : 4 }} />;');
        expect(out).toContain('m-2 ${on ?');
    });

    it('treats a conditional with a dynamic branch as a dynamic var', () => {
        const result = run('export const A = ({ on, v }) => <div sz={{ p: on ? v : 2 }} />;');
        expect(result.code).toContain('__szSpacingVar(on ? v : 2, "p")');
    });

    it('falls back to runtime for a conditional + dynamic mix', () => {
        const result = run('export const A = ({ on, v }) => <div sz={{ x: on ? 1 : 2, m: v }} />;');
        expect(result.usesRuntime).toBe(true);
    });

    it('resolves a bound spread inside a partial object', () => {
        const result = run(
            'const base = { p: 4 }; export const A = ({ v }) => <div sz={{ ...base, m: v }} />;',
        );
        expect(result.code).toContain('p-4');
    });

    it('falls back when a partial spread argument is unresolvable', () => {
        const result = run('export const A = ({ rest, v }) => <div sz={{ ...rest, m: v }} />;');
        expect(result.usesRuntime).toBe(true);
    });
});

describe('transform-oxc: runtime fallback diagnostics', () => {
    it('diagnoses a call-expression fallback', () => {
        const result = run('export const A = () => <div sz={makeSz()} />;');
        expect(result.diagnostics.join('\n')).toContain('function call `makeSz()`');
    });

    it('diagnoses a member-call fallback by method name', () => {
        const result = run('export const A = ({ o }) => <div sz={o.build()} />;');
        expect(result.diagnostics.join('\n')).toContain('`build()`');
    });

    it('diagnoses an unresolved identifier fallback', () => {
        const result = run('export const A = ({ styles }) => <div sz={styles} />;');
        expect(result.diagnostics.join('\n')).toContain('could not be resolved');
    });

    it('diagnoses a member-expression fallback', () => {
        const result = run('export const A = ({ o }) => <div sz={o.styles} />;');
        expect(result.diagnostics.join('\n')).toContain('member expression is not statically');
    });

    it('diagnoses a template-literal fallback as not analyzable', () => {
        const result = run('export const A = ({ x }) => <div sz={`${x}`} />;');
        expect(result.diagnostics.join('\n')).toContain('is not statically analyzable');
    });

    it('warns on an unresolvable top-level object spread', () => {
        const result = run('export const A = ({ x }) => <div sz={{ ...x }} />;');
        expect(result.diagnostics.join('\n')).toContain('unresolvable sz spread');
    });

    it('collects candidate classes from a logical-and sz fallback', () => {
        const result = run('export const A = ({ on }) => <div sz={on && { p: 4 }} />;');
        expect(classesOf(result)).toContain('p-4');
    });
});

describe('transform-oxc: className merging (static sz)', () => {
    it('merges a string className before sz-derived classes', () => {
        expect(code('export const A = () => <div className="base" sz={{ p: 4 }} />;')).toContain(
            'className="base p-4"',
        );
    });

    it('merges an expression className via _szMerge', () => {
        expect(
            code('export const A = ({ cls }) => <div className={cls} sz={{ p: 4 }} />;'),
        ).toContain('_szMerge(cls, "p-4")');
    });

    it('emits className={undefined} when sz lowers to zero classes', () => {
        expect(code('export const A = () => <div sz={{}} />;')).toContain('className={undefined}');
    });
});

describe('transform-oxc: candidate collection over complex fallback objects', () => {
    it('sweeps spread/variant/conditional/object props for safelisting', () => {
        const result = run(
            'export const A = ({ rest, v, on }) => <div sz={{ ...rest, hover: { p: v }, mx: on ? 2 : 4, focus: { m: 2 } }} />;',
        );
        const classes = classesOf(result);
        expect(classes).toEqual(expect.arrayContaining(['mx-2', 'mx-4']));
    });

    it('collects nested object classes from a dynamic array part', () => {
        const result = run(
            'export const A = ({ on, v }) => <div sz={[{ p: 4 }, on ? { m: v, w: 8 } : { m: 2 }]} />;',
        );
        expect(classesOf(result)).toEqual(expect.arrayContaining(['w-8', 'm-2']));
    });
});

describe('transform-oxc: dynamic() / szr() safelisting', () => {
    it('collects classes from a dynamic({...}) call', () => {
        const result = run('const s = dynamic({ p: 4 }); export const A = () => <div sz="m-1" />;');
        expect(classesOf(result)).toEqual(expect.arrayContaining(['p-4', 'm-1']));
    });

    it('collects classes from an szr({...}) call', () => {
        const result = run('const s = szr({ m: 2 }); export const A = () => <div sz="p-1" />;');
        expect(classesOf(result)).toContain('m-2');
    });

    it.each([
        ['no arguments', 'const s = dynamic(); export const A = () => <div sz="p-1" />;'],
        ['a non-object argument', 'const s = dynamic(x); export const A = () => <div sz="p-1" />;'],
        [
            'an unresolvable value',
            'export const A = ({ v }) => { const s = dynamic({ p: v }); return <div sz="p-1" />; };',
        ],
        [
            'a different callee',
            'const s = other({ p: 4 }); export const A = () => <div sz="p-1" />;',
        ],
    ])('does not safelist dynamic classes for %s', (_label, source) => {
        const result = run(source);
        expect(classesOf(result)).toEqual(['p-1']);
    });
});

describe('transform-oxc: szv catalog safelisting', () => {
    it.each([
        [
            'base and variants',
            'const s = szv({ base: { p: 4 }, variants: { size: { lg: { p: 8 } } } }); export const A = () => <div sz="m-1" />;',
            ['p-4', 'p-8'],
        ],
        [
            'variants without a base',
            'const s = szv({ variants: { size: { lg: { p: 8 } } } }); export const A = () => <div sz="m-1" />;',
            ['p-8'],
        ],
        [
            'a base without variants',
            'const s = szv({ base: { p: 4 } }); export const A = () => <div sz="m-1" />;',
            ['p-4'],
        ],
        ['no arguments', 'const s = szv(); export const A = () => <div sz="m-1" />;', []],
        [
            'finite conditional values',
            'const s = szv({ variants: { size: { lg: { p: 1 }, x: (0 ? { p: 2 } : { p: 3 }) } } }); export const A = () => <div sz="m-1" />;',
            ['p-1', 'p-2', 'p-3'],
        ],
    ])('collects classes from szv with %s', (_label, source, expectedClasses) => {
        const result = run(source);
        expect(classesOf(result)).toEqual(expect.arrayContaining(['m-1', ...expectedClasses]));
    });

    it('resolves a const-bound variant value object', () => {
        const result = run(
            'const V = { p: 5 }; const s = szv({ variants: { size: { lg: V } } }); export const A = () => <div sz="m-1" />;',
        );
        expect(classesOf(result)).toContain('p-5');
    });

    it('resolves a const-bound variant dimension object', () => {
        const result = run(
            'const D = { lg: { p: 6 } }; const s = szv({ variants: { size: D } }); export const A = () => <div sz="m-1" />;',
        );
        expect(classesOf(result)).toContain('p-6');
    });

    it('reads negative and positive unary leaf values', () => {
        const result = run(
            'const s = szv({ base: { mt: -2, mb: +3 } }); export const A = () => <div sz="m-1" />;',
        );
        expect(classesOf(result)).toEqual(expect.arrayContaining(['-mt-2', 'mb-3']));
    });

    it('skips spread / computed dimension and variant entries', () => {
        const result = run(
            'const s = szv({ ...pre, base: { p: 4 }, variants: { ...more, [dyn]: { a: 1 }, size: { ...v, [k]: {}, lg: { p: 8 } } } }); export const A = () => <div sz="m-1" />;',
        );
        expect(classesOf(result)).toEqual(expect.arrayContaining(['p-4', 'p-8']));
    });

    it('skips a non-object variant dimension value', () => {
        const result = run(
            'const s = szv({ base: { p: 4 }, variants: { size: 5 } }); export const A = () => <div sz="m-1" />;',
        );
        expect(classesOf(result)).toContain('p-4');
    });

    it('skips an unresolved identifier dimension value', () => {
        const result = run(
            'const s = szv({ base: { p: 4 }, variants: { size: unknownDim } }); export const A = () => <div sz="m-1" />;',
        );
        expect(classesOf(result)).toContain('p-4');
    });

    it('does not exponentiate on a deeply nested base (depth cap)', () => {
        const deep = `{ a: `.repeat(20) + '{ p: 1 }' + ` }`.repeat(20);
        const result = run(
            `const s = szv({ base: ${deep} }); export const A = () => <div sz="m-1" />;`,
        );
        expect(classesOf(result)).toContain('m-1');
    });
});

describe('transform-oxc: value & key shapes', () => {
    it('accepts string and number object keys', () => {
        expect(code("export const A = () => <div sz={{ 'p': 4, 5: 2 }} />;")).toContain('p-4');
    });

    it('reads a negative number literal value', () => {
        expect(code('export const A = () => <div sz={{ mt: -2 }} />;')).toContain('-mt-2');
    });

    it('looks through `as`/`satisfies` wrappers on a nested value', () => {
        expect(code('export const A = () => <div sz={{ p: (4 as number) }} />;')).toContain('p-4');
    });

    it('treats a logical-expression prop value as a dynamic runtime var', () => {
        // Exercises astValueToSzValue's logical/conditional throw before the
        // property is reclassified as a dynamic CSS variable.
        const out = code('export const A = ({ a, b }) => <div sz={{ p: a && b }} />;');
        expect(out).toContain('__szSpacingVar(a && b, "p")');
    });
});

describe('transform-oxc: mangleVars component hoisting', () => {
    it('hoists a shared dynamic var to a component-tier style prop', () => {
        const src =
            'export const A = ({ v }) => (\n' +
            '  <div sz={{ p: v }}>\n' +
            '    <span sz={{ p: v }} />\n' +
            '  </div>\n' +
            ');';
        const result = run(src, 'F.tsx', { mangleVars: true });
        expect(result.code).toContain('style={{');
        expect(result.cssVariableMap.size).toBeGreaterThan(0);
    });

    it('avoids user-authored inline custom-property names', () => {
        const src =
            'export const A = ({ v }) => (\n' +
            '  <div style={{ "--used": 1 }}>\n' +
            '    <span sz={{ p: v }} />\n' +
            '    <b sz={{ p: v }} />\n' +
            '  </div>\n' +
            ');';
        const result = run(src, 'F.tsx', { mangleVars: true });
        expect(result.code).toContain('--used');
    });

    it('hoists shared dynamic vars across a JSX fragment', () => {
        const src =
            'export const A = ({ v }) => (\n' +
            '  <>\n' +
            '    <span sz={{ p: (v) }} />\n' +
            '    <b sz={{ p: (v) }} />\n' +
            '  </>\n' +
            ');';
        const result = run(src, 'F.tsx', { mangleVars: true });
        expect(result.code).toContain('style={{');
    });
});

describe('transform-oxc: globalVarAliases', () => {
    it('rewrites an exact custom-property value through a Map alias table', () => {
        const result = run('export const A = () => <div sz={{ bg: "--brand" }} />;', 'F.tsx', {
            globalVarAliases: new Map([['--brand', '--b0']]),
        });
        expect(result.code).toContain('--b0');
        expect(result.cssVariableMap.get('--brand')).toBe('--b0');
    });

    it('accepts an array-form alias table', () => {
        const result = run('export const A = () => <div sz={{ bg: "--brand" }} />;', 'F.tsx', {
            globalVarAliases: [['--brand', '--b1']],
        });
        expect(result.code).toContain('--b1');
    });

    it('accepts an object-form alias table and ignores non-var entries', () => {
        const result = run('export const A = () => <div sz={{ bg: "--brand" }} />;', 'F.tsx', {
            globalVarAliases: { '--brand': '--b2', notavar: '--x' },
        });
        expect(result.code).toContain('--b2');
    });

    it('rewrites aliases inside nested variant objects', () => {
        const result = run(
            'export const A = () => <div sz={{ hover: { bg: "--brand" } }} />;',
            'F.tsx',
            { globalVarAliases: new Map([['--brand', '--b3']]) },
        );
        expect(result.code).toContain('--b3');
    });
});

describe('transform-oxc: multiple sz attributes', () => {
    it('deletes extra sz attributes on the runtime fallback path', () => {
        const result = run('export const A = ({ styles }) => <div sz={styles} sz={{ m: 2 }} />;');
        expect(result.code).toContain('_sz(styles)');
        expect(result.code).not.toContain('m: 2');
    });
});

describe('transform-oxc: className present with conditional/spread → runtime throw', () => {
    it('throws for a conditional const binding beside a className', () => {
        expect(() =>
            transformOxc(
                'export const A = ({ on }) => { const c = on ? { p: 1 } : { m: 2 }; return <div className="x" sz={c} />; };',
                'F.tsx',
            ),
        ).toThrow(OxcNotImplementedError);
    });

    it('throws for a conditional spread beside a className', () => {
        expect(() =>
            transformOxc(
                'export const A = ({ on }) => <div className="x" sz={{ ...(on ? { p: 1 } : { m: 2 }), block: true }} />;',
                'F.tsx',
            ),
        ).toThrow(OxcNotImplementedError);
    });

    it('throws for a nested conditional object beside a className', () => {
        expect(() =>
            transformOxc(
                "export const A = ({ on }) => <div className='x' sz={{ bg: 'white', borderColor: { color: on ? 'red-700' : 'charcoal', op: 18 } }} />;",
                'F.tsx',
            ),
        ).toThrow(OxcNotImplementedError);
    });
});

describe('transform-oxc: assorted attribute/value shapes', () => {
    it('handles a valueless className attribute beside sz', () => {
        expect(code('export const A = () => <div className sz={{ p: 4 }} />;')).toContain('p-4');
    });

    it('diagnoses a computed-member call fallback with a "?" name', () => {
        const result = run('export const A = ({ o, a }) => <div sz={o[a.b]()} />;');
        expect(result.diagnostics.join('\n')).toContain('function call `?()`');
    });

    it('accepts string, boolean and number pure-literal szs slot values', () => {
        const result = run(
            'export const A = () => <Panel szs={{ body: { display: "flex", block: true, order: 1 } }} />;',
        );
        expect(result.code).toContain('szsc={{');
    });

    it('falls back to runtime for a computed key in an sz object', () => {
        const result = run('export const A = ({ k, v }) => <div sz={{ [k]: v }} />;');
        expect(result.usesRuntime).toBe(true);
    });

    it('keeps falsy leading elements while collecting spread-array candidates', () => {
        const result = run(
            'export const A = ({ rest, on }) => <div sz={[null, { p: 4 }, on && { m: 2 }, ...rest]} />;',
        );
        expect(classesOf(result)).toEqual(expect.arrayContaining(['p-4', 'm-2']));
    });

    it('collects known-variant and non-variant object candidates from a fallback object', () => {
        const result = run(
            'export const A = ({ rest }) => <div sz={{ ...rest, hover: { p: 4 } }} />;',
        );
        expect(classesOf(result)).toContain('hover:p-4');
    });
});

describe('transform-oxc: nested & conditional class-source edge cases', () => {
    it('keeps a static prefix beside a hoisted nested conditional', () => {
        const out = code(
            "export const A = ({ on }) => <div sz={{ p: 4, hover: { display: on ? 'block' : 'inline' } }} />;",
        );
        expect(out).toContain('p-4 ${on ?');
        expect(out).toContain('hover:block');
    });

    it('renders an empty bare conditional prop branch as undefined', () => {
        const out = code(
            "export const A = ({ on }) => <div sz={{ display: on ? 'block' : '' }} />;",
        );
        expect(out).toContain(': undefined');
    });

    it('omits a utility for a null-literal conditional branch', () => {
        const out = code('export const A = ({ on }) => <div sz={{ p: on ? null : 2 }} />;');
        expect(out).toContain('on ? undefined : "p-2"');
        expect(out).not.toContain('__szSpacingVar');
    });

    it('returns null (fallback) when a static-conditional branch is an unbound identifier', () => {
        const B4 = 'const B4 = { m: 2 };';
        const result = run(
            `${B4} export const A = ({ on, ghost }) => <div sz={on ? ghost : B4} />;`,
        );
        expect(result.usesRuntime).toBe(true);
    });
});

describe('transform-oxc: nested variants & unknown keys', () => {
    it('builds a doubly-nested variant chain for a dynamic prop', () => {
        expect(
            code('export const A = ({ v }) => <div sz={{ hover: { focus: { p: v } } }} />;'),
        ).toContain('hover-focus:p-(--');
    });

    it('keeps nested static props beside a nested dynamic prop', () => {
        const out = code('export const A = ({ v }) => <div sz={{ hover: { p: 4, m: v } }} />;');
        expect(out).toContain('hover:p-4');
        expect(out).toContain('hover:m-(--');
    });

    it('derives a kebab tw-prefix for an unknown dynamic property key', () => {
        expect(code('export const A = ({ v }) => <div sz={{ fooBar: v }} />;')).toContain(
            'foo-bar-(--',
        );
    });

    it('falls back when a partial spread argument holds a dynamic value', () => {
        const result = run(
            'export const A = ({ x, v }) => { const base = { m: x }; return <div sz={{ ...base, p: v }} />; };',
        );
        expect(result.usesRuntime).toBe(true);
    });
});

describe('transform-oxc: mangleVars value keys & categories', () => {
    it('normalizes redundant/quoted parens across every dynamic category', () => {
        const src =
            'export const A = ({ c, a, d, z, v, x, y }) => <div sz={{\n' +
            '  bg: (c),\n' +
            '  rotate: (a),\n' +
            '  duration: (d),\n' +
            '  z: (z),\n' +
            '  p: ((v)),\n' +
            '  m: (x) + (y),\n' +
            '  w: (fn("x)y"))\n' +
            '}} />;';
        const result = run(src, 'F.tsx', { mangleVars: true });
        expect(result.code).toContain('__szColorVar(c)');
        expect(result.code).toContain('deg');
        expect(result.code).toContain('ms');
    });

    it('escaped quotes inside a parenthesized dynamic value are handled', () => {
        const src = 'export const A = ({ f }) => <div sz={{ h: (f("a\\"b)c")) }} />;';
        const result = run(src, 'F.tsx', { mangleVars: true });
        expect(result.code).toContain('style={{');
    });

    it('hoists across a member-expression component element', () => {
        const src =
            'export const A = ({ v }) => (\n' +
            '  <Foo.Bar sz={{ p: v }}>\n' +
            '    <span sz={{ p: v }} />\n' +
            '  </Foo.Bar>\n' +
            ');';
        const result = run(src, 'F.tsx', { mangleVars: true });
        expect(result.code).toContain('p-(--');
    });

    it('shares two distinct dynamic vars on sibling elements', () => {
        const src =
            'export const A = ({ v, w }) => (\n' +
            '  <div>\n' +
            '    <span sz={{ p: v, m: w }} />\n' +
            '    <b sz={{ p: v, m: w }} />\n' +
            '  </div>\n' +
            ');';
        const result = run(src, 'F.tsx', { mangleVars: true });
        expect(result.code).toContain('style={{');
        expect(result.cssVariableMap.size).toBeGreaterThan(0);
    });

    it('skips a spread attribute and non-object sz when collecting hoist candidates', () => {
        const src =
            'export const A = ({ props, on, v }) => (\n' +
            '  <div {...props} sz={on ? {} : {}}>\n' +
            '    <span sz={{ p: v }} />\n' +
            '  </div>\n' +
            ');';
        const result = run(src, 'F.tsx', { mangleVars: true });
        expect(result.code).toContain('p-(--');
    });

    it('skips a conditional-bearing sz object when collecting hoist candidates', () => {
        const src =
            'export const A = ({ on, v }) => (\n' +
            '  <div sz={{ p: on ? 1 : 2 }}>\n' +
            '    <span sz={{ m: v }} />\n' +
            '  </div>\n' +
            ');';
        const result = run(src, 'F.tsx', { mangleVars: true });
        expect(result.code).toContain('m-(--');
    });

    it('records user-authored inline custom props with spread and identifier keys', () => {
        const src =
            'export const A = ({ s, v }) => (\n' +
            '  <div style={{ ...s, color: "red", "--used": 1 }}>\n' +
            '    <span sz={{ p: v }} />\n' +
            '    <b sz={{ p: v }} />\n' +
            '  </div>\n' +
            ');';
        const result = run(src, 'F.tsx', { mangleVars: true });
        expect(result.code).toContain('--used');
    });
});
