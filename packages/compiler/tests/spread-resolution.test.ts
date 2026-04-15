import { describe, expect, it } from 'vitest';

import { transformSourceCode } from '../src/transform.js';

/**
 * Tests for local-variable spread resolution in sz props.
 *
 * The compiler resolves `{ ...localVar }` at build time when the variable is
 * a plain object literal defined in the same file, producing zero-runtime
 * output just like inline object literals.
 *
 * Unsupported patterns (imported vars, dynamic spreads, computed spreads) fall
 * back to the existing _sz() runtime wrapper — no error, no silent breakage.
 */
describe('spread resolution', () => {
    // ─── Basic spread ─────────────────────────────────────────────────────────

    // ─── Direct variable reference (no spread) ───────────────────────────────

    describe('sz={localVar}', () => {
        it('resolves plain variable reference to className', () => {
            const src = `
                const item = { p: 3, rounded: 'md' };
                const A = () => <div sz={item} />;
            `;
            const result = transformSourceCode(src);
            expect(result.transformed).toBe(true);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('className="p-3 rounded-md"');
        });

        it('resolves variable declared with "as const" to className', () => {
            const src = `
                const item = { p: 3, rounded: 'md' } as const;
                const A = () => <div sz={item} />;
            `;
            const result = transformSourceCode(src);
            expect(result.transformed).toBe(true);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('className="p-3 rounded-md"');
        });
    });

    describe('sz={{ ...localVar }}', () => {
        it('resolves const variable to className at build time', () => {
            const src = `
                const base = { p: 4, bg: 'blue-500' };
                const A = () => <div sz={{ ...base }} />;
            `;
            const result = transformSourceCode(src);
            expect(result.transformed).toBe(true);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('className="p-4 bg-blue-500"');
        });

        it('resolves const variable declared with "as const"', () => {
            const src = `
                const base = { p: 4, bg: 'blue-500' } as const;
                const A = () => <div sz={{ ...base }} />;
            `;
            const result = transformSourceCode(src);
            expect(result.transformed).toBe(true);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('className="p-4 bg-blue-500"');
        });

        it('resolves let variable the same as const', () => {
            const src = `
                let base = { rounded: 'md', text: 'sm' };
                const A = () => <div sz={{ ...base }} />;
            `;
            const result = transformSourceCode(src);
            expect(result.transformed).toBe(true);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('className="rounded-md text-sm"');
        });

        it('collects classes into result.classes', () => {
            const src = `
                const card = { p: 4, shadow: 'md' };
                const A = () => <div sz={{ ...card }} />;
            `;
            const result = transformSourceCode(src);
            expect(result.classes.has('p-4')).toBe(true);
            expect(result.classes.has('shadow-md')).toBe(true);
        });
    });

    // ─── Spread + extra props ─────────────────────────────────────────────────

    describe('sz={{ ...localVar, extra: val }}', () => {
        it('merges spread with additional inline props', () => {
            const src = `
                const base = { flex: true, gap: 2 };
                const A = () => <div sz={{ ...base, mt: 4 }} />;
            `;
            const result = transformSourceCode(src);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('flex');
            expect(result.code).toContain('gap-2');
            expect(result.code).toContain('mt-4');
        });

        it('later inline prop overrides same key from spread', () => {
            const src = `
                const base = { p: 4, bg: 'blue-500' };
                const A = () => <div sz={{ ...base, p: 8 }} />;
            `;
            const result = transformSourceCode(src);
            expect(result.usesRuntime).toBe(false);
            // p-8 wins over p-4 from spread
            expect(result.code).toContain('p-8');
            expect(result.code).not.toContain('p-4');
            expect(result.code).toContain('bg-blue-500');
        });

        it('spread prop overrides earlier inline prop of same key', () => {
            const src = `
                const over = { p: 8 };
                const A = () => <div sz={{ p: 4, ...over }} />;
            `;
            const result = transformSourceCode(src);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('p-8');
            expect(result.code).not.toContain('p-4');
        });
    });

    // ─── Multiple spreads ─────────────────────────────────────────────────────

    describe('sz={{ ...varA, ...varB }}', () => {
        it('merges two spread variables', () => {
            const src = `
                const layout = { flex: true, gap: 4 };
                const color = { bg: 'blue-500', color: 'white' };
                const A = () => <div sz={{ ...layout, ...color }} />;
            `;
            const result = transformSourceCode(src);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('flex');
            expect(result.code).toContain('gap-4');
            expect(result.code).toContain('bg-blue-500');
            expect(result.code).toContain('text-white');
        });

        it('second spread overrides first on conflict', () => {
            const src = `
                const a = { p: 2, rounded: 'sm' };
                const b = { p: 6 };
                const A = () => <div sz={{ ...a, ...b }} />;
            `;
            const result = transformSourceCode(src);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('p-6');
            expect(result.code).not.toContain('p-2');
            expect(result.code).toContain('rounded-sm');
        });
    });

    // ─── Nested spread (spread of a spread) ──────────────────────────────────

    describe('spread of spread', () => {
        it('resolves two levels of spread nesting', () => {
            const src = `
                const base = { p: 4 };
                const extended = { ...base, rounded: 'lg' };
                const A = () => <div sz={{ ...extended, mt: 2 }} />;
            `;
            const result = transformSourceCode(src);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('p-4');
            expect(result.code).toContain('rounded-lg');
            expect(result.code).toContain('mt-2');
        });
    });

    // ─── Spread + variants ────────────────────────────────────────────────────

    describe('spread containing variant objects', () => {
        it('resolves spread that includes hover variant', () => {
            const src = `
                const interactive = { cursor: 'pointer', hover: { opacity: 75 } };
                const A = () => <button sz={{ ...interactive, px: 4 }} />;
            `;
            const result = transformSourceCode(src);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('cursor-pointer');
            expect(result.code).toContain('hover:opacity-75');
            expect(result.code).toContain('px-4');
        });
    });

    // ─── Spread inside sz={[...]} array ──────────────────────────────────────

    describe('spread inside array element', () => {
        it('resolves spread inside array object element', () => {
            const src = `
                const base = { p: 4, rounded: 'md' };
                const A = () => <div sz={[{ ...base }, isActive && { bg: 'blue-500' }]} />;
            `;
            const result = transformSourceCode(src);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('p-4');
            expect(result.code).toContain('rounded-md');
        });
    });

    // ─── Spread + dynamic value (CSS var path) ────────────────────────────────

    describe('spread + dynamic prop → CSS variable path', () => {
        it('static spread merges with dynamic prop via CSS var, no _sz() runtime', () => {
            const src = `
                const base = { rounded: 'lg', p: 4 };
                const A = ({ color }) => <div sz={{ ...base, bg: color }} />;
            `;
            const result = transformSourceCode(src);
            expect(result.transformed).toBe(true);
            // CSS var path: no _sz() runtime
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('rounded-lg');
            expect(result.code).toContain('p-4');
            // Dynamic bg gets a CSS variable class
            expect(result.code).toContain('bg-(');
        });
    });

    // ─── Fallback: unresolvable spreads ───────────────────────────────────────

    describe('unresolvable spreads fall back gracefully', () => {
        it('imported variable spread falls back to _sz() runtime', () => {
            // Import binding: path.isImportSpecifier(), not isVariableDeclarator()
            const src = `
                import { baseStyle } from './styles';
                const A = () => <div sz={{ ...baseStyle, p: 4 }} />;
            `;
            const result = transformSourceCode(src);
            // Falls back — does not crash, does not produce [object Object]
            expect(result.code).not.toContain('[object Object]');
        });

        it('computed spread expression falls back to _sz() runtime', () => {
            const src = `
                const A = ({ getStyle }) => <div sz={{ ...getStyle(), p: 4 }} />;
            `;
            const result = transformSourceCode(src);
            expect(result.code).not.toContain('[object Object]');
        });

        it('variable with non-object initializer falls back', () => {
            const src = `
                const notAnObject = 'some-class';
                const A = () => <div sz={{ ...notAnObject, p: 4 }} />;
            `;
            const result = transformSourceCode(src);
            expect(result.code).not.toContain('[object Object]');
        });
    });

    // ─── No-runtime guarantee ─────────────────────────────────────────────────

    describe('zero-runtime guarantee', () => {
        it('resolving spread produces no import of _sz helpers', () => {
            const src = `
                const card = { p: 6, rounded: 'xl', shadow: 'lg' };
                const A = () => <div sz={{ ...card, mt: 4 }} />;
            `;
            const result = transformSourceCode(src);
            expect(result.usesRuntime).toBe(false);
            expect(result.usesMerge).toBe(false);
            expect(result.code).not.toContain('_sz(');
            expect(result.code).not.toContain('_szMerge');
        });
    });
});

// ─── Option B: Conditional spread hoist ──────────────────────────────────────

describe('sz={{ ...(cond ? varA : varB), key: val }}', () => {
    it('hoists ternary spread: both branches as variable references', () => {
        const src = `
            const active   = { bg: 'blue-500', color: 'white' };
            const inactive = { bg: 'gray-100', color: 'gray-600' };
            const A = ({ isActive }) => <div sz={{ ...(isActive ? active : inactive), p: 4 }} />;
        `;
        const result = transformSourceCode(src);
        expect(result.transformed).toBe(true);
        expect(result.usesRuntime).toBe(false);
        expect(result.code).toContain('isActive ?');
        expect(result.code).toContain('bg-blue-500');
        expect(result.code).toContain('bg-gray-100');
        expect(result.code).toContain('p-4');
        expect(result.code).not.toContain('_sz(');
    });

    it('hoists with multiple static overrides', () => {
        const src = `
            const primary = { bg: 'blue-600', color: 'white' };
            const ghost   = { bg: 'transparent', color: 'blue-600' };
            const A = ({ isPrimary }) => (
                <button sz={{ ...(isPrimary ? primary : ghost), px: 4, py: 2, rounded: 'md' }} />
            );
        `;
        const result = transformSourceCode(src);
        expect(result.usesRuntime).toBe(false);
        expect(result.code).toContain('isPrimary ?');
        expect(result.code).toContain('bg-blue-600');
        expect(result.code).toContain('bg-transparent');
        expect(result.code).toContain('px-4');
        expect(result.code).toContain('py-2');
        expect(result.code).toContain('rounded-md');
    });

    it('hoists with as const branches', () => {
        const src = `
            const on  = { opacity: 100 } as const;
            const off = { opacity: 0   } as const;
            const A = ({ show }) => <div sz={{ ...(show ? on : off), transition: 'opacity' }} />;
        `;
        const result = transformSourceCode(src);
        expect(result.usesRuntime).toBe(false);
        expect(result.code).toContain('show ?');
        expect(result.code).toContain('opacity-100');
        expect(result.code).toContain('opacity-0');
        expect(result.code).toContain('transition-opacity');
    });

    it('hoists with chained variable branches', () => {
        const src = `
            const base    = { rounded: 'md', border: true } as const;
            const active  = { ...base, bg: 'blue-500', borderColor: 'blue-600' } as const;
            const passive = { ...base, bg: 'gray-100',  borderColor: 'gray-300' } as const;
            const A = ({ on }) => <div sz={{ ...(on ? active : passive), p: 3 }} />;
        `;
        const result = transformSourceCode(src);
        expect(result.usesRuntime).toBe(false);
        expect(result.code).toContain('on ?');
        expect(result.code).toContain('bg-blue-500');
        expect(result.code).toContain('bg-gray-100');
        expect(result.code).toContain('p-3');
    });

    it('falls back gracefully when override value is dynamic', () => {
        // sz={{ ...(cond ? a : b), rotate: dynamicProp }} — rotate is runtime
        // Cannot hoist because the resulting objects would not be fully static.
        // Falls back to _sz() which throws in dev (Option A guard).
        const src = `
            const a = { bg: 'blue-500' };
            const b = { bg: 'gray-100' };
            const A = ({ cond, deg }) => <div sz={{ ...(cond ? a : b), rotate: deg }} />;
        `;
        const result = transformSourceCode(src);
        // Falls back — no build-time resolution possible for dynamic rotate
        expect(result.usesRuntime).toBe(true);
    });
});

// ─── Option C: sz={cond ? CONST_A : CONST_B} — direct top-level ternary ──────
// Both branches are module-level const identifiers resolvable at build time.
// No dynamic() or _sz() wrapper needed — pre-plugin generates className={cond?"a":"b"}.

describe('sz={cond ? CONST_A : CONST_B} — direct ternary with module-level consts', () => {
    it('compiles both branches at build time, no runtime fallback', () => {
        const src = `
            const SQUARE = { size: 16, rounded: 'xl' } as const;
            const CIRCLE = { size: 16, rounded: 'full' } as const;
            const A = ({ circle }) => <div sz={circle ? CIRCLE : SQUARE} />;
        `;
        const result = transformSourceCode(src);
        expect(result.transformed).toBe(true);
        expect(result.usesRuntime).toBe(false);
        expect(result.code).toContain('circle ?');
        expect(result.code).toContain('size-16 rounded-full');
        expect(result.code).toContain('size-16 rounded-xl');
    });

    it('handles nested objects in branches (e.g. bgImg)', () => {
        const src = `
            const A_STYLE = { size: 24, bgImg: { gradient: 'linear', dir: 'to-br' }, rounded: 'xl' } as const;
            const B_STYLE = { size: 24, bgImg: { gradient: 'linear', dir: 'to-br' }, rounded: 'full' } as const;
            const A = ({ toggle }) => <div sz={toggle ? A_STYLE : B_STYLE} />;
        `;
        const result = transformSourceCode(src);
        expect(result.usesRuntime).toBe(false);
        expect(result.code).toContain('toggle ?');
        expect(result.code).toContain('rounded-xl');
        expect(result.code).toContain('rounded-full');
    });

    it('handles multiple static props in both branches', () => {
        const src = `
            const ON  = { opacity: 100, scale: 100 } as const;
            const OFF = { opacity: 0,   scale: 75  } as const;
            const A = ({ visible }) => <div sz={visible ? ON : OFF} />;
        `;
        const result = transformSourceCode(src);
        expect(result.usesRuntime).toBe(false);
        expect(result.code).toContain('opacity-100');
        expect(result.code).toContain('opacity-0');
    });

    it('resolves function-body local consts too (compiler traces all bindings in scope)', () => {
        const src = `
            const A = ({ toggle }) => {
                const LOCAL = { p: 4, bg: 'blue-500' };
                const OTHER = { p: 8, bg: 'red-500' };
                return <div sz={toggle ? LOCAL : OTHER} />;
            };
        `;
        const result = transformSourceCode(src);
        // Compiler resolves local bindings — no runtime needed
        expect(result.usesRuntime).toBe(false);
        expect(result.code).toContain('p-4 bg-blue-500');
        expect(result.code).toContain('p-8 bg-red-500');
    });

    it('falls back gracefully when a branch is a function call', () => {
        const src = `
            const STATIC = { p: 4 } as const;
            const A = ({ toggle }) => <div sz={toggle ? STATIC : getDynamic()} />;
        `;
        const result = transformSourceCode(src);
        expect(result.usesRuntime).toBe(true);
    });
});

// ─── Nested spread inside variant value ───────────────────────────────────────
// DRY pattern: const BASE = { ... }; sz={{ before: { ...BASE, content: '' } }}
// The spread is inside a variant object value, not at the top level.

describe('spread inside variant value (DRY base prop pattern)', () => {
    it('resolves spread inside before: {} at build time', () => {
        // content: "''" = CSS empty string — note: sz uses "''" not '' for pseudo-element content
        const src = `
            const maskBase = { bgImg: 'url(/mask.svg)', bgSize: 'contain', bgRepeat: 'no-repeat' } as const;
            const A = () => <div sz={{ before: { ...maskBase, content: "''" } }} />;
        `;
        const result = transformSourceCode(src);
        expect(result.usesRuntime).toBe(false);
        expect(result.code).toContain('before:bg-[url(/mask.svg)]');
        expect(result.code).toContain('before:bg-contain');
        expect(result.code).toContain('before:bg-no-repeat');
        expect(result.code).toContain("before:content-['']");
    });

    it('resolves spread inside after: {} at build time', () => {
        const src = `
            const maskBase = { bgImg: 'url(/mask.svg)', bgSize: 'contain' } as const;
            const A = () => <div sz={{ after: { ...maskBase, content: "''" } }} />;
        `;
        const result = transformSourceCode(src);
        expect(result.usesRuntime).toBe(false);
        expect(result.code).toContain('after:bg-[url(/mask.svg)]');
        expect(result.code).toContain('after:bg-contain');
    });

    it('resolves spread inside hover: {} at build time', () => {
        const src = `
            const hoverStyles = { bg: 'blue-600', scale: 105 } as const;
            const A = () => <div sz={{ bg: 'blue-500', hover: { ...hoverStyles } }} />;
        `;
        const result = transformSourceCode(src);
        expect(result.usesRuntime).toBe(false);
        expect(result.code).toContain('bg-blue-500');
        expect(result.code).toContain('hover:bg-blue-600');
        expect(result.code).toContain('hover:scale-105');
    });

    it('resolves shared BASE with per-variant overrides at build time', () => {
        // The canonical DRY mask pattern: before and after share base, each adds content
        const src = `
            const maskBase = { bgImg: 'url(/sprite.svg)', bgSize: '24px 24px', bgRepeat: 'no-repeat' } as const;
            const A = () => (
                <div sz={{
                    before: { ...maskBase, content: "''" },
                    after:  { ...maskBase, content: "''" },
                }} />
            );
        `;
        const result = transformSourceCode(src);
        expect(result.usesRuntime).toBe(false);
        expect(result.code).toContain('before:bg-[url(/sprite.svg)]');
        expect(result.code).toContain('after:bg-[url(/sprite.svg)]');
    });

    it('resolves deeply nested spread (hover inside a variant key)', () => {
        const src = `
            const base = { p: 4, rounded: 'md' } as const;
            const A = () => <div sz={{ md: { ...base, bg: 'blue-500' } }} />;
        `;
        const result = transformSourceCode(src);
        expect(result.usesRuntime).toBe(false);
        expect(result.code).toContain('md:p-4');
        expect(result.code).toContain('md:rounded-md');
        expect(result.code).toContain('md:bg-blue-500');
    });

    it('falls back gracefully when nested spread references imported var', () => {
        const src = `
            import { maskBase } from './styles';
            const A = () => <div sz={{ before: { ...maskBase, content: "''" } }} />;
        `;
        // Imported binding is unresolvable → falls back to runtime, no crash
        expect(() => transformSourceCode(src)).not.toThrow();
    });
});
