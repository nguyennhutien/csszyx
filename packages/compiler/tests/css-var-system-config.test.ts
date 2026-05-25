import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { transformOxc, transformRust } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../..');

describe('CSS variable system config contract', () => {
    it('keeps production.mangleVars opt-in by default', () => {
        const typesConfig = readFileSync(join(REPO_ROOT, 'packages/types/src/config.ts'), 'utf8');
        const configDocs = readFileSync(
            join(REPO_ROOT, 'apps/docs/src/content/docs/docs/reference/config.mdx'),
            'utf8',
        );

        expect(typesConfig).toContain('mangleVars: boolean;');
        expect(typesConfig).toContain('@default false');
        expect(typesConfig).toMatch(/DEFAULT_PRODUCTION_CONFIG[\s\S]*mangleVars:\s*false,/);
        expect(configDocs).toContain('mangleVars: boolean;');
        expect(configDocs).toContain('| `mangleVars`       | `false`');
    });

    it('preserves existing dynamic CSS variable output when mangleVars is disabled', () => {
        const source = 'const App = ({ pad, gap }) => <div sz={{ p: pad, md: { gap } }} />;';
        const result = transformOxc(source, 'mangle-vars-disabled.tsx');

        expect(result.code).toContain('p-(--_sz-p)');
        expect(result.code).toContain('md:gap-(--_sz-md-gap)');
        expect(result.code).toContain('"--_sz-p"');
        expect(result.code).toContain('"--_sz-md-gap"');
        expect(result.classes).toEqual(new Set(['p-(--_sz-p)', 'md:gap-(--_sz-md-gap)']));
    });

    it('maps scoped dynamic variables to per-element s-tier names when mangleVars is enabled', () => {
        const source = 'const App = ({ pad, gap }) => <div sz={{ p: pad, md: { gap } }} />;';
        const result = transformOxc(source, 'mangle-vars-enabled.tsx', { mangleVars: true });

        expect(result.code).toContain('p-(--sz)');
        expect(result.code).toContain('md:gap-(--sy)');
        expect(result.code).toContain('"--sz"');
        expect(result.code).toContain('"--sy"');
        expect(result.classes).toEqual(new Set(['p-(--sz)', 'md:gap-(--sy)']));
        expect(result.cssVariableMap).toEqual(
            new Map([
                ['--_sz-p', '--sz'],
                ['--_sz-md-gap', '--sy'],
            ]),
        );
    });

    it('hoists repeated component-tier variables to a bounded common ancestor', () => {
        const source =
            'const App = ({ pad }) => <section><div sz={{ p: pad }} /><span sz={{ p: pad }} /></section>;';
        const result = transformOxc(source, 'mangle-vars-hoist.tsx', { mangleVars: true });

        expect(result.code).toContain(
            '<section style={{"--cz": `calc(${pad} * var(--spacing))`}}>',
        );
        expect(result.code).toContain('<div className="p-(--cz)" />');
        expect(result.code).toContain('<span className="p-(--cz)" />');
        expect(result.code).not.toContain('"--sz"');
        expect(result.classes).toEqual(new Set(['p-(--cz)']));
        expect(result.cssVariableMap).toEqual(new Map([['--_sz-p', '--cz']]));
    });

    it('does not hoist repeated vars across component boundaries', () => {
        const source =
            'const App = ({ pad }) => <Card><div sz={{ p: pad }} /><span sz={{ p: pad }} /></Card>;';
        const result = transformOxc(source, 'mangle-vars-component-boundary.tsx', {
            mangleVars: true,
        });

        expect(result.code).toContain('<Card>');
        expect(result.code).toContain(
            '<div className="p-(--sz)" style={{"--sz": `calc(${pad} * var(--spacing))`}} />',
        );
        expect(result.code).toContain(
            '<span className="p-(--sz)" style={{"--sz": `calc(${pad} * var(--spacing))`}} />',
        );
        expect(result.code).not.toContain('--cz');
        expect(result.classes).toEqual(new Set(['p-(--sz)']));
    });

    it('merges hoisted vars into an existing ancestor style expression', () => {
        const source =
            'const App = ({ pad, rootStyle }) => <section style={rootStyle}><div sz={{ p: pad }} /><span sz={{ p: pad }} /></section>;';
        const result = transformOxc(source, 'mangle-vars-hoist-existing-style.tsx', {
            mangleVars: true,
        });

        expect(result.code).toContain(
            '<section style={{...rootStyle, "--cz": `calc(${pad} * var(--spacing))`}}>',
        );
        expect(result.code).toContain('<div className="p-(--cz)" />');
        expect(result.code).toContain('<span className="p-(--cz)" />');
    });

    it('does not hoist repeated vars through fragments', () => {
        const source =
            'const App = ({ pad }) => <><div sz={{ p: pad }} /><span sz={{ p: pad }} /></>;';
        const result = transformOxc(source, 'mangle-vars-fragment-boundary.tsx', {
            mangleVars: true,
        });

        expect(result.code).toContain(
            '<div className="p-(--sz)" style={{"--sz": `calc(${pad} * var(--spacing))`}} />',
        );
        expect(result.code).toContain(
            '<span className="p-(--sz)" style={{"--sz": `calc(${pad} * var(--spacing))`}} />',
        );
        expect(result.code).not.toContain('--cz');
    });

    it('fails loudly instead of silently ignoring mangleVars on the Rust path', () => {
        expect(() =>
            transformRust('const App = ({ pad }) => <div sz={{ p: pad }} />;', 'rust-vars.tsx', {
                mangleVars: true,
            }),
        ).toThrow('mangleVars is not implemented by the native Rust engine yet');
    });

    it('keeps CSS variable names out of metadata while mangleVars is disabled', () => {
        const source = 'const App = ({ pad }) => <div sz={{ p: pad }} />;';
        const result = transformOxc(source, 'mangle-vars-disabled-metadata.tsx');

        expect(result.cssVariableMap).toEqual(new Map());
    });
});
