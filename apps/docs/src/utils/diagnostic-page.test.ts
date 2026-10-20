import { describe, expect, it } from 'vitest';

import {
    argType,
    type DiagnosticData,
    type DiagnosticEntry,
    DIAGNOSTIC_DATA,
    diagnosticPages,
    escapeHtml,
    renderDiagnosticPage,
    renderRemovedPage,
    renderUnknownCodePage,
    SHIPPED,
    type Shipped,
    surfaceSentences,
} from './diagnostic-page';

/** Every ADR 0031 behaviour landed, as the pages read once the last change merges. */
const LANDED: Shipped = { codePrefix: true, errorCode: true, compactProduction: true };
/** None of them landed, as the pages read before ADR 0031. */
const BEFORE: Shipped = { codePrefix: false, errorCode: false, compactProduction: false };

/** The generated entry of one id. */
function generated(id: string): DiagnosticEntry {
    const found = DIAGNOSTIC_DATA.diagnostics.find(diagnostic => diagnostic.id === id);
    if (found === undefined) throw new Error(`no ${id} in diagnostics.json`);
    return found;
}

const entry: DiagnosticEntry = {
    id: 'unknown-key',
    summary: 'A key no `sz` table knows, like <div>.',
    surfaces: { engine: {}, runtime: { production: false } },
    position: 'site',
    args: {
        key: { type: 'string' },
        suggestion: { type: 'string', optional: true },
        form: { type: ['enum', 'a', 'b'] },
        message: { type: 'string', opaque: true },
    },
};

describe('the /e/<code> pages', () => {
    it('escape registry text instead of reading it as markup', () => {
        expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
        const html = renderDiagnosticPage(entry);
        expect(html).toContain('like &lt;div&gt;.');
        expect(html).toContain('<code>sz</code> table');
        expect(html).not.toContain('<div>.');
    });

    it('say where an id appears and how loud it is by default', () => {
        expect(surfaceSentences(entry)).toHaveLength(2);
        const html = renderDiagnosticPage(entry);
        expect(html).toContain('<code>error</code> under <code>recommended</code>');
        expect(renderDiagnosticPage({ ...entry, surfaces: { runtime: { production: true } } })).not.toContain(
            '<h2>Level</h2>',
        );
    });

    it('list each argument with its type', () => {
        expect(argType({ type: ['enum', 'a', 'b'] })).toBe("'a' | 'b'");
        const html = renderDiagnosticPage(entry);
        expect(html).toContain('<code>suggestion</code></td><td><code>string</code></td><td>optional');
        expect(html).toContain('may change between its versions');
        expect(html).toContain('<p>The values this diagnostic names.</p>');
    });

    it('promise a JSON record only for a production browser line, once that has landed', () => {
        const browser = { ...entry, surfaces: { runtime: { production: true } } };
        expect(renderDiagnosticPage(browser, { shipped: LANDED })).toContain('prints them as JSON');
        expect(renderDiagnosticPage(browser, { shipped: BEFORE })).not.toContain('prints them as JSON');
        expect(renderDiagnosticPage(entry, { shipped: LANDED })).not.toContain('prints them as JSON');
    });

    it('describe the messages as every ADR 0031 change has landed', () => {
        expect(SHIPPED).toEqual(LANDED);
        const thrown = { ...entry, surfaces: { error: {} } };
        expect(surfaceSentences(thrown, BEFORE)).toEqual(['It is thrown as an error.']);
        expect(surfaceSentences(thrown)).toEqual(['It is thrown as an error whose `code` is this id.']);
    });

    it('name the forms a production bundle prints, and a throw only development reaches', () => {
        const some = { ...entry, surfaces: { runtime: { production: ['a'] } } };
        expect(surfaceSentences(some, BEFORE)).toEqual([
            'It is printed to the console. A production browser bundle prints its `a` form only.',
        ]);
        expect(renderDiagnosticPage(some, { shipped: LANDED })).toContain('prints them as JSON');
        const devOnly = { ...entry, surfaces: { error: { production: false } } };
        expect(surfaceSentences(devOnly, BEFORE)).toEqual([
            'It is thrown as an error by a development build; a production build does not throw it.',
        ]);
        expect(surfaceSentences(devOnly)).toEqual([
            'It is thrown as an error whose `code` is this id, by a development build; a production build does not throw it.',
        ]);
    });

    it('say a level reaches neither a console line nor a thrown error', () => {
        const note = 'It does not change a console line';
        expect(renderDiagnosticPage(entry)).toContain(note);
        expect(renderDiagnosticPage({ ...entry, surfaces: { engine: {} } })).not.toContain(note);
    });

    it('mark a removed id and name the one that replaced it', () => {
        const html = renderRemovedPage({
            id: 'other',
            since: '0.18.0',
            replacedBy: 'unknown-key',
            was: 'check-kind',
            reason: 'Every finding has its own kind.',
        });
        expect(html).toContain('Not reported since 0.18.0.');
        expect(html).toContain('href="/e/unknown-key"');
    });

    it('exist for every live id and every removed id the URL grammar fits', () => {
        const generated = DIAGNOSTIC_DATA;
        const pages = new Map(diagnosticPages(generated));
        for (const diagnostic of generated.diagnostics) expect(pages.has(diagnostic.id)).toBe(true);
        for (const removed of generated.removed) {
            expect(pages.has(removed.id)).toBe(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(removed.id));
        }
        const withTombstones: DiagnosticData = {
            ...generated,
            removed: [
                { id: 'old-key', since: '0.18.0', replacedBy: 'unknown-key', was: 'rule', reason: 'Renamed.' },
                { id: 'OLD_CODE', since: '0.18.0', was: 'error-code', reason: 'Renamed.' },
            ],
        };
        const ids = diagnosticPages(withTombstones).map(([id]) => id);
        expect(ids).toContain('old-key');
        expect(ids).not.toContain('OLD_CODE');
    });

    it('describe a thrown code, a runtime-only code, an old id with no successor and an unknown code', () => {
        const thrown = surfaceSentences({ ...entry, surfaces: { error: {} }, gaps: ['engine'] }, BEFORE);
        expect(thrown).toEqual([
            'It is thrown as an error.',
            'The build does not report it; only the runtime lane does.',
        ]);
        const formerly = renderDiagnosticPage(entry, {
            removed: [{ id: 'old-key', since: '0.18.0', replacedBy: 'unknown-key', was: 'rule', reason: 'Renamed.' }],
        });
        expect(formerly).toContain('Formerly <code>old-key</code> (until 0.18.0).');
        const orphan = renderRemovedPage({ id: 'gone', since: '0.18.0', was: 'rule', reason: 'Gone.' });
        expect(orphan).not.toContain('replaced by');
        expect(renderUnknownCodePage()).toContain('<a href="/docs/reference/codes/">Every code</a> is listed');
    });

    it('show each form’s words as the terminal prints them, every value as <name>', () => {
        const html = renderDiagnosticPage(generated('removed-key'));
        expect(html).toContain('<h3><code>removed</code></h3>');
        expect(html).toContain(
            '[csszyx] removed-key: `<var>&lt;key&gt;</var>` was removed, and nothing is emitted for it.\n  help: <var>&lt;note&gt;</var>.\n  docs: https://csszyx.com/e/removed-key',
        );
        expect(html).toContain('  help: write `{ <var>&lt;replacement&gt;</var> }` instead, or run `csszyx migrate`.');
        // A value the message works out names where it comes from.
        expect(html).toContain(
            '<li><code>&lt;note&gt;</code>: The migration note of <code>key</code> (MIGRATION_NOTES).</li>',
        );
        // Before the code prefix landed, a line did not start with it.
        expect(renderDiagnosticPage(generated('removed-key'), { shipped: BEFORE })).not.toContain(
            '[csszyx] removed-key:',
        );
    });

    it('show the line a production bundle prints, and what to write for each key it names', () => {
        const html = renderDiagnosticPage(generated('removed-key'));
        expect(html).toContain(
            '[csszyx] removed-key: {&quot;form&quot;:&quot;removed&quot;,&quot;key&quot;:&quot;&lt;key&gt;&quot;,&quot;replacement&quot;:&quot;&lt;replacement&gt;&quot;} https://csszyx.com/e/removed-key',
        );
        expect(html).toContain(
            '<tr><td><code>ordinal</code></td><td><code>numOrdinal: true</code></td><td>help: write <code>{ numOrdinal: true }</code> instead, or run <code>csszyx migrate</code>.</td></tr>',
        );
        expect(html).toContain(
            '<tr><td><code>maskFrom</code></td><td>help: write the from stop on its layer: <code>maskLinear</code>',
        );
        const moved = renderDiagnosticPage(generated('moved-value'));
        expect(moved).toContain(
            "<tr><td><code>touch</code></td><td><code>pan-x</code></td><td>help: write <code>{ touchPanX: 'x' }</code>, or run <code>csszyx migrate</code>.</td></tr>",
        );
        expect(moved).toContain('<tr><td><code>touchAction</code></td><td><code>pan-x</code></td>');
        // Only the form a production bundle prints gets its line.
        const closed = renderDiagnosticPage(generated('closed-enum-value'));
        expect(closed.split('A production browser bundle prints this in place of it:')).toHaveLength(2);
        // Its help names args only, so no table follows.
        expect(closed).not.toContain('For each key the line can name');
        // A form only the build reports gets no production line.
        const removed = renderDiagnosticPage(generated('removed-key'));
        expect(removed.split('A production browser bundle prints this in place of it:')).toHaveLength(5);
        expect(removed).toContain(
            '<p>Only the build reports this form, with its whole message; a browser bundle never prints it.</p>',
        );
        expect(removed).not.toContain('&quot;form&quot;:&quot;runtime-alias&quot;');
        expect(removed).not.toContain('<code>touchAction</code>');
        // Before compact lines landed, none is shown.
        const before = renderDiagnosticPage(generated('removed-key'), { shipped: BEFORE });
        expect(before).not.toContain('{&quot;form&quot;');
        expect(before).not.toContain('<code>ordinal</code>');
    });

    it('build a production line from each arg’s type, and name a thrown one', () => {
        const thrown: DiagnosticEntry = {
            ...entry,
            surfaces: { error: { host: 'browser' } },
            args: { depth: { type: 'number' }, parts: { type: 'string[]' } },
            text: 'It is {depth} deep.',
        };
        const html = renderDiagnosticPage(thrown);
        expect(html).toContain('A production browser bundle throws this in place of it:');
        expect(html).toContain('{&quot;depth&quot;:&lt;depth&gt;,&quot;parts&quot;:[&quot;&lt;parts&gt;&quot;]}');
        expect(renderDiagnosticPage({ ...thrown, surfaces: { error: { host: 'node' } } })).not.toContain(
            'in place of it',
        );
        const empty = renderDiagnosticPage({ ...thrown, args: undefined, text: 'It failed.' });
        expect(empty).toContain('[csszyx] unknown-key: {} https://csszyx.com/e/unknown-key');
    });

    it('read a template that varies by another arg, and leave out a field a form lacks', () => {
        const html = renderDiagnosticPage({
            ...entry,
            variesBy: 'form',
            text: { a: 'A {key}.', b: 'B.' },
            note: { a: 'only a.' },
        });
        expect(html).toContain('<h3><code>a</code></h3>');
        expect(html).toContain('[csszyx] unknown-key: B.\n  docs:');
        expect(renderDiagnosticPage(entry)).not.toContain('<h2>Message</h2>');
        // Varying by an arg that is no enum leaves one block, with no per-variant words.
        const loose = renderDiagnosticPage({ ...entry, variesBy: 'key', text: { a: 'A.' } });
        expect(loose).toContain('<pre><code>  docs: https://csszyx.com/e/unknown-key</code></pre>');
    });

    it('leave a cell empty when a row has no value for it', () => {
        const html = renderDiagnosticPage(
            { ...entry, surfaces: { runtime: { production: true } }, text: 'A.', help: 'write {canonical}.' },
            {
                message: {
                    ...DIAGNOSTIC_DATA,
                    lookups: { 'unknown-key': [{ args: { key: 'a' }, values: {} }, { args: { suggestion: 'b' }, values: {} }] },
                },
            },
        );
        expect(html).toContain('<tr><td><code>a</code></td><td></td><td></td></tr>');
        expect(html).toContain('<tr><td></td><td><code>b</code></td><td></td></tr>');
    });

    it('escape registry text in the words and in each table row', () => {
        const html = renderDiagnosticPage(
            {
                ...entry,
                id: 'removed-key',
                surfaces: { runtime: { production: true } },
                text: 'A `<b>` & {key}.',
                help: 'write `{ {key}: {note} }` & go.',
            },
            {
                message: {
                    ...DIAGNOSTIC_DATA,
                    lookups: { 'removed-key': [{ args: { key: '<x>&' }, values: { note: '"<y>"' } }] },
                },
            },
        );
        expect(html).toContain('A `&lt;b&gt;` &amp; <var>&lt;key&gt;</var>.');
        expect(html).toContain('<td><code>&lt;x&gt;&amp;</code></td>');
        expect(html).toContain('help: write <code>{ &lt;x&gt;&amp;: &quot;&lt;y&gt;&quot; }</code> &amp; go.');
        expect(html).not.toContain('<b>');
        expect(html).not.toContain('<x>');
    });
});
