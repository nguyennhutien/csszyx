/**
 * What `check` records for a finding, at the level the project gives it.
 *
 * `off` is the one level that means "not reported": a pass may still push
 * the finding, and the reporter drops it, so neither `--json` nor the exit
 * status sees it.
 */
import { stripVTControlCharacters } from 'node:util';

import { createDiagnosticPolicy } from '@csszyx/unplugin/diagnostics';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createReporter } from '../src/scanner/check-report.js';

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * What one `warn` call printed, line by line, without colour.
 *
 * @param text - The text passed to `warn`.
 * @returns The printed lines.
 */
function warned(text: string): string[] {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    createReporter(false).warn(text);
    const calls = log.mock.calls.map(call => String(call[0] ?? ''));
    log.mockRestore();
    return calls.map(line => stripVTControlCharacters(line));
}

describe('the check reporter', () => {
    it('prints a line that carries its own mark without the warning glyph', () => {
        expect(warned('\n\u2716 2 sz issue(s) in 1 file(s).')).toEqual([
            '',
            '\u2716 2 sz issue(s) in 1 file(s).',
        ]);
        expect(warned('! 1 value(s) written on a key.')).toEqual([
            '! 1 value(s) written on a key.',
        ]);
    });

    it('keeps the warning glyph on a heading, after its blank line', () => {
        expect(warned('\nClasses that produce no CSS:')).toEqual([
            '',
            '\u26a0 Classes that produce no CSS:',
        ]);
    });

    it('drops a finding the project turns off, and keeps the others with their level', () => {
        const out = createReporter(
            true,
            createDiagnosticPolicy({ rules: { 'dead-class': 'off', 'broken-opacity': 'warn' } }),
        );
        out.push({ rule: 'dead-class', file: 'src/A.tsx', message: 'styles nothing' });
        out.push({ rule: 'broken-opacity', file: 'src/A.tsx', message: 'no opacity' });

        expect(out.findings).toEqual([
            {
                rule: 'broken-opacity',
                kind: 'broken-opacity',
                file: 'src/A.tsx',
                message: 'no opacity',
                level: 'warn',
            },
        ]);
    });
});
