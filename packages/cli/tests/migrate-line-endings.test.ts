/**
 * Migrate must leave a file's line endings as it found them.
 *
 * A Windows checkout carries `\r\n`. The rewriter splices by byte offset, so
 * everything it does not touch keeps its ending — but every line it WRITES
 * (a multi-line sz object, a follow-up comment, the injected FOUC rule) used
 * to end in a bare `\n`, leaving one file with two conventions. Prettier and
 * eslint then flag the lines csszyx itself just wrote.
 *
 * The invariant is stronger than "contains \r\n": migrating a CRLF copy of a
 * source must equal the CRLF copy of migrating the LF source. One assertion
 * catches a mixed file, a swallowed newline, and an offset slip alike.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrate } from '../src/commands/migrate.js';
import { transformHtmlSourceSimple, transformSource } from '../src/migrate/ast-transformer.js';

const toCRLF = (text: string): string => text.replaceAll('\n', '\r\n');
// A `\n` not preceded by `\r` — the one thing a CRLF file must never gain.
const hasLoneLf = (text: string): boolean => /(?<!\r)\n/.test(text);

describe('line endings survive migration', () => {
    it('keeps CRLF through a multi-line sz object', () => {
        const lf =
            'export function Card() {\n  return (\n' +
            '    <div className="flex items-center p-4 bg-blue-500">\n' +
            '      <span className="text-sm font-bold">hi</span>\n' +
            '    </div>\n  );\n}\n';

        const fromCrlf = transformSource(toCRLF(lf), 'Card.tsx').code;

        expect(hasLoneLf(fromCrlf)).toBe(false);
        expect(fromCrlf).toBe(toCRLF(transformSource(lf, 'Card.tsx').code));
    });

    it('keeps CRLF through an injected follow-up comment', () => {
        const lf = 'export const K = () => (\n  <div className="p-4 mystery-class">x</div>\n);\n';
        const options = { injectTodos: true };

        const fromCrlf = transformSource(toCRLF(lf), 'K.tsx', options).code;

        expect(fromCrlf).toContain('@sz-todo');
        expect(hasLoneLf(fromCrlf)).toBe(false);
        expect(fromCrlf).toBe(toCRLF(transformSource(lf, 'K.tsx', options).code));
    });

    it('keeps CRLF through the HTML head and body injections', () => {
        const lf =
            '<html>\n<head>\n<title>t</title>\n</head>\n<body>\n' +
            '<div class="flex items-center p-4 bg-blue-500">x</div>\n' +
            '</body>\n</html>\n';
        const options = { injectRuntime: 'cdn' as const };

        const fromCrlf = transformHtmlSourceSimple(toCRLF(lf), options).code;

        expect(hasLoneLf(fromCrlf)).toBe(false);
        expect(fromCrlf).toBe(toCRLF(transformHtmlSourceSimple(lf, options).code));
    });

    it('leaves an LF file as LF', () => {
        const lf =
            'export const A = () => <div className="flex items-center p-4 bg-blue-500" />;\n';

        expect(transformSource(lf, 'A.tsx').code).not.toContain('\r');
    });
});

describe('the follow-up comment round trip on a CRLF file', () => {
    let cwd = '';
    afterEach(() => {
        vi.restoreAllMocks();
        if (cwd) rmSync(cwd, { recursive: true, force: true });
    });

    it('strips a resolved follow-up comment the same way on CRLF as on LF', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
        cwd = mkdtempSync(join(tmpdir(), 'csszyx-crlf-'));
        writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'fixture' }));
        mkdirSync(join(cwd, 'src'));
        // The documented workflow: an audit left this comment, the map now
        // answers it, and the resolve pass removes the comment with its line.
        const lf =
            'export const K = () => (<div>\n' +
            '{/* @sz-todo: mystery-class */}\n' +
            '<span className="p-4 mystery-class">x</span>\n' +
            '</div>);\n';
        const lfFile = join(cwd, 'src/Lf.tsx');
        const crlfFile = join(cwd, 'src/Crlf.tsx');
        writeFileSync(lfFile, lf);
        writeFileSync(crlfFile, toCRLF(lf));
        writeFileSync(
            join(cwd, '.csszyx-todo.json'),
            JSON.stringify({ 'mystery-class': { m: 1 } }),
        );

        await migrate({ cwd, resolveTodos: '.csszyx-todo.json' });

        const lfOut = readFileSync(lfFile, 'utf8');
        const crlfOut = readFileSync(crlfFile, 'utf8');
        expect(lfOut).not.toContain('@sz-todo');
        expect(crlfOut).not.toContain('@sz-todo');
        expect(hasLoneLf(crlfOut)).toBe(false);
        expect(crlfOut).toBe(toCRLF(lfOut));
    });
});
