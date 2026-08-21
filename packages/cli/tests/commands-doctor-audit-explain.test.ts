/**
 * The diagnostic commands (doctor, audit, explain, generate-types) and the
 * Tailwind config scanner — command modules that only ran through the binary,
 * which subprocess tests can't measure.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { audit } from '../src/commands/audit.js';
import { doctor } from '../src/commands/doctor.js';
import { explain, explainSz } from '../src/commands/explain.js';
import { generateTypes } from '../src/commands/generate-types.js';
import {
    extractScreenKeys,
    extractSpacingKeys,
    findConfigFile,
    flattenColors,
} from '../src/scanner/tailwind-scanner.js';

const tempDirs: string[] = [];
function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-cli-cmd-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    process.exitCode = undefined;
});

/** Capture console.log output for assertion.
 * @returns The captured log lines. */
function captureLogs(): { logs: string[] } {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        logs.push(parts.join(' '));
    });
    return { logs };
}

describe('doctor', () => {
    it('reports a healthy project when everything is in place', async () => {
        const { logs } = captureLogs();
        const cwd = tempRoot();
        writeFileSync(join(cwd, 'csszyx.config.ts'), 'export default {};');
        writeFileSync(
            join(cwd, 'package.json'),
            JSON.stringify({ devDependencies: { tailwindcss: '^4', csszyx: '^0.11' } }),
        );
        mkdirSync(join(cwd, 'dist'));
        writeFileSync(
            join(cwd, 'dist/index.html'),
            '<html data-sz-checksum="x"><body></body></html>',
        );

        await doctor({ cwd });
        const output = logs.join('\n');
        expect(output).toContain('No issues found');
        expect(output).toContain('Checksum injection working');
    });

    it('counts the missing pieces on an empty project', async () => {
        const { logs } = captureLogs();
        const cwd = tempRoot();
        writeFileSync(join(cwd, 'package.json'), JSON.stringify({}));

        await doctor({ cwd, verbose: true });
        const output = logs.join('\n');
        expect(output).toContain('issue(s)');
        expect(output).toContain('npm install -D tailwindcss');
    });

    it('flags an unreadable package.json', async () => {
        const { logs } = captureLogs();
        const cwd = tempRoot();
        await doctor({ cwd });
        expect(logs.join('\n')).toContain('Failed to read package.json');
    });
});

describe('explain', () => {
    it('compiles an sz object literal to its className', () => {
        expect(explainSz("{ p: 4, bg: 'blue-500' }")).toContain('p-4');
    });

    it('rejects unparseable input and non-object expressions', () => {
        expect(() => explainSz('{{{{')).toThrow(/could not be parsed/);
        expect(() => explainSz('42')).toThrow(/not an object literal/);
    });

    it('prints the className, or (no classes) for an empty object', () => {
        const { logs } = captureLogs();
        explain('{ p: 4 }');
        explain('{}');
        expect(logs[0]).toContain('p-4');
        expect(logs[1]).toBe('(no classes)');
        expect(process.exitCode).toBeUndefined();
    });

    it('sets a failing exit code on bad input', () => {
        captureLogs();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        explain('not an object');
        expect(process.exitCode).toBe(1);
    });
});

describe('audit', () => {
    it('emits machine-readable stats in json mode', async () => {
        const { logs } = captureLogs();
        const cwd = tempRoot();
        await audit({ cwd, json: true });
        const stats = JSON.parse(logs.join('\n'));
        expect(stats).toHaveProperty('totalClasses');
    });

    it('prints the human report with the not-built-yet guidance', async () => {
        const { logs } = captureLogs();
        const cwd = tempRoot();
        await audit({ cwd });
        expect(logs.join('\n')).toContain('Run a production build first');
    });

    it('measures bundle savings from build output', async () => {
        const { logs } = captureLogs();
        const cwd = tempRoot();
        mkdirSync(join(cwd, 'dist'));
        writeFileSync(join(cwd, 'dist/index.html'), '<html><body class="a b"></body></html>');
        writeFileSync(join(cwd, 'dist/app.css'), '.a{p:1}.b{m:2}');
        await audit({ cwd });
        const output = logs.join('\n');
        expect(output).toContain('Original HTML');
        expect(output).toContain('Original CSS');
    });
});

describe('generateTypes', () => {
    it('reports when no tailwind config can be found', async () => {
        const errors: string[] = [];
        vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
            errors.push(parts.join(' '));
        });
        captureLogs();
        const exit = vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
            throw new Error(`exit:${code}`);
        }) as never);
        const cwd = tempRoot();
        await expect(generateTypes({ cwd })).rejects.toThrow('exit:1');
        expect(errors.join('\n')).toContain('--config');
        expect(exit).toHaveBeenCalledWith(1);
    });
});

describe('tailwind-scanner helpers', () => {
    it('finds a config file by conventional name', () => {
        const cwd = tempRoot();
        expect(findConfigFile(cwd)).toBeNull();
        writeFileSync(join(cwd, 'tailwind.config.js'), 'module.exports = {};');
        expect(findConfigFile(cwd)).toContain('tailwind.config.js');
    });

    it('flattens nested color scales and skips non-color entries', () => {
        expect(
            flattenColors({ white: '#fff', blue: { '500': '#00f', '600': '#00e' } }).sort(),
        ).toEqual(['blue-500', 'blue-600', 'white']);
    });

    it('extracts spacing and screen keys', () => {
        expect(extractSpacingKeys({ '1': '0.25rem', px: '1px' })).toEqual(['1', 'px']);
        expect(extractScreenKeys({ sm: '640px', md: '768px' })).toEqual(['sm', 'md']);
    });
});

describe('scanTailwindConfig', () => {
    it('loads an ESM config and reports customizations', async () => {
        const { scanTailwindConfig } = await import('../src/scanner/tailwind-scanner.js');
        const cwd = tempRoot();
        const configPath = join(cwd, 'tailwind.config.mjs');
        writeFileSync(
            configPath,
            'export default { theme: { extend: { colors: { brand: "#123456" } } } };',
        );
        const result = await scanTailwindConfig(configPath);
        expect(result.hasCustomColors).toBe(true);
        expect(result.hasCustomSpacing).toBe(false);
        expect(result.configPath).toContain('tailwind.config.mjs');
    });

    it('throws a readable error for a missing or broken config', async () => {
        const { scanTailwindConfig } = await import('../src/scanner/tailwind-scanner.js');
        const cwd = tempRoot();
        await expect(scanTailwindConfig(join(cwd, 'nope.js'))).rejects.toThrow(/not found/);
        const broken = join(cwd, 'tailwind.config.mjs');
        writeFileSync(broken, 'export default {{{');
        await expect(scanTailwindConfig(broken)).rejects.toThrow(/Failed to load/);
    });
});

describe('explainSz literal space', () => {
    it('resolves nested objects, arrays, negatives, booleans and template strings', () => {
        expect(
            explainSz("{ hover: { m: -2 }, list: [1, 'a'], on: true, t: `x`, 'q k': 1 }"),
        ).toBeTypeOf('string');
    });

    it('names each dynamic construct it refuses', () => {
        expect(() => explainSz('{ p: x }')).toThrow(/dynamic/);
        expect(() => explainSz('{ p: `a${x}` }')).toThrow(/interpolation/);
        expect(() => explainSz('{ p: [...xs] }')).toThrow(/spread/);
        expect(() => explainSz('{ ...rest }')).toThrow(/spread/);
        expect(() => explainSz('{ [k]: 1 }')).toThrow(/computed/);
        expect(() => explainSz('{ p: !x }')).toThrow(/unary|dynamic/);
    });

    it('accepts what csszyx itself accepts, rather than a stricter reading', () => {
        // These two were refused while the command carried its own parser,
        // which made it stricter than the compiler: the Vue and Svelte
        // adapters resolve both through the shared reader, so csszyx does
        // compile them and a command whose job is to show what csszyx emits
        // has nothing to refuse. A numeric key is a string key in JS, and an
        // array hole reads as a hole rather than stopping the whole literal.
        //
        // The numeric key now reaches the compiler, which answers with its
        // own diagnostic about numeric keys and emits nothing. That is the
        // gain: the reason a person reads is csszyx's, not a second parser's
        // guess at what csszyx would have said.
        expect(explainSz('{ 4: 1 }')).toBe('');
        expect(() => explainSz('{ p: [1, , 2] }')).not.toThrow();
    });
});

describe('generateTypes happy path', () => {
    it('scans a config and writes the declaration file', async () => {
        const { logs } = captureLogs();
        const cwd = tempRoot();
        const configPath = join(cwd, 'tailwind.config.mjs');
        writeFileSync(
            configPath,
            'export default { theme: { extend: { colors: { brand: "#123456" }, spacing: { huge: "99rem" } } } };',
        );
        const output = join(cwd, 'csszyx-theme.d.ts');
        await generateTypes({ cwd, config: configPath, output });
        const written = readFileSync(output, 'utf8');
        expect(written).toContain('brand');
        expect(logs.join('\n')).toContain('generated successfully');
    });
});

describe('parseClass residual edges', () => {
    it('covers boolean prefixes, negatives, importants, and inset-ring shapes', async () => {
        const { parseClass, disambiguateFont } = await import('../src/migrate/class-parser.js');
        // Boolean-prefix exact match (e.g. ring) → boolean true with important.
        expect(parseClass('ring')).toMatchObject({ value: true });
        // A lone negative boolean-ish prefix is skipped, not parsed.
        expect(parseClass('-z')).toBeNull();
        // prefix + "-" with empty tail is skipped.
        expect(parseClass('p-')).toBeNull();
        // Numeric value with important becomes a string!-suffixed value.
        expect(parseClass('p-4!')).toMatchObject({ value: '4!' });
        // snap disambiguation routes through its helper.
        expect(parseClass('snap-start')).not.toBeNull();
        // inset-ring: arbitrary dimension vs color.
        expect(parseClass('inset-ring-[3px]')).toMatchObject({ prop: 'insetRing' });
        expect(parseClass('inset-ring-red-500')).toMatchObject({ prop: 'insetRingColor' });
        expect(disambiguateFont('sans')).toMatchObject({ prop: 'fontFamily' });
    });
});

describe('sz-codegen value shapes', () => {
    it('renders html values with and without braces, empties, and booleans', async () => {
        const { generateSzExpression, generateSzHtmlValue, generateSzObjectLiteral } = await import(
            '../src/migrate/sz-codegen.js'
        );
        expect(generateSzHtmlValue({ p: 4 }, true)).toContain('{');
        expect(generateSzHtmlValue({ p: 4 })).toBe('p: 4');
        expect(generateSzHtmlValue({})).toBe('');
        expect(generateSzObjectLiteral({ on: false, off: true })).toContain('false');
        expect(generateSzExpression({})).toBe('{{}}');
    });
});
