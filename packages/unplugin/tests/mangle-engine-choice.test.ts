/**
 * The plugin asks the class-name encoder for the artifact the build names.
 *
 * Both artifacts give the same token for an index, so the output cannot tell
 * which one ran. What can is the option the plugin hands the engine, so a
 * build pinned to one artifact never loads the other to mangle.
 */
import { classNameEncoder } from '@csszyx/compiler/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { planGlobalVarAliases, scanGlobalVarCss } from '../src/global-var-scanner.js';
import { allocateMangleTokens } from '../src/unplugin.js';

// Wrapped, not replaced: the encoder is real, and a test can read its options.
vi.mock('@csszyx/compiler/engine', async importOriginal => {
    const engine = await importOriginal<typeof import('@csszyx/compiler/engine')>();
    return { ...engine, classNameEncoder: vi.fn(engine.classNameEncoder) };
});

afterEach(() => {
    vi.mocked(classNameEncoder).mockClear();
});

describe('the artifact the mangle encoder runs on', () => {
    it.each(['rust', 'wasm'] as const)(
        'is the one the build names, %s, for class tokens',
        parser => {
            expect(allocateMangleTokens(['p-4', 'm-2'], new Set(), parser)).toEqual({
                'p-4': 'z',
                'm-2': 'y',
            });
            expect(classNameEncoder).toHaveBeenCalledWith({ parser });
        },
    );

    it.each(['rust', 'wasm'] as const)(
        'is the one the build names, %s, for variable aliases',
        parser => {
            const scan = scanGlobalVarCss(':root { --brand: red; }\n', { filePath: 'a.css' });
            const plan = planGlobalVarAliases({ scans: [scan], tokens: ['--brand'], parser });

            expect(plan.entries.map(entry => entry.alias)).toEqual(['---gz']);
            expect(classNameEncoder).toHaveBeenCalledWith({ parser });
        },
    );
});
