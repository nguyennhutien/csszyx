/**
 * The warning a dev server or `csszyx next watch` prints when a stylesheet
 * edit leaves the stylesheets unreadable and it goes on: the error's own
 * message, with the session's note above `docs:`.
 */
import { describe, expect, it } from 'vitest';

import { diagnosticError } from '../src/diagnostic-message.js';
import { keptSessionMessage } from '../src/kept-session-message.js';

const NOTE =
    'the dev server keeps the prefix it last read (`tw`) until the stylesheets agree again.';

describe('keptSessionMessage', () => {
    it('drops the build note of a prefix disagreement and puts its own above `docs:`', () => {
        const error = diagnosticError('prefix-disagreement', {
            form: 'build',
            entries: ['`src/a.css` with `prefix(tw)`', '`src/b.css` with none'],
            setting: '`build.tailwindStylesheets`',
        });

        const lines = keptSessionMessage(error, NOTE).split('\n');

        expect(lines.filter(line => line.startsWith('  note: '))).toEqual([`  note: ${NOTE}`]);
        expect(lines.at(-1)).toBe('  docs: https://csszyx.com/e/prefix-disagreement');
    });

    it("keeps another error's notes", () => {
        const error = diagnosticError('tailwind-stylesheet-broken', {
            stylesheets: ['src/a.css: ENOENT'],
            setting: '`build.tailwindStylesheets`',
        });

        const lines = keptSessionMessage(error, NOTE).split('\n');

        expect(lines.slice(-3)).toEqual([
            '    src/a.css: ENOENT',
            `  note: ${NOTE}`,
            '  docs: https://csszyx.com/e/tailwind-stylesheet-broken',
        ]);
        expect(lines.some(line => line.startsWith('  note: each failure'))).toBe(true);
    });

    it('puts the note last on a message without `docs:`', () => {
        expect(keptSessionMessage(new Error('ENOENT: no such file'), NOTE)).toBe(
            `ENOENT: no such file\n  note: ${NOTE}`,
        );
    });
});
