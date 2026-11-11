/**
 * A class the lowering keeps a BOM in (the engine reads Unicode White_Space,
 * and a BOM is not in it) stays one class wherever the build reads a class
 * list back: the safelist of a runtime `_sz` call and the classes an authored
 * `szcn` call names. A list splits on White_Space, as the engine splits one.
 */
import { describe, expect, it } from 'vitest';

import {
    collectAuthoredClassNames,
    collectMergeCallClassNames,
} from '../src/authored-class-scanner.js';
import { collectRuntimeStaticClasses } from '../src/next-transform-metadata.js';
import { mangleCodeClassesSync } from '../src/unplugin.js';

const BOM_CLASS = 'content-[a﻿b]';

describe('a class holding a BOM', () => {
    it('is safelisted whole from a runtime `_sz` call', () => {
        const found = new Set<string>();
        collectRuntimeStaticClasses(
            { usesRuntime: true, code: "_sz({ content: 'a﻿b', p: x })" } as never,
            found,
        );
        expect([...found]).toContain(BOM_CLASS);
        expect([...found]).not.toContain('content-[a');
    });

    it('is named whole from an authored `szcn` call', () => {
        const found = collectMergeCallClassNames(`szcn("${BOM_CLASS} p-4")`);
        expect([...found]).toEqual(expect.arrayContaining([BOM_CLASS, 'p-4']));
        expect([...found]).not.toContain('content-[a');
    });

    it('is named whole from an authored class attribute', () => {
        const found = collectAuthoredClassNames(`<div class="${BOM_CLASS} p-4"></div>`);
        expect([...found]).toEqual(expect.arrayContaining([BOM_CLASS, 'p-4']));
        expect([...found]).not.toContain('content-[a');
    });
});

describe('a class list a mangler rewrites', () => {
    // A string that goes straight into a `class` attribute splits where the
    // browser splits one, on ASCII whitespace: a NEL or an NBSP joins two
    // names into one class, which dev serves nothing for, so production must
    // not mangle them apart. A string `_szMerge` merges splits where the
    // runtime splits it, on White_Space.
    const map = { 'm-3': 'z', x: 'y' };

    it.each([['\u0085'], ['\u00a0']])(
        'leaves a class attribute joined by %j as one class',
        joint => {
            const code = `h("p", { className: "m-3${joint}x" })`;
            expect(mangleCodeClassesSync(code, map)).toBe(code);
            const html = `className="m-3${joint}x"`;
            expect(mangleCodeClassesSync(html, map)).toBe(html);
        },
    );

    it.each([['\u0085'], ['\u00a0']])('splits a `_szMerge` argument joined by %j', joint => {
        expect(mangleCodeClassesSync(`_szMerge("m-3${joint}x")`, map)).toBe('_szMerge("z y")');
    });

    it('still splits a class attribute on a tab or a newline', () => {
        expect(mangleCodeClassesSync('className="m-3\tx\nm-3"', map)).toBe('className="z y z"');
    });
});
