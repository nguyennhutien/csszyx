/**
 * Field-report regression: `sz={{ borderB: on }}` with a runtime `on` used to
 * compile to `className="border-b-(--_sz-border-b)"` plus a style custom
 * property. Two defects stacked on that one line — React discards booleans in
 * `style`, so the variable was never set for `true` OR `false`, and the valued
 * utility resolves to a border COLOR while the bare `border-b` class is a
 * WIDTH. The separator rule it was meant to draw disappeared with no
 * diagnostic anywhere. Boolean-only keys must lower through __szBoolClass, and
 * value-typed keys must keep the custom-property strategy untouched.
 */
import { describe, expect, it } from 'vitest';

import { transformSource } from '../src/transform-select.js';
import { transformWasm } from '../src/transform-wasm.js';

const ENGINES = [
    ['native', (jsx: string) => transformSource(jsx, 'probe.tsx', {})],
    ['wasm', (jsx: string) => transformWasm(jsx, 'probe.tsx', {})],
] as const;

describe.each(ENGINES)('dynamic boolean-only key lowering (%s)', (_name, run) => {
    it('compiles the reported repro to a conditional bare class', () => {
        const result = run('export const A = ({ on }) => <div sz={{ borderB: on }} />;');

        expect(result.code).toContain('className={__szBoolClass(on, "borderB", "border-b")}');
        expect(result.code).not.toContain('--_sz-');
        expect(result.code).not.toContain('style=');
        expect(result.usesBoolClass).toBe(true);
    });

    it('safelists the bare class so Tailwind emits a rule for it', () => {
        const result = run('export const A = ({ on }) => <div sz={{ borderB: on }} />;');

        expect([...result.classes]).toEqual(['border-b']);
    });

    it('keeps static siblings static and appends the helper after them', () => {
        const result = run(
            'export const A = ({ on }) => <div sz={{ py: 2, borderB: on, borderColor: "border" }} />;',
        );

        expect(result.code).toContain(
            'className={`py-2 border-border ${__szBoolClass(on, "borderB", "border-b")}`}',
        );
        expect([...result.classes]).toEqual(['py-2', 'border-border', 'border-b']);
    });

    it('covers the whole family, including the key with no valued form', () => {
        const family: ReadonlyArray<readonly [string, string]> = [
            ['border', 'border'],
            ['borderT', 'border-t'],
            ['borderX', 'border-x'],
            ['ring', 'ring'],
            ['outline', 'outline'],
            ['shadow', 'shadow'],
            ['truncate', 'truncate'],
        ];
        for (const [key, bareClass] of family) {
            const result = run(`export const A = ({ on }) => <div sz={{ ${key}: on }} />;`);
            expect(result.code, key).toContain(`__szBoolClass(on, "${key}", "${bareClass}")`);
            expect(result.code, key).not.toContain('--_sz-');
        }
    });

    it('hands the helper the variant-prefixed class', () => {
        const result = run('export const A = ({ on }) => <div sz={{ hover: { ring: on } }} />;');

        expect(result.code).toContain('__szBoolClass(on, "ring", "hover:ring")');
        expect([...result.classes]).toEqual(['hover:ring']);
    });

    it('passes a nullable conditional into the helper whole', () => {
        const result = run(
            'export const A = ({ on, flag }) => <div sz={{ borderB: flag ? on : undefined }} />;',
        );

        expect(result.code).toContain(
            '__szBoolClass(flag ? on : undefined, "borderB", "border-b")',
        );
        expect(result.code).not.toContain('--_sz-');
    });

    it('merges the helper with an authored className', () => {
        const result = run(
            'export const A = ({ on }) => <div className="q" sz={{ borderB: on }} />;',
        );

        expect(result.code).toContain('_szMerge("q", __szBoolClass(on, "borderB", "border-b"))');
    });

    it('leaves a literal-branch ternary on the plain conditional lane', () => {
        const result = run(
            'export const A = ({ on }) => <div sz={{ borderB: on ? true : false }} />;',
        );

        expect(result.code).toContain('className={on ? "border-b" : undefined}');
        expect(result.usesBoolClass).toBe(false);
    });

    it('keeps value-typed keys on the custom-property strategy', () => {
        const result = run('export const A = ({ v }) => <div sz={{ z: v, w: v, bg: v, p: v }} />;');

        expect(result.code).toContain(
            'className="z-(--_sz-z) w-(--_sz-w) bg-(--_sz-bg) p-(--_sz-p)"',
        );
        expect(result.code).toContain(
            'style={{"--_sz-z": v, "--_sz-w": __szSpacingVar(v, "w"), "--_sz-bg": __szColorVar(v), "--_sz-p": __szSpacingVar(v, "p")}}',
        );
        expect(result.usesBoolClass).toBe(false);
        expect(result.usesSpacingVar).toBe(true);
        expect(result.usesColorVar).toBe(true);
    });
});
