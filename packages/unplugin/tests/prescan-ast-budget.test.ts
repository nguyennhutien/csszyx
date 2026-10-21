import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const compilerMock = vi.hoisted(() => ({
    transformRust: vi.fn(),
    transformRustBatch: vi.fn(),
}));

vi.mock('@csszyx/compiler/engine', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler/engine')>();
    return { ...actual, ensureRustTransformAvailable: vi.fn() };
});

// The build lanes call the unrendered transforms.
vi.mock('@csszyx/compiler/internal', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler/internal')>();
    return {
        ...actual,
        transformRustUnrendered: compilerMock.transformRust,
        transformRustBatchUnrendered: compilerMock.transformRustBatch,
    };
});

const { vitePlugin } = await import('../src/unplugin.js');

type ViteConfigHook = {
    configResolved?: (config: { root: string }) => Promise<void>;
    transform?: (this: { warn(message: string): void }, code: string, id: string) => unknown;
    buildEnd?: (this: { warn(message: string): void; error(message: string): void }) => void;
};

const tempDirs: string[] = [];

afterEach(() => {
    compilerMock.transformRustBatch.mockReset();
    compilerMock.transformRust.mockReset();
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
    usesSpacingVar: boolean;
    usesUnitVar: boolean;
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
        usesSpacingVar: false,
        usesUnitVar: false,
        classes: new Set(),
        rawClassNames: new Set(),
        diagnostics: [],
        recoveryTokens: new Map(),
        cssVariableMap: new Map(),
    };
}

describe('prescan AST budget', () => {
    it('runs the rust prescan batch with the larger safelist budget by default', async () => {
        const root = tempRoot();
        writeFileSync(join(root, 'src/A.tsx'), 'export const A = () => <div sz={{ p: 4 }} />;');
        writeFileSync(join(root, 'src/B.tsx'), 'export const B = () => <div sz={{ m: 2 }} />;');
        compilerMock.transformRustBatch.mockImplementation((files: Array<{ filename: string }>) =>
            files.map(() => emptyBatchResult()),
        );

        const [prePlugin] = vitePlugin({
            build: { parser: 'rust', cache: false },
        }) as ViteConfigHook[];
        await prePlugin.configResolved?.({ root });

        expect(compilerMock.transformRustBatch).toHaveBeenCalledTimes(1);
        expect(compilerMock.transformRustBatch.mock.calls[0]?.[1]).toMatchObject({
            astBudget: 500_000,
        });
    });

    it('build.astBudgetLimit overrides the prescan budget too', async () => {
        const root = tempRoot();
        writeFileSync(join(root, 'src/A.tsx'), 'export const A = () => <div sz={{ p: 4 }} />;');
        writeFileSync(join(root, 'src/B.tsx'), 'export const B = () => <div sz={{ m: 2 }} />;');
        compilerMock.transformRustBatch.mockImplementation((files: Array<{ filename: string }>) =>
            files.map(() => emptyBatchResult()),
        );

        const [prePlugin] = vitePlugin({
            build: { parser: 'rust', cache: false, astBudgetLimit: 111_111 },
        }) as ViteConfigHook[];
        await prePlugin.configResolved?.({ root });

        expect(compilerMock.transformRustBatch.mock.calls[0]?.[1]).toMatchObject({
            astBudget: 111_111,
        });
    });

    it('warns loudly (with the fix attached) when a rust result carries the budget diagnostic', async () => {
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
                              issues: [{ code: 'ast-budget', line: 1, column: 1 }],
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
        await prePlugin.configResolved?.({ root });

        const budgetWarnings = warn.mock.calls
            .map(call => String(call[0]))
            .filter(message => message.includes('exceeds the AST node budget'));
        expect(budgetWarnings).toEqual([
            '[csszyx] ast-budget: src/Big.tsx\n' +
                '  The prescan skipped this file because it exceeds the AST node budget, so none of its classes reached the safelist.\n' +
                '  help: split the file, or raise `build.astBudgetLimit` in the plugin options; the Turbopack loader takes no budget option, so split the file there.\n' +
                '  note: its classes produce no CSS unless another source names them.\n' +
                '  docs: https://csszyx.com/e/ast-budget',
        ]);
        // The healthy sibling file still reaches the safelist.
        expect(readFileSync(join(root, '.csszyx/csszyx-classes.txt'), 'utf8')).toContain('m-2');
    });

    it('surfaces a transform-time AST budget diagnostic in production mode', async () => {
        const root = tempRoot();
        const source = 'export const Big = () => <div sz={{ p: 4 }} />;';
        const file = join(root, 'src/Big.tsx');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        compilerMock.transformRustBatch.mockImplementation((files: unknown[]) =>
            files.map(() => emptyBatchResult()),
        );
        compilerMock.transformRust.mockReturnValue({
            ...emptyBatchResult(),
            code: source,
            diagnostics: ['[csszyx] AST budget exceeded: the IR walk stopped mid-file.'],
        });

        const [prePlugin] = vitePlugin({
            build: { parser: 'rust', cache: false },
        }) as ViteConfigHook[];
        await prePlugin.configResolved?.({ root });
        prePlugin.transform?.call({ warn() {} }, source, file);

        expect(warn.mock.calls.map(call => String(call[0])).join('\n')).toContain(
            'AST budget exceeded',
        );
    });

    it('wasm prescan extracts a real page file the transform-hook budget would reject', async () => {
        const root = tempRoot();
        // Over the default 50k-node budget of the transform hook, yet well under
        // the prescan cap.
        const bigSource = `import { szv } from 'csszyx';
const controlSz = szv({ variants: { layout: { a: { mx: 0, my: 4 } } } });
export const Page = () => (<div>${'<span className="cell">x</span>'.repeat(30_000)}</div>);
`;
        writeFileSync(join(root, 'src/Page.tsx'), bigSource);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const [prePlugin] = vitePlugin({
            build: { parser: 'wasm', cache: false },
        }) as ViteConfigHook[];
        await prePlugin.configResolved?.({ root });

        const safelist = readFileSync(join(root, '.csszyx/csszyx-classes.txt'), 'utf8');
        expect(safelist).toContain('mx-0');
        expect(safelist).toContain('my-4');
        const budgetWarnings = warn.mock.calls
            .map(call => String(call[0]))
            .filter(message => message.includes('exceeds the AST node budget'));
        expect(budgetWarnings).toHaveLength(0);
    });

    describe('the other prescan skips', () => {
        /**
         * Run the prescan over one file whose transform the mock answers.
         *
         * @param answer - What the single-file transform does.
         * @param config - A `csszyx.config.mjs` to write, if any.
         * @returns Every console warning.
         */
        async function prescanOne(answer: () => unknown, config?: string): Promise<string[]> {
            const root = tempRoot();
            writeFileSync(
                join(root, 'src/Bad.tsx'),
                'export const Bad = () => <div sz={{ p: 4 }} />;',
            );
            if (config !== undefined) writeFileSync(join(root, 'csszyx.config.mjs'), config);
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            compilerMock.transformRust.mockImplementation(answer);
            const [prePlugin] = vitePlugin({
                build: { parser: 'rust', cache: false },
            }) as ViteConfigHook[];
            await prePlugin.configResolved?.({ root });
            return warn.mock.calls.map(call => String(call[0]));
        }

        const parseFailed = () => ({
            ...emptyBatchResult(),
            issues: [{ code: 'parse-error', line: 1, column: 1 }],
        });

        it('says the file did not parse, as `parse-error`', async () => {
            const lines = await prescanOne(parseFailed);
            expect(lines.filter(line => line.startsWith('[csszyx] parse-error:'))).toEqual([
                '[csszyx] parse-error: src/Bad.tsx\n' +
                    '  The prescan could not parse this file, so none of its classes reached the safelist.\n' +
                    '  help: fix the syntax error, or check that the file extension matches its contents.\n' +
                    '  note: its classes produce no CSS unless another source names them.\n' +
                    '  docs: https://csszyx.com/e/parse-error',
            ]);
        });

        it('says nothing where `csszyx.config` turns the id off', async () => {
            const lines = await prescanOne(
                parseFailed,
                "export default { diagnostics: { rules: { 'parse-error': 'off' } } };\n",
            );
            expect(lines.filter(line => line.includes('Bad.tsx'))).toEqual([]);
        });

        it('counts it as held where `info` is held back', async () => {
            vi.stubEnv('NODE_ENV', 'production');
            try {
                const lines = await prescanOne(
                    parseFailed,
                    "export default { diagnostics: { rules: { 'parse-error': 'info' } } };\n",
                );
                expect(lines.filter(line => line.includes('Bad.tsx'))).toEqual([]);
            } finally {
                vi.unstubAllEnvs();
            }
        });

        it('names a transform that threw, as `engine-call-failed`', async () => {
            const lines = await prescanOne(() => {
                throw new Error('the engine fell over');
            });
            expect(lines.filter(line => line.startsWith('[csszyx] engine-call-failed:'))).toEqual([
                '[csszyx] engine-call-failed:\n' +
                    '  The prescan could not transform `src/Bad.tsx`, so none of its classes reached the safelist.\n' +
                    '  help: fix the error the transform reported; under Tailwind `source(none)`, no class of this file gets CSS until then.\n' +
                    '  note: the transform reported: the engine fell over.\n' +
                    '  docs: https://csszyx.com/e/engine-call-failed',
            ]);
        });

        it('names a thrown value that is not an Error by its text', async () => {
            const lines = await prescanOne(() => {
                throw 'a bare string';
            });
            expect(lines.filter(line => line.startsWith('[csszyx] engine-call-failed:'))).toEqual([
                expect.stringContaining('\n  note: the transform reported: a bare string.\n'),
            ]);
        });
    });

    describe('what buildEnd says about the safelist', () => {
        it('says the safelist hit its cap, as `safelist-capped`', async () => {
            const root = tempRoot();
            writeFileSync(join(root, 'src/A.tsx'), 'export const A = () => <div sz={{ p: 4 }} />;');
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            compilerMock.transformRust.mockImplementation(() => ({
                ...emptyBatchResult(),
                transformed: true,
                classes: new Set(Array.from({ length: 100_001 }, (_, i) => `w-[${i}px]`)),
            }));
            const [prePlugin] = vitePlugin({
                build: { parser: 'rust', cache: false },
            }) as ViteConfigHook[];
            await prePlugin.configResolved?.({ root });
            prePlugin.buildEnd?.call({ warn() {}, error() {} });
            const lines = warn.mock.calls.map(call => String(call[0]));
            expect(lines.filter(line => line.startsWith('[csszyx] safelist-capped:'))).toEqual([
                '[csszyx] safelist-capped:\n' +
                    '  The safelist reached its cap of 100000 classes, so the build left out every class it found after that.\n' +
                    '  help: look for `sz` values that write a different arbitrary value per element, such as `w-[137px]`, and replace them with theme values.\n' +
                    '  note: the classes left out produce no CSS unless another source names them; the cap is fixed, and no option raises it.\n' +
                    '  docs: https://csszyx.com/e/safelist-capped',
            ]);
        });

        it('names the skipped package files by their project path', async () => {
            const root = tempRoot();
            mkdirSync(join(root, 'packages/ui/src'), { recursive: true });
            writeFileSync(
                join(root, 'packages/ui/src/Button.tsx'),
                'export const Button = () => <button sz={{ p: 4 }} />;',
            );
            writeFileSync(
                join(root, 'packages/ui/src/variants.ts'),
                "import { szv } from 'csszyx';\nexport const button = szv({ base: { p: 2 } });\n",
            );
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            compilerMock.transformRust.mockImplementation(() => emptyBatchResult());
            compilerMock.transformRustBatch.mockImplementation((files: unknown[]) =>
                files.map(() => emptyBatchResult()),
            );
            const [prePlugin] = vitePlugin({
                build: { parser: 'rust', cache: false },
            }) as ViteConfigHook[];
            await prePlugin.configResolved?.({ root });
            prePlugin.buildEnd?.call({ warn() {}, error() {} });
            const lines = warn.mock.calls.map(call => String(call[0]));
            expect(
                lines.filter(line => line.startsWith('[csszyx] compile-sources-skipped:')),
            ).toEqual([
                '[csszyx] compile-sources-skipped:\n' +
                    '  The build skipped 2 file(s) under `packages/` that use csszyx, so it compiles none of their `sz` props and none of their classes reach the safelist.\n' +
                    "  help: add the package directory to `compileSources`, such as `compileSources: ['packages/ui']`, or move the files out of `packages/`.\n" +
                    '  note: of these, 1 may export `szv` factories, so another module that calls one runs it at runtime instead of getting its classes compiled in; the skipped files:\n' +
                    '    packages/ui/src/Button.tsx\n' +
                    '    packages/ui/src/variants.ts\n' +
                    '  docs: https://csszyx.com/e/compile-sources-skipped',
            ]);
        });
    });
});
