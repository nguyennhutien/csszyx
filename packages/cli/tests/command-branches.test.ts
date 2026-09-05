/**
 * Branch coverage for the smaller command and helper modules: the non-json /
 * silent / default-output paths, byte formatting, the doctor checksum-missing
 * branch, check's pattern + no-sz skip, scan-collisions' unclosed-span handling,
 * and pure helpers (isColorValue, sz-codegen null/array, flattenColors DEFAULT,
 * explain null literal).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isColorValue } from '../../compiler/src/migrate-tables/reverse-map.js';
import { audit } from '../src/commands/audit.js';
import { check } from '../src/commands/check.js';
import { doctor } from '../src/commands/doctor.js';
import { explainSz } from '../src/commands/explain.js';
import { generateTypes } from '../src/commands/generate-types.js';
import { nextPrebuild } from '../src/commands/next-prebuild.js';
import { scanCollisions } from '../src/commands/scan-collisions.js';
import {
    generateAndWriteTypes,
    generateTypeDeclarations,
} from '../src/generator/type-generator.js';
import { flattenColors } from '../src/scanner/tailwind-scanner.js';

const dirs: string[] = [];
function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-cmd-br-'));
    dirs.push(dir);
    return dir;
}
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

function captureLogs(): string[] {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...p: unknown[]) => logs.push(p.join(' ')));
    return logs;
}

describe('audit byte formatting', () => {
    it('formats kilobyte-scale build output', async () => {
        const logs = captureLogs();
        const cwd = tempRoot();
        mkdirSync(join(cwd, 'dist'));
        // >1KB so formatBytes takes the KB branch, not the raw-bytes branch.
        writeFileSync(join(cwd, 'dist/index.html'), `<html>${'x'.repeat(3000)}</html>`);
        writeFileSync(join(cwd, 'dist/app.css'), `.a{}${'/*pad*/'.repeat(400)}`);
        await audit({ cwd });
        const out = logs.join('\n');
        expect(out).toContain('KB');
        expect(out).toContain('index.html');
    });
});

describe('audit megabyte formatting', () => {
    it('formats megabyte-scale build output', async () => {
        const logs = captureLogs();
        const cwd = tempRoot();
        mkdirSync(join(cwd, 'dist'));
        // >1MB so formatBytes takes the MB branch.
        writeFileSync(join(cwd, 'dist/index.html'), 'x'.repeat(1_200_000));
        await audit({ cwd });
        expect(logs.join('\n')).toContain('MB');
    });
});

describe('doctor checksum-missing branch', () => {
    it('warns when built HTML lacks the checksum and hints in verbose mode', async () => {
        const logs = captureLogs();
        const cwd = tempRoot();
        writeFileSync(
            join(cwd, 'package.json'),
            JSON.stringify({ devDependencies: { csszyx: '^0.11', tailwindcss: '^4' } }),
        );
        mkdirSync(join(cwd, 'dist'));
        writeFileSync(join(cwd, 'dist/index.html'), '<html><body>no checksum here</body></html>');
        await doctor({ cwd, verbose: true });
        const out = logs.join('\n');
        expect(out).toContain('Checksum not found');
        // The remedy has to be one the reader can act on. It used to name a
        // config option nothing read, so following it changed nothing.
        expect(out).not.toContain('injectChecksum');
        expect(out).toContain('NODE_ENV=production');
    });
});

describe('check pattern and no-sz skip', () => {
    it('honours an explicit --pattern and skips files that never mention sz', async () => {
        const logs = captureLogs();
        const cwd = tempRoot();
        mkdirSync(join(cwd, 'src'));
        writeFileSync(
            join(cwd, 'src/Bad.tsx'),
            'export const B = () => <div sz={{ pading: 4 }} />;',
        );
        // No occurrence of the substring "sz" → pre-filtered out.
        writeFileSync(join(cwd, 'src/Plain.tsx'), 'export const P = () => null;');
        await check({ cwd, pattern: '**/*.tsx' });
        const out = logs.join('\n');
        expect(out).toContain('pading');
        expect(process.exitCode).toBe(1);
    });
});

describe('scan-collisions pattern and unclosed spans', () => {
    it('accepts a custom --pattern and does not crash on an unterminated url()/comment', async () => {
        const logs = captureLogs();
        const cwd = tempRoot();
        // Unterminated url( and /* … keep the linear span scanner on its no-closer branch.
        writeFileSync(
            join(cwd, 'styles.css'),
            '.b7 { background: url(hero.png /* oops unterminated comment\n.x { left: 0 }',
        );
        await scanCollisions({ cwd, pattern: '**/*.css' });
        // The scanner completed and flagged the token-shaped class ahead of the broken span.
        expect(logs.join('\n')).toContain('.b7');
    });
});

describe('next-prebuild non-json output paths', () => {
    it('prints a human summary on success', async () => {
        const logs = captureLogs();
        const cwd = tempRoot();
        writeFileSync(join(cwd, 'package.json'), '{"name":"a","private":true}');
        mkdirSync(join(cwd, 'app'));
        writeFileSync(join(cwd, 'app/page.tsx'), 'export default () => <div sz={{ p: 4 }} />;');
        const code = await nextPrebuild({ root: cwd, cwd, parserMode: 'wasm' });
        expect(code).toBe(0);
        expect(logs.join('\n')).toContain('next prebuild done');
    }, 15000);

    it('prints a human error when no files match', async () => {
        captureLogs();
        const errors: string[] = [];
        vi.spyOn(console, 'error').mockImplementation((...p: unknown[]) =>
            errors.push(p.join(' ')),
        );
        const cwd = tempRoot();
        const code = await nextPrebuild({ root: cwd, cwd, pattern: 'app/**/*.none' });
        expect(code).toBe(1);
        expect(errors.join('\n')).toContain('No source files matched');
    });

    it('prints a human error for an invalid --mode', async () => {
        captureLogs();
        const errors: string[] = [];
        vi.spyOn(console, 'error').mockImplementation((...p: unknown[]) =>
            errors.push(p.join(' ')),
        );
        const cwd = tempRoot();
        writeFileSync(join(cwd, 'package.json'), '{"name":"a","private":true}');
        mkdirSync(join(cwd, 'app'));
        writeFileSync(join(cwd, 'app/page.tsx'), 'export default () => <div />;');
        const code = await nextPrebuild({ root: cwd, cwd, mode: 'staging' as 'production' });
        expect(code).toBe(1);
        expect(errors.join('\n')).toContain('Invalid --mode');
    });
});

describe('generate-types silent and default-output paths', () => {
    it('runs silently and writes the default ./csszyx.d.ts under cwd', async () => {
        const logs = captureLogs();
        const cwd = tempRoot();
        const configPath = join(cwd, 'tailwind.config.mjs');
        writeFileSync(
            configPath,
            'export default { theme: { extend: { colors: { brand: "#123" } } } };',
        );
        // No `output` → default resolves to ./csszyx.d.ts under cwd; silent suppresses logs.
        await generateTypes({ cwd, config: configPath, silent: true });
        expect(readFileSync(join(cwd, 'csszyx.d.ts'), 'utf8')).toContain('brand');
        expect(logs).toHaveLength(0); // silent
    });
});

describe('pure helper branches', () => {
    it('isColorValue recognizes named and scaled colors', () => {
        expect(isColorValue('red')).toBe(true); // COLOR_NAMES hit
        expect(isColorValue('blue-500')).toBe(true); // scale regex hit
        expect(isColorValue('rose-950')).toBe(true);
        expect(isColorValue('transparent-500')).toBe(false);
        expect(isColorValue('blue-bright')).toBe(false);
        expect(isColorValue('definitely-not-a-color')).toBe(false);
    });

    it('flattenColors expands a DEFAULT shade to the bare color name', () => {
        expect(flattenColors({ brand: { DEFAULT: '#000', '500': '#00f' } }).sort()).toEqual([
            'brand',
            'brand-500',
        ]);
    });

    it('explainSz resolves a null literal value', () => {
        expect(explainSz('{ p: null }')).toBeTypeOf('string');
    });

    it('generateTypeDeclarations tolerates a theme with no colors', () => {
        const decl = generateTypeDeclarations({} as never);
        expect(decl).toContain('sz');
    });

    it('generateAndWriteTypes writes to an explicit output path', async () => {
        const cwd = tempRoot();
        const out = join(cwd, 'nested', 'types.d.ts');
        const written = await generateAndWriteTypes({} as never, { output: out });
        expect(written).toContain('types.d.ts');
        expect(readFileSync(out, 'utf8').length).toBeGreaterThan(0);
    });
});
