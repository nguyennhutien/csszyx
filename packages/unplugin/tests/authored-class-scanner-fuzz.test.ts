/**
 * Pins what `collectAuthoredClassNames` finds on seeded random text: a class
 * sink or a near miss (`class`, `className`, quoted and escaped keys, a member
 * `x.class`, `-class`, `class:*` directives, letters that case-fold to ASCII),
 * a separator and a value, between quotes, templates, comments and regex
 * slashes. A change to the scanner that is meant to keep its answers must keep
 * this digest.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { collectAuthoredClassNames } from '../src/authored-class-scanner.js';

/** Names a scan reads as a class sink, or must not. */
const SINKS = [
    'class',
    'className',
    "'class'",
    '"className"',
    '"cl\\x61ss"',
    "'cla\\u0073s'",
    '"class',
    '"klass"',
    '"classname"',
    'x.class',
    '-class',
    'myclass',
    'classes',
    'class:list',
    'class:foo',
    ':class',
    'ſlass',
    'Klass',
    '$class',
    '_class',
    'class1',
    'my_class',
    '"cl\\x61ssName"',
];
const SEPARATORS = ['=', ': ', ':', ' = ', '={', ' ', '('];
const VALUES = [
    '"p-4"',
    "'a b'",
    '{"m-2"}',
    '`t-1 ${x}`',
    '["c-1", \'d-2\']',
    'clsx("e-3")',
    '{ f-4: true }',
    '"g-5" + "h-6"',
];
/** Text around a sink: quotes, escapes, templates, comments and regex slashes. */
const NOISE = [
    '',
    ' ',
    '\n',
    '{',
    '}',
    '"',
    "'",
    '`',
    '${',
    '/',
    '//',
    '/*',
    '*/',
    '\\',
    'return /a/',
    '<div ',
    '>',
    ',',
    ';',
    'x',
];

describe('collectAuthoredClassNames', () => {
    it('finds what it found before on seeded random text', () => {
        let state = 5;
        const next = (bound: number): number => {
            state = (state * 1103515245 + 12345) & 0x7fffffff;
            // The high bits: an LCG's low bits repeat with a short period.
            return (state >>> 16) % bound;
        };
        const digest = createHash('sha256');
        let found = 0;
        for (let sample = 0; sample < 20_000; sample++) {
            const pick = (pieces: readonly string[]): string =>
                pieces[next(pieces.length)] as string;
            let text = '';
            for (let part = 1 + next(3); part > 0; part--) {
                text += pick(NOISE) + pick(SINKS) + pick(SEPARATORS) + pick(VALUES) + pick(NOISE);
            }
            const classes = [...collectAuthoredClassNames(text)];
            if (classes.length > 0) found++;
            digest.update(JSON.stringify(classes));
            digest.update('\n');
        }
        // A quarter of the samples or more reach a sink, or the digest pins nothing.
        expect(found).toBeGreaterThan(4_000);
        expect(digest.digest('hex')).toBe(
            '01ccfc51538eea7429ce59bb7acfc90778647884df457c1048c04af8fff0b5d7',
        );
    });
});
