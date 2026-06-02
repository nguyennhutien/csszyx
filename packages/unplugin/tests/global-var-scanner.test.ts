import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    createGlobalVarAliasValidationOptions,
    createGlobalVarScanCacheKey,
    isTailwindReservedGlobalVar,
    planGlobalVarAliases,
    readGlobalVarScanCache,
    resolveGlobalVarScanCacheDir,
    rewriteGlobalVarCssAliases,
    scanGlobalVarCss,
    TAILWIND_RESERVED_PREFIXES,
    validateGlobalVarAliasInputs,
    writeGlobalVarScanCache,
} from '../src/global-var-scanner.js';

describe('scanGlobalVarCss', () => {
    it('records definitions and var() references with scopes and locations', () => {
        const result = scanGlobalVarCss(
            `
:root {
  --brand-primary: #3b82f6;
}

@media (min-width: 768px) {
  .card {
    --app-gap: 1rem;
    gap: var(--app-gap);
    color: var(--brand-primary, black);
  }
}
`,
            { filePath: '/repo/src/tokens.css' },
        );

        expect(result.thirdParty).toBe(false);
        expect(result.definitions.map(definition => definition.name)).toEqual([
            '--brand-primary',
            '--app-gap',
        ]);
        expect(result.definitions[0]).toMatchObject({
            filePath: '/repo/src/tokens.css',
            line: 3,
            column: 3,
            scopeId: 'rule::root',
            tailwindOwned: false,
            registered: false,
        });
        expect(result.references.map(reference => [reference.name, reference.scopeId])).toEqual([
            ['--app-gap', '@media (min-width: 768px) > rule:.card'],
            ['--brand-primary', '@media (min-width: 768px) > rule:.card'],
        ]);
    });

    it('marks @theme definitions as Tailwind-owned', () => {
        const result = scanGlobalVarCss(
            `
@theme {
  --color-primary: #3b82f6;
  --brand-primary: red;
}
`,
            { filePath: '/repo/src/theme.css' },
        );

        expect(result.definitions).toEqual([
            expect.objectContaining({
                name: '--color-primary',
                scopeId: '@theme',
                tailwindOwned: true,
            }),
            expect.objectContaining({
                name: '--brand-primary',
                scopeId: '@theme',
                tailwindOwned: true,
            }),
        ]);
    });

    it('records registered custom properties and third-party CSS', () => {
        const result = scanGlobalVarCss(
            `
@property --brand-angle {
  syntax: '<angle>';
  inherits: true;
  initial-value: 0deg;
}

.widget {
  --brand-angle: 10deg;
  rotate: var(--brand-angle);
}
`,
            { filePath: '/repo/node_modules/pkg/widget.css' },
        );

        expect(result.thirdParty).toBe(true);
        expect(result.registered).toEqual(['--brand-angle']);
        expect(result.definitions[0]).toMatchObject({
            name: '--brand-angle',
            registered: true,
        });
    });

    it('records var() references from at-rule params', () => {
        const result = scanGlobalVarCss(
            `
@container style(--brand-layout: wide) {
  .card { color: red; }
}
@media (width > var(--brand-breakpoint)) {
  .card { color: blue; }
}
`,
            { filePath: '/repo/src/layout.css' },
        );

        expect(result.references).toEqual([
            expect.objectContaining({
                name: '--brand-breakpoint',
                owner: '@media',
                scopeId: '<root>',
            }),
        ]);
    });
});

describe('planGlobalVarAliases', () => {
    it('plans deterministic aliases from explicit tokens and safe declaration scopes', () => {
        const scan = scanGlobalVarCss(
            `
:root {
  --brand-primary: #3b82f6;
  --brand-secondary: #2563eb;
}
[data-theme='dark'] {
  --brand-primary: cyan;
}
`,
        );

        const plan = planGlobalVarAliases({
            scans: [scan],
            tokens: ['--brand-secondary', '--brand-primary'],
        });

        expect(plan.diagnostics).toEqual([]);
        expect(plan.entries).toEqual([
            {
                original: '--brand-primary',
                alias: '---gz',
                scopes: ['rule::root', "rule:[data-theme='dark']"],
            },
            {
                original: '--brand-secondary',
                alias: '---gy',
                scopes: ['rule::root'],
            },
        ]);
        expect(plan.aliases.get('--brand-primary')).toBe('---gz');
    });

    it('discovers candidates by app-owned autoPrefix', () => {
        const scan = scanGlobalVarCss(`
:root {
  --brand-primary: #3b82f6;
  --brand-secondary: #2563eb;
  --other-token: red;
}
`);

        const plan = planGlobalVarAliases({
            scans: [scan],
            autoPrefix: '--brand-',
        });

        expect(plan.entries.map(entry => [entry.original, entry.alias])).toEqual([
            ['--brand-primary', '---gz'],
            ['--brand-secondary', '---gy'],
        ]);
    });

    it('uses a configurable alias prefix with the csszyx z-y-x encoder', () => {
        const scan = scanGlobalVarCss(`
:root {
  --brand-primary: #3b82f6;
  --brand-secondary: #2563eb;
}
`);

        const plan = planGlobalVarAliases({
            scans: [scan],
            autoPrefix: '--brand-',
            aliasPrefix: '--gx',
        });

        expect(plan.entries.map(entry => [entry.original, entry.alias])).toEqual([
            ['--brand-primary', '--gxz'],
            ['--brand-secondary', '--gxy'],
        ]);
    });

    it('fails closed for missing, reserved, @theme, registered, and collision cases', () => {
        const scan = scanGlobalVarCss(`
@property --brand-angle {
  syntax: '<angle>';
  inherits: true;
  initial-value: 0deg;
}
@theme {
  --brand-theme: red;
  --color-primary: blue;
}
:root {
  --brand-angle: 10deg;
  --brand-primary: red;
  --gap: 1rem;
  ---g-token: 1rem;
  ---gz: already-taken;
}
`);

        const collision = planGlobalVarAliases({
            scans: [scan],
            tokens: ['--brand-primary'],
        });
        expect(collision.entries).toEqual([]);
        expect(collision.diagnostics).toEqual([
            expect.objectContaining({
                code: 'alias-collision',
                name: '---gz',
            }),
        ]);

        const invalid = planGlobalVarAliases({
            scans: [scan],
            tokens: [
                '--missing',
                '--color-primary',
                '--brand-theme',
                '--brand-angle',
                '--brand-primary',
                '---g-token',
            ],
        });
        expect(invalid.entries).toEqual([]);
        expect(invalid.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.name])).toEqual(
            expect.arrayContaining([
                ['registered-property', '--brand-angle'],
                ['tailwind-reserved', '--color-primary'],
                ['tailwind-owned', '--color-primary'],
                ['tailwind-owned', '--brand-theme'],
                ['missing-definition', '--missing'],
                ['tailwind-reserved', '---g-token'],
            ]),
        );
        expect(invalid.diagnostics).toHaveLength(6);
    });

    it('honors user reserved exact names and prefixes', () => {
        const scan = scanGlobalVarCss(`
:root {
  --brand-primary: red;
  --app-gap: 1rem;
}
`);

        const plan = planGlobalVarAliases({
            scans: [scan],
            tokens: ['--brand-primary', '--app-gap'],
            reserved: ['--brand-*'],
        });

        expect(plan.diagnostics).toEqual([
            expect.objectContaining({
                code: 'tailwind-reserved',
                name: '--brand-primary',
            }),
        ]);
    });
});

describe('TAILWIND_RESERVED_PREFIXES', () => {
    it('covers Tailwind v4.3 reserved namespaces used by Phase H', () => {
        expect(TAILWIND_RESERVED_PREFIXES).toContain('--font-weight-');
        expect(TAILWIND_RESERVED_PREFIXES).toContain('--tab-size-');
        expect(TAILWIND_RESERVED_PREFIXES).toContain('--zoom-');
        expect(isTailwindReservedGlobalVar('--color-primary')).toBe(true);
        expect(isTailwindReservedGlobalVar('--brand-primary')).toBe(false);
    });
});

describe('global variable scan cache', () => {
    it('keys scan results by file path, mtime, and content hash', () => {
        const cacheRoot = mkdtempSync(join(tmpdir(), 'csszyx-global-vars-'));
        try {
            const cacheDir = resolveGlobalVarScanCacheDir(cacheRoot);
            const filePath = '/repo/src/tokens.css';
            const css = ':root { --brand-primary: red; }';
            const key = createGlobalVarScanCacheKey({ filePath, css, mtimeMs: 123 });
            const changedContentKey = createGlobalVarScanCacheKey({
                filePath,
                css: ':root { --brand-primary: blue; }',
                mtimeMs: 123,
            });
            const changedMtimeKey = createGlobalVarScanCacheKey({ filePath, css, mtimeMs: 124 });
            const result = scanGlobalVarCss(css, { filePath });

            writeGlobalVarScanCache(cacheDir, key, result);

            expect(readGlobalVarScanCache(cacheDir, key)?.definitions[0]?.name).toBe(
                '--brand-primary',
            );
            expect(readGlobalVarScanCache(cacheDir, changedContentKey)).toBeNull();
            expect(readGlobalVarScanCache(cacheDir, changedMtimeKey)).toBeNull();
        } finally {
            rmSync(cacheRoot, { recursive: true, force: true });
        }
    });
});

describe('createGlobalVarAliasValidationOptions', () => {
    it('normalizes bundler CSS assets into validation input', () => {
        const options = createGlobalVarAliasValidationOptions({
            rootDir: '/repo',
            cssAssets: [
                {
                    fileName: 'assets/app.css',
                    source: new TextEncoder().encode(':root { --brand-primary: red; }'),
                    mtimeMs: 10,
                },
                {
                    fileName: 'assets/app.js',
                    source: 'const css = "--brand-primary";',
                },
            ],
            sourceFiles: [
                {
                    filePath: '/repo/src/App.tsx',
                    code: "const App = () => <div sz={{ bg: '--brand-primary' }} />;",
                },
            ],
            tokens: ['--brand-primary'],
            aliasPrefix: '---g',
            cacheDir: '/repo/.csszyx/cache/global-vars',
        });

        expect(options.cssFiles).toEqual([
            {
                filePath: '/repo/assets/app.css',
                css: ':root { --brand-primary: red; }',
                mtimeMs: 10,
            },
        ]);
        expect(options.sourceFiles?.[0]?.filePath).toBe('/repo/src/App.tsx');
        expect(options.tokens).toEqual(['--brand-primary']);
        expect(options.aliasPrefix).toBe('---g');
        expect(options.cacheDir).toBe('/repo/.csszyx/cache/global-vars');

        const validation = validateGlobalVarAliasInputs(options);
        expect(validation.plan.entries.map(entry => [entry.original, entry.alias])).toEqual([
            ['--brand-primary', '---gz'],
        ]);
    });
});

describe('validateGlobalVarAliasInputs', () => {
    it('connects CSS planning with JS out-of-band diagnostics for selected tokens', () => {
        const result = validateGlobalVarAliasInputs({
            cssFiles: [
                {
                    filePath: '/repo/src/tokens.css',
                    css: `
:root {
  --brand-primary: red;
  --brand-secondary: blue;
  --other-token: green;
}
`,
                },
            ],
            sourceFiles: [
                {
                    filePath: '/repo/src/theme.tsx',
                    code: `
document.body.style.setProperty('--brand-primary', color);
document.body.style.setProperty('--other-token', color);
const App = () => <div style={{ '--brand-secondary': color }} />;
`,
                },
            ],
            autoPrefix: '--brand-',
        });

        expect(result.plan.entries.map(entry => [entry.original, entry.alias])).toEqual([
            ['--brand-primary', '---gz'],
            ['--brand-secondary', '---gy'],
        ]);
        expect(
            result.usageDiagnostics.map(diagnostic => [diagnostic.kind, diagnostic.name]),
        ).toEqual([
            ['style-set-property', '--brand-primary'],
            ['jsx-style-key', '--brand-secondary'],
        ]);
    });

    it('does not scan source files when CSS planning fails', () => {
        const result = validateGlobalVarAliasInputs({
            cssFiles: [{ filePath: '/repo/src/tokens.css', css: ':root { ---gz: red; }' }],
            sourceFiles: [
                {
                    filePath: '/repo/src/theme.tsx',
                    code: "document.body.style.setProperty('--brand-primary', color);",
                },
            ],
            tokens: ['--brand-primary'],
        });

        expect(result.plan.diagnostics).toEqual([
            expect.objectContaining({
                code: 'missing-definition',
                name: '--brand-primary',
            }),
        ]);
        expect(result.usageDiagnostics).toEqual([]);
    });

    it('uses the scan cache when cacheDir and mtime are provided', () => {
        const cacheRoot = mkdtempSync(join(tmpdir(), 'csszyx-global-vars-'));
        try {
            const cacheDir = resolveGlobalVarScanCacheDir(cacheRoot);
            const first = validateGlobalVarAliasInputs({
                cacheDir,
                cssFiles: [
                    {
                        filePath: '/repo/src/tokens.css',
                        css: ':root { --brand-primary: red; }',
                        mtimeMs: 1,
                    },
                ],
                tokens: ['--brand-primary'],
            });
            const second = validateGlobalVarAliasInputs({
                cacheDir,
                cssFiles: [
                    {
                        filePath: '/repo/src/tokens.css',
                        css: ':root { --brand-primary: red; }',
                        mtimeMs: 1,
                    },
                ],
                tokens: ['--brand-primary'],
            });

            expect(first.plan.entries[0]?.alias).toBe('---gz');
            expect(second.scans[0]?.definitions[0]?.name).toBe('--brand-primary');
        } finally {
            rmSync(cacheRoot, { recursive: true, force: true });
        }
    });
});

describe('rewriteGlobalVarCssAliases', () => {
    it('emits aliases in declaration scopes and rewrites declaration var() references', () => {
        const css = `
:root {
  --brand-primary: red;
  --brand-secondary: blue;
  color: var(--brand-primary);
}

@media (min-width: 768px) {
  [data-theme='dark'] {
    --brand-primary: cyan;
  }
  .card {
    color: var(--brand-primary, var(--brand-secondary));
  }
}
`;
        const plan = planGlobalVarAliases({
            scans: [scanGlobalVarCss(css, { filePath: '/repo/src/theme.css' })],
            tokens: ['--brand-primary', '--brand-secondary'],
        });

        const result = rewriteGlobalVarCssAliases({ css, plan, filePath: '/repo/src/theme.css' });

        expect(result.diagnostics).toEqual([]);
        expect(result.aliasDeclarations).toBe(3);
        expect(result.rewrittenReferences).toBe(3);
        expect(result.css).toContain('--brand-primary: red;\n  ---gz: var(--brand-primary);');
        expect(result.css).toContain('--brand-secondary: blue;\n  ---gy: var(--brand-secondary);');
        expect(result.css).toContain('--brand-primary: cyan;\n    ---gz: var(--brand-primary);');
        expect(result.css).toContain('color: var(---gz);');
        expect(result.css).toContain('color: var(---gz, var(---gy));');
    });

    it('does not rewrite when the alias plan has diagnostics', () => {
        const css = ':root { --brand-primary: red; color: var(--brand-primary); }';
        const plan = planGlobalVarAliases({
            scans: [scanGlobalVarCss(css)],
            tokens: ['--brand-primary'],
        });
        const invalidPlan = {
            ...plan,
            entries: [],
            aliases: new Map<string, string>(),
            diagnostics: [
                {
                    code: 'missing-definition' as const,
                    severity: 'error' as const,
                    name: '--missing',
                    message: 'missing',
                },
            ],
        };

        const result = rewriteGlobalVarCssAliases({ css, plan: invalidPlan });

        expect(result.css).toBe(css);
        expect(result.aliasDeclarations).toBe(0);
        expect(result.rewrittenReferences).toBe(0);
        expect(result.diagnostics).toHaveLength(1);
    });

    it('skips Tailwind @theme blocks even when given a manual alias plan', () => {
        const css = `
@theme {
  --brand-primary: red;
  color: var(--brand-primary);
}
:root {
  --brand-primary: blue;
  color: var(--brand-primary);
}
`;
        const plan = {
            entries: [
                { original: '--brand-primary', alias: '--g0', scopes: ['@theme', 'rule::root'] },
            ],
            aliases: new Map([['--brand-primary', '--g0']]),
            diagnostics: [],
        };

        const result = rewriteGlobalVarCssAliases({ css, plan });

        expect(result.aliasDeclarations).toBe(1);
        expect(result.rewrittenReferences).toBe(1);
        expect(result.css).toContain(
            '@theme {\n  --brand-primary: red;\n  color: var(--brand-primary);',
        );
        expect(result.css).toContain(
            ':root {\n  --brand-primary: blue;\n  --g0: var(--brand-primary);',
        );
        expect(result.css).toContain('color: var(--g0);');
    });

    it('is idempotent for alias declarations and rewritten references', () => {
        const css = ':root { --brand-primary: red; color: var(--brand-primary); }';
        const plan = planGlobalVarAliases({
            scans: [scanGlobalVarCss(css)],
            tokens: ['--brand-primary'],
        });

        const first = rewriteGlobalVarCssAliases({ css, plan });
        const second = rewriteGlobalVarCssAliases({ css: first.css, plan });

        expect(first.aliasDeclarations).toBe(1);
        expect(first.rewrittenReferences).toBe(1);
        expect(second.aliasDeclarations).toBe(0);
        expect(second.rewrittenReferences).toBe(0);
        expect(second.css).toBe(first.css);
    });

    it('does not rewrite references for scoped-only aliases without a global declaration', () => {
        const css = `
.card {
  --brand-primary: red;
}
.button {
  color: var(--brand-primary);
}
`;
        const plan = planGlobalVarAliases({
            scans: [scanGlobalVarCss(css)],
            tokens: ['--brand-primary'],
        });

        const result = rewriteGlobalVarCssAliases({ css, plan });

        expect(result.aliasDeclarations).toBe(1);
        expect(result.rewrittenReferences).toBe(0);
        expect(result.css).toContain('--brand-primary: red;\n  ---gz: var(--brand-primary);');
        expect(result.css).toContain('color: var(--brand-primary);');
    });

    it('leaves at-rule params untouched in the pure M5 slice', () => {
        const css = `
:root { --brand-breakpoint: 40rem; }
@media (width > var(--brand-breakpoint)) {
  .card { width: var(--brand-breakpoint); }
}
`;
        const plan = planGlobalVarAliases({
            scans: [scanGlobalVarCss(css)],
            tokens: ['--brand-breakpoint'],
        });

        const result = rewriteGlobalVarCssAliases({ css, plan });

        expect(result.css).toContain('@media (width > var(--brand-breakpoint))');
        expect(result.css).toContain('width: var(---gz);');
    });
});
