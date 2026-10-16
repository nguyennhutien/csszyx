/**
 * The three static `className` forms the engine writes, read in one place.
 */
import { describe, expect, it } from 'vitest';

import { findEmittedClassName } from '../src/emitted-class-name.js';

describe('findEmittedClassName', () => {
    it.each([
        ['a quoted class', '<div className="p-4" />', 'p-4', 20],
        ['no class', '<div className={undefined} />', '', 26],
        ['a class holding a quote', '<div className={"font-\\"Inter\\""} />', 'font-"Inter"', 33],
    ])('reads %s', (_name, code, className, end) => {
        expect(findEmittedClassName(code)).toEqual({ className, start: 4, end });
    });

    it.each([
        ['a runtime call', '<div className={_sz(a)} />'],
        ['a concatenation', '<div className={"a" + b} />'],
        ['no className', '<div sz={a} />'],
    ])('answers null for %s', (_name, code) => {
        expect(findEmittedClassName(code)).toBeNull();
    });
});
