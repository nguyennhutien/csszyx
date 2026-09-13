import { describe, expect, it } from 'vitest';
import { ENGINES } from './engine-parity-harness.js';

const DEFECTS = [
    ['workBreak: "all"', 'workBreak'],
    ['wordBreak: "all"', 'wordBreak'],
    ['zzzNotAKey: "x"', 'zzzNotAKey'],
    ['display: "bogus"', 'bogus'],
    ['italic: true', 'italic'],
] as const;

describe.each(ENGINES)('resolved branch diagnostics (%s)', (_name, transform) => {
    it.each(DEFECTS)('keeps the diagnostic for %s through a spread', (property, marker) => {
        const bare = transform(`const F=k=><b sz={{${property}}}/>;`, '/p/Spread.tsx');
        const spread = transform(
            `const F=k=><b sz={{${property}, ...(k ? {p:2} : {})}}/>;`,
            '/p/Spread.tsx',
        );
        expect(bare.diagnostics).toHaveLength(1);
        expect(spread.diagnostics).toEqual(bare.diagnostics);
        expect(spread.diagnostics?.[0]).toContain(marker);
    });
    it.each(DEFECTS)('keeps the diagnostic for %s through a static spread', (property, marker) => {
        const bare = transform(`const F=()=><b sz={{${property}}}/>;`, '/p/Spread.tsx');
        const spread = transform(`const F=()=><b sz={{${property}, ...{p:2}}}/>;`, '/p/Spread.tsx');
        expect(spread.diagnostics).toEqual(bare.diagnostics);
        expect(spread.diagnostics?.[0]).toContain(marker);
    });
    it('reports two different defects in one guarded object once each', () => {
        const result = transform(
            `const F=k=><b sz={{workBreak:'all', zzzNotAKey:'x', ...(k ? {p:2} : {})}}/>;`,
            '/p/Spread.tsx',
        );
        const messages = result.diagnostics ?? [];
        expect(messages.filter(message => message.includes('workBreak'))).toHaveLength(1);
        expect(messages.filter(message => message.includes('zzzNotAKey'))).toHaveLength(1);
    });
    it.each([
        '{p:2, ...(k ? {workBreak:"all"} : {})}',
        '{hover:{workBreak:"all"}, ...(k ? {p:2} : {})}',
        'k ? {workBreak:"all"} : {}',
        'k ? {} : j ? {workBreak:"all"} : {}',
        '[{workBreak:"all"}, k && {p:2}]',
    ])('reports the original property in %s', value => {
        const result = transform(`const F=(k,j)=><b sz={${value}}/>;`, '/p/Spread.tsx');
        expect(result.diagnostics?.filter(message => message.includes('workBreak'))).toHaveLength(
            1,
        );
        expect(result.diagnostics?.join('\n')).toContain('/p/Spread.tsx:1');
        expect([...(result.classes ?? [])]).toContain(
            value.includes('hover:') ? 'hover:work-break-all' : 'work-break-all',
        );
    });
    it('keeps both source occurrences on one line', () => {
        const result = transform(
            'const F=k=><b sz={k ? {workBreak:"all"} : {workBreak:"all"}}/>;',
            '/p/Spread.tsx',
        );
        expect(result.diagnostics?.filter(message => message.includes('workBreak'))).toHaveLength(
            2,
        );
    });
    it('keeps the branch condition and census unchanged', () => {
        const result = transform(
            'const F=k=><b sz={{workBreak:"all", ...(k ? {p:2} : {})}}/>;',
            '/p/Spread.tsx',
        );
        expect(result.code).toBe(
            'const F=k=><b className={k ? "p-2 work-break-all" : "work-break-all"}/>;',
        );
        expect([...(result.classes ?? [])]).toEqual(['p-2', 'work-break-all']);
    });
    it('does not warn on clean conditional objects', () => {
        const result = transform(
            'const F=k=><b sz={{m:4, ...(k ? {p:2} : {})}}/>;',
            '/p/Spread.tsx',
        );
        expect(result.diagnostics).toEqual([]);
    });
    it('locates a typo in a hoisted branch at its declaration', () => {
        const result = transform(
            'const A = {workBreak:"all"};\nconst B = {p:2};\nconst F=k=><b sz={k ? B : A}/>;',
            '/p/Spread.tsx',
        );
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics?.[0]).toContain('/p/Spread.tsx:1');
        expect(result.diagnostics?.[0]).toContain('workBreak');
    });
    it.each(['italic: true', 'wordBreak: "all"'])(
        'reports a removed key even when a logical array branch emits nothing: %s',
        property => {
            const result = transform(`const F=k=><b sz={[k && {${property}}]}/>;`, '/p/Spread.tsx');
            expect(result.diagnostics).toHaveLength(1);
            expect([...(result.classes ?? [])]).toEqual([]);
            // No class either way, so the attribute rewrites the way every
            // zero-class sz does, rather than reaching the DOM raw.
            expect(result.code).toBe('const F=k=><b className={undefined}/>;');
        },
    );
});
