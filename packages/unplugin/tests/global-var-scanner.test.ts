import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    createGlobalVarScanCacheKey,
    isTailwindReservedGlobalVar,
    planGlobalVarAliases,
    readGlobalVarScanCache,
    resolveGlobalVarScanCacheDir,
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
                alias: '--g0',
                scopes: ['rule::root', "rule:[data-theme='dark']"],
            },
            {
                original: '--brand-secondary',
                alias: '--g1',
                scopes: ['rule::root'],
            },
        ]);
        expect(plan.aliases.get('--brand-primary')).toBe('--g0');
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
            ['--brand-primary', '--g0'],
            ['--brand-secondary', '--g1'],
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
  --g0: already-taken;
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
                name: '--g0',
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
            ]),
        );
        expect(invalid.diagnostics).toHaveLength(5);
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
            ['--brand-primary', '--g0'],
            ['--brand-secondary', '--g1'],
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
            cssFiles: [{ filePath: '/repo/src/tokens.css', css: ':root { --g0: red; }' }],
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

            expect(first.plan.entries[0]?.alias).toBe('--g0');
            expect(second.scans[0]?.definitions[0]?.name).toBe('--brand-primary');
        } finally {
            rmSync(cacheRoot, { recursive: true, force: true });
        }
    });
});
