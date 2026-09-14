/**
 * Stable kinds for engine diagnostics.
 *
 * A CI gate that wants "typo'd keys fail, precedence advisories do not" had to
 * match the English of each message, and a reworded message turned that gate
 * green without a word. The kind is read here, next to the wording, so every
 * kind below is pinned by source the real engines diagnose: rewording a message
 * without updating its kind fails this file instead of a user's pipeline.
 */
import { describe, expect, it } from 'vitest';

import {
    isAdvisorySzDiagnostic,
    SZ_DIAGNOSTIC_KIND_IDS,
    szDiagnosticKindOf,
} from '../src/sz-diagnostic-kind.js';
import { ENGINES } from './engine-parity-harness.js';

/**
 * One source per kind, each diagnosed by the engines themselves. Every id the
 * classifier can name, `other` aside, must appear here: an id no source reaches
 * is an id `csszyx check --rule` would accept and never select.
 */
const ENGINE_SOURCES: Readonly<Record<string, string>> = {
    'unknown-key': 'export const A = () => <div sz={{ xyzzy: 4 }} />;',
    'canonical-key': "export const A = () => <div sz={{ backgroundColor: 'red-500' }} />;",
    'removed-key': "export const A = () => <div sz={{ maskFrom: '10%' }} />;",
    'numeric-key': "export const A = () => <div sz={{ 0: 'x' }} />;",
    'closed-enum-value': "export const A = () => <div sz={{ display: 'bogus' }} />;",
    'off-scale-value': 'export const A = () => <div sz={{ p: 1.3 }} />;',
    'numeric-font-weight': "export const A = () => <div sz={{ weight: '700' }} />;",
    'per-side-border-style':
        "export const A = () => <div sz={{ hover: { borderT: 'dashed' } }} />;",
    'property-object': 'export const A = () => <div sz={{ p: { x: 4 } }} />;',
    'non-variant-object': 'export const A = () => <div sz={{ container: { x: 1 } }} />;',
    'unknown-field': 'export const A = () => <div sz={{ maskLinear: { zzz: 1 } }} />;',
    'runtime-value': 'export const A = ({ v }) => <div sz={{ alignContent: v }} />;',
    'unresolvable-spread': 'export const A = (props) => <div sz={{ ...props.x, p: 4 }} />;',
    'style-override':
        'export const A = ({ width, props }) => <div sz={{ w: width }} {...props} />;',
    'szs-slot-map': 'export const A = () => <div szs={{ a: { p: 4 } }} />;',
    'sz-recover': 'export const A = ({ m }) => <div szRecover={m} sz={{ p: 4 }} />;',
    'class-precedence':
        'export const A = (props) => <div className={props.className} sz={{ p: 4 }} />;',
    'duplicate-sz': 'export const A = () => <div sz={{ p: 4 }} sz={{ m: 2 }} />;',
};

describe('SZ_DIAGNOSTIC_KIND_IDS', () => {
    it('has an engine-diagnosed source for every kind it names', () => {
        expect(Object.keys(ENGINE_SOURCES).sort()).toEqual(
            SZ_DIAGNOSTIC_KIND_IDS.filter(id => id !== 'other').sort(),
        );
    });

    it('ends with other, the kind of a message no matcher accepts', () => {
        expect(SZ_DIAGNOSTIC_KIND_IDS.at(-1)).toBe('other');
    });
});

describe.each(ENGINES)('diagnostic kinds — %s', (_name, transform) => {
    it.each(Object.entries(ENGINE_SOURCES))(
        'reads %s from what the engine renders',
        (kind, source) => {
            const diagnostics = transform(source, '/p/src/A.tsx').diagnostics ?? [];

            expect(diagnostics.map(szDiagnosticKindOf)).toContain(kind);
        },
    );
});

describe('advisory diagnostics', () => {
    it.each([
        '[csszyx] "sz" takes precedence over the runtime "className" on this element at src/A.tsx:1, whatever order the attributes are written.',
        '[csszyx] <div> at src/A.tsx:1:22 carries 2 `sz` attributes; they were merged as sz={[first, …, last]}, later wins per property.',
        '[csszyx] mangleVars skipped component CSS variable hoist for --v-x across 3 usages: no-lca',
        'sz fallback at 4:39: function call `t()` result is unknown',
    ])('calls a note about styles that are present advisory: %s', message => {
        expect(isAdvisorySzDiagnostic(message)).toBe(true);
    });

    it.each([
        'sz fallback at 2:38: imported binding `imported` could not be read at build time.',
        '[csszyx] Unknown property "zzz" in sz prop at src/A.tsx:1. The class is still emitted.',
        'unresolvable sz spread at 2:10',
        '[csszyx] parse error in /p/src/A.tsx: the native engine could not fully scan this file (1 syntax error(s))',
    ])('does not call a report of absent styles advisory: %s', message => {
        expect(isAdvisorySzDiagnostic(message)).toBe(false);
    });

    it('reads a message the same with or without its tag', () => {
        // `csszyx check` strips the tag before reporting; the bundler does not.
        const tagged =
            '[csszyx] Use the canonical key "bg" instead of "backgroundColor" at a.tsx:1.';

        expect(szDiagnosticKindOf(tagged.replace('[csszyx] ', ''))).toBe(
            szDiagnosticKindOf(tagged),
        );
        expect(szDiagnosticKindOf(tagged)).toBe('canonical-key');
    });

    it('names no kind for notes `csszyx check` never reports', () => {
        // A runtime fallback carries no `[csszyx]` tag and the mangleVars note
        // needs an option `check` does not pass. A kind for either would be an
        // id `--rule` accepts and can never select.
        for (const message of [
            'sz fallback at 4:39: function call `t()` result is unknown',
            'sz fallback at 2:38: imported binding `imported` could not be read at build time.',
            '[csszyx] mangleVars skipped component CSS variable hoist for --v-x across 3 usages: no-lca',
            'prescan skipped: AST budget exceeded',
        ]) {
            expect(szDiagnosticKindOf(message)).toBe('other');
        }
    });
});
