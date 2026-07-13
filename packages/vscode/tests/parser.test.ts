/**
 * Parser tests — cover both JSX (`sz={{ ... }}`) and HTML attribute
 * (`sz="{...}"`, `sz='{...}'`) forms.
 *
 * These are pure-function tests; no VS Code APIs involved.
 */

import { describe, expect, it } from 'vitest';

import {
    extractSzObjectAt,
    findSzExpressionAt,
    findSzExpressions,
    parseSzContext,
} from '../src/parser.js';

describe('parseSzContext — JSX form', () => {
    it('returns none outside any sz expression', () => {
        expect(parseSzContext('<div className="foo">').type).toBe('none');
        expect(parseSzContext('const x = 1;').type).toBe('none');
    });

    it('returns none after a closed sz expression', () => {
        expect(parseSzContext('<div sz={{ p: 4 }}>').type).toBe('none');
    });

    it('returns key at top-level of an empty object', () => {
        const ctx = parseSzContext('<div sz={{ ');
        expect(ctx.type).toBe('key');
        expect(ctx.depth).toBe(1);
    });

    it('returns key when typing a new prop name', () => {
        const ctx = parseSzContext('<div sz={{ p: 4, b');
        expect(ctx.type).toBe('key');
    });

    it('returns value with currentKey after a colon at top-level', () => {
        const ctx = parseSzContext('<div sz={{ p: ');
        expect(ctx.type).toBe('value');
        expect(ctx.currentKey).toBe('p');
    });

    it('returns variant-key inside a nested variant object', () => {
        const ctx = parseSzContext('<div sz={{ hover: { ');
        expect(ctx.type).toBe('variant-key');
        expect(ctx.depth).toBe(2);
    });

    it('returns variant-value inside a nested variant after a colon', () => {
        const ctx = parseSzContext('<div sz={{ hover: { bg: ');
        expect(ctx.type).toBe('variant-value');
        expect(ctx.currentKey).toBe('bg');
    });

    it('goes back to top-level key after closing a variant object', () => {
        const ctx = parseSzContext('<div sz={{ hover: { bg: "red" }, ');
        expect(ctx.type).toBe('key');
        expect(ctx.depth).toBe(1);
    });

    it('ignores colons inside strings', () => {
        const ctx = parseSzContext('<div sz={{ "a:b": ');
        // String key isn't a bare identifier — walker treats the whole
        // segment as "not a key", so no key is captured.
        expect(ctx.type).toBe('key');
    });

    it('ignores colons inside arbitrary value brackets', () => {
        const ctx = parseSzContext('<div sz={{ p: [calc(100%-2px)], ');
        expect(ctx.type).toBe('key');
    });

    it('balances nested brackets inside an arbitrary value', () => {
        const ctx = parseSzContext('<div sz={{ w: [minmax(0,arr[i]):x], ');
        expect(ctx.type).toBe('key');
        expect(ctx.depth).toBe(1);
    });
});

describe('parseSzContext — HTML attribute form (double quote)', () => {
    it('returns key at top-level of an empty HTML attr', () => {
        const ctx = parseSzContext('<div sz="{ ');
        expect(ctx.type).toBe('key');
        expect(ctx.depth).toBe(1);
    });

    it('returns value with currentKey after a colon', () => {
        const ctx = parseSzContext('<div sz="{ bg: ');
        expect(ctx.type).toBe('value');
        expect(ctx.currentKey).toBe('bg');
    });

    it('returns variant-key inside nested variant', () => {
        const ctx = parseSzContext('<div sz="{ hover: { ');
        expect(ctx.type).toBe('variant-key');
        expect(ctx.depth).toBe(2);
    });

    it('returns variant-value after colon inside nested variant', () => {
        const ctx = parseSzContext('<div sz="{ hover: { bg: ');
        expect(ctx.type).toBe('variant-value');
        expect(ctx.currentKey).toBe('bg');
    });

    it('returns none after the closing }" of the attribute', () => {
        expect(parseSzContext('<div sz="{ p: 4 }"').type).toBe('none');
    });

    it('handles single-quoted string values inside the attribute', () => {
        const ctx = parseSzContext("<div sz=\"{ bg: 'blue-500', ");
        expect(ctx.type).toBe('key');
    });
});

describe('parseSzContext — HTML implicit form (no outer braces)', () => {
    it('returns key at start of an implicit attr', () => {
        const ctx = parseSzContext('<div sz="');
        expect(ctx.type).toBe('key');
        expect(ctx.depth).toBe(1);
    });

    it('returns key while typing a prop name', () => {
        const ctx = parseSzContext('<div sz="b');
        expect(ctx.type).toBe('key');
    });

    it('returns value with currentKey after a colon', () => {
        const ctx = parseSzContext('<div sz="bg: ');
        expect(ctx.type).toBe('value');
        expect(ctx.currentKey).toBe('bg');
    });

    it('returns key after a comma (next prop)', () => {
        const ctx = parseSzContext("<div sz=\"bg: 'red', ");
        expect(ctx.type).toBe('key');
        expect(ctx.depth).toBe(1);
    });

    it('returns variant-key inside nested variant', () => {
        const ctx = parseSzContext('<div sz="hover: { ');
        expect(ctx.type).toBe('variant-key');
        expect(ctx.depth).toBe(2);
    });

    it('returns variant-value after colon inside variant', () => {
        const ctx = parseSzContext('<div sz="hover: { bg: ');
        expect(ctx.type).toBe('variant-value');
        expect(ctx.currentKey).toBe('bg');
    });

    it('returns none after the attribute closing quote', () => {
        expect(parseSzContext('<div sz="bg: \'red\'"').type).toBe('none');
    });

    it('also works with single-quoted attribute', () => {
        const ctx = parseSzContext("<div sz='color: ");
        expect(ctx.type).toBe('value');
        expect(ctx.currentKey).toBe('color');
    });
});

describe('parseSzContext — HTML attribute form (single quote)', () => {
    it('returns key at top-level of a single-quoted attribute', () => {
        const ctx = parseSzContext("<div sz='{ ");
        expect(ctx.type).toBe('key');
    });

    it('returns value with currentKey after colon', () => {
        const ctx = parseSzContext("<div sz='{ color: ");
        expect(ctx.type).toBe('value');
        expect(ctx.currentKey).toBe('color');
    });

    it('handles double-quoted string values inside a single-quoted attribute', () => {
        const ctx = parseSzContext('<div sz=\'{ bg: "blue-500", ');
        expect(ctx.type).toBe('key');
    });
});

describe('parseSzContext — picks the rightmost open expression', () => {
    it('prefers a later HTML open over an earlier closed JSX', () => {
        const ctx = parseSzContext('<div sz={{ p: 4 }}><span sz="{ bg: ');
        expect(ctx.type).toBe('value');
        expect(ctx.currentKey).toBe('bg');
    });

    it('prefers a later JSX open over an earlier closed HTML', () => {
        const ctx = parseSzContext('<div sz="{ p: 4 }"><span sz={{ color: ');
        expect(ctx.type).toBe('value');
        expect(ctx.currentKey).toBe('color');
    });
});

describe('findSzExpressions', () => {
    it('extracts a single JSX object', () => {
        const res = findSzExpressions('<div sz={{ p: 4 }} />');
        expect(res).toHaveLength(1);
        expect(res[0].objText).toBe('{ p: 4 }');
    });

    it('extracts a single HTML attribute object (double quote)', () => {
        const res = findSzExpressions('<div sz="{ p: 4 }">');
        expect(res).toHaveLength(1);
        expect(res[0].objText).toBe('{ p: 4 }');
    });

    it('extracts a single HTML attribute object (single quote)', () => {
        const res = findSzExpressions("<div sz='{ p: 4 }'>");
        expect(res).toHaveLength(1);
        expect(res[0].objText).toBe('{ p: 4 }');
    });

    it('extracts multiple expressions in the same text', () => {
        const res = findSzExpressions('<a sz={{ p: 1 }}></a><b sz="{ p: 2 }"></b>');
        expect(res).toHaveLength(2);
        expect(res[0].objText).toBe('{ p: 1 }');
        expect(res[1].objText).toBe('{ p: 2 }');
    });

    it('handles nested variant objects inside JSX', () => {
        const res = findSzExpressions('<div sz={{ hover: { bg: "red" } }} />');
        expect(res).toHaveLength(1);
        expect(res[0].objText).toBe('{ hover: { bg: "red" } }');
    });

    it('handles nested variant objects inside HTML attribute', () => {
        const res = findSzExpressions('<div sz="{ hover: { bg: \'red\' } }">');
        expect(res).toHaveLength(1);
        expect(res[0].objText).toBe("{ hover: { bg: 'red' } }");
    });

    it('skips braces inside string values', () => {
        // A stray `}` inside a string must not terminate the object early.
        const res = findSzExpressions('<div sz={{ css: "a}b" }} />');
        expect(res).toHaveLength(1);
        expect(res[0].objText).toBe('{ css: "a}b" }');
    });

    it('records the correct startOffset for later range calculations', () => {
        const text = '   <div sz="{ p: 4 }">';
        const res = findSzExpressions(text);
        expect(res[0].startOffset).toBe(text.indexOf('{'));
    });
});

describe('findSzExpressions — implicit form', () => {
    it('extracts an implicit double-quoted attribute', () => {
        const text = '<div sz="bg: \'red\', p: 4">';
        const res = findSzExpressions(text);
        expect(res).toHaveLength(1);
        expect(res[0].objText).toBe("bg: 'red', p: 4");
        expect(res[0].needsWrap).toBe(true);
        expect(res[0].startOffset).toBe(text.indexOf('bg'));
    });

    it('extracts an implicit single-quoted attribute', () => {
        const text = '<div sz=\'bg: "red"\'>';
        const res = findSzExpressions(text);
        expect(res).toHaveLength(1);
        expect(res[0].objText).toBe('bg: "red"');
        expect(res[0].needsWrap).toBe(true);
    });

    it('marks explicit forms as not-needing-wrap', () => {
        const res = findSzExpressions('<div sz="{ p: 4 }">');
        expect(res[0].needsWrap).toBe(false);
    });

    it('treats whitespace-then-{ as explicit (runtime does too)', () => {
        const text = '<div sz="  { p: 4 }">';
        const res = findSzExpressions(text);
        expect(res[0].needsWrap).toBe(false);
        expect(res[0].objText).toBe('{ p: 4 }');
    });

    it('extracts two implicit attributes on one line', () => {
        const text = '<a sz="p: 1"></a><b sz="p: 2"></b>';
        const res = findSzExpressions(text);
        expect(res).toHaveLength(2);
        expect(res[0].objText).toBe('p: 1');
        expect(res[1].objText).toBe('p: 2');
    });
});

describe('findSzExpressionAt', () => {
    it('returns needsWrap=true for cursor inside an implicit attr', () => {
        const text = '<div sz="bg: \'red\'">';
        const cursor = text.indexOf('bg');
        const hit = findSzExpressionAt(text, cursor);
        expect(hit?.needsWrap).toBe(true);
    });

    it('returns needsWrap=false for cursor inside an explicit attr', () => {
        const text = '<div sz="{ bg: \'red\' }">';
        const cursor = text.indexOf('bg');
        const hit = findSzExpressionAt(text, cursor);
        expect(hit?.needsWrap).toBe(false);
    });
});

describe('parseSzContext — string escapes and call forms', () => {
    it('skips escaped quotes inside string values', () => {
        const ctx = parseSzContext("<div sz={{ content: 'a\\'b', ");
        expect(ctx.type).toBe('key');
        expect(ctx.depth).toBe(1);
    });

    it('recognizes szv through a member access (csszyx.szv)', () => {
        const ctx = parseSzContext('csszyx.szv({ base: { bg: ');
        expect(ctx.form).toBe('szv');
        expect(ctx.type).toBe('variant-value');
    });

    it('rejects szv-lookalike identifiers (myszv is not a csszyx call)', () => {
        expect(parseSzContext('myszv({ p: ').type).toBe('none');
    });

    it('rejects szv( not followed by an object literal', () => {
        expect(parseSzContext('szv(options, ').type).toBe('none');
    });

    it('treats whitespace-then-{ as explicit in both attribute quote styles', () => {
        const dq = parseSzContext('<div sz="  { bg: ');
        expect(dq.type).toBe('value');
        expect(dq.currentKey).toBe('bg');
        const sq = parseSzContext("<div sz='  { bg: ");
        expect(sq.type).toBe('value');
        expect(sq.currentKey).toBe('bg');
    });
});

describe('findSzExpressions — unterminated and escaped input', () => {
    it('returns nothing for an unterminated explicit object', () => {
        expect(findSzExpressions('<div sz={{ p: 4')).toEqual([]);
    });

    it('returns nothing for an unterminated implicit attribute', () => {
        expect(findSzExpressions('<div sz="p: 4')).toEqual([]);
    });

    it('continues past an unterminated expression to a later complete one', () => {
        const res = findSzExpressions('<div sz={{ p: 4 <div sz={{ m: 2 }} />');
        expect(res).toHaveLength(1);
        expect(res[0].objText).toBe('{ m: 2 }');
    });

    it('treats whitespace-then-{ as explicit in a single-quoted attribute', () => {
        const res = findSzExpressions("<div sz=' { p: 4 }'>");
        expect(res).toHaveLength(1);
        expect(res[0].objText).toBe('{ p: 4 }');
        expect(res[0].needsWrap).toBe(false);
    });

    it('skips escaped quotes inside strings of an explicit object', () => {
        // The escaped quote must not end the string early — the following
        // `}` sits inside the string and must not close the object.
        const text = "<div sz={{ content: 'a\\'}b' }} />";
        const res = findSzExpressions(text);
        expect(res).toHaveLength(1);
        expect(res[0].objText).toBe("{ content: 'a\\'}b' }");
    });

    it('skips escaped quotes inside nested strings of an implicit attribute', () => {
        const text = "<div sz=\"content: 'a\\'b', p: 4\">";
        const res = findSzExpressions(text);
        expect(res).toHaveLength(1);
        expect(res[0].objText).toBe("content: 'a\\'b', p: 4");
        expect(res[0].needsWrap).toBe(true);
    });
});

describe('extractSzObjectAt', () => {
    it('returns the object enclosing the cursor', () => {
        const text = '<div sz="{ p: 4 }">';
        const cursor = text.indexOf('p');
        expect(extractSzObjectAt(text, cursor)).toBe('{ p: 4 }');
    });

    it('returns null when cursor is outside every sz expression', () => {
        const text = '<div sz={{ p: 4 }}> outside';
        const cursor = text.indexOf('outside');
        expect(extractSzObjectAt(text, cursor)).toBeNull();
    });

    it('picks the expression containing the cursor when multiple exist', () => {
        const text = '<a sz={{ p: 1 }}></a><b sz="{ color: \'red\' }"></b>';
        const cursor = text.indexOf('color');
        expect(extractSzObjectAt(text, cursor)).toBe("{ color: 'red' }");
    });

    it('wraps implicit form with `{ ... }` for eval safety', () => {
        const text = '<div sz="bg: \'red\', p: 4">';
        const cursor = text.indexOf('bg');
        expect(extractSzObjectAt(text, cursor)).toBe("{ bg: 'red', p: 4 }");
    });
});
