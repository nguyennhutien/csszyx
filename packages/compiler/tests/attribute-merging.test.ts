import { describe, expect, it } from 'vitest';

import { transformSourceCode } from '../src/transform.js';

describe('Attribute Merging (transformSourceCode)', () => {
    describe('className attribute merging', () => {
        it('should merge static className with static sz at compile time', () => {
            const source =
                'const App = () => <div className="existing-class" sz={{ p: 4, bg: \'red-500\' }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('className="existing-class p-4 bg-red-500"');
            expect(result.code).not.toContain('_szMerge');
        });

        it('should merge expression className with static sz using _szMerge', () => {
            const source =
                'const App = () => <div className={isActive ? "active" : "inactive"} sz={{ p: 4, bg: \'red-500\' }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            // Babel does not wrap ternary in extra parens — direct args to _szMerge
            expect(result.code).toContain(
                '_szMerge(isActive ? "active" : "inactive", "p-4 bg-red-500")',
            );
            expect(result.usesMerge).toBe(true);
        });

        it('should merge static className with dynamic sz via compile-time concat + CSS var', () => {
            // When sz has a dynamic prop, compiler uses partial-static path:
            //   className is statically merged at compile time ("base-class p-(--_sz-p)")
            //   the dynamic value is passed via CSS custom property in style
            //   _szMerge is NOT needed because className can be merged at compile time.
            const source = 'const App = () => <div className="base-class" sz={{ p: padVal }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('className="base-class p-(--_sz-p)"');
            expect(result.code).toContain('style={{');
            expect(result.code).toContain('"--_sz-p"');
            expect(result.code).not.toContain('_szMerge');
        });

        it('should merge expression className with dynamic sz using _szMerge with CSS var class string', () => {
            // When existing className is dynamic (call expression), _szMerge is needed.
            // sz partial-static path still produces a CSS var class string, not _sz({})
            const source = 'const App = () => <div className={getClasses()} sz={{ p: padVal }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('_szMerge(getClasses(), "p-(--_sz-p)")');
            expect(result.code).toContain('style={{');
            expect(result.code).toContain('"--_sz-p"');
            expect(result.usesMerge).toBe(true);
        });
    });

    describe('style attribute merging', () => {
        it('should create style object if not exists and inject CSS variables', () => {
            const source = 'const App = () => <div sz={{ p: padVal }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            // Spacing values are wrapped in calc() for Tailwind v4 spacing scale
            expect(result.code).toContain('style={{');
            expect(result.code).toContain('"--_sz-p"');
            expect(result.code).toContain('var(--spacing)');
        });

        it('should merge CSS variables into existing style object natively', () => {
            const source =
                'const App = () => <div style={{ color: "red", marginTop: 10 }} sz={{ p: padVal }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            // Existing style props preserved; CSS var added alongside
            expect(result.code).toContain('style={{');
            expect(result.code).toContain('color: "red"');
            expect(result.code).toContain('marginTop: 10');
            expect(result.code).toContain('"--_sz-p"');
        });

        it('should parse existing style string and merge into an object when injecting variables', () => {
            // React does not support string styles — compiler converts to object so SSR does not crash.
            const source =
                'const App = () => <div style="color: red; margin-top: 10px;" sz={{ p: padVal }} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            // parseStyleStringToObjectExpr converts kebab-case to camelCase identifier keys
            expect(result.code).toContain('style={{');
            expect(result.code).toContain('color: "red"');
            expect(result.code).toContain('marginTop: "10px"');
            expect(result.code).toContain('"--_sz-p"');
        });
    });
});
