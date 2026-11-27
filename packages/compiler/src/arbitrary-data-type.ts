/**
 * What an arbitrary value is, as Tailwind reads it before it picks a property:
 * `text-[12px]` is a length, so the font size; `text-[var(--x)]` has no type,
 * so the colour. Its own module so the browser lowering ships none of it; the
 * units it reads as a length are the lowering's own list.
 *
 * @module
 */

import { ARBITRARY_LENGTH_UNITS } from './css-units.js';
import { COLOUR_FUNCTION_NAMES } from './shadow-size-keywords.js';

/** The units in {@link ARBITRARY_LENGTH_UNITS} that are not a length. */
const NOT_LENGTH_UNITS: ReadonlySet<string> = new Set([
    '%',
    'deg',
    'rad',
    'turn',
    'grad',
    'ms',
    's',
    'fr',
]);

/**
 * A CSS number alone, as a percentage, and with a unit. Tailwind writes the
 * number `\d*\.?\d+`, which backtracks in square time on a long run of
 * digits; this form matches the same text with none.
 */
const IS_NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i;
const IS_PERCENTAGE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?%$/i;
const NUMBER_AND_UNIT = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?([a-z]+)$/i;
/** The angle units, in Tailwind's case. */
const ANGLE_UNITS: ReadonlySet<string> = new Set(['deg', 'rad', 'grad', 'turn']);

/**
 * The math calls whose result Tailwind takes as any numeric type, found
 * anywhere in the value as Tailwind finds them (`minmax(` holds `max(`).
 */
const MATH_CALL =
    /(?:calc|min|max|clamp|mod|rem|sin|cos|tan|asin|acos|atan|atan2|pow|sqrt|hypot|log|exp|round)\(/;

/** The calls that make an image. */
const IMAGE_CALL =
    /^(?:element|image|cross-fade|image-set|(?:repeating-)?(?:conic|linear|radial)-gradient)\(/;

const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'ui-rounded',
    'math',
    'emoji',
    'fangsong',
]);

const ABSOLUTE_SIZES: ReadonlySet<string> = new Set([
    'xx-small',
    'x-small',
    'small',
    'medium',
    'large',
    'x-large',
    'xx-large',
    'xxx-large',
]);

/** The closer of each bracket a value can open. */
const CLOSER_OF: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };

/**
 * The parts of a value between top-level separators: a separator inside a
 * call, a bracket, a brace or a quote does not split it, and a closer closes
 * only the bracket it matches, as Tailwind's split reads it. Linear in the
 * value's length.
 *
 * @param value - The value.
 * @param separator - One character.
 * @returns The parts, empty ones included.
 */
function topLevelParts(value: string, separator: string): string[] {
    const parts: string[] = [];
    // The closer the innermost open bracket waits for, and those of the
    // brackets around it; any other closer closes nothing.
    let closer = '';
    const outer: string[] = [];
    let quote = '';
    let start = 0;
    for (let at = 0; at < value.length; at++) {
        const char = value[at];
        if (char === '\\') at++;
        else if (quote) quote = char === quote ? '' : quote;
        else if (char === '"' || char === "'") quote = char;
        else if (char === '(' || char === '[' || char === '{') {
            outer.push(closer);
            closer = CLOSER_OF[char];
        } else if (char === closer) {
            // A closer is set only once the one around it is pushed.
            closer = outer.pop() as string;
        } else if (char === separator && closer === '') {
            parts.push(value.slice(start, at));
            start = at + 1;
        }
    }
    parts.push(value.slice(start));
    return parts;
}

/**
 * @param value - A value.
 * @returns Whether it holds a math call, which can be any numeric type.
 */
function hasMath(value: string): boolean {
    return MATH_CALL.test(value);
}

/**
 * @param value - A value.
 * @returns Whether it is a length: a number with a length unit, a
 *   `--spacing()` or a math call.
 */
function isLength(value: string): boolean {
    const unit = NUMBER_AND_UNIT.exec(value)?.[1];
    return (
        (unit !== undefined && ARBITRARY_LENGTH_UNITS.has(unit) && !NOT_LENGTH_UNITS.has(unit)) ||
        /^--spacing\(/i.test(value) ||
        hasMath(value)
    );
}

/**
 * @param value - A value.
 * @returns Whether it is a percentage, or a math call.
 */
function isPercentage(value: string): boolean {
    return IS_PERCENTAGE.test(value) || hasMath(value);
}

/**
 * @param value - A value.
 * @param separator - What its parts are split on.
 * @param part - The test each part that is not a variable must pass.
 * @returns Whether every such part passes and at least one exists.
 */
function everyPart(value: string, separator: string, part: (text: string) => boolean): boolean {
    let counted = 0;
    for (const text of topLevelParts(value, separator)) {
        if (text.startsWith('var(')) continue;
        if (!part(text)) return false;
        counted++;
    }
    return counted > 0;
}

/**
 * @param value - A value.
 * @returns Whether it is a `background-size`: layers of `cover`, `contain` or
 *   one or two sizes, at least one of them read.
 */
function isBackgroundSize(value: string): boolean {
    let counted = 0;
    for (const layer of topLevelParts(value, ',')) {
        const sizes = topLevelParts(layer, ' ');
        if (layer === 'cover' || layer === 'contain') counted++;
        else if (sizes.length > 2) return false;
        else if (sizes.every(size => size === 'auto' || isLength(size) || isPercentage(size))) {
            counted++;
        }
    }
    return counted > 0;
}

/**
 * @param value - A value.
 * @returns Whether it starts as a colour does, with `#` or a colour function
 *   (`rgb(calc(255) 0 0)` too, which the math tests would read as a length).
 */
function isColour(value: string): boolean {
    const call = /^([a-z-]+)\(/i.exec(value)?.[1];
    return (
        value.startsWith('#') ||
        (call !== undefined && COLOUR_FUNCTION_NAMES.has(call.toLowerCase()))
    );
}

/** Tailwind's test for each type a shared prefix reads, by the type's name. */
const DATA_TYPE_TESTS: Readonly<Record<string, (value: string) => boolean>> = {
    color: isColour,
    length: isLength,
    percentage: isPercentage,
    number: value => IS_NUMBER.test(value) || hasMath(value),
    'line-width': value =>
        topLevelParts(value, ' ').every(
            part =>
                isLength(part) ||
                IS_NUMBER.test(part) ||
                part === 'thin' ||
                part === 'medium' ||
                part === 'thick',
        ),
    url: value => /^url\(.*\)$/.test(value),
    image: value =>
        everyPart(value, ',', part => /^url\(.*\)$/.test(part) || IMAGE_CALL.test(part)),
    position: value =>
        everyPart(
            value,
            ' ',
            part =>
                part === 'center' ||
                part === 'top' ||
                part === 'right' ||
                part === 'bottom' ||
                part === 'left' ||
                isLength(part) ||
                isPercentage(part),
        ),
    'bg-size': isBackgroundSize,
    'family-name': value => everyPart(value, ',', part => !/^\d/.test(part)),
    'generic-name': value => GENERIC_FAMILIES.has(value),
    'absolute-size': value => ABSOLUTE_SIZES.has(value),
    'relative-size': value => value === 'larger' || value === 'smaller',
    angle: value => ANGLE_UNITS.has(NUMBER_AND_UNIT.exec(value)?.[1] ?? ''),
    // Three numbers a run of spaces apart, a `rotate` axis.
    vector: value => {
        const parts = value.split(/ +/);
        return parts.length === 3 && parts.every(part => IS_NUMBER.test(part));
    },
};

/**
 * The first of `types` a decoded arbitrary value is, in the order given, as
 * Tailwind infers it for a prefix several properties share. A value that
 * starts with `var()` has no type: Tailwind gives it the prefix's default
 * property, which is the colour on every prefix that has one. A colour is
 * read by its start, `#` or a colour function, and must be asked for where
 * Tailwind asks, since the math tests take `rgb(calc(255) 0 0)` as a length.
 * A colour word is not tested: no other type reads one, so it has none, and
 * a value of no type is the colour.
 *
 * Cost: each test is one pass over the value, so O(t·n) for `t` types and a
 * value of length `n`; `n` is a class's bracket, `t` at most eight, on `bg`.
 *
 * @param value - The value, hint taken off and `_` decoded.
 * @param types - The types to try, in the prefix's order.
 * @returns The type, or undefined for none.
 */
export function inferDataType(value: string, types: readonly string[]): string | undefined {
    if (value.startsWith('var(')) return undefined;
    return types.find(type => DATA_TYPE_TESTS[type]?.(value));
}
