/**
 * Classes a project selects on from outside its stylesheets.
 *
 * A merge may remove a class only when nothing selects on it. Stylesheets are
 * one place a selector lives; two others reach the page without passing
 * through one: an arbitrary variant in markup (`group-[.shadow-md]:p-2`
 * selects on `shadow-md` wherever it is written) and a `<style>` block in a
 * Vue, Svelte or Astro component. Missing either one removes a class the page
 * still uses, with a green build.
 */
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { loadContentScanner } from '../src/candidate-scanner.js';
import { createEmittedClassOracle } from '../src/emitted-class-oracle.js';
import {
    type ClassHooks,
    collectClassHooks,
    collectVariantHooks,
    isHook,
    noClassHooks,
    styleBlockHooks,
} from '../src/origin-oracle.js';

const REPO = path.resolve(import.meta.dirname, '../../..');
const dirs: string[] = [];

afterAll(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * The CSS the repository's Tailwind writes for each candidate.
 *
 * @param css - The root stylesheet.
 * @returns A `cssFor` over that design system.
 */
async function cssForOf(css = '@import "tailwindcss";') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-source-hooks-'));
    dirs.push(dir);
    const oracle = await createEmittedClassOracle({ resolveFrom: REPO, css, cssBase: dir });
    if (!oracle.ok) throw new Error(`expected a ready oracle, got skip: ${oracle.reason}`);
    return (classes: readonly string[]) => oracle.cssFor(classes);
}

/**
 * The hooks the given candidates' own rules select on.
 *
 * @param candidates - Classes as written.
 * @param css - The root stylesheet.
 * @returns The hooks.
 */
async function variantHooksOf(candidates: string[], css?: string): Promise<ClassHooks> {
    const hooks = noClassHooks();
    collectVariantHooks(candidates, await cssForOf(css), hooks);
    return hooks;
}

describe('the classes an arbitrary variant selects on', () => {
    it.each([
        ['group-[.shadow-md]:p-2', ['shadow-md']],
        ['[&_.tab-item-header]:p-2', ['tab-item-header']],
        ['in-[.group.is-published]:opacity-100', ['is-published']],
        ['[&.w-1\\/2]:p-2', ['w-1/2']],
        ['[&_.a\\.b]:p-2', ['a.b']],
        ['not-[.x]:p-2', ['x']],
        ['*:[.x]:p-2', ['x']],
        ['[&:is(.a,.b)]:p-2', ['a', 'b']],
        ['[&>li.z]:p-2', ['z']],
        ['md:[&.shadow-md]:p-2', ['shadow-md']],
    ])('%s selects on %j', async (candidate, expected) => {
        const hooks = await variantHooksOf([candidate]);
        for (const name of expected) expect(isHook(hooks, name), name).toBe(true);
        expect(hooks.names.has(candidate)).toBe(false);
    });

    it('reads a class attribute selector inside the brackets', async () => {
        const hooks = await variantHooksOf(['[&[class~=shadow-md]]:p-2']);
        expect(isHook(hooks, 'shadow-md')).toBe(true);
        expect(isHook(hooks, 'shadow-lg')).toBe(false);
    });

    it.each([
        'hover:p-4',
        'md:p-4',
        'data-[state=a.b]:p-2',
        'aria-[label=x.y]:p-2',
        'min-[1.5rem]:p-2',
        'bg-[url(/a.card.png)]',
        'p-4',
        'not-a-class:at-all',
    ])('%s selects on no class', async candidate => {
        const hooks = await variantHooksOf([candidate]);
        expect([...hooks.names].filter(name => name !== 'group')).toEqual([]);
        expect(hooks.attributes).toEqual([]);
    });

    it('follows a variant the project defines', async () => {
        const hooks = await variantHooksOf(
            ['foo:p-2'],
            '@import "tailwindcss";\n@custom-variant foo (&.bar);',
        );
        expect(isHook(hooks, 'bar')).toBe(true);
    });

    it('asks for many candidates at once and keeps each one’s own name out', async () => {
        const hooks = await variantHooksOf(['[&.p-4]:m-2', 'hover:p-4', 'group-[.x]:p-4']);
        // `p-4` is selected by the first, so it stays a hook although the
        // second and third name it as their own utility.
        expect(isHook(hooks, 'p-4')).toBe(true);
        expect(isHook(hooks, 'x')).toBe(true);
        expect(hooks.names.has('hover:p-4')).toBe(false);
    });
});

describe('a <style> block in a component', () => {
    it.each([
        ['vue scoped', '<style scoped>\n.card.shadow-md { color: red; }\n</style>\n<template/>'],
        ['vue :deep', '<style scoped lang="scss">.card :deep(.shadow-md) { color: red; }</style>'],
        ['svelte :global', '<style>\n  :global(.shadow-md) { color: red; }\n</style>\n<div/>'],
        ['svelte :global block', '<style>:global { .card .shadow-md { color: red; } }</style>'],
        ['astro is:global', '---\n---\n<style is:global>.shadow-md{color:red}</style>'],
        ['html', '<html><head><STYLE type="text/css">.a > .shadow-md{}</STYLE></head></html>'],
        ['sass', '<style lang="sass">\n.card\n  .shadow-md\n    color: red\n</style>'],
        ['stylus', "<style lang='stylus'>\n.card .shadow-md\n  color red\n</style>"],
    ])('%s selects on the class', (_name, text) => {
        const hooks = noClassHooks();
        styleBlockHooks(text, hooks);
        expect(isHook(hooks, 'shadow-md')).toBe(true);
    });

    it('reads every block, and no text outside one', () => {
        const hooks = noClassHooks();
        // One per line, so no line holds two tags.
        const text = [
            '<style>.a{}</style>',
            '<div class="shadow-lg">.p-4 {}</div>',
            '<style>.b { margin: .5rem }</style>',
        ].join('\n');
        styleBlockHooks(text, hooks);
        expect([...hooks.names].sort()).toEqual(['a', 'b']);
    });

    it('reads no tag that only starts like one, or never ends', () => {
        const hooks = noClassHooks();
        styleBlockHooks('<stylesheet>.a{}</stylesheet>\n<style .b{}', hooks);
        expect([...hooks.names]).toEqual([]);
    });

    it('reads an unclosed block to the end of the file', () => {
        const hooks = noClassHooks();
        styleBlockHooks('<style>.a{}', hooks);
        expect([...hooks.names]).toEqual(['a']);
    });
});

describe('an attribute selector after an escaped quote', () => {
    it('matches its own value, and does not throw', () => {
        const hooks = noClassHooks();
        collectClassHooks('.a\\"b [class*="shadow"] { color: red; }', hooks);
        expect(isHook(hooks, 'shadow-md')).toBe(true);
    });

    it('is not read from inside an escape', () => {
        const hooks = noClassHooks();
        collectClassHooks('.a\\[class\\~\\=x\\] { color: red; }', hooks);
        expect(hooks.attributes).toEqual([]);
    });
});

describe('a stylesheet that applies a variant selecting on a class', () => {
    /**
     * The origin answer for a stylesheet.
     *
     * @param css - The root stylesheet.
     * @returns A function naming each candidate's origin.
     */
    async function originsOf(css: string) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-source-hooks-'));
        dirs.push(dir);
        const oracle = await createEmittedClassOracle({ resolveFrom: REPO, css, cssBase: dir });
        if (!oracle.ok) throw new Error(`expected a ready oracle, got skip: ${oracle.reason}`);
        const origins = await oracle.loadOriginOracle();
        if (!origins.ok) throw new Error(`expected origins, got: ${origins.reason}`);
        return (candidate: string) => origins.origin(candidate);
    }

    it.each([
        ['with a semicolon', '.card { @apply [&.shadow-md]:p-2; }'],
        ['as the last statement of its block', '.card { color: red; @apply [&.shadow-md]:p-2 }'],
    ])('makes the class a hook %s', async (_name, rule) => {
        const origin = await originsOf(`@import "tailwindcss";\n${rule}`);
        expect(origin('shadow-md')).toBe('hook');
        expect(origin('shadow-lg')).toBe('tailwind');
    });
});

describe('the content scanner', () => {
    it('finds the candidates Tailwind would in any file, fresh on every call', () => {
        const scan = loadContentScanner(REPO);
        if (scan === null) throw new Error('expected a scanner');
        const text = '<b className="group-[.shadow-md]:p-2" />';
        expect(scan(text, 'tsx')).toContain('group-[.shadow-md]:p-2');
        expect(scan(text, 'tsx')).toContain('group-[.shadow-md]:p-2');
        expect(scan('<template><i class="in-[.is-on]:p-1" /></template>', 'vue')).toContain(
            'in-[.is-on]:p-1',
        );
    });
});
