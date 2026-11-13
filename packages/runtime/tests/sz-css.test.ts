/**
 * `__szCss` is the mark a mangle build wraps every class string the compiler
 * emits in, as Closure wraps a class in `goog.getCssName`. The build pass
 * replaces each call with the renamed string; a call it misses still runs and
 * names each class through the installed mangle registry, or keeps the name
 * where there is none, so a missed mark never breaks a class.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { __szCss, clearMangleRegistry, installMangleRuntime } from '../src/index.js';

afterEach(() => {
    clearMangleRegistry();
});

describe('__szCss', () => {
    it('keeps the classes as written when no registry is installed', () => {
        expect(__szCss('p-4 flex')).toBe('p-4 flex');
    });

    it('names each class through the registry, and keeps one it does not know', () => {
        installMangleRuntime({ mangleMap: { 'p-4': 'a', flex: 'b' }, checksum: 'one' });
        expect(__szCss('p-4 flex hover:m-2')).toBe('a b hover:m-2');
    });

    it('keeps a class holding a BOM whole', () => {
        installMangleRuntime({ mangleMap: { 'content-[a﻿b]': 'c' }, checksum: 'two' });
        expect(__szCss('content-[a﻿b] p-4')).toBe('c p-4');
    });

    it('keeps the spaces around a list, as the build pass does', () => {
        installMangleRuntime({ mangleMap: { 'p-4': 'a' }, checksum: 'three' });
        expect(__szCss(' p-4 ')).toBe(' a ');
    });

    it('returns an empty string for an empty one', () => {
        expect(__szCss('')).toBe('');
    });
});
