/**
 * Prescan engine-parity harness.
 *
 * Runs the REAL unplugin prescan (no compiler mocks) over one deliberately
 * dirty fixture tree with each parser — rust, oxc, babel — and asserts the
 * safelist token set is IDENTICAL across engines. This is the in-repo version
 * of the harness a field user had to build themselves to discover that the
 * native engine silently dropped whole files (JSX-in-.js) the JS engines kept:
 * per-snippet transform tests can never see pipeline bugs (file discovery,
 * prescan gates, per-file error handling, fallback asymmetry). Engine scan
 * divergence is a bug by definition — this suite enforces it.
 *
 * FIELD-REPORT RULE: every external bug report that touches the scan pipeline
 * adds a fixture file here. Fixture sources live as template strings (not real
 * files) so intentionally-broken syntax never trips repo-wide lint/typecheck.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { vitePlugin } from '../src/unplugin.js';
import { loadWorkspaceNativeBinding } from './load-workspace-native.js';

type ViteConfigHook = {
    configResolved?: (config: { root: string }) => void;
};

/**
 * Fixture tree — one file per scan-pipeline trap. Keys are paths relative to
 * the fixture root; every entry names the field report (or trap class) it
 * guards against.
 */
const FIXTURE_TREE: Record<string, string> = {
    // vui 0.10.10 item 1: className EXPRESSION beside a static sz (children,
    // extra props) — classes must be safelisted even though emission is a merge.
    'src/App.tsx': `
export const App = ({ isMobile, children }) => (
    <Row className={isMobile ? undefined : 'dems-panel'} sz={{ p: 4 }} grow={0}>
        {children}
    </Row>
);
`,
    // vui 0.10.10 item 2: JSX in plain .js — parse-fail here silently emptied
    // the native engine's scan while the JS engines recovered via Babel.
    'src/toolbar.js': `
export const Toolbar = ({ active }) => (
    <div className="toolbar datetime" sz={{ mx: 0, my: 4 }}>
        <span className={active ? 'toolbar__item--active' : 'toolbar__item'} sz={{ px: 2 }} />
    </div>
);
`,
    // Same trap, .mjs flavour.
    'src/menu.mjs': `
export const Menu = () => <nav className="grouping-popup" sz={{ gap: 2 }} />;
`,
    // vui 0.10.10 item 3: szv variant table kept complete via `satisfies` —
    // TS wrappers used to disable extraction (differently per engine).
    'src/tag-styles.ts': `
import { szv } from '@csszyx/runtime';
export const tagSz = szv({ variants: { c: {
    blue: { bg: 'tag-blue-bg', color: 'tag-blue-fg' },
    red: { bg: 'tag-red-bg', color: 'tag-red-fg' },
} satisfies Record<string, object> } });
`,
    // vui 0.10.10 item 4: bare szr() static arg.
    'src/typography.ts': `
import { szr } from '@csszyx/runtime';
export const widestTracking = szr({ tracking: 'widest' });
`,
    // vui 0.10.10 item 2 (corrupted tokens): a numeric lookup table swallowed
    // by extraction must NOT mint garbage classes like "50-100".
    'src/tables.ts': `
import { szv } from '@csszyx/runtime';
export const opacityScale = szv({ variants: { op: { half: { 50: 100, m: 6 } } } });
`,
    // Multi-key szv variant values (the report's mx-0 minimal repro).
    'src/control.ts': `
import { szv } from '@csszyx/runtime';
export const controlSz = szv({ variants: { layout: {
    stacked: { mb: 2 },
    panelSelect: { grow: 1, mx: 0, my: 4 },
    panel: { grow: 1, m: 4 },
} } });
`,
    // Nested variants + finite conditional (trove 0.10.8 parity class).
    'src/badge.tsx': `
export const Badge = ({ danger }) => (
    <span sz={{ color: danger ? 'red-500' : 'green-500', hover: { bg: 'zinc-100' }, md: { gap: 4 } }} />
);
`,
    // dynamic() literal extraction (Astro SSR path).
    'src/dyn.ts': `
import { dynamic } from 'csszyx';
export const dynCls = dynamic({ leading: 'loose' });
`,
    // szs slot maps on a custom component.
    'src/card.tsx': `
export const StyledCard = () => <Card szs={{ title: { weight: 'semibold' }, body: { text: 'sm' } }} />;
`,
};

// A file the parser must reject: it contributes nothing, but the skip has to be
// a WARNING, never silent (vui item 2 — silently dead classes).
const BROKEN_FIXTURE = `
export const Broken = () => <div sz={{ p: 4 } ;
`;

// A compileSources package file nobody imports — the prescan walks directories,
// not the import graph, so it must still be scanned (vui item 2 note).
const UNIMPORTED_DESIGN_SYSTEM_FIXTURE = `
export const Button = () => <button className="ds-button" sz={{ rounded: 'lg', indent: 8 }} />;
`;

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
});

/**
 * Materialize the fixture tree and run the real prescan with one parser.
 *
 * @param parser - engine under test.
 * @returns sorted safelist tokens + everything console.warn'd during the run.
 */
function runPrescan(parser: 'rust' | 'oxc' | 'babel'): {
    tokens: string[];
    warnings: string[];
} {
    const root = mkdtempSync(join(tmpdir(), `csszyx-parity-${parser}-`));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'design-system'), { recursive: true });
    for (const [file, source] of Object.entries(FIXTURE_TREE)) {
        writeFileSync(join(root, file), source, 'utf8');
    }
    writeFileSync(join(root, 'src/broken.tsx'), BROKEN_FIXTURE, 'utf8');
    writeFileSync(join(root, 'design-system/Button.tsx'), UNIMPORTED_DESIGN_SYSTEM_FIXTURE, 'utf8');

    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
    });
    try {
        const [prePlugin] = vitePlugin({
            build: { parser, cache: false },
            compileSources: ['design-system'],
        }) as ViteConfigHook[];
        prePlugin?.configResolved?.({ root });
    } finally {
        warnSpy.mockRestore();
    }

    let html = '';
    try {
        html = readFileSync(join(root, 'csszyx-classes.html'), 'utf8');
    } catch {
        // Leave tokens empty — the assertions below will point straight at the
        // engine whose prescan produced nothing.
    }
    const classList = html.match(/class="([^"]*)"/)?.[1] ?? '';
    const tokens = [...new Set(classList.split(/\s+/).filter(Boolean))].sort();
    return { tokens, warnings };
}

describe('prescan engine parity (real pipeline, no mocks)', () => {
    beforeAll(() => {
        loadWorkspaceNativeBinding();
    });

    // Computed once; every assertion below reuses the same three runs.
    const runs = {} as Record<'rust' | 'oxc' | 'babel', ReturnType<typeof runPrescan>>;
    beforeAll(() => {
        runs.rust = runPrescan('rust');
        runs.oxc = runPrescan('oxc');
        runs.babel = runPrescan('babel');
    });

    it('rust and oxc scans produce the identical token set', () => {
        expect(runs.rust.tokens).toEqual(runs.oxc.tokens);
    });

    it('babel and oxc scans produce the identical token set', () => {
        expect(runs.babel.tokens).toEqual(runs.oxc.tokens);
    });

    // Known, ENGINE-CONSISTENT gap (not a divergence): string candidates inside
    // className EXPRESSIONS ('dems-panel' in a ternary, the BEM strings in
    // toolbar.js) are not collected by any engine — only string-literal
    // className values are. They are app-owned classes (not Tailwind
    // utilities), so nothing is lost from the generated CSS; if expression
    // string collection ever ships, this snapshot is where it lands.
    it('the token set covers every fixture trap (drift snapshot)', () => {
        expect(runs.rust.tokens).toMatchInlineSnapshot(`
          [
            "bg-tag-blue-bg",
            "bg-tag-red-bg",
            "datetime",
            "ds-button",
            "font-semibold",
            "gap-2",
            "grouping-popup",
            "grow-1",
            "hover:bg-zinc-100",
            "indent-8",
            "leading-loose",
            "m-4",
            "m-6",
            "mb-2",
            "md:gap-4",
            "mx-0",
            "my-4",
            "p-4",
            "px-2",
            "rounded-lg",
            "text-green-500",
            "text-red-500",
            "text-sm",
            "text-tag-blue-fg",
            "text-tag-red-fg",
            "toolbar",
            "tracking-widest",
          ]
        `);
    });

    it('numeric lookup tables never mint garbage tokens', () => {
        for (const engine of ['rust', 'oxc', 'babel'] as const) {
            expect(runs[engine].tokens, engine).not.toContain('50-100');
            expect(runs[engine].tokens, engine).not.toContain('undefined');
        }
    });

    it('a parse-rejected file warns on every engine — never a silent skip', () => {
        // The exact phrasing differs per lane (rust: "prescan skipped"; the JS
        // lanes surface Babel's own parse-failure warning) — the CONTRACT is
        // that some warning names the file, so a developer can find the dead
        // classes before a field user does.
        for (const engine of ['rust', 'oxc', 'babel'] as const) {
            expect(
                runs[engine].warnings.some(w => w.includes('broken.tsx')),
                `${engine}: broken.tsx must be named in a warning`,
            ).toBe(true);
        }
    });

    it('the unimported compileSources file is scanned (directory walk, not import graph)', () => {
        for (const engine of ['rust', 'oxc', 'babel'] as const) {
            expect(runs[engine].tokens, engine).toContain('ds-button');
            expect(runs[engine].tokens, engine).toContain('rounded-lg');
        }
    });
});
