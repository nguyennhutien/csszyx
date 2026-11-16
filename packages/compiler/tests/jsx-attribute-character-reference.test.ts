/**
 * A character reference inside a JSX attribute string.
 *
 * JSX decodes `&#32;`, `&quot;`, `&amp;` and the other HTML references in an
 * attribute string, so `<div sz="p-4&#32;m-2" />` renders `class="p-4 m-2"`.
 * The engine read the text between the quotes as written and collected one
 * class, `p-4&#32;m-2`, which no stylesheet serves; under `source(none)` the two
 * classes the page carries had no CSS and nothing said so.
 *
 * The engine now reads the value as the JSX transform does, and writes back a
 * class string JSX reads as the same classes: in an attribute string while
 * decoding it again changes nothing, as a JavaScript string otherwise.
 */
import { describe, expect, it } from 'vitest';

import { findEmittedClassName } from '../src/emitted-class-name.js';
import { ENGINES, GLOBAL_VAR_SCANNERS, scanOneFile } from './engine-parity-harness.js';

/** A reference JSX would decode in an attribute string. */
const REFERENCE = /&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);/i;

/**
 * The classes a page carries for the engine's output: the emitted `className`
 * as JSX reads it. An attribute string must hold no reference, or JSX would
 * decode it a second time.
 *
 * @param code - The transformed module.
 * @returns The class string the element renders.
 */
function rendered(code: string): string {
    const emitted = findEmittedClassName(code);
    if (emitted === null) throw new Error(`no static className in ${code}`);
    const value = code.slice(emitted.start, emitted.end);
    if (!value.includes('={')) {
        expect(value).not.toMatch(REFERENCE);
        expect([...value].some(isControl)).toBe(false);
    }
    return emitted.className;
}

/**
 * Whether a character is a control character, which an attribute string
 * would carry raw into the module.
 *
 * @param character - One character.
 * @returns True for C0, DEL and C1.
 */
function isControl(character: string): boolean {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/** A no-break space: a browser's class list does not split at it. */
const NBSP = '\u00a0';

describe.each(ENGINES)('what the council of the first fix found (%s)', (_name, engine) => {
    const compile = (source: string) => engine(source, { filename: '/p/App.tsx' });

    it('writes a class still holding a reference as a JavaScript string, beside a lone surrogate', () => {
        const run = compile(
            'export const A = () => <div sz="p-4 &amp;#xD800; content-[&amp;lt;]" />;',
        );

        expect([...(run.classes ?? [])]).toEqual(['p-4', '&#xD800;', 'content-[&lt;]']);
        expect(rendered(run.code)).toBe('p-4 &#xD800; content-[&lt;]');
    });

    it('keeps one lone-surrogate reference as written and decodes the rest', () => {
        const run = compile('export const A = () => <div sz="a&#xD800;b p-4&#32;m-2" />;');

        expect([...(run.classes ?? [])]).toEqual(['a&#xD800;b', 'p-4', 'm-2']);
        expect(rendered(run.code)).toBe('a&#xD800;b p-4 m-2');
    });

    it.each([
        ['&nbsp;', 'x&nbsp;y'],
        ['a raw no-break space', `x${NBSP}y`],
    ])('keeps an authored class joined by %s as one class', (_spelling, value) => {
        const run = compile(`export const A = () => <div className="${value}" sz={{ p: 4 }} />;`);

        expect(rendered(run.code)).toBe(`x${NBSP}y p-4`);
    });

    it('writes a class holding a control character as a JavaScript string', () => {
        const run = compile('export const A = () => <div sz="&#27;p-4 m-2" />;');

        expect([...(run.classes ?? [])]).toEqual(['\u001bp-4', 'm-2']);
        expect(rendered(run.code)).toBe('\u001bp-4 m-2');
    });

    it('decodes the class name it merges into when JSX would decode it again', () => {
        const run = compile('export const A = () => <div className="a&amp;lt;b" sz="p-4" />;');

        expect(rendered(run.code)).toBe('a&lt;b p-4');
    });

    it('reads szRecover as JSX does', () => {
        const accepted = compile('export const A = () => <div szRecover="c&#115;r" sz="p-4" />;');
        const unknown = compile('export const A = () => <div szRecover="c&#115;x" sz="p-4" />;');

        expect(accepted.code).toContain('data-sz-recovery-token=');
        expect(accepted.diagnostics ?? []).toEqual([]);
        expect((unknown.diagnostics ?? []).join('\n')).toContain('csx');
    });
});

describe.each(GLOBAL_VAR_SCANNERS)('a reference in a scanned attribute (%s)', (_name, scan) => {
    it('reads the custom property JSX renders', () => {
        const usages = scanOneFile(scan)(
            'const A = () => <i className="p-[var(&#45;&#45;gap)]" />;',
            '/p/A.tsx',
        );

        expect(usages.map(usage => usage.name)).toEqual(['--gap']);
    });
});

describe.each(ENGINES)('a character reference in a JSX attribute (%s)', (_name, engine) => {
    const compile = (source: string) => engine(source, { filename: '/p/App.tsx' });

    it.each([
        ['&#32;', 'p-4&#32;m-2'],
        ['&#x20;', 'p-4&#x20;m-2'],
        ['&#9;', 'p-4&#9;m-2'],
    ])('splits classes at %s as the page does', (_reference, value) => {
        const run = compile(`export const A = () => <div sz="${value}" />;`);

        expect([...(run.classes ?? [])]).toEqual(['p-4', 'm-2']);
        expect(rendered(run.code)).toBe('p-4 m-2');
    });

    it('decodes a reference inside an arbitrary value', () => {
        const run = compile(
            'export const A = () => <div sz="p-4 after:content-[&quot;x&quot;]" />;',
        );

        expect([...(run.classes ?? [])]).toEqual(['p-4', 'after:content-["x"]']);
        expect(rendered(run.code)).toBe('p-4 after:content-["x"]');
    });

    it('writes a decoded `&…;` so that JSX does not decode it again', () => {
        const run = compile('export const A = () => <div sz="content-[\'&amp;lt;\']" />;');

        expect([...(run.classes ?? [])]).toEqual(["content-['&lt;']"]);
        expect(rendered(run.code)).toBe("content-['&lt;']");
    });

    it('keeps a bare `&` in an attribute string', () => {
        const run = compile('export const A = () => <div sz="[&amp;_p]:m-2 p-4" />;');

        expect([...(run.classes ?? [])]).toEqual(['[&_p]:m-2', 'p-4']);
        expect(run.code).toContain('className="[&_p]:m-2 p-4"');
    });

    it('reads the class name it merges into the same way', () => {
        const run = compile(
            'export const A = () => <div className="x&#32;y" sz="p-4&#x20;m-2" />;',
        );

        expect([...(run.classes ?? [])]).toEqual(['p-4', 'm-2']);
        expect(rendered(run.code)).toBe('x y p-4 m-2');
    });

    it('leaves a name JSX does not know as written', () => {
        const run = compile('export const A = () => <div sz="a&bogus;b" />;');

        expect([...(run.classes ?? [])]).toEqual(['a&bogus;b']);
    });

    it('leaves a string with no reference byte-identical', () => {
        const run = compile('export const A = () => <div sz="p-4 m-2" />;');

        expect(run.code).toBe('export const A = () => <div className="p-4 m-2" />;');
    });
});
