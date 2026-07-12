import { describe, expect, it } from 'vitest';

import { getPrompt, listPrompts } from '../src/prompts/index';

describe('mcp prompts', () => {
    it('lists both guided-workflow prompts with a required argument each', () => {
        const prompts = listPrompts();
        expect(prompts.map(p => p.name)).toEqual(['migrate_component', 'create_component']);
        for (const prompt of prompts) {
            expect(prompt.arguments).toHaveLength(1);
            expect(prompt.arguments[0].required).toBe(true);
        }
    });

    it('interpolates the code argument into migrate_component', () => {
        const result = getPrompt('migrate_component', { code: '<div className="p-4" />' });
        expect(result.messages[0].content.text).toContain('<div className="p-4" />');
    });

    it('falls back to a placeholder when migrate_component gets no code argument', () => {
        const result = getPrompt('migrate_component', {});
        expect(result.messages[0].content.text).toContain('// paste your component here');
    });

    it('interpolates the description argument into create_component', () => {
        const result = getPrompt('create_component', { description: 'a pricing table' });
        expect(result.messages[0].content.text).toContain('Component description: a pricing table');
    });

    it('falls back to a placeholder when create_component gets no description argument', () => {
        const result = getPrompt('create_component', {});
        expect(result.messages[0].content.text).toContain(
            'Component description: a responsive card component',
        );
    });

    it('throws for an unknown prompt name', () => {
        expect(() => getPrompt('nope', {})).toThrow(/Unknown prompt/);
    });
});
