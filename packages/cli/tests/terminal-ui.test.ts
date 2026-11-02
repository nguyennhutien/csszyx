import { stripVTControlCharacters } from 'node:util';
import { expect, it, vi } from 'vitest';
import { spinner } from '../src/utils/terminal-ui.js';

it('delivers a failed or warning status to the matching spinner channel', () => {
    const status = { fail: vi.fn(), warn: vi.fn() };
    spinner.fail(status as never, 'write failed');
    spinner.warn(status as never, 'skipped one file');
    expect(stripVTControlCharacters(status.fail.mock.calls[0]?.[0])).toBe('write failed');
    expect(stripVTControlCharacters(status.warn.mock.calls[0]?.[0])).toBe('skipped one file');
});
