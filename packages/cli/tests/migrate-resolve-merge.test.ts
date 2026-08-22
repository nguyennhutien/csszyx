/**
 * `--resolve-todos` on a file that was already migrated once.
 *
 * The documented loop is migrate → audit → edit the todo map → resolve →
 * re-audit. After the first pass an element that had unrecognized classes
 * reads `className="mystery" sz={{ … }}`, so the resolve pass meets a
 * className next to an existing sz prop. Skipping it, as a plain migration
 * does to protect hand-written sz, would make the loop a no-op: the map's
 * decisions never land and the stripped @sz-todo marker is lost. With a map
 * in play the resolved classes merge into the existing sz object instead.
 */
import { describe, expect, it } from 'vitest';

import { transformSource } from '../src/migrate/ast-transformer.js';

const run = (source: string, customMap: Record<string, unknown>, injectTodos = false) =>
    transformSource(source, 'Card.tsx', { customMap, injectTodos });

describe('resolve-todos merges into an existing sz prop', () => {
    it('appends the resolved classes and drops an emptied className', () => {
        const out = run('<div sz={{ m: 1 }} className="mystery" />', { mystery: { p: 4 } });
        expect(out.code).toBe('<div sz={{ m: 1, p: 4 }} />');
        expect(out.changed).toBe(true);
        expect(out.stats.classNamesTransformed).toBe(1);
        expect(out.stats.classNamesSkipped).toBe(0);
    });

    it('fills an empty sz object', () => {
        const out = run('<div sz={{}} className="mystery" />', { mystery: { p: 4 } });
        expect(out.code).toBe('<div sz={{ p: 4 }} />');
    });

    it('keeps sz:keep and still-unrecognized classes in className and re-marks them', () => {
        const out = run(
            '<div sz={{ m: 1 }} className="mystery keepme other" />',
            { mystery: { p: 4 }, keepme: 'sz:keep' },
            true,
        );
        expect(out.code).toBe(
            '\n{/* @sz-todo: other */}\n<div sz={{ m: 1, p: 4 }} className="keepme other" />',
        );
        expect(out.stats.classesUnrecognized).toEqual(['other']);
    });

    it('applies a Tailwind-string entry and a removal', () => {
        const out = run('<div sz={{ m: 1 }} className="legacy gone" />', {
            legacy: 'p-4 bg-blue-500',
            gone: 'sz:remove',
        });
        expect(out.code).toBe("<div sz={{ m: 1, p: 4, bg: 'blue-500' }} />");
    });

    it('lays several resolved entries out the way the codegen does', () => {
        const out = run('<div sz={{ m: 1 }} className="legacy" />', {
            legacy: 'p-4 bg-blue-500 hover:underline',
        });
        expect(out.code).toBe(
            "<div sz={{ m: 1, p: 4,\n  bg: 'blue-500',\n  hover: { decoration: 'underline' }, }} />",
        );
    });

    it('fails closed when a resolved key is already set on the sz prop', () => {
        const source = '<div sz={{ p: 2 }} className="mystery" />';
        const out = run(source, { mystery: { p: 4 } }, true);
        expect(out.code).toBe(source);
        expect(out.changed).toBe(false);
        expect(out.stats.classNamesSkipped).toBe(1);
        expect(out.warnings).toEqual([
            '[Card.tsx] Cannot merge resolved classes into the existing sz prop on <div>: p is already set. Resolve by hand.',
        ]);
    });

    it('re-marks an element the map did not resolve so the marker survives the strip', () => {
        const out = run('<div sz={{ m: 1 }} className="mystery" />', { other: { p: 4 } }, true);
        expect(out.code).toBe(
            '\n{/* @sz-todo: mystery */}\n<div sz={{ m: 1 }} className="mystery" />',
        );
        expect(out.stats.classNamesSkipped).toBe(1);
        expect(out.stats.classNamesTransformed).toBe(0);
    });

    it('leaves a dynamic className or a dynamic sz alone', () => {
        for (const source of [
            '<div sz={{ m: 1 }} className={clsx("mystery")} />',
            '<div sz={styles} className="mystery" />',
        ]) {
            const out = run(source, { mystery: { p: 4 } });
            expect(out.code).toBe(source);
            expect(out.stats.classNamesSkipped).toBe(1);
        }
    });

    it('still skips the element when no map is given', () => {
        const source = '<div sz={{ m: 1 }} className="p-4" />';
        const out = transformSource(source, 'Card.tsx');
        expect(out.code).toBe(source);
        expect(out.changed).toBe(false);
    });
});
