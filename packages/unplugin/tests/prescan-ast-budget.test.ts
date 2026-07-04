import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const compilerMock = vi.hoisted(() => ({
    transformRustBatch: vi.fn(),
}));

vi.mock('@csszyx/compiler', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler')>();
    return {
        ...actual,
        ensureRustTransformAvailable: vi.fn(),
        transformRustBatch: compilerMock.transformRustBatch,
    };
});

const { vitePlugin } = await import('../src/unplugin.js');

type ViteConfigHook = {
    configResolved?: (config: { root: string }) => void;
};

const tempDirs: string[] = [];

afterEach(() => {
    compilerMock.transformRustBatch.mockReset();
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-prescan-budget-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'src'), { recursive: true });
    return dir;
}

function emptyBatchResult(): {
    code: string;
    transformed: boolean;
    usesRuntime: boolean;
    usesMerge: boolean;
    usesColorVar: boolean;
    classes: Set<string>;
    rawClassNames: Set<string>;
    diagnostics: string[];
    recoveryTokens: Map<string, never>;
    cssVariableMap: Map<string, never>;
} {
    return {
        code: '',
        transformed: false,
        usesRuntime: false,
        usesMerge: false,
        usesColorVar: false,
        classes: new Set(),
        rawClassNames: new Set(),
        diagnostics: [],
        recoveryTokens: new Map(),
        cssVariableMap: new Map(),
    };
}

describe('prescan AST budget', () => {
    it('runs the rust prescan batch with the larger safelist budget by default', () => {
        const root = tempRoot();
        writeFileSync(join(root, 'src/A.tsx'), 'export const A = () => <div sz={{ p: 4 }} />;');
        writeFileSync(join(root, 'src/B.tsx'), 'export const B = () => <div sz={{ m: 2 }} />;');
        compilerMock.transformRustBatch.mockImplementation((files: Array<{ filename: string }>) =>
            files.map(() => emptyBatchResult()),
        );

        const [prePlugin] = vitePlugin({
            build: { parser: 'rust', cache: false },
        }) as ViteConfigHook[];
        prePlugin.configResolved?.({ root });

        expect(compilerMock.transformRustBatch).toHaveBeenCalledTimes(1);
        expect(compilerMock.transformRustBatch.mock.calls[0]?.[1]).toMatchObject({
            astBudget: 500_000,
        });
    });

    it('build.astBudgetLimit overrides the prescan budget too', () => {
        const root = tempRoot();
        writeFileSync(join(root, 'src/A.tsx'), 'export const A = () => <div sz={{ p: 4 }} />;');
        writeFileSync(join(root, 'src/B.tsx'), 'export const B = () => <div sz={{ m: 2 }} />;');
        compilerMock.transformRustBatch.mockImplementation((files: Array<{ filename: string }>) =>
            files.map(() => emptyBatchResult()),
        );

        const [prePlugin] = vitePlugin({
            build: { parser: 'rust', cache: false, astBudgetLimit: 111_111 },
        }) as ViteConfigHook[];
        prePlugin.configResolved?.({ root });

        expect(compilerMock.transformRustBatch.mock.calls[0]?.[1]).toMatchObject({
            astBudget: 111_111,
        });
    });

    it('warns loudly (with the fix attached) when a rust result carries the budget diagnostic', () => {
        const root = tempRoot();
        const bigPath = join(root, 'src/Big.tsx');
        writeFileSync(bigPath, 'export const Big = () => <div sz={{ p: 4 }} />;');
        writeFileSync(join(root, 'src/Ok.tsx'), 'export const Ok = () => <div sz={{ m: 2 }} />;');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        compilerMock.transformRustBatch.mockImplementation(
            (files: Array<{ filename: string; source: string }>) =>
                files.map(file =>
                    file.filename === bigPath
                        ? {
                              ...emptyBatchResult(),
                              code: file.source,
                              diagnostics: [
                                  `[csszyx] AST budget exceeded in ${file.filename}: the IR walk stopped mid-file.`,
                              ],
                          }
                        : {
                              ...emptyBatchResult(),
                              code: 'export const Ok = () => <div className="m-2" />;',
                              transformed: true,
                              classes: new Set(['m-2']),
                          },
                ),
        );

        const [prePlugin] = vitePlugin({
            build: { parser: 'rust', cache: false },
        }) as ViteConfigHook[];
        prePlugin.configResolved?.({ root });

        const budgetWarnings = warn.mock.calls
            .map(call => String(call[0]))
            .filter(message => message.includes('exceeds the AST node budget'));
        expect(budgetWarnings).toHaveLength(1);
        expect(budgetWarnings[0]).toContain('src/Big.tsx');
        expect(budgetWarnings[0]).toContain('astBudgetLimit');
        // The healthy sibling file still reaches the safelist.
        expect(readFileSync(join(root, 'csszyx-classes.html'), 'utf8')).toContain('m-2');
    });

    it('oxc prescan extracts a real page file the transform-hook budget would reject', () => {
        const root = tempRoot();
        // >50k AST nodes for the JS engines (the compiler-level default throws
        // ASTBudgetExceededError on this shape), yet well under the prescan cap.
        const bigSource = `import { szv } from 'csszyx';
const controlSz = szv({ variants: { layout: { a: { mx: 0, my: 4 } } } });
export const Page = () => (<div>${'<span className="cell">x</span>'.repeat(30_000)}</div>);
`;
        writeFileSync(join(root, 'src/Page.tsx'), bigSource);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const [prePlugin] = vitePlugin({
            build: { parser: 'oxc', cache: false },
        }) as ViteConfigHook[];
        prePlugin.configResolved?.({ root });

        const safelist = readFileSync(join(root, 'csszyx-classes.html'), 'utf8');
        expect(safelist).toContain('mx-0');
        expect(safelist).toContain('my-4');
        const budgetWarnings = warn.mock.calls
            .map(call => String(call[0]))
            .filter(message => message.includes('exceeds the AST node budget'));
        expect(budgetWarnings).toHaveLength(0);
    });
});
