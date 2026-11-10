/**
 * How a project with several stylesheets reads the `_` of a value: each
 * stylesheet is asked under its own prefix, and an `_` is a space only where
 * every stylesheet that serves the class reads it as one. The readings come
 * from the real Tailwind design system; a stylesheet that keeps every `_` is
 * that same design system asked about the escaped class.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEmittedClassOracle } from '@csszyx/tailwind-oracle';
import { beforeAll, describe, expect, it } from 'vitest';

import {
    type UnderscoreRoot,
    underscoreReadingsPerRoot,
    underscoreSpaceVerdictsPerRoot,
} from '../src/underscore-roots.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let plain: UnderscoreRoot;
let prefixed: UnderscoreRoot;
let keeping: UnderscoreRoot;
const serving: UnderscoreRoot = { prefix: null, cssFor: classes => classes.map(() => null) };

/**
 * @param css - The stylesheet's entry CSS.
 * @returns Its `cssFor`.
 */
async function cssForOf(css: string): Promise<UnderscoreRoot['cssFor']> {
    const oracle = await createEmittedClassOracle({ resolveFrom: REPO, css, cssBase: REPO });
    if (!oracle.ok) throw new Error(`expected a ready oracle, got skip: ${oracle.reason}`);
    return classes => oracle.cssFor(classes);
}

beforeAll(async () => {
    const cssFor = await cssForOf('@import "tailwindcss";');
    plain = { prefix: null, cssFor };
    prefixed = { prefix: 'tw', cssFor: await cssForOf('@import "tailwindcss" prefix(tw);') };
    // Escaping every bare `_` before asking makes each probe read the same
    // declarations, so this stylesheet keeps every `_`.
    keeping = {
        prefix: null,
        cssFor: classes => cssFor(classes.map(name => name.replaceAll(/(?<!\\)_/g, '\\_'))),
    };
});

const content = { key: 'content', value: "'a_b'", className: "content-['a_b']" };

describe('underscoreReadingsPerRoot', () => {
    it('reads the `_` as a space where every stylesheet does', () => {
        expect(underscoreReadingsPerRoot([content], [plain, plain])).toEqual(["'a b'"]);
    });

    it('keeps the `_` when one stylesheet keeps it, in either order', () => {
        expect(underscoreReadingsPerRoot([content], [plain])).toEqual(["'a b'"]);
        expect(underscoreReadingsPerRoot([content], [keeping])).toEqual(["'a_b'"]);
        expect(underscoreReadingsPerRoot([content], [plain, keeping])).toEqual(["'a_b'"]);
        expect(underscoreReadingsPerRoot([content], [keeping, plain])).toEqual(["'a_b'"]);
    });

    it('asks a prefixed stylesheet under its prefix, once', () => {
        expect(underscoreReadingsPerRoot([content], [prefixed])).toEqual(["'a b'"]);
        const already = { ...content, className: "tw:content-['a_b']" };
        expect(underscoreReadingsPerRoot([already], [prefixed], 'tw')).toEqual(["'a b'"]);
        // Lowered under another prefix: asked as this stylesheet's class.
        // A class without the prefix it is said to carry is kept whole.
        expect(underscoreReadingsPerRoot([content], [prefixed], 'ui')).toEqual(["'a b'"]);
        const other = { ...content, className: "ui:content-['a_b']" };
        expect(underscoreReadingsPerRoot([other], [prefixed, plain], 'ui')).toEqual(["'a b'"]);
    });

    it('leaves out a stylesheet that serves nothing, and answers nothing without one', () => {
        expect(underscoreReadingsPerRoot([content], [serving, plain])).toEqual(["'a b'"]);
        expect(underscoreReadingsPerRoot([content], [serving])).toEqual([undefined]);
        expect(underscoreReadingsPerRoot([content], [])).toEqual([undefined]);
    });
});

describe('underscoreSpaceVerdictsPerRoot', () => {
    it('reports a fact only where the agreed reading differs from the value', () => {
        const kept = { key: 'bgImg', value: 'url(a_b.png)', className: 'bg-[url(a_b.png)]' };
        const { found, unserved } = underscoreSpaceVerdictsPerRoot(
            [content, kept],
            [plain, prefixed],
        );
        expect(found.map(f => f.key)).toEqual(['content']);
        expect(unserved).toEqual([]);
        expect(underscoreSpaceVerdictsPerRoot([content], [plain, keeping]).found).toEqual([]);
    });

    it('names a fact with an `_` to ask about that no stylesheet serves', () => {
        const spaced = { key: 'content', value: "'a b'", className: "content-['a_b']" };
        expect(underscoreSpaceVerdictsPerRoot([content, spaced], [serving])).toEqual({
            found: [],
            unserved: [content],
        });
    });
});
