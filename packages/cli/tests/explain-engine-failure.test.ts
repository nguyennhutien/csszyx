/**
 * `csszyx explain` when the engine itself throws: not a refusal of the input.
 * A csszyx error says what failed in the registry's words, so it is printed
 * as it is; anything else is a csszyx bug, and the command says how to report
 * it.
 */
import { stripVTControlCharacters } from 'node:util';

import { szDiagnosticError } from '@csszyx/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({ throws: new Error('unset') as unknown }));

vi.mock('@csszyx/compiler/engine', () => ({
    transformSource: () => {
        throw engine.throws;
    },
}));

const { explain } = await import('../src/commands/explain.js');

afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

/**
 * Run `explain` and collect what it printed.
 *
 * @returns Every printed line, colour codes removed.
 */
function explained(): string[] {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        lines.push(stripVTControlCharacters(parts.join(' ')));
    });
    explain('{ p: 4 }');
    return lines;
}

describe('explain, when the engine throws', () => {
    it('prints a csszyx error in its own words, with no second header', () => {
        const error = szDiagnosticError('internal-error', {
            where: 'transformWasm',
            detail: 'the wasm engine returned no result',
        });
        engine.throws = error;

        expect(explained()).toEqual([error.message]);
        expect(process.exitCode).toBe(1);
    });

    it('says how to report any other throw, without its class name', () => {
        engine.throws = new TypeError("Cannot read properties of undefined (reading 'kind')");

        expect(explained()).toEqual([
            "✗ Could not explain this sz object: Cannot read properties of undefined (reading 'kind')\n" +
                '  help: report this csszyx bug at https://github.com/nguyennhutien/csszyx/issues with this message, the csszyx version and the sz object you passed.',
        ]);
        expect(process.exitCode).toBe(1);
    });

    it('reports a thrown value that is not an Error as it is', () => {
        engine.throws = 'no engine';

        expect(explained()[0]).toMatch(
            /^✗ Could not explain this sz object: no engine\n {2}help: /,
        );
    });
});
