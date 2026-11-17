/**
 * The CSS reader every pass that skips comments and strings shares, read as
 * CSS Syntax Level 3 tokenizes them: a comment runs to `*\/` or the end of the
 * text, and a string to its quote, an unescaped line break, or the end.
 */
import { describe, expect, it } from 'vitest';
import { cpuMs } from '../../core/tests/helpers/cpu-time.js';
import {
    cssCommentEnd,
    cssOpaqueEnd,
    cssStringEnd,
    stripCssBlockComments,
} from '../src/css-comments.js';

describe('cssCommentEnd', () => {
    it('ends after `*/`, or at the end of the text when the comment never closes', () => {
        expect(cssCommentEnd('a /* b */ c', 2)).toBe(9);
        expect(cssCommentEnd('/**/', 0)).toBe(4);
        expect(cssCommentEnd('/* open', 0)).toBe(7);
    });
});

describe('cssStringEnd', () => {
    it('ends after its quote, at an unescaped line break, or at the end', () => {
        expect(cssStringEnd('"a" b', 0)).toBe(3);
        expect(cssStringEnd(`'a\\'b' c`, 0)).toBe(6);
        expect(cssStringEnd('"a\nb"', 0)).toBe(2);
        // An escaped line break continues the string.
        expect(cssStringEnd('"a\\\nb" c', 0)).toBe(6);
        expect(cssStringEnd('"open', 0)).toBe(5);
    });
});

describe('cssOpaqueEnd', () => {
    it('skips a comment, a string or an escape, and nothing else', () => {
        expect(cssOpaqueEnd('a /* b */ c', 2)).toBe(9);
        expect(cssOpaqueEnd('a "b" c', 2)).toBe(5);
        expect(cssOpaqueEnd(".a\\'b", 2)).toBe(4);
        expect(cssOpaqueEnd('a\\', 1)).toBe(2);
        expect(cssOpaqueEnd('a / b', 2)).toBe(-1);
        expect(cssOpaqueEnd('a b', 0)).toBe(-1);
    });
});

describe('stripCssBlockComments', () => {
    it('removes every comment, the last to the end when it never closes', () => {
        expect(stripCssBlockComments('a /* x */ b /* y */c')).toBe('a  b c');
        expect(stripCssBlockComments('@utility a {} /* @utility b {}')).toBe('@utility a {} ');
        expect(stripCssBlockComments('no comment')).toBe('no comment');
    });

    it('can leave a comment that never closes, and the rest, as written', () => {
        const css = '@utility a {} /* x */ @utility b {} /* @utility c {}';
        expect(stripCssBlockComments(css, { unterminated: 'keep' })).toBe(
            '@utility a {}  @utility b {} /* @utility c {}',
        );
        // A closing `*/` that ends the text closes the comment.
        expect(stripCssBlockComments('a /* b */', { unterminated: 'keep' })).toBe('a ');
        // `/*/` opens a comment and does not close it.
        expect(stripCssBlockComments('a{} /*/', { unterminated: 'keep' })).toBe('a{} /*/');
        expect(stripCssBlockComments('/*/', { unterminated: 'keep' })).toBe('/*/');
        expect(stripCssBlockComments('a /*/ b */', { unterminated: 'keep' })).toBe('a ');
    });

    it('keeps a comment opener inside a string as text', () => {
        expect(stripCssBlockComments('a { content: "/*"; } /* x */ @utility b {}')).toBe(
            'a { content: "/*"; }  @utility b {}',
        );
        expect(stripCssBlockComments("a { content: '*/ /*' } b")).toBe("a { content: '*/ /*' } b");
    });

    it('reads an escaped quote outside a string as text, not as a string', () => {
        expect(stripCssBlockComments(".quote\\'s { color: red } /* @utility old {} */ b")).toBe(
            ".quote\\'s { color: red }  b",
        );
        expect(stripCssBlockComments('.a\\"b {} /* c */')).toBe('.a\\"b {} ');
    });

    it('stays linear on an unterminated comment opener repeated', () => {
        const hostile = `/*${'a/*'.repeat(200_000)}`;
        const start = cpuMs();
        expect(stripCssBlockComments(hostile)).toBe('');
        expect(cpuMs() - start).toBeLessThan(1000);
    });
});
