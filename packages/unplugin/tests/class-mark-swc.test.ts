/**
 * The marks survive SWC, the compiler a Next webpack build runs after csszyx
 * (ADR 0034). SWC drops an annotation that opens a JSX expression container,
 * so the engine writes that mark in parentheses; every other position keeps
 * its annotation. Each mark the engine wrote must reach the bundle pass
 * readable, through both JSX runtimes.
 */
import { createRequire } from 'node:module';
import { transformSource } from '@csszyx/compiler/engine';
import { describe, expect, it } from 'vitest';

import { inlineClassMarks } from '../src/class-mark-inline.js';

interface Swc {
    transformSync(code: string, options: object): { code: string };
}

/**
 * The workspace's `@swc/core`, or null where it is not installed.
 *
 * @returns The compiler, or null.
 */
function loadSwc(): Swc | null {
    try {
        return createRequire(import.meta.url)('@swc/core') as Swc;
    } catch {
        return null;
    }
}

const swc = loadSwc();

const SOURCE = [
    'export const A = ({ on, c }) => <>',
    '<div sz={{ p: 4 }} />',
    '<b className={c} sz={{ m: 2 }} />',
    '<i sz={{ borderB: on }} />',
    '<a sz={on ? { bg: "blue-500" } : { bg: "red-500" }} />',
    '<p sz={[{ text: "sm" }, on && { py: 2 }]} />',
    '<s sz={{ mx: 1, bg: on ? "red-500" : "blue-500" }} />',
    '<C szs={{ header: { bg: "zinc-100" } }} />',
    '</>;',
].join('\n');

describe.skipIf(swc === null)('marks through SWC', () => {
    it.each(['automatic', 'classic'])('reach the bundle pass readable (%s runtime)', runtime => {
        const marked = transformSource(SOURCE, { filename: 'probe.tsx', markClasses: true });
        const marks = marked.code.split('/*#__PURE__*/__szCss(').length - 1;
        expect(marks).toBeGreaterThan(8);
        const compiled = (swc as Swc).transformSync(marked.code, {
            jsc: {
                parser: { syntax: 'ecmascript', jsx: true },
                transform: { react: { runtime } },
                target: 'es2020',
            },
        }).code;
        const result = inlineClassMarks(compiled, { 'p-4': 'a' });
        expect(result.missed, compiled).toBe(0);
        expect(result.inlined).toBe(marks);
    });
});
