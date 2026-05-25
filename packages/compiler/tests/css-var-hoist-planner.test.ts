import { describe, expect, it } from 'vitest';

import { planComponentVariableHoists } from '../src/css-var-hoist-planner.js';

describe('CSS variable hoist planner', () => {
    it('hoists identical component-tier vars to the lowest common ancestor', () => {
        const plan = planComponentVariableHoists(
            [
                { id: 'root' },
                { id: 'card', parentId: 'root' },
                { id: 'title', parentId: 'card' },
                { id: 'body', parentId: 'card' },
            ],
            [
                { id: 'a', elementId: 'title', name: '--cz', valueKey: 'blue-500' },
                { id: 'b', elementId: 'body', name: '--cz', valueKey: 'blue-500' },
            ],
        );

        expect(plan).toEqual([
            {
                name: '--cz',
                valueKey: 'blue-500',
                targetElementId: 'card',
                usageIds: ['a', 'b'],
            },
        ]);
    });

    it('does not hoist different values', () => {
        const plan = planComponentVariableHoists(
            [{ id: 'root' }, { id: 'a', parentId: 'root' }, { id: 'b', parentId: 'root' }],
            [
                { id: 'a1', elementId: 'a', name: '--cz', valueKey: 'blue-500' },
                { id: 'b1', elementId: 'b', name: '--cz', valueKey: 'red-500' },
            ],
        );

        expect(plan).toEqual([]);
    });

    it('respects the maxDepth cap', () => {
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
            { id: 'deep', elementId: 'f', name: '--cz', valueKey: 'blue-500' },
            { id: 'wide', elementId: 'sibling', name: '--cz', valueKey: 'blue-500' },
        ];

        expect(planComponentVariableHoists(nodes, usages, { maxDepth: 5 })).toEqual([]);
        expect(planComponentVariableHoists(nodes, usages, { maxDepth: 6 })).toEqual([
            {
                name: '--cz',
                valueKey: 'blue-500',
                targetElementId: 'root',
                usageIds: ['deep', 'wide'],
            },
        ]);
    });

    it('skips ancestors that cannot host style props', () => {
        const plan = planComponentVariableHoists(
            [
                { id: 'root' },
                { id: 'fragment', parentId: 'root', canHost: false },
                { id: 'a', parentId: 'fragment' },
                { id: 'b', parentId: 'fragment' },
            ],
            [
                { id: 'a1', elementId: 'a', name: '--cz', valueKey: 'blue-500' },
                { id: 'b1', elementId: 'b', name: '--cz', valueKey: 'blue-500' },
            ],
        );

        expect(plan).toEqual([]);
    });
});
