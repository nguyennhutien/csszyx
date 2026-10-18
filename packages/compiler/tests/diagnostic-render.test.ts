/**
 * The diagnostic renderer and its computed values (ADR 0031).
 */
import { describe, expect, it } from 'vitest';

import { COMPUTED } from '../../../scripts/diagnostics/registry.mjs';
import { PLACEHOLDER_PATTERN } from '../../../scripts/gen-diagnostic-codes.mjs';
import { PLACEHOLDER } from '../src/diagnostic-placeholder.js';
import { SZ_DIAGNOSTIC_COMPUTED } from '../src/diagnostic-registry.generated.js';
import { renderSzDiagnostic, renderSzDiagnosticBody } from '../src/diagnostic-render.js';
import { SZ_DIAGNOSTIC_COMPUTED_VALUES } from '../src/diagnostic-render-helpers.js';
import {
    diagnosticPath,
    renderEngineDiagnostics,
    renderUnplacedDiagnostic,
    szDiagnosticKey,
} from '../src/engine-diagnostics.js';
import type { SzDiagnosticIssue } from '../src/engine-spans.js';

const computed = SZ_DIAGNOSTIC_COMPUTED_VALUES;

describe('renderSzDiagnostic', () => {
    it('heads a site diagnostic with its code and place, and ends with its page', () => {
        expect(
            renderSzDiagnostic({
                diagnostic: { code: 'numeric-key', args: { key: '0' }, line: 3, column: 9 },
                file: 'src/A.tsx',
                computed,
            }).split('\n'),
        ).toEqual([
            '[csszyx] numeric-key: src/A.tsx:3:9',
            '  `sz` received a numeric key `0`, and its value is ignored.',
            '  help: pass an object of sz keys here; a numeric key usually means an array or a spread was passed in its place.',
            '  docs: https://csszyx.com/e/numeric-key',
        ]);
    });

    it('names the file alone for a file-wide diagnostic, and nothing for one with no place', () => {
        const file = renderSzDiagnostic({
            diagnostic: { code: 'nesting-depth', args: { depth: 70 }, line: 1, column: 1 },
            file: 'src/A.tsx',
            computed,
        });
        expect(file.split('\n')[0]).toBe('[csszyx] nesting-depth: src/A.tsx');
        // A site diagnostic the caller could not place still names its file.
        const unplaced = renderSzDiagnostic({
            diagnostic: { code: 'numeric-key', args: { key: '0' } },
            file: 'src/A.tsx',
            computed,
        });
        expect(unplaced.split('\n')[0]).toBe('[csszyx] numeric-key: src/A.tsx');
    });

    it('fills each placeholder once, so an arg holding braces is printed as written', () => {
        const body = renderSzDiagnosticBody(
            { code: 'numeric-key', args: { key: '{key}' } },
            computed,
        );
        expect(body.split('\n')[0]).toBe(
            '`sz` received a numeric key `{key}`, and its value is ignored.',
        );
    });

    it('picks the text of the variant an arg other than form names', () => {
        const body = renderSzDiagnosticBody(
            {
                code: 'mangle-vars-hoist-skipped',
                args: { name: '--cz', usageCount: 2, reason: 'max-depth', maxDepth: 5 },
            },
            computed,
        );
        expect(body).toContain('`maxDepth` 5 allows');
        expect(body).toContain('help: raise `production.mangleVarHoistMaxDepth` to hoist it.');
    });

    it('joins a list arg with the joiner the registry declares', () => {
        expect(
            renderSzDiagnosticBody(
                { code: 'property-object', args: { key: 'p', nestedKeys: ['x', 'y'] } },
                computed,
            ),
        ).toContain('`{ x, y }`');
    });

    it('heads a diagnostic with its code alone when it has no place', () => {
        const message = renderUnplacedDiagnostic({ code: 'numeric-key', args: { key: '0' } });
        expect(message.split('\n')[0]).toBe('[csszyx] numeric-key:');
        expect(message).toContain('docs: https://csszyx.com/e/numeric-key');
    });

    it('prints nothing for a per-form field when the issue names no form', () => {
        expect(
            renderSzDiagnosticBody(
                { code: 'closed-enum-value', args: { key: 'k', value: 'v' } },
                computed,
            ),
        ).toBe('');
    });

    it('prints nothing for a field the variant has no template for', () => {
        const body = renderSzDiagnosticBody(
            { code: 'closed-enum-value', args: { form: 'nope', key: 'k', value: 'v' } },
            computed,
        );
        expect(body).toBe('');
    });
});

describe('the computed values', () => {
    it('are exactly the ones the registry lists', () => {
        expect(Object.keys(computed).sort()).toEqual(Object.keys(COMPUTED).sort());
        expect([...SZ_DIAGNOSTIC_COMPUTED].sort()).toEqual(Object.keys(COMPUTED).sort());
    });

    it('read a missing or non-text arg as nothing', () => {
        expect(computed.canonical?.({ key: 4 })).toBe('');
        expect(computed.enumAllowed?.({ key: 'nope' })).toBe('');
        expect(computed.canonicalAllowed?.({ key: 'nope' })).toBe('');
        expect(computed.canonicalAllowed?.({ key: 'touchAction' })).toBe(
            'auto, none, manipulation',
        );
        expect(computed.earlier?.({ classes: ['card'], szCount: 1 })).toBe(
            'the classes of an earlier `sz` and `card`',
        );
    });

    it('render a miss as nothing, as the engine did', () => {
        for (const name of ['canonical', 'note', 'movedKey', 'movedValue', 'groups']) {
            expect(computed[name]?.({ key: 'nope', value: 'nope' }), name).toBe('');
        }
    });

    it('present the optional args a template cannot leave blank', () => {
        expect(computed.spellingHint?.({ suggestion: 'break' })).toBe('did you mean `break`?');
        expect(computed.spellingHint?.({})).toBe('check the spelling.');
        expect(computed.spreadPlace?.({ spread: 'r' })).toBe('`{...r}`');
        expect(computed.spreadPlace?.({})).toBe('the spread');
        expect(computed.groupLiteral?.({ groupValue: 'true' })).toBe('true');
        expect(computed.groupLiteral?.({ groupValue: 'paint' })).toBe("'paint'");
        expect(computed.earlier?.({ classes: ['card', 'a`b'], szCount: 2, szAt: 1 })).toBe(
            '`card` and the classes of 2 earlier `sz` and `` a`b ``',
        );
        expect(computed.earlier?.({})).toBe('');
        expect(computed.example?.({})).toBe('{ … }');
    });
});

describe('the placeholder grammar', () => {
    it('is one pattern for the generator and the renderer', () => {
        expect(PLACEHOLDER.source).toBe(PLACEHOLDER_PATTERN.source);
        expect(PLACEHOLDER.flags).toBe(PLACEHOLDER_PATTERN.flags);
    });
});

describe('diagnosticPath', () => {
    it('names a file under the root relative to it, and any other as given', () => {
        expect(diagnosticPath('/repo/src/A.tsx', '/repo')).toBe('src/A.tsx');
        expect(diagnosticPath('/repo/src/A.tsx', '/repo/')).toBe('src/A.tsx');
        expect(diagnosticPath('/repository/A.tsx', '/repo')).toBe('/repository/A.tsx');
        expect(diagnosticPath('/repo/src/A.tsx')).toBe('/repo/src/A.tsx');
        expect(diagnosticPath('/elsewhere/A.tsx', '/repo')).toBe('/elsewhere/A.tsx');
        expect(diagnosticPath('C:\\repo\\A.tsx', 'C:\\repo')).toBe('A.tsx');
    });
});

describe('renderEngineDiagnostics', () => {
    it('keeps a suggestion an issue already carries', () => {
        const issue = {
            code: 'unknown-key',
            args: { key: 'workBreak', suggestion: 'mine' },
            line: 1,
            column: 1,
        } as SzDiagnosticIssue;
        const [message] = renderEngineDiagnostics([issue], 'src/A.tsx');
        expect(issue.args).toEqual({ key: 'workBreak', suggestion: 'mine' });
        expect(message).toContain('did you mean `mine`?');
    });
});

describe('szDiagnosticKey', () => {
    it('is empty for a code the registry does not know', () => {
        expect(szDiagnosticKey({ code: 'nope' as never, args: {} })).toBe('');
    });

    it('reads the args in registry order, whatever order they were written in', () => {
        expect(
            szDiagnosticKey({ code: 'property-object', args: { nestedKeys: ['x'], key: 'p' } }),
        ).toBe(szDiagnosticKey({ code: 'property-object', args: { key: 'p', nestedKeys: ['x'] } }));
        expect(szDiagnosticKey({ code: 'unknown-key', args: { key: 'a' } })).not.toBe(
            szDiagnosticKey({ code: 'unknown-key', args: { key: 'b' } }),
        );
    });
});
