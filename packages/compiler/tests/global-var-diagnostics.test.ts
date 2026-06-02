import { describe, expect, it } from 'vitest';

import { scanGlobalVarUsages } from '../src/global-var-diagnostics.js';

describe('scanGlobalVarUsages', () => {
    it('detects DOM style custom-property method calls', () => {
        const source = `
const token = '--brand-primary';
document.documentElement.style.setProperty(token, color);
document.documentElement.style.getPropertyValue('--brand-secondary');
document.documentElement.style.removeProperty('--brand-tertiary');
`;

        const diagnostics = scanGlobalVarUsages(source, '/repo/src/theme.ts');

        expect(diagnostics.map(diagnostic => [diagnostic.kind, diagnostic.name])).toEqual([
            ['style-set-property', '--brand-primary'],
            ['style-get-property', '--brand-secondary'],
            ['style-remove-property', '--brand-tertiary'],
        ]);
        expect(diagnostics[0]?.location).toMatchObject({
            filePath: '/repo/src/theme.ts',
            line: 3,
        });
    });

    it('detects raw JSX style custom-property keys', () => {
        const source = `
const token = '--brand-accent';
const App = ({ color }) => (
  <div
    style={{
      '--brand-primary': color,
      [token]: color,
      color: 'red',
    }}
  />
);
`;

        const diagnostics = scanGlobalVarUsages(source, '/repo/src/App.tsx');

        expect(diagnostics.map(diagnostic => [diagnostic.kind, diagnostic.name])).toEqual([
            ['jsx-style-key', '--brand-primary'],
            ['jsx-style-key', '--brand-accent'],
        ]);
    });

    it('detects className strings containing var() references', () => {
        const source = `
const App = () => (
  <>
    <div className="bg-[var(--brand-primary)]" />
    <div className={'text-[var(--brand-secondary)]'} />
    <div className={\`border-[var(--brand-tertiary)] \${active ? 'block' : 'hidden'}\`} />
  </>
);
`;

        const diagnostics = scanGlobalVarUsages(source, '/repo/src/App.tsx');

        expect(diagnostics.map(diagnostic => [diagnostic.kind, diagnostic.name])).toEqual([
            ['class-string-var-reference', '--brand-primary'],
            ['class-string-var-reference', '--brand-secondary'],
            ['class-string-var-reference', '--brand-tertiary'],
        ]);
    });

    it('filters diagnostics by candidate tokens', () => {
        const source = `
document.body.style.setProperty('--brand-primary', color);
document.body.style.setProperty('--brand-secondary', color);
const App = () => <div style={{ '--brand-primary': color, '--brand-secondary': color }} />;
`;

        const diagnostics = scanGlobalVarUsages(source, '/repo/src/theme.tsx', {
            tokens: ['--brand-secondary'],
        });

        expect(diagnostics.map(diagnostic => [diagnostic.kind, diagnostic.name])).toEqual([
            ['style-set-property', '--brand-secondary'],
            ['jsx-style-key', '--brand-secondary'],
        ]);
    });

    it('does not report sz prop CSS variable strings as out-of-band usage', () => {
        const source = `
const App = () => (
  <div sz={{ bg: '--brand-primary', hover: { bg: '--brand-secondary' } }} />
);
`;

        expect(scanGlobalVarUsages(source, '/repo/src/App.tsx')).toEqual([]);
    });

    it('returns an empty result when no custom-property syntax is present', () => {
        expect(scanGlobalVarUsages('const value = "brand";', '/repo/src/plain.ts')).toEqual([]);
    });
});
