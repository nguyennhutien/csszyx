/**
 * `csszyx explain` prints what the build emits for an sz object, so a
 * developer can verify it without a build. What the build emits is pinned per
 * engine artifact in explain-engine.test.ts; this file pins what the command
 * prints for each kind of answer.
 */
import { stripVTControlCharacters } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { explain } from '../src/commands/explain.js';

/**
 * Collect every printed line, colour codes removed.
 * @returns The lines printed so far, in order.
 */
function capture(): string[] {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        lines.push(stripVTControlCharacters(parts.join(' ')));
    });
    return lines;
}

afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

describe('explain', () => {
    it('prints the className alone for a plain object', () => {
        const lines = capture();
        explain("{ hover: { bg: 'blue-500' } }");
        expect(lines).toEqual(['hover:bg-blue-500']);
        expect(process.exitCode).toBeUndefined();
    });

    it('prints (no classes) for an object that yields none', () => {
        const lines = capture();
        explain('{}');
        expect(lines).toEqual(['(no classes)']);
    });

    it('names the style variable a class reads at runtime', () => {
        const lines = capture();
        explain('{ p: size }');
        expect(lines[0]).toBe('p-(--_sz-p)');
        expect(lines[1]).toMatch(/--_sz-p is set through the style attribute at runtime/);
        expect(lines).toHaveLength(2);
    });

    it("prints the engine's diagnostics after the className", () => {
        const lines = capture();
        explain('{ foo: 4 }');
        expect(lines[0]).toBe('foo-4');
        expect(lines[1]).toContain('`foo` is not an sz property.');
        expect(process.exitCode).toBeUndefined();
    });

    it('fails, naming the runtime fallback and its reason, for an object the build leaves to `_sz()`', () => {
        const lines = capture();
        explain('{ ...props }');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe(
            '[csszyx] explain-input-invalid:\n' +
                '  The build emits no classes for `{ ...props }`, because `_sz()` resolves it at runtime.\n' +
                '  help: write its values as literals to see the classes the build emits; a warning printed below, when there is one, names the value that needs the runtime.\n' +
                '  docs: https://csszyx.com/e/explain-input-invalid',
        );
        // The engine's own line names the value, under the refusal.
        expect(lines[1]).toMatch(/^⚠ \[csszyx\] unresolvable-spread/);
        expect(process.exitCode).toBe(1);
    });

    it('fails on a syntax error', () => {
        const lines = capture();
        explain('{ p:');
        expect(lines).toEqual([
            '[csszyx] parse-error:\n' +
                '  This `sz` value could not be parsed as a JavaScript expression.\n' +
                '  help: write the value as an object literal, such as `{ p: 4 }`.\n' +
                '  note: the attribute is left as written, and no class is generated for it.\n' +
                '  docs: https://csszyx.com/e/parse-error',
        ]);
        expect(process.exitCode).toBe(1);
    });
});
