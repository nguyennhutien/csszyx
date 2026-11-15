/**
 * A static `szs` slot is emitted as a JSON string literal of its classes. The
 * engine promises the text `JSON.stringify` writes, which escapes every
 * control character; a raw one leaves a literal no JSON reader accepts and a
 * byte the two engines' callers do not agree on.
 */
import { describe, expect, it } from 'vitest';

import { transformRust } from '../src/transform-rust.js';
import { transformWasm } from '../src/transform-wasm.js';

const ENGINES = [
    ['native', transformRust],
    ['wasm', transformWasm],
] as const;

/** The literal each slot of `szs` is written as. */
const SLOT_LITERAL = /root:\s*(?:\/\*#__PURE__\*\/__szCss\()?("(?:[^"\\]|\\.)*")/;

describe.each(ENGINES)('a static szs slot (%s)', (_name, transform) => {
    it.each([
        [
            'backspace, form feed and other control characters',
            String.raw`'a\u0008b\u000cc\u0001d\u001fe'`,
        ],
        ['a quote, a backslash and a line break', String.raw`'a\"b\\c\nd'`],
    ])('writes %s as JSON.stringify does', (_case, value) => {
        const source = `export const A = () => <Card szs={{ root: { content: "${value}" } }} />;`;
        const literal = SLOT_LITERAL.exec(transform(source, { filename: 'a.tsx' }).code)?.[1];

        expect(literal).toBeDefined();
        expect(literal).toBe(JSON.stringify(JSON.parse(literal ?? '""')));
    });
});
