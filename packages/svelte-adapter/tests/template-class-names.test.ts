/**
 * `templateClassNames` reads the class names a component puts in the DOM as
 * Svelte parses it, so text such as `don't` stays text and an expression is
 * read from Svelte's own tree, with no lexer of the adapter's own.
 */
import { describe, expect, it } from 'vitest';

import { templateClassNames } from '../src/index.js';

const names = (source: string): string[] => [...(templateClassNames(source)?.names ?? [])].sort();

describe('templateClassNames', () => {
    it('reads static words past text a JavaScript reader would take for a string', () => {
        expect(names(`<p>don't panic</p>\n<div class="p-4  m-2\tgap-1">x</div>`)).toEqual([
            'gap-1',
            'm-2',
            'p-4',
        ]);
    });

    it('reads the strings and template text of an expression, and a mixed value', () => {
        const source = [
            '<script>let on = true; const tone = "x";</script>',
            `<div class={cn('flex w-full', on && "hidden", \`ring-\${tone} border\`)}>a</div>`,
            "<b class=\"a {on ? 'b' : ''} c\">b</b>",
        ].join('\n');
        expect(names(source)).toEqual([
            'a',
            'b',
            'border',
            'c',
            'flex',
            'hidden',
            'ring-',
            'w-full',
        ]);
    });

    it('reads a tagged template whose text has no cooked value by its raw text', () => {
        // A `\u` that starts no escape leaves `cooked` null in a tagged template.
        expect(names('<div class={tag`\\unicode p-3`}>x</div>')).toEqual(['\\unicode', 'p-3']);
    });

    it('reads the keys of a class object at the top of the value or in an array there', () => {
        const source = [
            '<script>let on = true;</script>',
            '<i class={{ flipped: on, "is-open": on, [on]: on }}>a</i>',
            "<i class={['m-1', { active: on }, [{ deep: on }]]}>b</i>",
            // Keys of an object passed to a call are its arguments, not classes.
            '<i class={cn(variants({ size: on }))}>c</i>',
        ].join('\n');
        expect(names(source)).toEqual(['active', 'deep', 'flipped', 'is-open', 'm-1']);
    });

    it('reads class directives and elements inside blocks and components', () => {
        const source = [
            '<script>let on = true; let items = [1];</script>',
            '{#if on}<div class:active={on} class:done>a</div>{:else}<p class="else-p">b</p>{/if}',
            '{#each items as item}<Button class="btn-x">{item}</Button>{/each}',
        ].join('\n');
        expect(names(source)).toEqual(['active', 'btn-x', 'done', 'else-p']);
    });

    it('reads a bare class and an empty one as nothing', () => {
        expect(names('<div class>a</div><p class="">b</p>')).toEqual([]);
    });

    it('answers null for a component Svelte cannot parse', () => {
        expect(templateClassNames('<div class={>broken</div>')).toBeNull();
    });

    it("throws an error that is not Svelte's verdict on the markup", () => {
        // No string at all: Svelte's parser throws a TypeError, which carries
        // no Svelte `code`, so it is not read as an unparsable component.
        expect(() => templateClassNames(null as unknown as string)).toThrow(TypeError);
    });

    it('leaves the expressions list empty: every expression is read from the tree', () => {
        expect(templateClassNames('<div class={a}>x</div>')?.expressions).toEqual([]);
    });
});
