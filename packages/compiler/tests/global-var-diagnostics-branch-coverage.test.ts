import { describe, expect, it } from 'vitest';

import { scanGlobalVarUsages } from '../src/global-var-diagnostics.js';

/**
 * Complementary branch-coverage suite for the out-of-band global-variable
 * scanner. Each case drives a specific decision the primary suite never reaches
 * (parser errors, nested sz attributes, non-identifier declarators, computed /
 * argument-less style methods, non-object style values, filtered className
 * tokens, namespaced attributes, numeric object keys, dynamic className
 * expressions) and asserts the concrete diagnostics produced.
 */
describe('scanGlobalVarUsages — branch coverage', () => {
    it('throws when the parser reports errors on token-bearing source', () => {
        // Contains `--` and `var(` so the early-out is skipped and the parser runs.
        expect(() => scanGlobalVarUsages('const = var(--broken)', '/repo/src/bad.ts')).toThrow(
            /oxc-parser errors/,
        );
    });

    it('does not report sz strings whether the sz prop is top-level or nested in another attribute', () => {
        const source = `
const A = () => (
  <div sz={{ bg: '--top-level' }}>
    <Wrap icon={<span sz={{ bg: '--nested-in-attr' }} />} />
  </div>
);
`;
        // The nested <span sz> attribute has a JSXAttribute ancestor (icon),
        // exercising the ancestor-walk guard; neither sz value is reported.
        expect(scanGlobalVarUsages(source, '/repo/src/App.tsx')).toEqual([]);
    });

    it('ignores destructuring and uninitialized declarators when resolving const strings', () => {
        const source = `
const { a } = obj;
let later;
const token = '--brand-resolved';
document.documentElement.style.setProperty(token, color);
`;
        const diagnostics = scanGlobalVarUsages(source, '/repo/src/theme.ts');

        expect(diagnostics.map(diagnostic => [diagnostic.kind, diagnostic.name])).toEqual([
            ['style-set-property', '--brand-resolved'],
        ]);
    });

    it('handles plain calls, non-style methods, computed/argument-less/dynamic style methods', () => {
        const source = `
const known = '--brand-known';
plainCall('--not-a-method');
el.classList.add('--not-style-method');
el.style['setProperty']('--brand-computed', color);
el.style.removeProperty();
el.style.setProperty(unknownVar, color);
el.style.setProperty(\`--brand-template\`, color);
el.style.setProperty(known, color);
`;
        const diagnostics = scanGlobalVarUsages(source, '/repo/src/theme.ts');

        // Only the computed-member call and the const-resolved call are real
        // out-of-band setProperty usages.
        expect(diagnostics.map(diagnostic => [diagnostic.kind, diagnostic.name])).toEqual([
            ['style-set-property', '--brand-computed'],
            ['style-set-property', '--brand-known'],
        ]);
    });

    it('skips non-object and string-literal JSX style attributes', () => {
        const source = `
const A = ({ dynamicStyle }) => (
  <>
    <div style={dynamicStyle} />
    <div style="--brand-inline: 1" />
    <div style={{ 123: color, color: 'red', '--brand-key': color }} />
  </>
);
`;
        const diagnostics = scanGlobalVarUsages(source, '/repo/src/App.tsx');

        // Only the object-literal style with a real `--` string key reports.
        expect(diagnostics.map(diagnostic => [diagnostic.kind, diagnostic.name])).toEqual([
            ['jsx-style-key', '--brand-key'],
        ]);
    });

    it('returns empty for source containing no custom-property syntax at all', () => {
        expect(scanGlobalVarUsages('const plain = compute(1, 2);', '/repo/src/plain.ts')).toEqual(
            [],
        );
    });

    it('classifies getPropertyValue and removeProperty style-method kinds', () => {
        const source = `
element.style.getPropertyValue('--brand-get');
element.style.removeProperty('--brand-remove');
`;
        const diagnostics = scanGlobalVarUsages(source, '/repo/src/theme.ts');

        expect(diagnostics.map(diagnostic => [diagnostic.kind, diagnostic.name])).toEqual([
            ['style-get-property', '--brand-get'],
            ['style-remove-property', '--brand-remove'],
        ]);
    });

    it('reports spread style objects, computed keys, and quoted className expressions', () => {
        const source = `
const brandKey = '--brand-computed-key';
const A = ({ color, base }) => (
  <>
    <div style={{ ...base, [brandKey]: color, '--brand-literal': color }} />
    <div className={'bg-[var(--brand-quoted)]'} />
  </>
);
`;
        const diagnostics = scanGlobalVarUsages(source, '/repo/src/App.tsx');

        expect(diagnostics.map(diagnostic => [diagnostic.kind, diagnostic.name])).toEqual([
            ['jsx-style-key', '--brand-computed-key'],
            ['jsx-style-key', '--brand-literal'],
            ['class-string-var-reference', '--brand-quoted'],
        ]);
    });

    it('handles filtered tokens, namespaced attributes, boolean/dynamic/template classNames', () => {
        const source = `
const A = ({ cls }) => (
  <>
    <a xlink:href="var(--namespaced)" className="bg-[var(--filtered-out)]" />
    <input className />
    <div className={cls} />
    <div className={\`text-[var(--template-token)] \${cls}\`} />
  </>
);
`;
        // The candidate filter drops --filtered-out; the namespaced attribute has
        // no plain identifier name; boolean/dynamic classNames yield no strings.
        const diagnostics = scanGlobalVarUsages(source, '/repo/src/App.tsx', {
            tokens: ['--template-token'],
        });

        expect(diagnostics.map(diagnostic => [diagnostic.kind, diagnostic.name])).toEqual([
            ['class-string-var-reference', '--template-token'],
        ]);
    });
});
