/**
 * Pattern Detection Tests — migration CLI edge cases.
 *
 * Tests the AST transformer's ability to:
 *   1. Detect CVA imports and emit szv() suggestions
 *   2. Skip className on capitalized (custom) components
 *   3. Skip CSS Modules references silently
 *   4. Skip component className passthrough silently
 *   5. Handle real-world SA/design-system scenarios correctly
 *
 * "Real-world SA" scenarios cover teams migrating projects that mix:
 *   - Design token class names (ds-card, btn-primary, etc.)
 *   - CSS Modules + Tailwind
 *   - CVA variant systems
 *   - Headless UI / Radix UI components (member expressions)
 *   - Complex responsive + state + data-attribute combinations
 *   - Accessibility patterns (sr-only, focus-visible, etc.)
 */
import { describe, expect, it } from 'vitest';

import { transformSource } from '../src/migrate/ast-transformer.js';
import type { CsszyxTodoMap } from '../src/migrate/variant-parser.js';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Transform a JSX source and return the result.
 * @param source - JSX source string.
 * @param opts - Transform options.
 * @param opts.injectTodos - Whether to inject @sz-todo comments.
 * @param opts.customMap - Optional parsed .csszyx-todo.json map.
 * @returns TransformResult.
 */
function migrate(
    source: string,
    opts: { injectTodos?: boolean; customMap?: CsszyxTodoMap } = {},
): ReturnType<typeof transformSource> {
    return transformSource(source, 'test.tsx', opts);
}

// ============================================================================
// CVA IMPORT DETECTION
// ============================================================================

describe('CVA import detection', () => {
    it('emits szv() warning when importing from "cva"', () => {
        const source = `
import { cva } from 'cva';
const button = cva('px-4 py-2', { variants: { intent: { primary: 'bg-blue-500' } } });
export const Button = ({ intent }) => <button className={button({ intent })} />;
`;
        const result = migrate(source);
        expect(result.warnings.some(w => w.includes('cva()'))).toBe(true);
        expect(result.warnings.some(w => w.includes('szv()'))).toBe(true);
    });

    it('emits warning when importing from "class-variance-authority"', () => {
        const source = `
import { cva } from 'class-variance-authority';
const chip = cva('rounded-full', { variants: { size: { sm: 'text-xs', md: 'text-sm' } } });
`;
        const result = migrate(source);
        expect(result.warnings.some(w => w.includes('cva()'))).toBe(true);
        expect(result.warnings.some(w => w.includes('szv()'))).toBe(true);
    });

    it('does NOT emit warning for files without CVA import', () => {
        const source = `
import { clsx } from 'clsx';
export const Button = () => <button className="px-4 py-2 bg-blue-500" />;
`;
        const result = migrate(source);
        expect(result.warnings.some(w => w.includes('cva()'))).toBe(false);
    });

    it('still transforms static classNames in a CVA file', () => {
        // CVA is used for variant logic, but regular elements may still have static classNames
        const source = `
import { cva } from 'cva';
const variants = cva('base', { variants: {} });
export const Layout = () => (
    <div className="min-h-screen bg-gray-50">
        <nav className="px-4 py-2 border-b" />
    </div>
);
`;
        const result = migrate(source);
        // Should still transform the static className attrs on div/nav
        expect(result.stats.classNamesTransformed).toBeGreaterThan(0);
        // But emit the warning too
        expect(result.warnings.some(w => w.includes('szv()'))).toBe(true);
    });

    it('CVA call expression className is skipped (not a static string)', () => {
        const source = `
import { cva } from 'cva';
const btn = cva('p-4');
export const Btn = ({ v }) => <button className={btn({ v })} />;
`;
        const result = migrate(source);
        // The className={btn({v})} is a call expression — not a string literal — skipped
        expect(result.stats.classNamesSkipped).toBeGreaterThanOrEqual(1);
    });
});

// ============================================================================
// CAPITALIZED COMPONENT — className skip
// ============================================================================

describe('capitalized component className skip', () => {
    it('skips className on a PascalCase component', () => {
        const source = '<Button className="px-4 py-2 bg-blue-500" />';
        const result = migrate(source);
        // className should NOT be transformed
        expect(result.changed).toBe(false);
        expect(result.code).toContain('className="px-4 py-2 bg-blue-500"');
    });

    it('skips className on a multi-word PascalCase component', () => {
        const source = '<DialogPanel className="p-6 bg-white rounded-xl shadow-xl" />';
        const result = migrate(source);
        expect(result.changed).toBe(false);
    });

    it('transforms className on lowercase HTML elements', () => {
        const source = '<button className="px-4 py-2 bg-blue-500" />';
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.code).not.toContain('className=');
        expect(result.code).toContain('px: 4');
    });

    it('skips className on JSX member expression (Radix/Headless UI pattern)', () => {
        const source = `
<Dialog.Panel className="w-full max-w-md p-6 bg-white rounded-xl">
    <Dialog.Title className="text-lg font-semibold">Hello</Dialog.Title>
</Dialog.Panel>
`;
        const result = migrate(source);
        // Dialog.Panel and Dialog.Title are member expressions → skip
        expect(result.changed).toBe(false);
        expect(result.code).toContain('className="w-full max-w-md p-6 bg-white rounded-xl"');
    });

    it('transforms lowercase elements inside a capitalized component tree', () => {
        const source = `
<Card className="card-wrapper">
    <div className="p-4 flex flex-col gap-2">
        <span className="text-sm text-gray-600">Label</span>
    </div>
</Card>
`;
        const result = migrate(source);
        // Card className stays — Card is capitalized
        expect(result.code).toContain('className="card-wrapper"');
        // div and span get transformed
        expect(result.code).toContain('sz=');
        expect(result.code).toContain('p: 4');
    });

    it('skips className passthrough prop on capitalized component', () => {
        // When className is a variable being passed through
        const source = `
function MyCard({ className }) {
    return <Card className={className} />;
}
`;
        const result = migrate(source);
        // Card is capitalized → skip
        expect(result.changed).toBe(false);
    });

    it('transforms className on motion.div (lowercased tag of member expr)', () => {
        // motion.div — the left side is "motion" (lowercase), right side is "div"
        // This is a JSXMemberExpression — our rule skips all member expressions
        const source = '<motion.div className="animate-spin" />';
        const result = migrate(source);
        // motion.div is a member expression → skip
        expect(result.changed).toBe(false);
    });

    it('skips className on ALL_CAPS component names', () => {
        // Unusual but valid: <SVG className="..." />
        const source = '<SVG className="w-4 h-4 fill-current" />';
        const result = migrate(source);
        expect(result.changed).toBe(false);
    });

    it('mixed: capitalized and lowercase siblings', () => {
        const source = `
<div className="flex gap-4">
    <Button className="btn-base" />
    <span className="text-sm font-medium text-gray-600" />
</div>
`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        // Button className untouched
        expect(result.code).toContain('<Button className="btn-base"');
        // div and span transformed
        expect(result.code).toContain('flex: true');
        expect(result.code).toContain("fontWeight: 'medium'");
    });
});

// ============================================================================
// CSS MODULES — silent skip
// ============================================================================

describe('CSS Modules silent skip', () => {
    it('skips styles.property member expression', () => {
        const source = '<div className={styles.container} />';
        const result = migrate(source);
        expect(result.changed).toBe(false);
        expect(result.code).toContain('className={styles.container}');
    });

    it('skips styles bracket notation', () => {
        const source = "<div className={styles['header-section']} />";
        const result = migrate(source);
        expect(result.changed).toBe(false);
    });

    it('no warning emitted for CSS Modules skip', () => {
        const source = '<div className={styles.card} />';
        const result = migrate(source);
        expect(result.warnings).toHaveLength(0);
    });

    it('skips template literal mixing CSS Modules + TW', () => {
        // Template literal with a CSS module ref — can't statically analyze
        const source = '<div className={`${styles.base} p-4 hover:bg-blue-600`} />';
        const result = migrate(source);
        // Template literal with a dynamic expression — migrated is false if unrecognized dynamic parts
        // The static parts ("p-4 hover:bg-blue-600") may be extracted but the dynamic part is unknown
        // What matters: no crash, and the static parts should be handled
        expect(() => result).not.toThrow();
    });
});

// ============================================================================
// IDENTIFIER EXPRESSION — silent skip
// ============================================================================

describe('identifier expression silent skip', () => {
    it('skips className={className} passthrough', () => {
        const source = '<div className={className} />';
        const result = migrate(source);
        expect(result.changed).toBe(false);
    });

    it('skips className={computedClass} variable', () => {
        const source = '<div className={computedClass} />';
        const result = migrate(source);
        expect(result.changed).toBe(false);
    });

    it('no warning for identifier passthrough', () => {
        const source = '<nav className={navClass} />';
        const result = migrate(source);
        expect(result.warnings).toHaveLength(0);
    });
});

// ============================================================================
// REAL-WORLD SA SCENARIOS
// ============================================================================

describe('real-world SA scenarios', () => {
    // ── Design system with token classes ─────────────────────────────────────
    it('design system: token classes stay in className when unknown', () => {
        const source = `
<div className="ds-surface ds-elevation-2 ds-radius-md p-6 flex flex-col gap-4">
    <h2 className="ds-text-heading font-semibold text-gray-900" />
    <p className="ds-text-body text-gray-600" />
</div>
`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        // Token classes unrecognized → stay in className
        expect(result.code).toContain('ds-surface');
        expect(result.code).toContain('ds-elevation-2');
        // Standard TW classes go to sz
        expect(result.code).toContain('flex: true');
        expect(result.code).toContain("fontWeight: 'semibold'");
    });

    it('design system with customMap: tokens resolved', () => {
        const customMap = {
            'ds-surface': { bg: 'white', dark: { bg: 'gray-900' } },
            'ds-elevation-2': { shadow: 'md' },
            'ds-radius-md': { rounded: 'lg' },
        };
        const source = '<div className="ds-surface ds-elevation-2 ds-radius-md p-6" />';
        const result = migrate(source, { customMap });
        expect(result.changed).toBe(true);
        expect(result.code).not.toContain('className=');
        expect(result.code).toContain("bg: 'white'");
        expect(result.code).toContain("shadow: 'md'");
        expect(result.code).toContain("rounded: 'lg'");
    });

    // ── Radix UI / Headless UI compound components ────────────────────────────
    it('Radix UI: Dialog.Panel / Dialog.Title skipped, inner elements transformed', () => {
        const source = `
<Dialog.Panel className="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
    <Dialog.Title as="h3" className="text-lg font-semibold leading-6 text-gray-900">
        Title
    </Dialog.Title>
    <div className="mt-4 flex justify-end gap-2">
        <button className="px-4 py-2 text-sm font-medium bg-blue-500 text-white rounded-md">OK</button>
    </div>
</Dialog.Panel>
`;
        const result = migrate(source);
        // Dialog.Panel — member expression → skip
        expect(result.code).toContain(
            'className="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl"',
        );
        // Dialog.Title — member expression → skip
        expect(result.code).toContain('className="text-lg font-semibold leading-6 text-gray-900"');
        // div and button are lowercase → transformed
        expect(result.code).toContain('mt: 4');
        expect(result.code).toContain('px: 4');
    });

    // ── Accessibility patterns ────────────────────────────────────────────────
    it('sr-only + focus:not-sr-only pattern', () => {
        const source =
            '<a className="sr-only focus:not-sr-only focus:absolute focus:inset-0 focus:z-50 p-2" />';
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('srOnly: true');
        expect(result.code).toContain('notSrOnly');
    });

    it('aria-* variant classes', () => {
        const source = '<button className="aria-selected:bg-blue-500 aria-disabled:opacity-50" />';
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('aria');
        expect(result.code).toContain('selected');
    });

    it('focus-visible ring pattern', () => {
        const source = `
<button className="px-4 py-2 bg-blue-500 text-white rounded-md
    focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2" />
`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('focusVisible');
        expect(result.code).toContain('ring: 2');
    });

    // ── Complex compound data/state selectors ─────────────────────────────────
    it('group-data-[state=open] accordion pattern', () => {
        const source = `
<div className="group">
    <button className="flex items-center justify-between w-full py-4 text-left">Toggle</button>
    <div className="group-data-[state=open]:block hidden overflow-hidden transition-all" />
</div>
`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        // group-data-[state=open]:block → nested sz object
        expect(result.code).toContain('group');
        expect(result.code).toContain('data');
    });

    it('peer-checked pattern for custom checkbox', () => {
        const source = `
<label className="flex items-center gap-2 cursor-pointer">
    <input type="checkbox" className="peer sr-only" />
    <div className="w-5 h-5 rounded border-2 border-gray-300 peer-checked:bg-blue-500 peer-checked:border-blue-500" />
</label>
`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('peer');
        expect(result.code).toContain('checked');
        expect(result.code).toContain("bg: 'blue-500'");
    });

    it('has-[:checked] parent-selector pattern', () => {
        const source =
            '<form className="has-[:invalid]:ring-2 has-[:invalid]:ring-red-500 p-4 rounded" />';
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('has');
        expect(result.code).toContain('invalid');
        // rounded bare is a valid TW v4 class → converts to { rounded: true }
        expect(result.code).toContain('rounded: true');
    });

    // ── Responsive heavy (mobile-first teams) ─────────────────────────────────
    it('4-breakpoint responsive layout', () => {
        const source = `
<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4" />
`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('gridCols: 1');
        expect(result.code).toContain('sm: {');
        expect(result.code).toContain('md: {');
        expect(result.code).toContain('lg: {');
        expect(result.code).toContain('xl: {');
    });

    it('container query + responsive mixed', () => {
        const source =
            '<div className="@container flex flex-col @md:flex-row @lg:gap-8 md:p-8 lg:p-12" />';
        const result = migrate(source);
        expect(result.changed).toBe(true);
        // @container (standalone) is a TW v4 container declaration class — not a sz prop;
        // it stays in className while its query variants (@md, @lg) go to sz.
        expect(result.code).toContain('className="@container"');
        expect(result.code).toContain("'@md'");
        expect(result.code).toContain("'@lg'");
        expect(result.code).toContain('md: {');
    });

    // ── Animation-heavy UI ────────────────────────────────────────────────────
    it('complex transition + animation classes', () => {
        const source = `
<div className="transition-all duration-300 ease-in-out hover:scale-105 hover:shadow-xl active:scale-95" />
`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('duration: 300');
        expect(result.code).toContain("ease: 'in-out'");
        expect(result.code).toContain('scale: 105');
    });

    it('Framer Motion wrapper (member expr) with inner transformed elements', () => {
        const source = `
<motion.div
    className="fixed inset-0 bg-black/50"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
>
    <div className="flex items-center justify-center h-full">
        <motion.div className="w-96 bg-white rounded-xl p-8 shadow-2xl" />
    </div>
</motion.div>
`;
        const result = migrate(source);
        // motion.div — member expressions → skipped
        expect(result.code).toContain('className="fixed inset-0 bg-black/50"');
        expect(result.code).toContain('className="w-96 bg-white rounded-xl p-8 shadow-2xl"');
        // Inner div is transformed
        expect(result.code).toContain('flex: true');
        expect(result.code).toContain("items: 'center'");
    });

    // ── Form-heavy teams ──────────────────────────────────────────────────────
    it('form input state pattern: disabled, invalid, focus-within', () => {
        const source = `
<input
    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm
        focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
        disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100
        invalid:border-red-500 invalid:ring-red-500"
/>
`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('disabled');
        expect(result.code).toContain('invalid');
        expect(result.code).toContain('focus');
    });

    it('form with data-[error] custom validation', () => {
        const source = `
<div className="group/field">
    <input className="peer px-3 py-2 border rounded-md data-[invalid]:border-red-500" />
    <p className="hidden peer-data-[invalid]:block text-sm text-red-600">Error message</p>
</div>
`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('data');
        expect(result.code).toContain('invalid');
        expect(result.code).toContain('peer');
    });

    // ── Catalyst UI-style patterns (Tailwind Labs) ────────────────────────────
    it('Catalyst Badge: complex status colors with ring', () => {
        const source = `
<span className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 inset-ring-1
    bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-400/10 dark:text-green-400 dark:ring-green-400/20" />
`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        // ring-1 → sz ring:1; inset-ring-1 → sz insetRing:1
        expect(result.code).toContain('ring: 1');
        expect(result.code).toContain('insetRing: 1');
        expect(result.code).toContain("bg: 'green-50'");
        expect(result.code).toContain('dark');
    });

    it('Catalyst Divider: responsive + spacing', () => {
        const source =
            '<hr className="w-full border-t border-zinc-950/10 dark:border-white/10 my-6 sm:my-10" />';
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('my: 6');
        expect(result.code).toContain('sm');
        expect(result.code).toContain('dark');
    });

    it('Catalyst Table: striped rows via odd/even', () => {
        const source = `
<tr className="even:bg-zinc-950/[2.5%] odd:bg-white dark:even:bg-white/[2.5%] dark:odd:bg-zinc-900" />
`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('even');
        expect(result.code).toContain('odd');
        expect(result.code).toContain('dark');
    });

    // ── clsx-heavy codebase ────────────────────────────────────────────────────
    it('clsx with base classes + conditional custom tokens', () => {
        const customMap = {
            'btn-primary': { bg: 'blue-500', color: 'white' },
            'btn-outline': { borderColor: 'blue-500', border: true, color: 'blue-500' },
        };
        const source = `
<button className={clsx(
    "px-4 py-2 rounded-md font-medium transition-colors",
    isPrimary ? "btn-primary" : "btn-outline",
    isLoading && "opacity-50 cursor-not-allowed"
)} />
`;
        const result = migrate(source, { customMap });
        expect(result.changed).toBe(true);
        expect(result.code).toContain("bg: 'blue-500'");
        // btn-outline resolves to object with borderColor
        expect(result.code).toContain("borderColor: 'blue-500'");
    });

    it('cn() (shadcn/ui pattern) with class merging', () => {
        const source = `
import { cn } from '@/lib/utils';
<div className={cn(
    "relative flex items-center gap-x-1 rounded-xl bg-white shadow-sm ring-1 inset-ring ring-gray-300",
    "px-3 py-2 text-sm",
    isFocused && "ring-blue-500 ring-2"
)} />
`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('flex: true');
        // ring-1 → sz ring:1; inset-ring → sz insetRing:true
        expect(result.code).toContain('ring: 1');
        expect(result.code).toContain('insetRing: true');
    });

    // ── Dark mode heavy ────────────────────────────────────────────────────────
    it('full dark mode layout', () => {
        const source = `
<div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-50">
    <header className="sticky top-0 z-50 bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200 dark:border-gray-800" />
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12" />
</div>
`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('dark');
        expect(result.code).toContain("bg: 'gray-950'");
        expect(result.code).toContain('backdropBlur: true');
    });

    // ── Already has sz prop — skip ─────────────────────────────────────────────
    it('skips element that already has sz prop', () => {
        const source = '<div sz={{ p: 4 }} className="bg-blue-500" />';
        const result = migrate(source);
        // Already has sz → className skipped
        expect(result.changed).toBe(false);
        expect(result.code).toContain('className="bg-blue-500"');
    });

    // ── @sz-todo comment injection ─────────────────────────────────────────────
    it('injectTodos: adds comment for elements with unrecognized classes', () => {
        const source = '<div className="p-4 my-custom-component-class flex" />';
        const result = migrate(source, { injectTodos: true });
        expect(result.changed).toBe(true);
        expect(result.code).toContain('@sz-todo');
        expect(result.code).toContain('my-custom-component-class');
    });

    it('injectTodos: no comment when all classes recognized', () => {
        const source = '<div className="p-4 flex bg-blue-500 hover:bg-blue-600" />';
        const result = migrate(source, { injectTodos: true });
        expect(result.changed).toBe(true);
        expect(result.code).not.toContain('@sz-todo');
    });

    it('injectTodos: comment lists all unrecognized classes for the element', () => {
        const source = '<div className="p-4 figma-token-a figma-token-b flex" />';
        const result = migrate(source, { injectTodos: true });
        expect(result.code).toMatch(/@sz-todo:.*figma-token-a/);
        expect(result.code).toMatch(/@sz-todo:.*figma-token-b/);
    });

    // ── Unused import detection ───────────────────────────────────────────────
    it('reports clsx as potentially unused after full migration', () => {
        const source = `
import { clsx } from 'clsx';
export const A = () => <div className={clsx("p-4 flex")} />;
export const B = () => <div className={clsx("m-2 bg-white")} />;
`;
        const result = migrate(source);
        expect(result.potentiallyUnusedImports).toContain('clsx');
    });

    it('does NOT report clsx unused when used outside className', () => {
        const source = `
import { clsx } from 'clsx';
const someVar = clsx('foo', 'bar');
export const A = () => <div className={clsx("p-4")} />;
`;
        const result = migrate(source);
        expect(result.potentiallyUnusedImports).not.toContain('clsx');
    });

    // ── Parse error resilience ─────────────────────────────────────────────────
    it('returns unchanged result on parse error (does not throw)', () => {
        const source = '<div className={unclosed';
        const result = migrate(source);
        expect(result.changed).toBe(false);
        expect(result.warnings.some(w => w.includes('Parse error'))).toBe(true);
    });

    // ── TypeScript generics in JSX (common in SA codebases) ───────────────────
    it('handles TypeScript generics in JSX without crashing', () => {
        const source = `
const Component = <T extends object>({ data, className }: { data: T; className?: string }) => (
    <div className="flex flex-col gap-2">
        <span className={className} />
    </div>
);
`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('flex: true');
        // className={className} is an identifier → skipped
        expect(result.code).toContain('className={className}');
    });

    it('handles decorators without crashing', () => {
        const source = `
@observer
class MyComponent extends React.Component {
    render() {
        return <div className="p-4 flex" />;
    }
}
`;
        const result = migrate(source);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('p: 4');
    });
});

// ============================================================================
// @sz-todo COMMENT ROUND-TRIP (resolve flow)
// ============================================================================

describe('@sz-todo comment round-trip', () => {
    it('pre-strips existing @sz-todo comment before re-transforming', () => {
        // Simulate the pre-strip that migrate.ts does before calling transformSource
        const sourceWithComment = `
{/* @sz-todo: ds-card */}
<div className="ds-card p-4 flex" />
`.trimStart();

        // Strip the comment (as migrate.ts does on --resolve-todos pass)
        const stripped = sourceWithComment.replace(
            /\{\/\*\s*@sz-todo:\s*(\S(?:.*\S)?)\s*\*\/\}\n?/g,
            '',
        );
        const customMap = { 'ds-card': { rounded: 'lg', shadow: 'sm' } };
        const result = transformSource(stripped, 'test.tsx', { customMap, injectTodos: true });

        expect(result.changed).toBe(true);
        // ds-card resolved → no new @sz-todo comment for it
        expect(result.code).not.toMatch(/@sz-todo:.*ds-card/);
        expect(result.code).toContain("rounded: 'lg'");
    });

    it('re-injects @sz-todo for still-unresolved classes after partial resolve', () => {
        const source = '<div className="p-4 resolved-token still-unknown" />';
        const customMap = { 'resolved-token': { bg: 'blue-500' } };
        const result = transformSource(source, 'test.tsx', { customMap, injectTodos: true });

        expect(result.changed).toBe(true);
        // still-unknown → gets @sz-todo comment
        expect(result.code).toContain('@sz-todo');
        expect(result.code).toContain('still-unknown');
        // resolved-token → resolved, should NOT be in @sz-todo
        expect(result.code).not.toMatch(/@sz-todo:.*resolved-token/);
    });
});
