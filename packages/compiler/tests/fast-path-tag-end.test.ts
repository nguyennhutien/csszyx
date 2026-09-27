/**
 * The AST-free lane reads an element's attributes to its real end.
 *
 * It found the opening tag by the first `>` after `sz` and the last `<` before
 * it. An arrow in an event handler, a comparison, or an angle bracket in a
 * string cut the tag there, so a class name written past the cut was not seen:
 * the lane wrote a second class name and the platform kept only one of them.
 */
import { describe, expect, it } from 'vitest';

import { ENGINES, normalizeEmit } from './engine-parity-harness.js';

/**
 * What every engine makes of one element, alone in its file so the file takes
 * the AST-free lane when it can.
 *
 * @param element - The JSX element as written.
 * @returns The engine name and the emitted code, per engine.
 */
function transformElement(element: string) {
    const source = `export const A = ({ a, f }) => ${element};`;
    return ENGINES.map(([name, transform]) => ({
        name,
        code: normalizeEmit(transform(source, 'a.tsx', {}).code ?? ''),
    }));
}

describe('the AST-free lane and the end of a tag', () => {
    it.each([
        [
            '<div sz={{ p: 4 }} onClick={() => f()} className="c" />',
            'onClick={() => f()} className="c p-4"',
        ],
        [
            '<div className="c" data-n={a <b ? 1 : 2} sz={{ p: 4 }} />',
            'className="c p-4" data-n={a <b ? 1 : 2}',
        ],
        ['<div className="c" title="x <y" sz={{ p: 4 }} />', 'className="c p-4" title="x <y"'],
    ])('%s keeps one class name', (element, expected) => {
        for (const { name, code } of transformElement(element)) {
            expect(code, name).toContain(expected);
            expect(code.match(/className=/g), name).toHaveLength(1);
        }
    });

    it('still lowers an sz with an arrow after it', () => {
        for (const { name, code } of transformElement(
            '<div sz={{ p: 4 }} onClick={() => f()} title="a>b" />',
        )) {
            expect(code, name).toContain('<div className="p-4" onClick={() => f()} title="a>b" />');
        }
    });
});
