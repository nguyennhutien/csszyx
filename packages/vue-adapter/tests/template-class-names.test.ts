/**
 * `templateClassNames` reads the class names an SFC's template puts in the
 * DOM as Vue parses it: static words decoded as Vue decodes them, past text
 * such as `Don't`, and each `:class` expression as written, for a JavaScript
 * reader, since Vue leaves expressions as text here.
 */
import { describe, expect, it } from 'vitest';

import { templateClassNames } from '../src/index.js';

describe('templateClassNames', () => {
    it('reads static words past text a JavaScript reader would take for a string', () => {
        const reading = templateClassNames(
            `<template><p>Don't panic</p><div class="p-4  m-2&#9;gap-1">x</div></template>`,
        );
        expect([...(reading?.names ?? [])].sort()).toEqual(['gap-1', 'm-2', 'p-4']);
    });

    it('gives each class binding expression as written, nested elements included', () => {
        const reading = templateClassNames(
            [
                '<template>',
                '  <section :class="{ active: on }">',
                `    <span v-bind:class="['a', on ? 'b' : '']" :id="x">y</span>`,
                '    <Btn :[name]="z" class="btn" />',
                '  </section>',
                '</template>',
            ].join('\n'),
        );
        expect(reading?.names).toEqual(['btn']);
        expect([...(reading?.expressions ?? [])].sort()).toEqual([
            "['a', on ? 'b' : '']",
            '{ active: on }',
        ]);
    });

    it('answers an empty reading for an SFC with no template', () => {
        expect(templateClassNames('<script setup>const a = 1;</script>')).toEqual({
            names: [],
            expressions: [],
        });
    });

    it('answers an empty reading for a template whose markup lives in another file', () => {
        // `src` leaves Vue no template tree to read.
        expect(templateClassNames('<template src="./a.html"></template>')).toEqual({
            names: [],
            expressions: [],
        });
    });

    it('answers null for an SFC Vue cannot parse or a template in another language', () => {
        expect(templateClassNames('<template><div class="a"></template>')).toBeNull();
        expect(templateClassNames('<template lang="pug">div.a</template>')).toBeNull();
    });
});
