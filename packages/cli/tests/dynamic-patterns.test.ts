/**
 * Dynamic Pattern Tests for Migration CLI Phase 2.
 *
 * Tests the Babel AST-based transformer for dynamic className expressions:
 * - clsx/cn/cx/twMerge calls
 * - Ternary (conditional) expressions
 * - Logical AND expressions
 * - Template literals
 * - Edge cases and mixed patterns
 */
import { describe, expect, it } from 'vitest';

import { transformSource } from '../src/migrate/ast-transformer.js';

// ============================================================================
// HELPER
// ============================================================================

/**
 * Transform a JSX source and return the result.
 * @param source - JSX source string.
 * @returns TransformResult.
 */
function migrate(source: string): ReturnType<typeof transformSource> {
    return transformSource(source, 'test.tsx');
}

// ============================================================================
// CLSX / CN / TWMERGE
// ============================================================================

describe('clsx/cn calls', () => {
    it('single string argument', () => {
        const result = migrate('<div className={clsx("px-4 py-2")} />');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('sz=');
        expect(result.code).toContain('px: 4');
        expect(result.code).toContain('py: 2');
        expect(result.code).not.toContain('className');
        expect(result.code).not.toContain('clsx');
    });

    it('cn function name', () => {
        const result = migrate('<div className={cn("flex relative")} />');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('sz=');
        expect(result.code).toContain('flex: true');
        expect(result.code).toContain('relative: true');
    });

    it('twMerge function name', () => {
        const result = migrate('<div className={twMerge("p-4")} />');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('p: 4');
    });

    it('cx function name', () => {
        const result = migrate('<div className={cx("m-2")} />');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('m: 2');
    });

    it('classNames function name', () => {
        const result = migrate('<div className={classNames("bg-red-500")} />');
        expect(result.changed).toBe(true);
        expect(result.code).toContain("bg: 'red-500'");
    });

    it('multiple string arguments', () => {
        const result = migrate('<div className={clsx("px-4", "bg-blue-500")} />');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('sz=');
        expect(result.code).toContain('px: 4');
        expect(result.code).toContain("bg: 'blue-500'");
    });

    it('string + logical AND', () => {
        const result = migrate('<div className={clsx("px-4", isActive && "bg-blue-500")} />');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('sz={[');
        expect(result.code).toContain('px: 4');
        expect(result.code).toContain('isActive &&');
        expect(result.code).toContain("bg: 'blue-500'");
    });

    it('string + ternary inside clsx', () => {
        const result = migrate(
            '<div className={clsx("px-4", isLarge ? "text-2xl" : "text-sm")} />',
        );
        expect(result.changed).toBe(true);
        expect(result.code).toContain('sz={[');
        expect(result.code).toContain('px: 4');
        expect(result.code).toContain('isLarge ?');
        expect(result.code).toContain("text: '2xl'");
        expect(result.code).toContain("text: 'sm'");
    });

    it('skips non-string argument (variable)', () => {
        const result = migrate('<div className={clsx("px-4", someVar)} />');
        expect(result.changed).toBe(false);
        expect(result.code).toContain('className');
        expect(result.code).toContain('clsx');
    });

    it('skips spread argument', () => {
        const result = migrate('<div className={clsx("px-4", ...args)} />');
        expect(result.changed).toBe(false);
        expect(result.code).toContain('className');
    });

    it('skips non-clsx function call', () => {
        const result = migrate('<div className={myCustomFn("px-4")} />');
        expect(result.changed).toBe(false);
        expect(result.code).toContain('className');
    });

    it('handles empty clsx', () => {
        const result = migrate('<div className={clsx()} />');
        expect(result.changed).toBe(false);
    });
});

// ============================================================================
// TERNARY (ConditionalExpression)
// ============================================================================

describe('ternary expressions', () => {
    it('simple ternary with two branches', () => {
        const result = migrate('<div className={isActive ? "bg-blue-500" : "bg-gray-200"} />');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('sz={');
        expect(result.code).toContain('isActive ?');
        expect(result.code).toContain("bg: 'blue-500'");
        expect(result.code).toContain("bg: 'gray-200'");
    });

    it('ternary with multi-class branches', () => {
        const result = migrate(
            '<div className={isDark ? "bg-gray-800 text-white" : "bg-white text-gray-900"} />',
        );
        expect(result.changed).toBe(true);
        expect(result.code).toContain('isDark ?');
    });

    it('ternary with empty alternate (falsy branch)', () => {
        const result = migrate('<div className={isActive ? "bg-blue-500" : ""} />');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('isActive &&');
        expect(result.code).toContain("bg: 'blue-500'");
    });

    it('ternary with empty consequent', () => {
        const result = migrate('<div className={isHidden ? "" : "block"} />');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('!isHidden &&');
        expect(result.code).toContain('block: true');
    });

    it('skips ternary with non-string branches', () => {
        const result = migrate('<div className={isActive ? someVar : "bg-gray-200"} />');
        expect(result.changed).toBe(false);
    });

    it('skips ternary with both non-string branches', () => {
        const result = migrate('<div className={isActive ? varA : varB} />');
        expect(result.changed).toBe(false);
    });
});

// ============================================================================
// LOGICAL AND
// ============================================================================

describe('logical AND expressions', () => {
    it('simple condition && string', () => {
        const result = migrate('<div className={isActive && "bg-blue-500"} />');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('sz={');
        expect(result.code).toContain('isActive &&');
        expect(result.code).toContain("bg: 'blue-500'");
    });

    it('complex condition && multi-class string', () => {
        const result = migrate('<div className={isOpen && "flex items-center gap-4"} />');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('isOpen &&');
        expect(result.code).toContain('flex: true');
        expect(result.code).toContain("items: 'center'");
        expect(result.code).toContain('gap: 4');
    });

    it('skips && with non-string right', () => {
        const result = migrate('<div className={isActive && someVar} />');
        expect(result.changed).toBe(false);
    });

    it('skips || operator', () => {
        const result = migrate('<div className={isActive || "bg-blue-500"} />');
        expect(result.changed).toBe(false);
    });
});

// ============================================================================
// TEMPLATE LITERALS
// ============================================================================

describe('template literals', () => {
    it('static-only template literal', () => {
        const result = migrate('<div className={`px-4 py-2 bg-blue-500`} />');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('sz=');
        expect(result.code).toContain('px: 4');
        expect(result.code).toContain('py: 2');
        expect(result.code).toContain("bg: 'blue-500'");
    });

    it('template with ternary expression', () => {
        const result = migrate(
            '<div className={`px-4 ${isActive ? "bg-blue-500" : "bg-gray-200"}`} />',
        );
        expect(result.changed).toBe(true);
        expect(result.code).toContain('sz={[');
        expect(result.code).toContain('px: 4');
        expect(result.code).toContain('isActive ?');
    });

    it('template with logical AND expression', () => {
        const result = migrate('<div className={`px-4 ${isActive && "bg-blue-500"}`} />');
        expect(result.changed).toBe(true);
        expect(result.code).toContain('sz={[');
        expect(result.code).toContain('px: 4');
        expect(result.code).toContain('isActive &&');
    });

    it('skips template with variable expression', () => {
        const result = migrate('<div className={`px-4 ${customClass}`} />');
        expect(result.changed).toBe(false);
    });

    it('skips template with function call expression', () => {
        const result = migrate('<div className={`px-4 ${getClasses()}`} />');
        expect(result.changed).toBe(false);
    });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('edge cases', () => {
    it('skips if sz attribute already exists', () => {
        const result = migrate('<div className="p-4" sz={{ m: 2 }} />');
        expect(result.changed).toBe(false);
        expect(result.code).toContain('className="p-4"');
    });

    it('handles multiple elements in one file', () => {
        const source = `
<div className="p-4">
  <span className={clsx("text-white", isActive && "font-bold")} />
  <button className={isDark ? "bg-gray-800" : "bg-white"} />
</div>`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.stats.classNamesTransformed).toBeGreaterThanOrEqual(3);
    });

    it('preserves other attributes', () => {
        const result = migrate('<div id="test" className="p-4" data-foo="bar" />');
        expect(result.code).toContain('id="test"');
        expect(result.code).toContain('data-foo="bar"');
        expect(result.code).toContain('sz=');
    });

    it('handles className with expression container string', () => {
        const result = migrate("<div className={'p-4 bg-blue-500'} />");
        expect(result.changed).toBe(true);
        expect(result.code).toContain('p: 4');
    });

    it('skips dynamic variable className', () => {
        const result = migrate('<div className={someVar} />');
        expect(result.changed).toBe(false);
    });

    it('skips JSXEmptyExpression', () => {
        const result = migrate('<div className={/* comment */} />');
        expect(result.changed).toBe(false);
    });

    it('handles parse errors gracefully', () => {
        // Invalid JSX should not throw
        const result = migrate('this is not valid JSX at all <<<>>>```');
        expect(result.changed).toBe(false);
        expect(result.warnings.length).toBeGreaterThan(0);
    });
});

// ============================================================================
// UNUSED IMPORT DETECTION
// ============================================================================

describe('unused import detection', () => {
    it('reports clsx as potentially unused when all calls migrated', () => {
        const source = `
import { clsx } from 'clsx';
export function Button() {
  return <div className={clsx("px-4 py-2")} />;
}`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.potentiallyUnusedImports).toContain('clsx');
    });

    it('does not report clsx when used outside className', () => {
        const source = `
import { clsx } from 'clsx';
const key = clsx('a', 'b');
export function Button() {
  return <div className={clsx("px-4")} />;
}`;
        const result = migrate(source);
        // clsx is still used in `const key = clsx(...)`, so not reported
        expect(result.potentiallyUnusedImports).not.toContain('clsx');
    });

    it('reports cn as potentially unused', () => {
        const source = `
import { cn } from '@/lib/utils';
export function Card() {
  return <div className={cn("p-4 rounded-lg")} />;
}`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.potentiallyUnusedImports).toContain('cn');
    });
});
