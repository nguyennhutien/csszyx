/**
 * The migrate bridge under the inputs a real codebase contains.
 *
 * `migrate-rust.test.ts` replays the recorded corpus, which is a set of
 * answers agreed in advance. This asks the other question: what happens to a
 * file nobody wrote on purpose — a byte-order mark from a Windows editor, a
 * minified line, a class attribute holding an emoji, a file that does not
 * parse. Migrate is pointed at whole repositories, so every one of these
 * arrives eventually, and none of them may take the run down with it.
 *
 * Characters outside ASCII are written as escapes. A private-use code point or
 * a lone surrogate does not survive every editor and copy path, and one
 * already went missing from a sibling suite in this repository, leaving a case
 * that passed while comparing the wrong pair.
 */
import { describe, expect, it } from 'vitest';

import {
    isRustMigrateAvailable,
    migrateRustBatch,
    migrateRustClassName,
    migrateRustHtml,
    migrateRustParseClass,
} from '../src/migrate-rust.js';

const runs = it.skipIf(!isRustMigrateAvailable());

/**
 * @param source - The file contents.
 * @returns What migrate made of it, as a batch of one.
 */
function migrateOne(source: string) {
    const [result] = migrateRustBatch([{ filename: 'App.tsx', source }]);
    if (!result) throw new Error('the engine answered nothing for a batch of one');
    return result;
}

const HTML = '<html><head><title>t</title></head><body><div class="p-4"></div></body></html>';

describe('the HTML runtime option, which carries a value that is not a string', () => {
    // `injectRuntime` is typed `'local' | 'cdn' | false`, but the engine takes
    // a string or nothing: handing it `false` fails to convert and throws from
    // inside napi. The bridge turns the false into absent, and that one
    // operator is the whole guard — writing it as `??` instead of `||` would
    // pass the false straight through and take down any caller that spells
    // "no runtime" the way the type invites.
    runs('reads false as "inject nothing" rather than failing to convert it', () => {
        const result = migrateRustHtml(HTML, { injectRuntime: false });

        expect(result.code).not.toContain('<script');
    });

    runs('injects nothing when the option is absent either', () => {
        expect(migrateRustHtml(HTML, {}).code).not.toContain('<script');
    });

    runs.each([
        [
            'cdn',
            { injectRuntime: 'cdn' as const, cdnUrl: 'https://example.test/sz.js' },
            'https://example.test/sz.js',
        ],
        ['local', { injectRuntime: 'local' as const, localPath: './sz.js' }, './sz.js'],
    ])('injects the %s runtime at the address it was given', (_name, options, address) => {
        const { code } = migrateRustHtml(HTML, options);

        expect(code).toContain('<script');
        expect(code).toContain(address);
    });

    runs('guards the first paint by default and stops when told to', () => {
        expect(migrateRustHtml(HTML, {}).code).not.toBe(HTML);
        // Absent means on: a user who never passes the option still gets the
        // guard, so the default is behaviour rather than a spelling.
        expect(migrateRustHtml(HTML, {}).code.length).toBeGreaterThan(
            migrateRustHtml(HTML, { injectFouc: false }).code.length,
        );
    });
});

describe('sources a real repository contains', () => {
    const ATTRIBUTE = 'export const A = () => <div className="p-4 flex">CHILD</div>;\n';

    runs.each([
        ['a byte-order mark, as a Windows editor writes one', `\ufeff${ATTRIBUTE}`],
        ['a NUL byte, as a corrupted checkout carries one', ATTRIBUTE.replace('CHILD', '\u0000')],
        ['a lone surrogate, which is not encodable text', ATTRIBUTE.replace('CHILD', '\uD800')],
        ['an emoji inside the markup', ATTRIBUTE.replace('CHILD', '\u{1F389}')],
        ['CRLF line endings', ATTRIBUTE.replace(/\n/g, '\r\n')],
    ])('migrates a file carrying %s', (_name, source) => {
        const result = migrateOne(source);

        expect(result.stats.classNamesTransformed).toBe(1);
        expect(result.code).toContain('sz={{');
    });

    runs('keeps the line endings the file arrived with', () => {
        const result = migrateOne(ATTRIBUTE.replace(/\n/g, '\r\n'));

        expect(result.code).toContain('\r\n');
    });

    runs('answers an empty file without calling it changed', () => {
        const result = migrateOne('');

        expect(result.changed).toBe(false);
        expect(result.warnings).toEqual([]);
    });

    runs('warns about a file that does not parse instead of throwing', () => {
        // The single most common thing in a large repository: one file the
        // parser cannot read, in a run over thousands that can.
        const result = migrateOne('const a = <div className="p-4"');

        expect(result.changed).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain('App.tsx');
    });

    runs('handles markup nested far deeper than anyone writes by hand', () => {
        const depth = 2000;
        const result = migrateOne(
            `export const A = () => ${'<div className="p-4">'.repeat(depth)}${'</div>'.repeat(depth)};`,
        );

        expect(result.stats.classNamesTransformed).toBe(depth);
    });

    runs('handles a minified line holding a very long class attribute', () => {
        const result = migrateOne(
            `export const A = () => <div className="${'p-4 '.repeat(20000).trim()}" />;`,
        );

        expect(result.changed).toBe(true);
    });
});

describe('a batch, which is how the command sends a whole repository', () => {
    runs('answers once per file, in input order, when one file is broken', () => {
        // The file that fails must cost itself and nothing else: a run over
        // thousands of files cannot be lost to one of them.
        const results = migrateRustBatch([
            { filename: 'Good.tsx', source: 'export const A = () => <div className="p-4" />;' },
            { filename: 'Broken.tsx', source: 'const a = <div className="p-4"' },
            { filename: 'AlsoGood.tsx', source: 'export const B = () => <div className="m-2" />;' },
        ]);

        expect(results).toHaveLength(3);
        expect(results.map(result => result.changed)).toEqual([true, false, true]);
        expect(results[1]?.warnings[0]).toContain('Broken.tsx');
    });

    runs('answers nothing for no files rather than refusing the call', () => {
        expect(migrateRustBatch([])).toEqual([]);
    });
});

describe('a resolution map handed over already serialised', () => {
    // The command serialises the map once and sends the same string with
    // every run of files; the engine must read it exactly as it reads the
    // object form, or the two callers would resolve the same class
    // differently.
    runs('resolves a class the same way as the object form', () => {
        const source = 'export const A = () => <div className="btn">a</div>;\n';
        const map = { btn: { p: 8 } };
        const [fromObject] = migrateRustBatch([{ filename: 'A.tsx', source }], { customMap: map });
        const [fromJson] = migrateRustBatch([{ filename: 'A.tsx', source }], {
            customMapJson: JSON.stringify(map),
        });

        expect(fromObject?.code).toContain('p: 8');
        expect(fromJson?.code).toBe(fromObject?.code);
    });
});

describe('the resolution entries a hand-written map holds', () => {
    // Every shape `CsszyxTodoEntry` allows, asked of the bridge that returns
    // them. `keepInClassName` is how a user says "leave this one alone", and
    // it is the only field of the answer no other suite in this package reads.
    runs('reads an object, an alias and each directive', () => {
        const answer = migrateRustClassName('mapped aliased kept removed pending', {
            mapped: { m: 2 },
            aliased: 'p-8',
            kept: 'sz:keep',
            removed: 'sz:remove',
            pending: 'sz:todo',
        });

        expect(answer.szObject).toMatchObject({ m: 2, p: 8 });
        expect(answer.keepInClassName).toEqual(['kept']);
        // Removed is gone from every list; pending is still a question.
        expect(answer.unrecognized).toEqual(['pending']);
    });

    runs.each([
        ['null', null],
        ['false', false],
    ])('reads %s as unresolved, the way it meant before the directives existed', (_n, entry) => {
        const answer = migrateRustClassName('legacy', { legacy: entry });

        expect(answer.unrecognized).toEqual(['legacy']);
        expect(answer.keepInClassName).toEqual([]);
    });
});

describe('reading one class, which the editor tooling asks for a keystroke at a time', () => {
    runs.each([
        ['an empty string', ''],
        ['whitespace', '   '],
        ['two classes at once, which is not one utility', 'p-4 m-2'],
        ['a class nobody defined', 'not-a-tailwind-class'],
        ['a lone surrogate', '\uD800'],
    ])('answers null for %s rather than guessing', (_name, className) => {
        expect(migrateRustParseClass(className)).toBeNull();
    });

    runs('answers the prop and value for a utility it knows', () => {
        expect(migrateRustParseClass('p-4')).toMatchObject({ prop: 'p', value: 4 });
    });
});
