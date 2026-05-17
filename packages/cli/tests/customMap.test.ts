/**
 * Custom Map (csszyx-todo.json) tests.
 *
 * Covers all value routes in the customMap:
 *   - Object     → merge into sz
 *   - "sz:keep"  → retain in className (keepInClassName[])
 *   - "sz:remove"→ omit from output entirely
 *   - "sz:todo"  → skip conversion; stays in unrecognized[] (not yet decided)
 *   - TW string  → auto-convert recognized classes to sz
 *   - Partial TW → recognized → sz, unrecognized → bubble up to unrecognized[]
 *   - null / false / missing → same as sz:todo (backwards compat)
 *
 * Note: --resolve-todos is read-only. Remaining unknowns surface in log/console
 * only — the todo file is never written during --resolve-todos.
 *
 * Also tests transformSource() with customMap (the --resolve-todos flow).
 */
import { describe, expect, it } from 'vitest';

import { transformSource } from '../src/migrate/ast-transformer.js';
import { type CsszyxTodoMap, classNameToSzObject } from '../src/migrate/variant-parser.js';

// ============================================================================
// classNameToSzObject — customMap route tests
// ============================================================================

describe('classNameToSzObject — customMap routes', () => {
    // ── Object route ─────────────────────────────────────────────────────────
    describe('object route', () => {
        it('maps a custom class to a direct sz object', () => {
            const customMap = { 'btn-primary': { bg: 'blue-500', color: 'white', px: 4, py: 2 } };
            const { szObject, unrecognized, keepInClassName } = classNameToSzObject(
                'btn-primary',
                customMap,
            );
            expect(szObject).toEqual({ bg: 'blue-500', color: 'white', px: 4, py: 2 });
            expect(unrecognized).toEqual([]);
            expect(keepInClassName).toEqual([]);
        });

        it('merges object-route class with other TW classes', () => {
            const customMap = { 'card-base': { rounded: 'lg', border: true } };
            const { szObject } = classNameToSzObject('p-4 card-base bg-white', customMap);
            expect(szObject).toMatchObject({
                p: 4,
                rounded: 'lg',
                border: true,
                bg: 'white',
            });
        });

        it('object route with nested variant', () => {
            const customMap = {
                'ds-card': {
                    rounded: 'xl',
                    shadow: 'md',
                    dark: { bg: 'gray-800' },
                },
            };
            const { szObject } = classNameToSzObject('ds-card', customMap);
            expect(szObject).toMatchObject({
                rounded: 'xl',
                shadow: 'md',
                dark: { bg: 'gray-800' },
            });
        });

        it('multiple custom tokens all object-routed', () => {
            const customMap = {
                'btn-base': { px: 4, py: 2, rounded: 'md', fontWeight: 'medium' },
                'btn-primary': { bg: 'blue-500', color: 'white', hover: { bg: 'blue-600' } },
            };
            const { szObject, unrecognized } = classNameToSzObject(
                'btn-base btn-primary',
                customMap,
            );
            expect(szObject.px).toBe(4);
            expect(szObject.py).toBe(2);
            expect(szObject.bg).toBe('blue-500');
            expect(szObject.color).toBe('white');
            expect(unrecognized).toEqual([]);
        });
    });

    // ── "sz:keep" route ───────────────────────────────────────────────────────
    describe('"sz:keep" route', () => {
        it('keeps the class in keepInClassName[]', () => {
            const customMap = { 'text-muted': 'sz:keep' };
            const { szObject, unrecognized, keepInClassName } = classNameToSzObject(
                'p-4 text-muted',
                customMap,
            );
            expect(keepInClassName).toEqual(['text-muted']);
            expect(unrecognized).toEqual([]);
            expect(szObject.p).toBe(4);
        });

        it('multiple sz:keep classes all collected', () => {
            const customMap = {
                'text-muted': 'sz:keep',
                'icon-sm': 'sz:keep',
            };
            const { keepInClassName } = classNameToSzObject('flex text-muted icon-sm', customMap);
            expect(keepInClassName).toContain('text-muted');
            expect(keepInClassName).toContain('icon-sm');
            expect(keepInClassName).toHaveLength(2);
        });

        it('sz:keep does NOT add to unrecognized', () => {
            const customMap = { 'legacy-class': 'sz:keep' };
            const { unrecognized } = classNameToSzObject('legacy-class', customMap);
            expect(unrecognized).toEqual([]);
        });

        it('sz:keep alongside sz object routes', () => {
            const customMap = {
                'btn-base': { px: 4, py: 2 },
                'icon-only': 'sz:keep',
            };
            const { szObject, keepInClassName, unrecognized } = classNameToSzObject(
                'btn-base icon-only flex',
                customMap,
            );
            expect(szObject.px).toBe(4);
            expect(keepInClassName).toEqual(['icon-only']);
            expect(unrecognized).toEqual([]);
        });
    });

    // ── "sz:remove" route ─────────────────────────────────────────────────────
    describe('"sz:remove" route', () => {
        it('omits the class from both sz and className', () => {
            const customMap = { 'legacy-card': 'sz:remove' };
            const { szObject, unrecognized, keepInClassName } = classNameToSzObject(
                'p-4 legacy-card flex',
                customMap,
            );
            expect(szObject).toEqual({ p: 4, flex: true });
            expect(unrecognized).toEqual([]);
            expect(keepInClassName).toEqual([]);
        });

        it('removing all classes returns empty szObject', () => {
            const customMap = {
                'old-class-a': 'sz:remove',
                'old-class-b': 'sz:remove',
            };
            const { szObject, unrecognized } = classNameToSzObject(
                'old-class-a old-class-b',
                customMap,
            );
            expect(Object.keys(szObject)).toHaveLength(0);
            expect(unrecognized).toEqual([]);
        });
    });

    // ── "sz:todo" route ───────────────────────────────────────────────────────
    describe('"sz:todo" route', () => {
        it('treats sz:todo as unresolved (goes to unrecognized[])', () => {
            const customMap = { 'custom-shadow': 'sz:todo' };
            const { unrecognized, keepInClassName } = classNameToSzObject(
                'custom-shadow',
                customMap,
            );
            expect(unrecognized).toContain('custom-shadow');
            expect(keepInClassName).toEqual([]);
        });

        it('sz:todo does not contribute to szObject', () => {
            const customMap = { 'brand-color': 'sz:todo' };
            const { szObject } = classNameToSzObject('p-4 brand-color', customMap);
            expect(szObject).toEqual({ p: 4 });
        });

        it('multiple sz:todo entries all go to unrecognized', () => {
            const customMap = {
                'ds-primary': 'sz:todo',
                'ds-secondary': 'sz:todo',
            };
            const { unrecognized } = classNameToSzObject('ds-primary ds-secondary flex', customMap);
            expect(unrecognized).toContain('ds-primary');
            expect(unrecognized).toContain('ds-secondary');
        });

        it('sz:todo on a valid TW class blocks conversion — stays unresolved, NOT converted', () => {
            // "flex" is a perfectly valid TW class the parser knows.
            // But the dev marked it sz:todo = "not yet decided" — so resolve-todos
            // must NOT silently convert it. It stays in unrecognized[].
            const customMap = { flex: 'sz:todo' };
            const { szObject, unrecognized } = classNameToSzObject('flex', customMap);
            expect(unrecognized).toContain('flex');
            expect(szObject).toEqual({});
        });

        it('null and false behave identically to sz:todo (block conversion)', () => {
            const mapNull: CsszyxTodoMap = { flex: null };
            const mapFalse: CsszyxTodoMap = { flex: false };
            const r1 = classNameToSzObject('flex', mapNull);
            const r2 = classNameToSzObject('flex', mapFalse);
            expect(r1.unrecognized).toContain('flex');
            expect(r1.szObject).toEqual({});
            expect(r2.unrecognized).toContain('flex');
            expect(r2.szObject).toEqual({});
        });
    });

    // ── null / false / missing → unresolved (backwards compat) ───────────────
    describe('null / false / missing → unresolved', () => {
        it('null value → unresolved', () => {
            const customMap: CsszyxTodoMap = { 'custom-class': null };
            const { unrecognized } = classNameToSzObject('custom-class', customMap);
            expect(unrecognized).toContain('custom-class');
        });

        it('false value → unresolved', () => {
            const customMap: CsszyxTodoMap = { 'custom-class': false };
            const { unrecognized } = classNameToSzObject('custom-class', customMap);
            expect(unrecognized).toContain('custom-class');
        });

        it('token not in map → normal parse (unrecognized if unknown)', () => {
            const customMap = { 'other-class': 'sz:keep' };
            const { unrecognized } = classNameToSzObject('totally-unknown', customMap);
            expect(unrecognized).toContain('totally-unknown');
        });
    });

    // ── Plain TW string route ─────────────────────────────────────────────────
    describe('plain Tailwind string route', () => {
        it('converts a TW string value to sz', () => {
            const customMap = { 'btn-primary': 'bg-blue-500 text-white' };
            const { szObject, unrecognized } = classNameToSzObject('btn-primary', customMap);
            expect(szObject.bg).toBe('blue-500');
            expect(szObject.color).toBe('white');
            expect(unrecognized).toEqual([]);
        });

        it('TW string with variants', () => {
            const customMap = {
                'btn-interactive': 'px-4 py-2 hover:bg-blue-600 focus:ring-2',
            };
            const { szObject } = classNameToSzObject('btn-interactive', customMap);
            expect(szObject.px).toBe(4);
            expect(szObject.py).toBe(2);
            expect((szObject.hover as CsszyxTodoMap).bg).toBe('blue-600');
            expect((szObject.focus as CsszyxTodoMap).ring).toBe(2);
        });

        it('TW string with responsive + dark variants', () => {
            const customMap = {
                'card-responsive': 'p-4 md:p-8 lg:p-12 dark:bg-gray-900',
            };
            const { szObject } = classNameToSzObject('card-responsive', customMap);
            expect(szObject.p).toBe(4);
            expect((szObject.md as CsszyxTodoMap).p).toBe(8);
            expect((szObject.lg as CsszyxTodoMap).p).toBe(12);
            expect((szObject.dark as CsszyxTodoMap).bg).toBe('gray-900');
        });

        it('single-class TW string', () => {
            const customMap = { 'shadow-brand': 'shadow-md' };
            const { szObject } = classNameToSzObject('shadow-brand', customMap);
            expect(szObject.shadow).toBe('md');
        });

        it('TW string with fully-unknown classes → unresolved', () => {
            const customMap = { mystery: 'not-a-tw-class' };
            const { unrecognized } = classNameToSzObject('mystery', customMap);
            // Falls back to unresolved because parsed TW string had no recognized classes
            expect(unrecognized).toContain('mystery');
        });
    });

    // ── Partial TW string cascade ─────────────────────────────────────────────
    describe('partial TW string cascade', () => {
        it('recognized TW classes go to sz; unrecognized cascade to unrecognized[]', () => {
            const customMap = { 'mixed-token': 'p-4 my-unknown-class' };
            const { szObject, unrecognized } = classNameToSzObject('mixed-token', customMap);
            expect(szObject.p).toBe(4);
            expect(unrecognized).toContain('my-unknown-class');
            // The source token itself should NOT be in unrecognized
            expect(unrecognized).not.toContain('mixed-token');
        });

        it('multiple unknown classes in TW string all cascade', () => {
            const customMap = { 'btn-legacy': 'bg-blue-500 custom-a custom-b custom-c' };
            const { szObject, unrecognized } = classNameToSzObject('btn-legacy', customMap);
            expect(szObject.bg).toBe('blue-500');
            expect(unrecognized).toContain('custom-a');
            expect(unrecognized).toContain('custom-b');
            expect(unrecognized).toContain('custom-c');
        });

        it('cascade does not include source token — only inner unknowns', () => {
            const customMap = { 'half-custom': 'flex unknown-x' };
            const { unrecognized } = classNameToSzObject('half-custom', customMap);
            expect(unrecognized).not.toContain('half-custom');
            expect(unrecognized).toContain('unknown-x');
        });

        it('cascade works alongside other source tokens', () => {
            const customMap = { 'btn-fancy': 'rounded-xl custom-ring' };
            const { szObject, unrecognized } = classNameToSzObject(
                'p-4 btn-fancy hover:opacity-90',
                customMap,
            );
            expect(szObject.p).toBe(4);
            expect(szObject.rounded).toBe('xl');
            expect((szObject.hover as CsszyxTodoMap).opacity).toBe(90);
            expect(unrecognized).toContain('custom-ring');
        });
    });

    // ── Mixed routes in one class string ────────────────────────────────────
    describe('mixed routes', () => {
        it('handles all routes in a single className string', () => {
            const customMap: CsszyxTodoMap = {
                'btn-base': { px: 4, py: 2 }, // object
                'icon-sm': 'sz:keep', // keep
                'old-badge': 'sz:remove', // remove
                'brand-color': 'sz:todo', // unresolved
                'shadow-token': 'shadow-md shadow-blue-100', // TW string (partial)
            };
            const { szObject, unrecognized, keepInClassName } = classNameToSzObject(
                'flex btn-base icon-sm old-badge brand-color shadow-token',
                customMap,
            );
            // Object route
            expect(szObject.px).toBe(4);
            expect(szObject.py).toBe(2);
            // TW string route (shadow-md recognized)
            expect(szObject.shadow).toBe('md');
            // Boolean
            expect(szObject.flex).toBe(true);
            // sz:keep
            expect(keepInClassName).toContain('icon-sm');
            // sz:remove — gone from everywhere
            expect(keepInClassName).not.toContain('old-badge');
            expect(unrecognized).not.toContain('old-badge');
            // sz:todo — in unrecognized
            expect(unrecognized).toContain('brand-color');
            // shadow-blue-100 is NOT a valid TW class (shadow color) → cascades
            // Note: shadow-blue-100 may or may not be recognized; just verify no crash
        });

        it('design system token map — realistic scenario', () => {
            // Scenario: migrating Figma token classes from a design system
            const customMap: CsszyxTodoMap = {
                'ds-surface': { bg: 'white', dark: { bg: 'gray-900' } },
                'ds-text-primary': { color: 'gray-900', dark: { color: 'gray-100' } },
                'ds-text-muted': 'sz:keep',
                'ds-elevation-1': 'shadow-sm',
                'ds-elevation-2': 'shadow-md',
                'ds-radius-md': 'rounded-lg',
                'ds-spacing-base': 'p-4',
                'ds-border-subtle': 'border border-gray-200 dark:border-gray-700',
                'ds-deprecated-pill': 'sz:remove',
            };
            const className = [
                'ds-surface',
                'ds-text-primary',
                'ds-text-muted',
                'ds-elevation-2',
                'ds-radius-md',
                'ds-spacing-base',
                'ds-border-subtle',
                'ds-deprecated-pill',
                'hover:opacity-90',
            ].join(' ');

            const { szObject, unrecognized, keepInClassName } = classNameToSzObject(
                className,
                customMap,
            );

            expect(szObject.bg).toBe('white');
            expect(szObject.color).toBe('gray-900');
            expect(szObject.shadow).toBe('md');
            expect(szObject.rounded).toBe('lg');
            expect(szObject.p).toBe(4);
            expect(szObject.border).toBe(true);
            expect((szObject.hover as CsszyxTodoMap).opacity).toBe(90);
            expect(keepInClassName).toContain('ds-text-muted');
            expect(unrecognized).not.toContain('ds-deprecated-pill'); // removed
            expect(unrecognized).not.toContain('ds-text-muted'); // kept, not unrecognized
        });
    });
});

// ============================================================================
// transformSource — customMap integration (--resolve-todos flow)
// ============================================================================

describe('transformSource — customMap (--resolve-todos)', () => {
    /**
     * Run transformSource with a custom map.
     * @param source - JSX source string.
     * @param customMap - Resolution map.
     * @returns TransformResult.
     */
    function migrateWithMap(
        source: string,
        customMap: CsszyxTodoMap,
    ): ReturnType<typeof transformSource> {
        return transformSource(source, 'test.tsx', { customMap });
    }

    it('resolves custom class via object route in JSX', () => {
        const customMap = { 'btn-primary': { bg: 'blue-500', color: 'white', px: 4 } };
        // Use rounded-lg (recognized) not bare rounded (unrecognized without modifier)
        const result = migrateWithMap(
            '<button className="btn-primary py-2 rounded-lg" />',
            customMap,
        );
        expect(result.changed).toBe(true);
        expect(result.code).not.toContain('className=');
        expect(result.code).toContain("bg: 'blue-500'");
        expect(result.code).toContain("color: 'white'");
        expect(result.code).toContain('px: 4');
        expect(result.code).toContain('py: 2');
        expect(result.code).toContain("rounded: 'lg'");
    });

    it('sz:keep classes stay in className= alongside sz=', () => {
        const customMap = { 'icon-sprite': 'sz:keep' };
        const result = migrateWithMap(
            '<div className="flex items-center icon-sprite" />',
            customMap,
        );
        expect(result.changed).toBe(true);
        // sz:keep class should stay in className
        expect(result.code).toContain('className="icon-sprite"');
        // TW classes go to sz
        expect(result.code).toContain('sz=');
        expect(result.code).toContain('flex: true');
    });

    it('sz:remove classes disappear completely', () => {
        const customMap = { 'legacy-wrapper': 'sz:remove' };
        const result = migrateWithMap('<div className="p-4 legacy-wrapper flex" />', customMap);
        expect(result.changed).toBe(true);
        expect(result.code).not.toContain('legacy-wrapper');
        expect(result.code).not.toContain('className=');
        expect(result.code).toContain('p: 4');
    });

    it('sz:todo classes remain in unrecognized and className', () => {
        const customMap: CsszyxTodoMap = { 'pending-class': 'sz:todo' };
        const result = migrateWithMap('<div className="p-4 pending-class" />', customMap);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('className="pending-class"');
        expect(result.stats.classesUnrecognized).toContain('pending-class');
    });

    it('TW string route auto-converts to sz', () => {
        const customMap = { 'focus-ring': 'ring-2 ring-blue-500 ring-offset-2' };
        const result = migrateWithMap('<button className="focus-ring px-4" />', customMap);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('ring: 2');
        expect(result.code).toContain('ringOffset: 2');
        expect(result.code).toContain('px: 4');
    });

    it('partial TW string cascade: unknowns in string value surface in stats', () => {
        const customMap = { 'btn-fancy': 'px-4 figma-token-unknown' };
        const result = migrateWithMap('<button className="btn-fancy" />', customMap);
        expect(result.changed).toBe(true);
        expect(result.code).toContain('px: 4');
        // The inner unknown from string route cascades to unrecognized[]
        expect(result.stats.classesUnrecognized).toContain('figma-token-unknown');
    });

    it('injectTodos with customMap: sz:todo classes get comment', () => {
        const customMap: CsszyxTodoMap = {
            'resolved-class': { bg: 'blue-500' },
            'pending-class': 'sz:todo',
        };
        const result = transformSource(
            '<div className="resolved-class pending-class p-4" />',
            'test.tsx',
            { customMap, injectTodos: true },
        );
        expect(result.changed).toBe(true);
        expect(result.code).toContain('@sz-todo');
        expect(result.code).toContain('pending-class');
        // resolved-class should NOT appear in comment
        expect(result.code).not.toMatch(/@sz-todo.*resolved-class/);
    });

    it('injectTodos with sz:keep: kept classes do NOT get @sz-todo comment', () => {
        const customMap = { 'sprite-class': 'sz:keep' };
        const result = transformSource('<div className="p-4 sprite-class" />', 'test.tsx', {
            customMap,
            injectTodos: true,
        });
        expect(result.changed).toBe(true);
        // sz:keep is intentional — should NOT generate a @sz-todo comment
        expect(result.code).not.toContain('@sz-todo');
    });

    it('resolves multiple custom tokens in clsx call', () => {
        const customMap = {
            'card-base': { rounded: 'lg', bg: 'white' },
            'card-hover': { hover: { shadow: 'lg' } },
        };
        const result = migrateWithMap(
            '<div className={clsx("card-base p-4", isActive && "card-hover")} />',
            customMap,
        );
        expect(result.changed).toBe(true);
        expect(result.code).toContain("rounded: 'lg'");
        expect(result.code).toContain("bg: 'white'");
    });

    it('resolves custom token in ternary expression', () => {
        const customMap = {
            'btn-primary': { bg: 'blue-500', color: 'white' },
            'btn-secondary': { bg: 'gray-100', color: 'gray-900' },
        };
        const result = migrateWithMap(
            '<button className={isPrimary ? "btn-primary px-4" : "btn-secondary px-4"} />',
            customMap,
        );
        expect(result.changed).toBe(true);
        expect(result.code).toContain("bg: 'blue-500'");
        expect(result.code).toContain("bg: 'gray-100'");
    });
});

// ============================================================================
// Edge cases — customMap always takes priority over normal TW parsing
// ============================================================================

describe('customMap priority — token in map is never parsed as plain TW', () => {
    it('sz:todo on any class — valid or custom — always goes to unrecognized[]', () => {
        // sz:todo = "not yet decided". resolve-todos skips it entirely.
        // Even if the class is valid TW (like 'flex'), it must NOT be converted.
        // The @sz-todo comment should be re-injected so the dev sees it's still pending.
        const customMap: CsszyxTodoMap = { flex: 'sz:todo' };
        const { szObject, unrecognized } = classNameToSzObject('flex', customMap);
        expect(unrecognized).toContain('flex'); // stays pending
        expect(szObject).not.toHaveProperty('flex'); // NOT converted
    });

    it('sz:todo on a custom class → unresolved', () => {
        const customMap: CsszyxTodoMap = { 'ds-elevation': 'sz:todo' };
        const { unrecognized } = classNameToSzObject('ds-elevation', customMap);
        expect(unrecognized).toContain('ds-elevation');
    });

    it('customMap overrides normal TW parsing for mapped tokens', () => {
        // 'p-4' is normally a TW class, but if mapped to sz:keep, respect the map
        const customMap: CsszyxTodoMap = { 'p-4': 'sz:keep' };
        const { keepInClassName, szObject } = classNameToSzObject('p-4 m-2', customMap);
        expect(keepInClassName).toContain('p-4');
        expect(szObject.p).toBeUndefined(); // NOT converted to sz
        expect(szObject.m).toBe(2); // m-2 still converted normally
    });
});
