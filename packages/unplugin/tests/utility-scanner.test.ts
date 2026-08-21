/**
 * Reading `@utility` declarations out of a project's CSS.
 *
 * The scanner has only ever read `@theme`. That was enough while a theme token
 * was the only way a project could claim a class name, but `@utility` claims
 * one directly, and Tailwind merges rather than refuses when the name is
 * already taken — measured: `@utility text-balance { letter-spacing: … }`
 * against stock Tailwind emits `letter-spacing` AND `text-wrap: balance`, with
 * no warning from anyone.
 *
 * Nothing can report that collision without first knowing which names the
 * project declares, which is what this reads.
 *
 * Two forms, and the difference matters. A static `@utility panel-flat` claims
 * exactly one class name. A functional `@utility pad-*` claims a namespace and
 * resolves its argument against the theme — comparing its literal text to a
 * class list would ask the wrong question, so the two are kept apart rather
 * than flattened into one list.
 */
import { describe, expect, it } from 'vitest';

import { parseUtilityBlocks } from '../src/theme-scanner.js';

describe('parseUtilityBlocks', () => {
    it('reads a static utility as one claimed class name', () => {
        const css = `@utility panel-flat {\n    box-shadow: none;\n}\n`;

        expect(parseUtilityBlocks(css)).toEqual({ statics: ['panel-flat'], functionals: [] });
    });

    it('reads a functional utility as a namespace, not a class name', () => {
        const css = `@utility pad-* {\n    padding: --value(--pad-*);\n}\n`;

        expect(parseUtilityBlocks(css)).toEqual({ statics: [], functionals: ['pad'] });
    });

    it('reads several declarations from one stylesheet', () => {
        const css = [
            '@import "tailwindcss";',
            '@theme {',
            '    --color-brand: #f00;',
            '}',
            '@utility panel-flat {',
            '    box-shadow: none;',
            '}',
            '@utility pad-* {',
            '    padding: --value(--pad-*);',
            '}',
            '@utility text-balance {',
            '    letter-spacing: 0.01em;',
            '}',
        ].join('\n');

        expect(parseUtilityBlocks(css)).toEqual({
            statics: ['panel-flat', 'text-balance'],
            functionals: ['pad'],
        });
    });

    it('reads a declaration nested in a layer', () => {
        // `@theme` already had to handle this, so a stylesheet that wraps one
        // wraps the other.
        const css = `@layer utilities {\n@utility panel-flat {\n    box-shadow: none;\n}\n}\n`;

        expect(parseUtilityBlocks(css).statics).toEqual(['panel-flat']);
    });

    it('survives a declaration body holding braces', () => {
        // A nested rule inside the body must not end the block early, or every
        // declaration after it is lost silently.
        const css = [
            '@utility card-raised {',
            '    box-shadow: 0 1px 2px #0001;',
            '    &:hover {',
            '        box-shadow: 0 4px 8px #0002;',
            '    }',
            '}',
            '@utility panel-flat {',
            '    box-shadow: none;',
            '}',
        ].join('\n');

        expect(parseUtilityBlocks(css).statics).toEqual(['card-raised', 'panel-flat']);
    });

    it('reports nothing for a stylesheet that declares none', () => {
        expect(
            parseUtilityBlocks('@import "tailwindcss";\n@theme {\n--color-a: #f00;\n}\n'),
        ).toEqual({ statics: [], functionals: [] });
    });

    it('ignores the word inside a comment or a string', () => {
        const css = [
            '/* @utility commented-out { color: red } */',
            '@utility real-one {',
            '    color: red;',
            '}',
        ].join('\n');

        expect(parseUtilityBlocks(css).statics).toEqual(['real-one']);
    });

    // Comment stripping is the step in front of every other rule here, so a
    // change to how it matches can silently move what the rest of the scanner
    // sees. These pin the shapes a naive pattern gets wrong.
    it('ends a comment at the first close, not the last', () => {
        const css = '/* one */ @utility a { color: red } /* two */ @utility b { color: red }';

        expect(parseUtilityBlocks(css).statics).toEqual(['a', 'b']);
    });

    it('reads stars inside a comment as comment text', () => {
        const css = '/** doc ** star * /* @utility hidden { color: red } */ @utility shown {}';

        expect(parseUtilityBlocks(css).statics).toEqual(['shown']);
    });

    it('leaves an unterminated comment in place rather than swallowing the rest', () => {
        // Not what CSS itself does, where an unclosed comment runs to EOF.
        // Pinned as it stands: a scanner that starts dropping declarations
        // after a stray `/*` would be a worse failure than reading one it
        // should have skipped, and changing it is not a ReDoS question.
        const css = '@utility before {}\n/* @utility after { color: red }';

        expect(parseUtilityBlocks(css).statics).toEqual(['before', 'after']);
    });

    it('keeps a bare slash or star that opens nothing', () => {
        const css = 'a { width: calc(1px * 2 / 3) }\n@utility kept { color: red }';

        expect(parseUtilityBlocks(css).statics).toEqual(['kept']);
    });

    it('joins the text either side of a comment with nothing between', () => {
        // The declaration only survives if the removed span is exactly the
        // comment: one character too few leaves the `/` glued to `@utility`
        // and one too many eats the space in front of the name, and either
        // way the at-rule stops matching and the utility disappears.
        const css = '@utility/* c */ name { color: red }';

        expect(parseUtilityBlocks(css).statics).toEqual(['name']);
    });

    it('does not let a comment close on the slash that opened it', () => {
        // `/*/` is one opener, not an opener and a closer. Searching for the
        // close from the star instead of past it ends the comment here and
        // exposes the declaration it was hiding.
        const css = '/*/ @utility hacked { color: red } */ @utility after { color: red }';

        expect(parseUtilityBlocks(css).statics).toEqual(['after']);
    });

    it('keeps an earlier comment stripped once a later one is found', () => {
        // Each kept span has to start where the previous comment ended. Copying
        // from the start of the source instead re-admits every comment already
        // dropped, so the first one's contents come back.
        const css =
            '/* @utility h1 { color: red } */ @utility keep1 { color: red }' +
            ' /* @utility h2 { color: red } */ @utility keep2 { color: red }';

        expect(parseUtilityBlocks(css).statics).toEqual(['keep1', 'keep2']);
    });
});

describe('parseUtilityBlocks — a declaration whose body never closes', () => {
    it('still claims the name, and stops rather than scanning the body again', () => {
        // A stylesheet mid-edit, or one with a brace missing. The name IS
        // claimed — that is what the collision report needs — and the scan has
        // to end: resuming inside a block with no close would find the same
        // declaration over and over.
        const css = '@utility panel-flat {\n    box-shadow: none;\n';

        expect(parseUtilityBlocks(css)).toEqual({ statics: ['panel-flat'], functionals: [] });
    });

    it('does not read a declaration buried in an unclosed body as a second one', () => {
        // Everything after the unclosed brace belongs to that body as far as
        // CSS is concerned, so nothing later is a declaration of its own.
        const css = '@utility outer {\n    @utility inner {\n        color: red;\n';

        expect(parseUtilityBlocks(css).statics).toEqual(['outer']);
    });
});
