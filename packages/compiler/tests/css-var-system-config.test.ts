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
        expect(typesConfig).toContain('mangleVarHoistMaxDepth: number;');
        expect(typesConfig).toContain('mangleGlobalVars?: GlobalVarMangleConfig;');
        expect(typesConfig).toContain('mode?: GlobalVarMangleMode;');
        expect(typesConfig).toContain('onUnsafeUsage?: GlobalVarUnsafeUsageMode;');
        expect(typesConfig).toContain('emitMap?: boolean;');
        expect(typesConfig).toContain('@default false');
        expect(typesConfig).toMatch(/DEFAULT_PRODUCTION_CONFIG[\s\S]*mangleVars:\s*false,/);
        expect(typesConfig).toMatch(/DEFAULT_PRODUCTION_CONFIG[\s\S]*mangleVarHoistMaxDepth:\s*5,/);
        expect(typesConfig).not.toMatch(/DEFAULT_PRODUCTION_CONFIG[\s\S]*mangleGlobalVars:/);
        expect(configDocs).toContain('mangleVars: boolean;');
        expect(configDocs).toContain('mangleVarHoistMaxDepth: number;');
        expect(configDocs).toContain('mangleGlobalVars?: GlobalVarMangleConfig;');
        expect(configDocs).toContain("mode?: 'alias';");
        expect(configDocs).toContain("onUnsafeUsage?: 'error';");
        expect(configDocs).toContain('emitMap?: boolean;');
        expect(configDocs).toMatch(/\| `mangleVars`\s+\| `false`/);
        expect(configDocs).toMatch(/\| `mangleVarHoistMaxDepth`\s+\| `5`/);
        expect(configDocs).toMatch(/\| `mangleGlobalVars`\s+\| `undefined`/);
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

        expect(result.code).toContain('<section style={{"--cz": __szSpacingVar(pad, "p")}}>');
        expect(result.code).toContain('<div className="p-(--cz)" />');
        expect(result.code).toContain('<span className="p-(--cz)" />');
        expect(result.code).not.toContain('"--sz"');
        expect(result.classes).toEqual(new Set(['p-(--cz)']));
        expect(result.cssVariableMap).toEqual(new Map([['--_sz-p', '--cz']]));
    });

    it('keeps one-to-many CSS variable metadata when one original uses scoped and hoisted tiers', () => {
        const source =
            'const App = ({ pad, gap }) => <main><section><div sz={{ p: pad }} /><span sz={{ p: pad }} /></section><aside sz={{ p: gap }} /></main>;';
        const oxc = transformOxc(source, 'mangle-vars-mixed-tiers.tsx', { mangleVars: true });
        const rust = transformRust(source, 'rust-mangle-vars-mixed-tiers.tsx', {
            mangleVars: true,
        });

        for (const result of [oxc, rust]) {
            expect(result.code).toContain('p-(--cz)');
            expect(result.code).toContain('p-(--sz)');
            expect(new Set(asArray(result.cssVariableMap.get('--_sz-p')))).toEqual(
                new Set(['--cz', '--sz']),
            );
        }
    });

    it('reduces repeated dynamic CSS variable output when mangleVars is enabled', () => {
        const source =
            'const App = ({ pad }) => <section><div sz={{ p: pad }} /><span sz={{ p: pad }} /><button sz={{ p: pad }} /></section>;';
        const disabled = transformOxc(source, 'mangle-vars-size-disabled.tsx');
        const enabled = transformOxc(source, 'mangle-vars-size-enabled.tsx', { mangleVars: true });

        expect(disabled.code).toContain('--_sz-p');
        expect(enabled.code).toContain('--cz');
        expect(enabled.code).not.toContain('--_sz-p');
        expect(enabled.code.length).toBeLessThan(disabled.code.length);
    });

    it('does not hoist repeated vars across component boundaries', () => {
        const source =
            'const App = ({ pad }) => <Card><div sz={{ p: pad }} /><span sz={{ p: pad }} /></Card>;';
        const result = transformOxc(source, 'mangle-vars-component-boundary.tsx', {
            mangleVars: true,
        });

        expect(result.code).toContain('<Card>');
        expect(result.code).toContain(
            '<div className="p-(--sz)" style={{"--sz": __szSpacingVar(pad, "p")}} />',
        );
        expect(result.code).toContain(
            '<span className="p-(--sz)" style={{"--sz": __szSpacingVar(pad, "p")}} />',
        );
        expect(result.code).not.toContain('--cz');
        expect(result.classes).toEqual(new Set(['p-(--sz)']));
        expect(result.diagnostics).toContain(
            '[csszyx] mangleVars skipped component CSS variable hoist for --cz across 2 usages: non-host-ancestor',
        );
    });

    it('merges hoisted vars into an existing ancestor style expression', () => {
        const source =
            'const App = ({ pad, rootStyle }) => <section style={rootStyle}><div sz={{ p: pad }} /><span sz={{ p: pad }} /></section>;';
        const result = transformOxc(source, 'mangle-vars-hoist-existing-style.tsx', {
            mangleVars: true,
        });

        expect(result.code).toContain(
            '<section style={{...rootStyle, "--cz": __szSpacingVar(pad, "p")}}>',
        );
        expect(result.code).toContain('<div className="p-(--cz)" />');
        expect(result.code).toContain('<span className="p-(--cz)" />');
    });

    it('uses configured mangle var hoist max depth', () => {
        const source =
            'const App = ({ pad }) => <section><div><article><aside><div><div><span sz={{ p: pad }} /></div></div></aside></article></div><button sz={{ p: pad }} /></section>;';
        const defaultDepth = transformOxc(source, 'mangle-vars-default-depth.tsx', {
            mangleVars: true,
        });
        const deeper = transformOxc(source, 'mangle-vars-deeper-depth.tsx', {
            mangleVars: true,
            mangleVarHoistMaxDepth: 6,
        });

        expect(defaultDepth.code).not.toContain('<section style={{"--cz"');
        expect(defaultDepth.code).toContain('className="p-(--sz)"');
        expect(defaultDepth.diagnostics).toContain(
            '[csszyx] mangleVars skipped component CSS variable hoist for --cz across 2 usages: max-depth (maxDepth 5)',
        );
        expect(deeper.code).toContain('<section style={{"--cz": __szSpacingVar(pad, "p")}}>');
        expect(deeper.code).toContain('<span className="p-(--cz)" />');
        expect(deeper.code).toContain('<button className="p-(--cz)" />');
        expect(deeper.diagnostics).not.toContain(
            '[csszyx] mangleVars skipped component CSS variable hoist for --cz across 2 usages: max-depth (maxDepth 5)',
        );
    });

    it('does not reuse user-authored CSS custom property names', () => {
        const source =
            'const App = ({ pad, gap }) => <section style={{ "--cz": "user" }}><div style={{ "--sz": "local" }} sz={{ p: pad }} /><span sz={{ p: pad, gap }} /></section>;';
        const result = transformOxc(source, 'mangle-vars-reserved-names.tsx', {
            mangleVars: true,
        });

        expect(result.code).toContain('style={{...{ "--cz": "user" }, "--cy"');
        expect(result.code).toContain('p-(--cy)');
        expect(result.code).toContain('gap-(--sy)');
        expect(result.code).not.toContain('p-(--cz)');
        expect(result.code).not.toContain('gap-(--sz)');
        expect(result.cssVariableMap).toEqual(
            new Map([
                ['--_sz-p', '--cy'],
                ['--_sz-gap', '--sy'],
            ]),
        );
    });

    it('hoists dynamic values with redundant expression parentheses', () => {
        const source =
            'const App = ({ pad }) => <section><div sz={{ p: pad }} /><span sz={{ p: (pad) }} /></section>;';
        const result = transformOxc(source, 'mangle-vars-normalized-value-key.tsx', {
            mangleVars: true,
        });

        expect(result.code).toContain('<section style={{"--cz": __szSpacingVar(pad, "p")}}>');
        expect(result.code).toContain('<div className="p-(--cz)" />');
        expect(result.code).toContain('<span className="p-(--cz)" />');
        expect(result.code).not.toContain('--sz');
        expect(result.cssVariableMap).toEqual(new Map([['--_sz-p', '--cz']]));
    });

    it('does not hoist repeated vars through fragments', () => {
        const source =
            'const App = ({ pad }) => <><div sz={{ p: pad }} /><span sz={{ p: pad }} /></>;';
        const result = transformOxc(source, 'mangle-vars-fragment-boundary.tsx', {
            mangleVars: true,
        });

        expect(result.code).toContain(
            '<div className="p-(--sz)" style={{"--sz": __szSpacingVar(pad, "p")}} />',
        );
        expect(result.code).toContain(
            '<span className="p-(--sz)" style={{"--sz": __szSpacingVar(pad, "p")}} />',
        );
        expect(result.code).not.toContain('--cz');
        expect(result.diagnostics).toContain(
            '[csszyx] mangleVars skipped component CSS variable hoist for --cz across 2 usages: non-host-ancestor',
        );
    });

    it('applies mangleVars on the Rust path when native support is available', () => {
        const source =
            'const App = ({ pad }) => <section><div sz={{ p: pad }} /><span sz={{ p: pad }} /></section>;';
        const result = transformRust(source, 'rust-vars.tsx', { mangleVars: true });

        expect(result.code).toContain('<section style={{"--cz": __szSpacingVar(pad, "p")}}>');
        expect(result.code).toContain('<div className="p-(--cz)" />');
        expect(result.code).toContain('<span className="p-(--cz)" />');
        expect(result.classes).toEqual(new Set(['p-(--cz)']));
        expect(result.cssVariableMap).toEqual(new Map([['--_sz-p', '--cz']]));
    });

    it('keeps CSS variable names out of metadata while mangleVars is disabled', () => {
        const source = 'const App = ({ pad }) => <div sz={{ p: pad }} />;';
        const result = transformOxc(source, 'mangle-vars-disabled-metadata.tsx');

        expect(result.cssVariableMap).toEqual(new Map());
    });

    it('rewrites selected global variable tokens in static sz objects on oxc and Rust paths', () => {
        const source =
            "const App = () => <div sz={{ bg: '--brand-primary', hover: { text: '--brand-secondary' }, borderColor: '--other-token' }} />;";
        const aliases = new Map([
            ['--brand-primary', '--g0'],
            ['--brand-secondary', '--g1'],
        ]);
        const oxc = transformOxc(source, 'global-var-aliases.tsx', {
            globalVarAliases: aliases,
        });
        const rust = transformRust(source, 'rust-global-var-aliases.tsx', {
            globalVarAliases: aliases,
        });

        for (const result of [oxc, rust]) {
            expect(result.code).toContain('bg-(--g0)');
            expect(result.code).toContain('hover:text-(length:--g1)');
            expect(result.code).toContain('border-(--other-token)');
            expect(result.code).not.toContain('bg-(--brand-primary)');
            expect(result.code).not.toContain('hover:text-(length:--brand-secondary)');
            expect(result.classes).toEqual(
                new Set(['bg-(--g0)', 'hover:text-(length:--g1)', 'border-(--other-token)']),
            );
            expect(result.cssVariableMap).toEqual(
                new Map([
                    ['--brand-primary', '--g0'],
                    ['--brand-secondary', '--g1'],
                ]),
            );
        }
    });

    it('preserves static sz output when the global variable alias table is empty', () => {
        const source = "const App = () => <div sz={{ bg: '--brand-primary' }} />;";
        const result = transformOxc(source, 'global-var-aliases-empty.tsx', {
            globalVarAliases: new Map(),
        });

        expect(result.code).toContain('bg-(--brand-primary)');
        expect(result.classes).toEqual(new Set(['bg-(--brand-primary)']));
        expect(result.cssVariableMap).toEqual(new Map());
    });

    it('does not alias runtime fallback sz expressions on oxc and Rust paths', () => {
        const source =
            "const App = ({ styles }: { styles: { bg: '--brand-primary' } }) => <div sz={styles} />;";
        const aliases = new Map([['--brand-primary', '--g0']]);
        const oxc = transformOxc(source, 'global-var-runtime-fallback.tsx', {
            globalVarAliases: aliases,
        });
        const rust = transformRust(source, 'rust-global-var-runtime-fallback.tsx', {
            globalVarAliases: aliases,
        });

        for (const result of [oxc, rust]) {
            expect(result.code).toContain('_sz(styles)');
            expect(result.code).toContain("'--brand-primary'");
            expect(result.code).not.toContain('--g0');
            expect(result.classes).toEqual(new Set());
            expect(result.cssVariableMap).toEqual(new Map());
        }
    });
});

function asArray<T>(value: T | T[] | undefined): T[] {
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
