/**
 * A class list splits where the engine splits one, on Unicode White_Space. A
 * class the lowering keeps a BOM in (a BOM is not White_Space, so the engine
 * keeps it inside the class) stays one class through every helper that reads
 * a list.
 */
import { describe, expect, it } from 'vitest';

import { splitBox, szcn, validateHydrationClass } from '../src/index.js';
import { _szMerge as liteMerge } from '../src/lite.js';
import { installMangleRuntime } from '../src/mangle-registry.js';

const BOM_CLASS = 'content-[a﻿b]';

describe('a class holding a BOM', () => {
    it('stays one class through `szcn`', () => {
        expect(szcn(`${BOM_CLASS} p-4`, 'm-2')).toBe(`${BOM_CLASS} p-4 m-2`);
    });

    it('is placed whole by `splitBox`', () => {
        const { outer, inner } = splitBox(`${BOM_CLASS} p-4`);
        expect(`${outer} ${inner}`.split(' ')).toContain(BOM_CLASS);
    });

    it('is told apart from its halves by `validateHydrationClass`', () => {
        expect(validateHydrationClass(`${BOM_CLASS} p-4`, 'content-[a b] p-4')).toBe(false);
    });
});

describe('the separators', () => {
    // The engine's `split_whitespace`: every White_Space character, ASCII or
    // not, splits; nothing else does.
    it.each([['\t'], ['\n'], ['\f'], ['\r'], ['\v'], ['\u0085'], [' '], [' '], ['　']])(
        '%j splits a list',
        separator => {
            expect(szcn(`p-4${separator}m-2`, `flex${separator}`)).toBe('p-4 m-2 flex');
            // The lite runtime's merge splits where the core one does.
            expect(liteMerge(`p-4${separator}m-2`, `flex${separator}p-4`)).toBe('p-4 m-2 flex');
        },
    );

    it('keeps a BOM class whole in the lite merge', () => {
        expect(liteMerge(`${BOM_CLASS} p-4`, BOM_CLASS)).toBe(`${BOM_CLASS} p-4`);
    });
});

describe('a decoded class list', () => {
    it('keeps a BOM class whole', () => {
        const runtime = installMangleRuntime({ mangleMap: { 'p-4': 'z' }, checksum: 'one' });
        const element = { getAttribute: () => `${BOM_CLASS} z` } as unknown as Element;
        expect(runtime.decodeAll(element)).toEqual([BOM_CLASS, 'p-4']);
        // The DOM splits a class attribute on ASCII whitespace only: an NBSP
        // joins two names into one class, decoded as one token.
        const joined = { getAttribute: () => 'z\u00a0z z' } as unknown as Element;
        expect(runtime.decodeAll(joined)).toEqual(['z\u00a0z', 'p-4']);
    });
});
