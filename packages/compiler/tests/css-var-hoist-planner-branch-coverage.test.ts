import { describe, expect, it } from 'vitest';

import {
    planComponentVariableHoists,
    planComponentVariableHoistsWithDiagnostics,
} from '../src/css-var-hoist-planner.js';

/**
 * Complementary branch-coverage suite for the component-tier hoist planner. It
 * exercises the group-building, LCA, depth, and diagnostic-shaping branches the
 * primary suite skips: default maxDepth, singleton and multi-member groups,
 * empty and dangling ancestor chains, and the diagnostic name fallback.
 */
describe('planComponentVariableHoists — branch coverage', () => {
    it('plans a hoist and ignores singleton and unique-value groups (default maxDepth)', () => {
        const plans = planComponentVariableHoists(
            [
                { id: 'root' },
                { id: 'a', parentId: 'root' },
                { id: 'b', parentId: 'root' },
                { id: 'c', parentId: 'root' },
            ],
            [
                { id: 'a1', elementId: 'a', name: '--cz', valueKey: 'blue' },
                { id: 'b1', elementId: 'b', name: '--cz', valueKey: 'blue' },
                // Same name, different value → its own group of one, skipped.
                { id: 'c1', elementId: 'c', name: '--cz', valueKey: 'red' },
                // Unique name → a second single-member group, also skipped.
                { id: 'a2', elementId: 'a', name: '--mz', valueKey: 'green' },
            ],
        );

        expect(plans).toEqual([
            { name: '--cz', valueKey: 'blue', targetElementId: 'root', usageIds: ['a1', 'b1'] },
        ]);
    });

    it('records a max-depth diagnostic carrying the configured cap', () => {
        const nodes = [
            { id: 'root' },
            { id: 'a', parentId: 'root' },
            { id: 'b', parentId: 'a' },
            { id: 'c', parentId: 'b' },
            { id: 'd', parentId: 'c' },
            { id: 'e', parentId: 'd' },
            { id: 'f', parentId: 'e' },
            { id: 'sibling', parentId: 'root' },
        ];
        const usages = [
            { id: 'deep', elementId: 'f', name: '--cz', valueKey: 'blue' },
            { id: 'wide', elementId: 'sibling', name: '--cz', valueKey: 'blue' },
        ];

        expect(planComponentVariableHoistsWithDiagnostics(nodes, usages, { maxDepth: 5 })).toEqual({
            plans: [],
            diagnostics: [{ name: '--cz', reason: 'max-depth', usageCount: 2, maxDepth: 5 }],
        });
    });

    it('records a non-host diagnostic when the common ancestor cannot host props', () => {
        const analysis = planComponentVariableHoistsWithDiagnostics(
            [
                { id: 'root' },
                { id: 'frag', parentId: 'root', canHost: false },
                { id: 'a', parentId: 'frag' },
                { id: 'b', parentId: 'frag' },
            ],
            [
                { id: 'a1', elementId: 'a', name: '--cz', valueKey: 'blue' },
                { id: 'b1', elementId: 'b', name: '--cz', valueKey: 'blue' },
            ],
        );

        expect(analysis).toEqual({
            plans: [],
            diagnostics: [{ name: '--cz', reason: 'non-host-ancestor', usageCount: 2 }],
        });
    });

    it('records a no-lca diagnostic when the first element id is empty', () => {
        const analysis = planComponentVariableHoistsWithDiagnostics(
            [{ id: 'root' }],
            [
                { id: 'u1', elementId: '', name: '--cz', valueKey: 'blue' },
                { id: 'u2', elementId: '', name: '--cz', valueKey: 'blue' },
            ],
        );

        expect(analysis).toEqual({
            plans: [],
            diagnostics: [{ name: '--cz', reason: 'no-lca', usageCount: 2 }],
        });
    });

    it('records a no-lca diagnostic when ancestor chains dead-end at a missing parent', () => {
        const analysis = planComponentVariableHoistsWithDiagnostics(
            // 'a' and 'b' both point at a parent id that is absent from the tree,
            // so each ancestor chain breaks before reaching a shared ancestor.
            [{ id: 'root' }, { id: 'a', parentId: 'ghost' }, { id: 'b', parentId: 'ghost' }],
            [
                { id: 'a1', elementId: 'a', name: '--cz', valueKey: 'blue' },
                { id: 'b1', elementId: 'b', name: '--cz', valueKey: 'blue' },
            ],
        );

        expect(analysis).toEqual({
            plans: [],
            diagnostics: [{ name: '--cz', reason: 'no-lca', usageCount: 2 }],
        });
    });

    it('falls back to an empty diagnostic name when usages carry no name', () => {
        const analysis = planComponentVariableHoistsWithDiagnostics(
            [{ id: 'a' }, { id: 'b' }],
            [
                // Malformed usages without a name still group and diagnose; the
                // diagnostic name falls back to the empty string.
                { id: 'u1', elementId: 'a', name: undefined as unknown as string, valueKey: 'v' },
                { id: 'u2', elementId: 'b', name: undefined as unknown as string, valueKey: 'v' },
            ],
        );

        expect(analysis).toEqual({
            plans: [],
            diagnostics: [{ name: '', reason: 'no-lca', usageCount: 2 }],
        });
    });
});
