/**
 * An engine that cannot answer is not a provider that cannot be read.
 *
 * The Turbopack lane gives up the cross-module optimization for a provider it
 * cannot read, quietly, because failing an importer whose own source is fine
 * is the worse trade. An unavailable engine is different: every provider then
 * reads as exporting nothing, the optimization is off for the whole build, and
 * nothing says why. That reaches the user as an error naming the packages.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const failure = vi.hoisted(() => ({ current: undefined as (() => Error) | undefined }));

vi.mock('@csszyx/compiler', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler')>();
    return {
        ...actual,
        extractCrossModuleRegistryEntries: (
            ...args: Parameters<typeof actual.extractCrossModuleRegistryEntries>
        ) => {
            if (failure.current) throw failure.current();
            return actual.extractCrossModuleRegistryEntries(...args);
        },
    };
});

const { RustTransformUnavailableError, WasmTransformUnavailableError } = await import(
    '@csszyx/compiler'
);
const { clearNextAliasCache, resolveNextCrossModule } = await import('../src/next-cross-module.js');

const roots: string[] = [];

afterEach(() => {
    failure.current = undefined;
    clearNextAliasCache();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * Resolve an importer of one style module.
 *
 * @returns The resolution.
 */
function resolveStyles(): ReturnType<typeof resolveNextCrossModule> {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-next-xmod-engine-'));
    roots.push(root);
    mkdirSync(join(root, 'app'));
    writeFileSync(join(root, 'app/styles.ts'), 'export const cardSz = { p: 7 };\n');
    return resolveNextCrossModule({
        filename: join(root, 'app/page.tsx'),
        source: "import { cardSz } from './styles';\n",
        root,
        importedStaticSz: true,
    });
}

describe('a provider the engine cannot read', () => {
    it.each([
        ['native', () => new RustTransformUnavailableError('older platform package')],
        ['wasm', () => new WasmTransformUnavailableError('no wasm')],
    ])('passes the unavailable %s engine on', (_name, error) => {
        failure.current = error;
        expect(resolveStyles).toThrow(error().message);
    });

    it('still costs only the optimization on any other failure', () => {
        failure.current = () => new Error('unexpected');
        expect(resolveStyles().statics).toEqual({});
    });
});
