import { describe, expect, it } from 'vitest';

import data from '../data/diagnostics.json';
import {
    argType,
    type DiagnosticData,
    type DiagnosticEntry,
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
        expect(renderDiagnosticPage(browser)).not.toContain('prints them as JSON');
        expect(renderDiagnosticPage(entry, { shipped: LANDED })).not.toContain('prints them as JSON');
    });

    it('describe today’s messages until each ADR 0031 change lands', () => {
        expect(SHIPPED).toEqual({ codePrefix: false, errorCode: false, compactProduction: false });
        const thrown = { ...entry, surfaces: { error: {} } };
        expect(surfaceSentences(thrown)).toEqual(['It is thrown as an error.']);
        expect(surfaceSentences(thrown, LANDED)).toEqual(['It is thrown as an error whose `code` is this id.']);
    });

    it('name the forms a production bundle prints, and a throw only development reaches', () => {
        const some = { ...entry, surfaces: { runtime: { production: ['a'] } } };
        expect(surfaceSentences(some)).toEqual([
            'It is printed to the console. A production browser bundle prints its `a` form only.',
        ]);
        expect(renderDiagnosticPage(some, { shipped: LANDED })).toContain('prints them as JSON');
        const devOnly = { ...entry, surfaces: { error: { production: false } } };
        expect(surfaceSentences(devOnly)).toEqual([
            'It is thrown as an error by a development build; a production build does not throw it.',
        ]);
        expect(surfaceSentences(devOnly, LANDED)).toEqual([
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
        const generated = data as DiagnosticData;
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
        const thrown = surfaceSentences({ ...entry, surfaces: { error: {} }, gaps: ['engine'] });
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
});
