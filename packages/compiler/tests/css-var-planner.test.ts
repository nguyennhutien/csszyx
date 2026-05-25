import { describe, expect, it } from 'vitest';

import { planCSSVariableNames } from '../src/css-var-planner.js';

describe('CSS variable name planner', () => {
    it('assigns deterministic component-tier names and deduplicates matching keys', () => {
        const plan = planCSSVariableNames([
            { id: 'a', tier: 'component', propertyKey: 'bg' },
            { id: 'b', tier: 'component', propertyKey: 'color' },
            { id: 'c', tier: 'component', propertyKey: 'bg' },
            { id: 'd', tier: 'component', propertyKey: 'gap', variantChain: 'md' },
        ]);

        expect(plan.map(entry => [entry.id, entry.name])).toEqual([
            ['a', '--cz'],
            ['b', '--cy'],
            ['c', '--cz'],
            ['d', '--cx'],
        ]);
    });

    it('restarts scoped-tier names per element', () => {
        const plan = planCSSVariableNames([
            { id: 'a', tier: 'scoped', elementId: 'card-1', propertyKey: 'x' },
            { id: 'b', tier: 'scoped', elementId: 'card-1', propertyKey: 'y' },
            { id: 'c', tier: 'scoped', elementId: 'card-2', propertyKey: 'x' },
            { id: 'd', tier: 'scoped', elementId: 'card-2', propertyKey: 'y' },
        ]);

        expect(plan.map(entry => [entry.id, entry.name])).toEqual([
            ['a', '--sz'],
            ['b', '--sy'],
            ['c', '--sz'],
            ['d', '--sy'],
        ]);
    });

    it('keeps component and scoped counters independent', () => {
        const plan = planCSSVariableNames([
            { id: 'component', tier: 'component', propertyKey: 'bg' },
            { id: 'scoped', tier: 'scoped', elementId: 'card', propertyKey: 'bg' },
        ]);

        expect(plan.map(entry => [entry.id, entry.name])).toEqual([
            ['component', '--cz'],
            ['scoped', '--sz'],
        ]);
    });
});
