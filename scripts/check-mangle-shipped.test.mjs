import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { bundleShortfall, MANGLING_APPS, mangleShortfall } from './check-mangle-shipped.mjs';

const CENSUS =
    '<script id="__CSSZYX_MANGLE_MAP__" type="application/json">{"class:p-4":"z"}</script>';

test('a mangled page lacks nothing, under either checksum name', () => {
    assert.deepEqual(mangleShortfall(`<html data-sz-cs="0123456789abcdef"><head>${CENSUS}`), []);
    assert.deepEqual(mangleShortfall(`<html data-sz-checksum="0123456789abcdef">${CENSUS}`), []);
});

test('an unmangled page lacks the census and the checksum', () => {
    assert.deepEqual(mangleShortfall('<html><head></head></html>'), [
        'the `__CSSZYX_MANGLE_MAP__` census',
        'the `data-sz-cs` checksum',
    ]);
});

test('a census with no class, or a page nobody built, fails', () => {
    const empty = '<script id="__CSSZYX_MANGLE_MAP__" type="application/json">{}</script>';
    assert.deepEqual(mangleShortfall(`<html data-sz-cs="0123456789abcdef">${empty}`), [
        'any class in the census',
    ]);
    assert.deepEqual(mangleShortfall(null), ['the page (not built)']);
});

test('a bundle carries the map when one chunk holds a non-empty one', () => {
    assert.deepEqual(bundleShortfall(['a()', 'x({mangleMap:{"p-4":`z`}})']), []);
    assert.deepEqual(bundleShortfall(['x({mangleMap:{flex:`z`}})']), []);
    assert.deepEqual(bundleShortfall(['x({mangleMap:{}})']), ['a non-empty `mangleMap`']);
    assert.deepEqual(bundleShortfall([]), ['the bundle (not built)']);
    assert.deepEqual(bundleShortfall(null), ['the bundle (not built)']);
});

test('every listed app sets production.mangle in its config', () => {
    for (const { app } of MANGLING_APPS) {
        const config = ['astro.config.mjs', 'vite.config.ts']
            .map(name => {
                try {
                    return readFileSync(`${app}/${name}`, 'utf8');
                } catch {
                    return '';
                }
            })
            .join('');
        assert.match(config, /mangle:\s*(true|process\.env)/, app);
    }
});
