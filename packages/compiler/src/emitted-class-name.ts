/**
 * Read the `className` the engine wrote for an element. Every reader of engine
 * output that wants the static class (the template lane, `csszyx explain`)
 * reads it here, so a form the engine writes cannot be known to one of them
 * and missed by another.
 *
 * @module emitted-class-name
 */

/** The attribute name and `=` the engine writes before a class. */
const ATTRIBUTE = ' className=';

/**
 * A `className` value the engine writes when the class is known at build
 * time: `{undefined}` for no class, a `"…"` string, or a `{"…"}` JavaScript
 * string when the class holds a `"`. A runtime call does not match.
 */
const STATIC_VALUE = /\{undefined\}|"[^"]*"|\{"(?:[^"\\]|\\.)*"\}/y;

/** A static `className` found in engine output. */
export interface EmittedClassName {
    /** The class string; `''` for `{undefined}`. */
    className: string;
    /** Offset of the attribute's leading space. */
    start: number;
    /** Offset just past its value. */
    end: number;
}

/**
 * Find the first `className` attribute in engine output and read its class,
 * when the engine wrote it as a static value.
 *
 * @param code - The engine's output.
 * @returns The class and where the attribute lies, or null when there is no
 *   `className` or its value is an expression read at runtime.
 */
export function findEmittedClassName(code: string): EmittedClassName | null {
    const start = code.indexOf(ATTRIBUTE);
    if (start === -1) return null;
    STATIC_VALUE.lastIndex = start + ATTRIBUTE.length;
    const value = STATIC_VALUE.exec(code)?.[0];
    if (value === undefined) return null;
    return { className: decode(value), start, end: STATIC_VALUE.lastIndex };
}

/**
 * The class string of a static `className` value.
 *
 * @param value - The value, braces and quotes included.
 * @returns The class string.
 */
function decode(value: string): string {
    if (value === '{undefined}') return '';
    // A class string with a `"` in it is written as a JavaScript string,
    // which the engine serialises as JSON.
    return value.startsWith('"') ? value.slice(1, -1) : JSON.parse(value.slice(1, -1));
}
