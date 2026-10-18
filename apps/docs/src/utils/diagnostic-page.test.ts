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
    surfaceSentences,
} from './diagnostic-page';

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
    });

    it('describe a thrown code, a runtime-only code, an old id with no successor and an unknown code', () => {
        const thrown = surfaceSentences({ ...entry, surfaces: { error: {} }, gaps: ['engine'] });
        expect(thrown).toEqual([
            'It is thrown as an error whose `code` is this id.',
            'The build does not report it; only the runtime lane does.',
        ]);
        const formerly = renderDiagnosticPage(entry, [
            { id: 'old-key', since: '0.18.0', replacedBy: 'unknown-key', was: 'rule', reason: 'Renamed.' },
        ]);
        expect(formerly).toContain('Formerly <code>old-key</code> (until 0.18.0).');
        const orphan = renderRemovedPage({ id: 'gone', since: '0.18.0', was: 'rule', reason: 'Gone.' });
        expect(orphan).not.toContain('replaced by');
        expect(renderUnknownCodePage()).toContain('<h1>Unknown code</h1>');
    });
});
