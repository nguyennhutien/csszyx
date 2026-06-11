import { describe, expect, it } from 'vitest';
import {
    escapeForDoubleQuotedString,
    escapeJsonForInlineScript,
} from '../src/inline-script-escape.js';

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

describe('escapeJsonForInlineScript', () => {
    it('removes every template-literal and script-tag terminator', () => {
        const nasty = {
            "[content:'</script>']": 'a',
            '[content:springs`${alert(1)}`]': 'b',
            [`x${LS}y${PS}z`]: 'c',
        };
        const escaped = escapeJsonForInlineScript(JSON.stringify(nasty));

        expect(escaped).not.toContain('`');
        expect(escaped).not.toContain('$');
        expect(escaped).not.toContain('<');
        expect(escaped).not.toContain(LS);
        expect(escaped).not.toContain(PS);
    });

    it('keeps the JSON parse-identical', () => {
        const map = {
            "[content:'</script>']": 'z9',
            'hover:bg-blue-500/40': 'a',
            [`weird${LS}key\`\${}`]: 'b',
        };
        const json = JSON.stringify(map);
        const escaped = escapeJsonForInlineScript(json);

        expect(JSON.parse(escaped)).toEqual(map);
    });

    it('is inert inside a template literal (the debug-script context)', () => {
        const map = { '[content:springs`${(globalThis.pwned = true)}`]': 'a' };
        const escaped = escapeJsonForInlineScript(JSON.stringify(map));

        // Paste into a template literal exactly like the injected debug
        // script does, evaluate it, and reconstruct the embedded object.
        // Interpolation must NOT have executed.
        // biome-ignore lint/security/noGlobalEval: evaluating the generated construct is the property under test
        const body = eval(`\`var m=${escaped};\``) as string;
        expect((globalThis as Record<string, unknown>).pwned).toBeUndefined();
        // biome-ignore lint/security/noGlobalEval: reconstructs the embedded object to prove value equivalence
        const reconstructed = eval(`(${body.slice('var m='.length, -1)})`) as unknown;
        expect(reconstructed).toEqual(map);
    });

    it('leaves ordinary mangle maps byte-identical', () => {
        const map = { 'p-4': 'a', 'hover:bg-blue-500/40': 'b', 'md:flex': 'c' };
        const json = JSON.stringify(map);

        expect(escapeJsonForInlineScript(json)).toBe(json);
    });
});

describe('escapeForDoubleQuotedString', () => {
    it('escapes backslashes before quotes so the value survives the eval() reparse', () => {
        const map = { "[content:'</script>']": 'z', 'a`b${c}': 'y' };
        // Production path: inline-script escape, then double-quote-string escape
        // for the webpack-dev eval("...") wrapper.
        const embedded = escapeForDoubleQuotedString(
            escapeJsonForInlineScript(JSON.stringify(map)),
        );

        // The outer eval string parse must yield back the inline-script-escaped
        // JSON exactly — including the \uXXXX escapes (so `<` stays neutralised).
        // biome-ignore lint/security/noGlobalEval: reparsing the embedded string is the property under test
        const afterEvalParse = eval(`"${embedded}"`) as string;
        expect(afterEvalParse).toBe(escapeJsonForInlineScript(JSON.stringify(map)));
        expect(afterEvalParse).not.toContain('<');
        expect(JSON.parse(afterEvalParse)).toEqual(map);
    });

    it('is a no-op for strings with no backslashes or quotes', () => {
        expect(escapeForDoubleQuotedString('p-4 md:flex')).toBe('p-4 md:flex');
    });
});
