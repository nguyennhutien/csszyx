/**
 * The diagnostic renderer and its computed values (ADR 0031).
 */
import { describe, expect, it } from 'vitest';

import { COMPUTED } from '../../../scripts/diagnostics/registry.mjs';
import { casingProblems, PLACEHOLDER_PATTERN } from '../../../scripts/gen-diagnostic-codes.mjs';
import { PLACEHOLDER } from '../src/diagnostic-placeholder.js';
import { SZ_DIAGNOSTIC_COMPUTED } from '../src/diagnostic-registry.generated.js';
import {
    isSzDiagnosticId,
    renderSzDiagnostic,
    renderSzDiagnosticBody,
    renderSzDiagnosticParts,
} from '../src/diagnostic-render.js';
import { SZ_DIAGNOSTIC_COMPUTED_VALUES } from '../src/diagnostic-render-helpers.js';
import {
    diagnosticPath,
    renderEngineDiagnostics,
    renderUnplacedDiagnostic,
    szDiagnosticKey,
} from '../src/engine-diagnostics.js';
import type { SzDiagnosticIssue } from '../src/engine-spans.js';
import { SZ_FALLBACK_KINDS } from '../src/sz-fallback-matrix.js';
import { MIGRATION_NOTES } from '../src/transform-core.js';

const computed = SZ_DIAGNOSTIC_COMPUTED_VALUES;

describe('renderSzDiagnosticParts', () => {
    it('returns each part bare, for a sink to lay out', () => {
        expect(
            renderSzDiagnosticParts({ code: 'canonical-key', args: { key: 'padding' } }, computed),
        ).toEqual({
            text: '`padding` is an alias of `p`, and nothing is emitted for it.',
            help: 'write `p`.',
            docs: 'https://csszyx.com/e/canonical-key',
        });
        expect(
            renderSzDiagnosticParts({ code: 'runtime-value', args: { key: 'gridArea' } }, computed),
        ).toEqual({
            text: '`gridArea` cannot take a runtime value: Tailwind has no utility for this key that reads a CSS variable.',
            help: 'name the values with `szv()`, or use `dynamic()` for open-ended data.',
            note: 'no class or variable is emitted for `gridArea`.',
            docs: 'https://csszyx.com/e/runtime-value',
        });
    });

    it('leaves out a field the code has no template for', () => {
        const noNote = renderSzDiagnosticParts({ code: 'unresolvable-spread', args: {} }, computed);
        expect(Object.keys(noNote)).toEqual(['text', 'help', 'docs']);
        const noHelp = renderSzDiagnosticParts(
            {
                code: 'mangle-vars-hoist-skipped',
                args: { name: '--cz', usageCount: 2, reason: 'no-lca' },
            },
            computed,
        );
        expect(Object.keys(noHelp)).toEqual(['text', 'note', 'docs']);
    });

    it('lays the terminal body out from the same parts', () => {
        const diagnostic = { code: 'runtime-value', args: { key: 'gridArea' } } as const;
        const { text, help, note } = renderSzDiagnosticParts(diagnostic, computed);
        expect(renderSzDiagnosticBody(diagnostic, computed)).toBe(
            `${text}\n  help: ${help}\n  note: ${note}`,
        );
    });
});

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
        expect(body).toContain('more than 5 levels below');
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
        expect(computed.spellingHint?.({ suggestion: 'break' })).toBe(
            'write `break` if you meant it',
        );
        expect(computed.spellingHint?.({})).toBe('check the spelling');
        expect(computed.parserMessage?.({ message: 'Unexpected token.' })).toBe('Unexpected token');
        expect(computed.parserMessage?.({ message: 'Unexpected token' })).toBe('Unexpected token');
        expect(computed.parserMessage?.({})).toBe('');
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

/**
 * The parts of a rendered body: its text, then each labelled line.
 *
 * @param body - A body as `renderSzDiagnosticBody` returns it.
 * @returns The fields that render, by name.
 */
function partsOf(body: string): Array<['text' | 'help' | 'note', string]> {
    const [text = '', ...rest] = body.split('\n  ');
    return [
        ['text', text],
        ...rest.map(line => {
            const [label, ...value] = line.split(': ');
            return [label as 'help' | 'note', value.join(': ')] as ['help' | 'note', string];
        }),
    ];
}

describe('the text composed at render time', () => {
    // The generator checks every template, but a computed value, a migration
    // note or a fallback-matrix entry is only text once rendered.
    const bodies: Array<[string, string]> = [
        ...[{}, { suggestion: 'wordBreak' }].map(
            extra =>
                [
                    'unknown-key',
                    renderSzDiagnosticBody(
                        { code: 'unknown-key', args: { key: 'workBreak', ...extra } },
                        computed,
                    ),
                ] as [string, string],
        ),
        ...Object.keys(MIGRATION_NOTES).map(
            key =>
                [
                    `removed-key ${key}`,
                    renderSzDiagnosticBody(
                        { code: 'removed-key', args: { form: 'removed', key } },
                        computed,
                    ),
                ] as [string, string],
        ),
        ...SZ_FALLBACK_KINDS.flatMap(shape =>
            (
                [
                    ['fallback-missing-css', ['sz', 'szr', 'sz-variant-key']],
                    ['fallback-nudge', ['sz']],
                ] as const
            ).flatMap(([code, sites]) =>
                sites.map(
                    site =>
                        [
                            `${code} ${site} ${shape}`,
                            renderSzDiagnosticBody(
                                {
                                    code,
                                    args: { site, shape, detail: 'x', path: 'p', keyPath: 'k' },
                                },
                                computed,
                            ),
                        ] as [string, string],
                ),
            ),
        ),
        ...['Unexpected token', 'Expected `}`.'].map(
            message =>
                [
                    'parse-error syntax',
                    renderSzDiagnosticBody(
                        { code: 'parse-error', args: { form: 'syntax', message } },
                        computed,
                    ),
                ] as [string, string],
        ),
    ];

    it.each(bodies)('keeps the casing rule: %s', (_, body) => {
        expect(body).not.toBe('');
        for (const [field, value] of partsOf(body)) {
            if (value === '') continue;
            expect(casingProblems(field, value), `${field}: ${value}`).toEqual([]);
        }
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

    it('matches a Windows root whatever its separators and drive-letter case', () => {
        expect(diagnosticPath('C:\\repo\\src\\A.tsx', 'C:/repo')).toBe('src\\A.tsx');
        expect(diagnosticPath('C:/repo/src/A.tsx', 'C:\\repo\\')).toBe('src/A.tsx');
        expect(diagnosticPath('c:\\Repo\\A.tsx', 'C:\\repo')).toBe('A.tsx');
        expect(diagnosticPath('D:\\repo\\A.tsx', 'C:\\repo')).toBe('D:\\repo\\A.tsx');
        expect(diagnosticPath('C:\\repository\\A.tsx', 'c:\\repo')).toBe('C:\\repository\\A.tsx');
        expect(diagnosticPath('c:\\A.tsx', 'C:\\')).toBe('A.tsx');
        expect(diagnosticPath('C:\\\u0130x\\A.tsx', 'C:\\i\u0307x')).toBe('C:\\\u0130x\\A.tsx');
    });

    it('keeps the case of a POSIX root significant', () => {
        expect(diagnosticPath('/Repo/A.tsx', '/repo')).toBe('/Repo/A.tsx');
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
        expect(message).toContain('write `mine` if you meant it;');
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

    it('keys an absent optional arg apart from a present one', () => {
        const args = { elementName: 'div', classes: ['a'], szCount: 1, szAt: 0, parts: ['x'] };

        expect(szDiagnosticKey({ code: 'spread-split-class', args })).not.toBe(
            szDiagnosticKey({ code: 'spread-split-class', args: { ...args, spread: 'props' } }),
        );
    });

    it("is the same before and after rendering fills an unknown key's suggestion", () => {
        expect(
            szDiagnosticKey({
                code: 'unknown-key',
                args: { key: 'workBreak', suggestion: 'break' },
            }),
        ).toBe(szDiagnosticKey({ code: 'unknown-key', args: { key: 'workBreak' } }));
    });
});

describe('isSzDiagnosticId', () => {
    it('knows every live id on any surface, and nothing else', () => {
        expect(isSzDiagnosticId('unknown-key')).toBe(true);
        expect(isSzDiagnosticId('hydration-aborted')).toBe(true);
        expect(isSzDiagnosticId('sz-diagnostic')).toBe(false);
        expect(isSzDiagnosticId('CSSZYX_NATIVE_UNAVAILABLE')).toBe(false);
    });

    it('renders a template of an id the engine does not report', () => {
        expect(
            renderSzDiagnosticBody(
                { code: 'config-id-not-settable', args: { id: 'internal-error' } },
                SZ_DIAGNOSTIC_COMPUTED_VALUES,
            ),
        ).toMatch(
            /^`internal-error` is printed to the console or thrown, .*\n {2}help: remove it;/,
        );
    });
});
