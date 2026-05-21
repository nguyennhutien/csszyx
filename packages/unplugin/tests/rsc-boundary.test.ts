import { transformSourceCode } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';

import {
    assertNoRSCBoundaryViolation,
    findRSCBoundaryViolation,
    findRSCGraphViolation,
    hasUseClientDirective,
    hasUseServerDirective,
    isRSCServerModule,
    type RSCModuleRecord,
} from '../src/rsc-boundary.js';
import { vitePlugin } from '../src/unplugin.js';

const SERVER_FILE = '/app/actions.tsx';

type TransformHook = {
    transform: (this: { warn: (message: string) => void }, code: string, id: string) => unknown;
};

/**
 * Mirrors unplugin's runtime import insertion after a directive prologue.
 * @param code transformed module code
 * @param symbol runtime helper symbol to import
 * @returns code with the runtime import inserted
 */
function injectRuntimeImportLikePlugin(code: string, symbol: string): string {
    const directiveMatch = code.match(/^['"]use (client|server)['"];?\s*/);
    const importStmt = `import { ${symbol} } from '@csszyx/runtime';\n`;
    if (!directiveMatch) {
        return `${importStmt}${code}`;
    }
    return code.replace(directiveMatch[0], `${directiveMatch[0]}${importStmt}`);
}

describe('RSC boundary guard', () => {
    it('detects a top-level use server directive after comments', () => {
        expect(
            hasUseServerDirective(`
            // comment
            /* block */
            'use server';
            import { action } from './action';
        `),
        ).toBe(true);
    });

    it('does not treat use client modules as server modules', () => {
        expect(
            hasUseServerDirective(`
            'use client';
            import { _sz } from '@csszyx/runtime';
        `),
        ).toBe(false);
        expect(
            hasUseClientDirective(`
            'use client';
            import { _sz } from '@csszyx/runtime';
        `),
        ).toBe(true);
    });

    it('treats Next App Router entry files as server modules unless use client is present', () => {
        expect(
            isRSCServerModule(
                'export default function Page() { return null; }',
                '/repo/app/page.tsx',
            ),
        ).toBe(true);
        expect(
            isRSCServerModule(
                `
            'use client';
            export default function Page() { return null; }
        `,
                '/repo/app/page.tsx',
            ),
        ).toBe(false);
    });

    it('fails explicit forbidden runtime helper imports in use server modules', () => {
        const code = `
            'use server';
            import { _sz as cx } from '@csszyx/runtime';
            export async function action() {
                return cx({ p: 4 });
            }
        `;

        expect(() => assertNoRSCBoundaryViolation(code, SERVER_FILE)).toThrow(
            'csszyxRSCViolation: _sz imported in Server Component /app/actions.tsx\n' +
                '  Import chain: /app/actions.tsx -> @csszyx/runtime',
        );
    });

    it('fails generated _sz imports from dynamic sz fallback in use server modules', () => {
        const source = `
            'use server';
            export function Card({ styles }) {
                return <div sz={styles} />;
            }
        `;
        const result = transformSourceCode(source, SERVER_FILE);

        expect(result.code).toContain('_sz(styles)');
        expect(() => {
            assertNoRSCBoundaryViolation(
                injectRuntimeImportLikePlugin(result.code, '_sz'),
                SERVER_FILE,
            );
        }).toThrow('csszyxRSCViolation: _sz imported in Server Component /app/actions.tsx');
    });

    it('fails generated _szMerge imports from dynamic className merge in use server modules', () => {
        const source = `
            'use server';
            export function Card({ styles, className }) {
                return <div className={className} sz={styles} />;
            }
        `;
        const result = transformSourceCode(source, SERVER_FILE);

        expect(result.code).toContain('_szMerge');
        expect(() => {
            assertNoRSCBoundaryViolation(
                injectRuntimeImportLikePlugin(result.code, '_szMerge'),
                SERVER_FILE,
            );
        }).toThrow('csszyxRSCViolation: _szMerge imported in Server Component /app/actions.tsx');
    });

    it('allows static sz in use server modules because no runtime helper is needed', () => {
        const source = `
            'use server';
            export function Card() {
                return <div sz={{ p: 4, bg: 'red-500' }} />;
            }
        `;
        const result = transformSourceCode(source, SERVER_FILE);

        expect(result.usesRuntime).toBe(false);
        expect(() => assertNoRSCBoundaryViolation(result.code, SERVER_FILE)).not.toThrow();
    });

    it('fails runtime helper imports in default-server Next App Router route files', () => {
        const source = `
            export default function Page({ styles }) {
                return <div sz={styles} />;
            }
        `;
        const result = transformSourceCode(source, '/repo/app/page.tsx');

        expect(result.code).toContain('_sz(styles)');
        expect(() => {
            assertNoRSCBoundaryViolation(
                `import { _sz } from '@csszyx/runtime';\n${result.code}`,
                '/repo/app/page.tsx',
            );
        }).toThrow('csszyxRSCViolation: _sz imported in Server Component /repo/app/page.tsx');
    });

    it('keeps generated runtime imports after leading-comment server directives', () => {
        const [prePlugin] = vitePlugin({
            build: { parser: 'babel', cache: false },
        }) as TransformHook[];
        const source = `
            // comments before directives are legal directive prologue trivia
            'use server';
            export function Card({ styles }) {
                return <div sz={styles} />;
            }
        `;

        expect(() =>
            prePlugin.transform.call({ warn: () => undefined }, source, '/repo/actions.tsx'),
        ).toThrow('csszyxRSCViolation: _sz imported in Server Component /repo/actions.tsx');
    });

    it('ignores type-only runtime imports', () => {
        const code = `
            'use server';
            import type { SzInput } from '@csszyx/runtime';
            export async function action(input: SzInput) {
                return input;
            }
        `;

        expect(findRSCBoundaryViolation(code, SERVER_FILE)).toBeNull();
    });

    it('flags namespace and dynamic runtime imports conservatively', () => {
        expect(
            findRSCBoundaryViolation(
                `
            'use server';
            import * as runtime from '@csszyx/runtime';
        `,
                SERVER_FILE,
            )?.symbol,
        ).toBe('_sz');

        expect(
            findRSCBoundaryViolation(
                `
            'use server';
            export async function action() {
                return import('@csszyx/runtime');
            }
        `,
                SERVER_FILE,
            )?.symbol,
        ).toBe('_sz');
    });

    it('fails when a server route imports a child module that imports a forbidden runtime helper', () => {
        const records = new Map<string, RSCModuleRecord>([
            [
                '/repo/app/page.tsx',
                {
                    id: '/repo/app/page.tsx',
                    isServer: true,
                    isClient: false,
                    imports: ['/repo/app/ServerCard.tsx'],
                    runtimeImports: [],
                },
            ],
            [
                '/repo/app/ServerCard.tsx',
                {
                    id: '/repo/app/ServerCard.tsx',
                    isServer: false,
                    isClient: false,
                    imports: [],
                    runtimeImports: [{ source: '@csszyx/runtime', symbols: ['_sz'] }],
                },
            ],
        ]);

        expect(findRSCGraphViolation(records)).toEqual({
            symbol: '_sz',
            path: '/repo/app/page.tsx',
            importChain: ['/repo/app/page.tsx', '/repo/app/ServerCard.tsx', '@csszyx/runtime'],
        });
    });

    it('stops graph traversal at use client boundaries', () => {
        const records = new Map<string, RSCModuleRecord>([
            [
                '/repo/app/page.tsx',
                {
                    id: '/repo/app/page.tsx',
                    isServer: true,
                    isClient: false,
                    imports: ['/repo/app/ClientCard.tsx'],
                    runtimeImports: [],
                },
            ],
            [
                '/repo/app/ClientCard.tsx',
                {
                    id: '/repo/app/ClientCard.tsx',
                    isServer: false,
                    isClient: true,
                    imports: ['/repo/app/ClientLeaf.tsx'],
                    runtimeImports: [{ source: '@csszyx/runtime', symbols: ['_sz'] }],
                },
            ],
            [
                '/repo/app/ClientLeaf.tsx',
                {
                    id: '/repo/app/ClientLeaf.tsx',
                    isServer: false,
                    isClient: false,
                    imports: [],
                    runtimeImports: [{ source: '@csszyx/runtime', symbols: ['_szMerge'] }],
                },
            ],
        ]);

        expect(findRSCGraphViolation(records)).toBeNull();
    });

    it('handles cycles while walking server-owned imports', () => {
        const records = new Map<string, RSCModuleRecord>([
            [
                '/repo/app/page.tsx',
                {
                    id: '/repo/app/page.tsx',
                    isServer: true,
                    isClient: false,
                    imports: ['/repo/app/a.tsx'],
                    runtimeImports: [],
                },
            ],
            [
                '/repo/app/a.tsx',
                {
                    id: '/repo/app/a.tsx',
                    isServer: false,
                    isClient: false,
                    imports: ['/repo/app/b.tsx'],
                    runtimeImports: [],
                },
            ],
            [
                '/repo/app/b.tsx',
                {
                    id: '/repo/app/b.tsx',
                    isServer: false,
                    isClient: false,
                    imports: ['/repo/app/a.tsx'],
                    runtimeImports: [{ source: '@csszyx/runtime', symbols: ['_szMerge'] }],
                },
            ],
        ]);

        expect(findRSCGraphViolation(records)?.importChain).toEqual([
            '/repo/app/page.tsx',
            '/repo/app/a.tsx',
            '/repo/app/b.tsx',
            '@csszyx/runtime',
        ]);
    });
});

// =====================================================================
// Known issues — fix planned in this version pump.
//
// These tests document concrete behavioural gaps in the RSC boundary
// guard surfaced by the 2026-05-13 audit. Each uses `it.fails(...)` so
// the suite stays green while the bug exists; when a fix lands the
// inner assertion starts passing and `it.fails` flips to red, forcing
// the contributor to remove the `.fails` qualifier and promote the
// test to a regular `it(...)`.
//
// Severity ordering:
//   #3 subpath bypass            — HIGH (csszyx/browser + csszyx/dynamic exist today)
//   #2 default-import bypass     — MEDIUM (defensive; runtime has no default export yet)
//   #1 commented-out false +ve   — LOW (annoying but workaround = delete the comment)
//   #4 normalizeModuleId perf    — LOW (fine on this repo, may bite large monorepos)
//   #5 stale state on HMR        — LOW (dev-only, server restart clears)
// =====================================================================

describe('Known issues — fix planned in next version pump', () => {
    // ---- Issue 3 ---------------------------------------------------
    // Subpath bypass. RUNTIME_MODULES is an exact-match Set, so any
    // import from `csszyx/*` or `@csszyx/*` outside the four hard-coded
    // entries silently passes the guard. csszyx already ships
    // `csszyx/browser` and `csszyx/dynamic` (umbrella package's
    // package.json `exports` map), plus the standalone `@csszyx/dynamic`
    // package — none of which are safe to import from a Server
    // Component. Fix should switch to a prefix match against
    // `csszyx`, `@csszyx/runtime`, `@csszyx/dynamic` package roots and
    // treat ANY import from those roots as forbidden (regardless of
    // imported symbol name), since runtime subpaths can expose their
    // own client-only APIs.

    it.fails('flags named imports from csszyx/dynamic in a server module', () => {
        const code = `
            'use server';
            import { dynamic } from 'csszyx/dynamic';
            export async function action() {
                return dynamic({ p: 4 });
            }
        `;
        expect(() => assertNoRSCBoundaryViolation(code, SERVER_FILE)).toThrow('csszyxRSCViolation');
    });

    it.fails('flags named imports from the standalone @csszyx/dynamic package', () => {
        const code = `
            'use server';
            import { dynamic } from '@csszyx/dynamic';
            export async function action() {
                return dynamic({ p: 4 });
            }
        `;
        expect(() => assertNoRSCBoundaryViolation(code, SERVER_FILE)).toThrow('csszyxRSCViolation');
    });

    it.fails('flags namespace imports from csszyx/dynamic in a server module', () => {
        const code = `
            'use server';
            import * as cssz from 'csszyx/dynamic';
            export async function action() {
                return cssz.dynamic({ p: 4 });
            }
        `;
        expect(() => assertNoRSCBoundaryViolation(code, SERVER_FILE)).toThrow('csszyxRSCViolation');
    });

    it.fails('flags side-effect imports of csszyx/browser in a server module', () => {
        // csszyx/browser is the IIFE runtime bundled for vanilla HTML —
        // unconditionally CSP-active in the browser, attaches a
        // MutationObserver. Importing it for side-effect from a server
        // module ships client-only code via the SSR transport.
        const code = `
            'use server';
            import 'csszyx/browser';
            export async function action() {
                return null;
            }
        `;
        expect(() => assertNoRSCBoundaryViolation(code, SERVER_FILE)).toThrow('csszyxRSCViolation');
    });

    // ---- Issue 2 ---------------------------------------------------
    // `readImportedSymbols` only scans inside `{...}` blocks, so default
    // and `* as` aliased imports of a runtime helper bypass the check.
    // csszyx/runtime currently has no default export, but the moment
    // one is added (or someone uses a barrel re-export) this becomes a
    // silent failure. Fix should also inspect the default-import
    // identifier preceding the `{...}` or `from` keyword.

    it.fails('flags default imports of forbidden runtime symbols', () => {
        const code = `
            'use server';
            import _sz from '@csszyx/runtime';
            export async function action() {
                return _sz({ p: 4 });
            }
        `;
        expect(() => assertNoRSCBoundaryViolation(code, SERVER_FILE)).toThrow('csszyxRSCViolation');
    });

    it.fails('flags mixed default + named imports where the default is forbidden', () => {
        const code = `
            'use server';
            import _sz, { other } from '@csszyx/runtime';
            export async function action() {
                return _sz({ p: 4 });
            }
        `;
        expect(() => assertNoRSCBoundaryViolation(code, SERVER_FILE)).toThrow('csszyxRSCViolation');
    });

    // ---- Issue 1 ---------------------------------------------------
    // `findRuntimeImports` runs regex against raw source — line and
    // block comments are not stripped, so a forbidden import that has
    // been commented out for any reason (stale code, FIX-ME marker,
    // pending refactor) still trips the guard. Fix should remove
    // single-line and block comments before scanning, or move to an
    // AST-aware lightweight tokenizer.

    it.fails('allows commented-out forbidden imports without triggering the guard', () => {
        const code = `
            'use server';

            // import { _sz } from '@csszyx/runtime';
            // FIX: removed pending client-island refactor

            export async function action() {
                return { ok: true };
            }
        `;
        expect(() => assertNoRSCBoundaryViolation(code, SERVER_FILE)).not.toThrow();
    });

    it.fails('allows block-commented forbidden imports', () => {
        const code = `
            'use server';

            /*
             * Disabled while ServerCard refactor is in flight.
             * import { _szMerge } from '@csszyx/runtime';
             */

            export async function action() {
                return { ok: true };
            }
        `;
        expect(() => assertNoRSCBoundaryViolation(code, SERVER_FILE)).not.toThrow();
    });

    // ---- Issue 5 ---------------------------------------------------
    // `state.rscModules` is a long-lived Map keyed by module ID. Dev-
    // mode HMR reuses the same plugin instance, so when a file is
    // deleted from disk its stale record stays in the Map and is
    // included in the next `buildEnd()` graph walk. The current code
    // never invalidates records on file deletion. Fix should hook into
    // the bundler's "module removed" event (or revalidate file
    // existence in `assertNoRSCGraphViolation`).

    it.fails('graph walk should not report a violation rooted in a module whose file no longer exists', () => {
        const records = new Map<string, RSCModuleRecord>([
            [
                '/repo/app/deleted-page.tsx',
                {
                    id: '/repo/app/deleted-page.tsx',
                    isServer: true,
                    isClient: false,
                    imports: [],
                    runtimeImports: [{ source: '@csszyx/runtime', symbols: ['_sz'] }],
                },
            ],
        ]);

        // The file at this path was deleted between transforms; the
        // record is stale. A correct implementation would revalidate
        // existence and skip the missing module.
        expect(findRSCGraphViolation(records)).toBeNull();
    });

    // ---- Issue 4 ---------------------------------------------------
    // `normalizeModuleId` calls `fs.realpathSync.native` on every
    // record creation, and `resolveLocalModule` does up to 11
    // `existsSync` + `statSync` calls per relative import (extension
    // fallback). For monorepos with thousands of TS files this adds up
    // — every transform pass repeats the same lookups. Fix should
    // memoise both normalisation and resolution per plugin lifetime.
    //
    // Not a unit-test concern — would be a microbenchmark against a
    // generated workspace of N files. Tracked here for visibility.

    it.todo('normalizeModuleId memoises repeated lookups across transforms');
    it.todo('resolveLocalModule memoises extension-fallback results across transforms');
});
