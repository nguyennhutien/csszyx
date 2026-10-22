/**
 * A lane csszyx forgot to wire asks for the Tailwind prefix before it read
 * the project's stylesheets. No user setting reaches this: the plugin stops
 * with csszyx's own failure rather than guess a prefix and ship classes that
 * style nothing.
 */
import { describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';
import { internalErrorMessage } from './helpers/internal-error.js';

describe('a transform before the stylesheets were read', () => {
    it('stops with internal-error', async () => {
        const [pre] = vitePlugin({ build: { parser: 'wasm', cache: false } }) as unknown as [
            { transform(this: unknown, code: string, id: string): unknown },
        ];
        await expect(
            (async () =>
                pre.transform.call(
                    { warn() {} },
                    'export const A = () => <div sz={{ p: 4 }} />;',
                    '/repo/src/A.tsx',
                ))(),
        ).rejects.toThrow(
            expect.objectContaining({
                code: 'internal-error',
                message: internalErrorMessage(
                    'createCompilerOptions',
                    "the build asked for the Tailwind prefix before it read the project's stylesheets",
                ),
            }),
        );
    });
});
