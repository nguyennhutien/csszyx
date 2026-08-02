/**
 * Size contract of the runtime split (`@csszyx/runtime/core` + `/lowering`).
 *
 * `import { szr }` from the main entry ships the ~12.6 KB gz browser transform
 * because the object branch must work standalone — that is the entry's
 * contract and it must NOT quietly change. The split adds two entries: `/core`
 * (string-first helpers, no compiler) and `/lowering` (bare side-effect import
 * that registers object support). This suite bundles each shape with esbuild —
 * the same measurement that motivated the split — so a regression in either
 * direction fails CI:
 *
 * - a static compiler reference sneaking back into `/core` (the win evaporates
 *   silently), or
 * - a module-level side effect landing in the barrel graph (tree shaking dies
 *   and `szv`'s 781 B jumps to 13 KB for every consumer), or
 * - `sideEffects` misconfiguration dropping the bare `/lowering` import (objects
 *   start throwing in production).
 */
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

/**
 * A string constant that exists only in the compiler's transform chunk — a
 * dev-warning message, kept verbatim by minification. Present in a bundle
 * exactly when the browser transform shipped.
 */
const COMPILER_MARKER = 'received a numeric key';

/** One bundled entry probe. */
interface BundleProbe {
    gzipBytes: number;
    hasCompiler: boolean;
    code: string;
}

/**
 * Bundle a snippet against the workspace packages, production-shaped.
 *
 * @param source - Entry module source.
 * @returns Gzip size and compiler presence.
 */
async function bundleProbe(source: string): Promise<BundleProbe> {
    const result = await build({
        stdin: {
            contents: source,
            // Resolve from this package so `@csszyx/runtime` follows the same
            // workspace linking an app would use.
            resolveDir: __dirname,
            loader: 'js',
        },
        bundle: true,
        minify: true,
        write: false,
        format: 'esm',
        define: { 'process.env.NODE_ENV': '"production"' },
        logLevel: 'silent',
    });
    const [output] = result.outputFiles;
    return {
        gzipBytes: gzipSync(output.contents, { level: 6 }).length,
        hasCompiler: output.text.includes(COMPILER_MARKER),
        code: output.text,
    };
}

describe('runtime split size contract', () => {
    it('the marker string still identifies the compiler chunk', () => {
        // If a compiler refactor ever renames this warning, every assertion
        // below would silently test nothing — pin the marker itself first.
        // The entry re-exports from a shared chunk (ESM `from './shared/…'`,
        // CJS `require('./shared/…')`), so scan the entry plus every sibling
        // chunk rather than parsing either syntax.
        const fs = require('node:fs');
        const path = require('node:path');
        const browserEntry = require.resolve('@csszyx/compiler/browser');
        const sharedDir = path.join(path.dirname(browserEntry), 'shared');
        const candidates = [browserEntry];
        if (fs.existsSync(sharedDir)) {
            for (const name of fs.readdirSync(sharedDir)) {
                candidates.push(path.join(sharedDir, name));
            }
        }
        const found = candidates.some(file =>
            String(fs.readFileSync(file)).includes(COMPILER_MARKER),
        );
        expect(found).toBe(true);
    });

    it('barrel szr keeps its standalone contract: compiler included', async () => {
        const probe = await bundleProbe("import { szr } from '@csszyx/runtime'; console.log(szr);");
        expect(probe.hasCompiler).toBe(true);
    });

    it('barrel szv stays light — the anti-poisoning guard', async () => {
        // The one regression this architecture could cause: a top-level impure
        // statement anywhere in the barrel graph would be retained for every
        // consumer and weld the compiler onto szv/szcn/szDecode imports.
        const probe = await bundleProbe("import { szv } from '@csszyx/runtime'; console.log(szv);");
        expect(probe.hasCompiler).toBe(false);
        expect(probe.gzipBytes).toBeLessThan(2_000);
    });

    it('barrel szDecode stays tiny', async () => {
        const probe = await bundleProbe(
            "import { szDecode } from '@csszyx/runtime'; console.log(szDecode);",
        );
        expect(probe.hasCompiler).toBe(false);
        expect(probe.gzipBytes).toBeLessThan(1_000);
    });

    it('barrel __szvPick stays light — the shape the plugin injects', async () => {
        // The unplugin injects the pickers from the BARREL on purpose (a
        // measured call: the barrel szv surface tree-shakes clean, and /core
        // would be a second import line for the same bytes). This probe pins
        // the injected shape itself, so the claim rests on a bundle, not on
        // the szv probe above happening to share a chunk.
        const probe = await bundleProbe(
            "import { __szvPick, __szvPick1 } from '@csszyx/runtime'; console.log(__szvPick, __szvPick1);",
        );
        expect(probe.hasCompiler).toBe(false);
        expect(probe.gzipBytes).toBeLessThan(2_000);
    });

    it('core szr ships no compiler', async () => {
        const probe = await bundleProbe(
            "import { szr } from '@csszyx/runtime/core'; console.log(szr);",
        );
        expect(probe.hasCompiler).toBe(false);
        // 13.1 KB before the split, ~3 KB while core still carried the merge
        // family, 603 B once /merge became its own entry. Headroom for chunk
        // noise, tight enough to catch the merge tables sneaking back in.
        expect(probe.gzipBytes).toBeLessThan(1_500);
    });

    it('the merge entry carries the group tables but no compiler', async () => {
        const probe = await bundleProbe(
            "import { _szPart, _szcn } from '@csszyx/runtime/merge'; console.log(_szPart, _szcn);",
        );
        expect(probe.hasCompiler).toBe(false);
        // The box-role tables are the merge family's data — ~5 KB is its
        // honest cost. The barrel _szPart was 17 KB WITH the compiler.
        expect(probe.gzipBytes).toBeLessThan(7_000);
    });

    it('the bare /lowering import survives bundling and restores the compiler', async () => {
        // sideEffects misconfiguration would drop the import silently — the
        // bundle would be small, objects would throw in production.
        const probe = await bundleProbe(
            "import '@csszyx/runtime/lowering';\n" +
                "import { szr } from '@csszyx/runtime/core'; console.log(szr);",
        );
        expect(probe.hasCompiler).toBe(true);
    });
});

describe('szr import rewrite, end to end', () => {
    it('a compiled szr-strings module bundles without the compiler', async () => {
        // The whole point of the split: compiler proves strings-only, rewrites
        // the import, and the resulting bundle drops ~13 KB gz of transform.
        const { transformSourceCode } = require('@csszyx/compiler');
        const source =
            "import { szr } from '@csszyx/runtime';\n" +
            "export const cls = szr('p-4', true && 'm-2');\n";
        const compiled = transformSourceCode(source, '/app/Button.tsx').code as string;
        expect(compiled).toContain('@csszyx/runtime/core');
        const probe = await bundleProbe(compiled);
        expect(probe.hasCompiler).toBe(false);
        expect(probe.gzipBytes).toBeLessThan(5_000);
    });

    it('an szr-objects module keeps the barrel and stays object-capable', async () => {
        const { transformSourceCode } = require('@csszyx/compiler');
        const source =
            "import { szr } from '@csszyx/runtime';\n" + 'export const cls = (cfg) => szr(cfg);\n';
        const compiled = transformSourceCode(source, '/app/Card.tsx').code ?? source;
        expect(compiled).not.toContain('@csszyx/runtime/core');
        const probe = await bundleProbe(compiled);
        expect(probe.hasCompiler).toBe(true);
    });
});

describe('szv precompile, end to end', () => {
    it('a precompiled szv+szr module bundles without the compiler', async () => {
        // The composed prize: variant leaves become build-time strings, the
        // dynamic path becomes a table pick, every szr argument is therefore a
        // string, the szr import moves to /core - and the transform chunk
        // never ships. The picker injection is the unplugin's job, so this
        // probe appends the exact import the plugin injects — the BARREL form
        // (requiredRuntimeHelpers routes __szvPick there), not a hand-written
        // /core line the plugin never emits.
        const { transformSourceCode } = require('@csszyx/compiler');
        // The single-clause import is the shape people actually write; the
        // compiler splits it, moving szr to the core entry on its own line.
        const source =
            "import { szr, szv } from '@csszyx/runtime';\n" +
            "const cardSz = szv({ base: { rounded: 'lg' }, variants: { pad: { sm: { p: 2 }, lg: { p: 8 } } } });\n" +
            'export const C = (sel) => szr(cardSz(sel), cardSz({ pad: "sm" }));\n';
        const result = transformSourceCode(source, '/app/Card.tsx');
        expect(result.usesSzvPick).toBe(true);
        const compiled = `import { __szvPick } from '@csszyx/runtime';\n${result.code as string}`;
        expect(compiled).toContain('@csszyx/runtime/core');
        expect(compiled).toContain('__szvT_cardSz');
        const probe = await bundleProbe(compiled);
        expect(probe.hasCompiler).toBe(false);
        expect(probe.gzipBytes).toBeLessThan(5_000);
    });
});

describe('runtime split functional contract (built dist)', () => {
    it('registration from the /lowering entry reaches the /core entry', async () => {
        // Cross-entry: rollup must keep the slot in ONE shared chunk. Two
        // copies would mean registering into instance A while helpers read B.
        const lowering = require.resolve('@csszyx/runtime/lowering');
        const core = require.resolve('@csszyx/runtime/core');
        await import(lowering);
        const { szr } = await import(core);
        expect(szr({ p: 4, bg: 'red-500' })).toBe('p-4 bg-red-500');
    });
});
