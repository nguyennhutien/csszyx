import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNativePackageName, loadNativeBinding } from '@csszyx/core/native';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

type TransformHook = {
    configResolved?: (config: { root: string }) => void;
    transform: (this: { warn: (message: string) => void }, code: string, id: string) => unknown;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../..');

let nativeRustAvailable = false;

beforeAll(() => {
    try {
        loadNativeBinding(getNativePackageName());
        nativeRustAvailable = true;
    } catch {
        nativeRustAvailable = false;
    }
});

describe('rust parser real-source canary', () => {
    function createRustTransform(): TransformHook {
        const [prePlugin] = vitePlugin({
            build: { parser: 'rust', cache: false },
        }) as TransformHook[];
        prePlugin.configResolved?.({ root: REPO_ROOT });
        return prePlugin;
    }

    it('runs representative playground and docs files through the unplugin rust path', () => {
        const prePlugin = createRustTransform();

        if (!nativeRustAvailable) {
            expect(() =>
                prePlugin.transform.call(
                    { warn: vi.fn() },
                    'const App=()=> <div sz={{ p: 4 }} />;',
                    join(REPO_ROOT, 'src/App.tsx'),
                ),
            ).toThrow('Use build.parser: "oxc" or "babel"');
            return;
        }

        const cases = [
            {
                filename: 'playground/vite-react/src/App.tsx',
                expected: ['className=', 'min-h-screen', 'bg-linear-to-br'],
            },
            {
                filename: 'playground/nextjs-ssr/components/server-card.tsx',
                expected: ['className=', 'p-6', 'rounded-xl'],
            },
            {
                filename: 'apps/docs/src/components/Demo.tsx',
                expected: ['className=', 'demo-dot', 'rounded-xl'],
            },
        ];

        for (const testCase of cases) {
            const id = join(REPO_ROOT, testCase.filename);
            const source = readFileSync(id, 'utf8');
            const result = prePlugin.transform.call({ warn: vi.fn() }, source, id) as {
                code: string;
            };

            expect(result.code, testCase.filename).not.toContain(' sz=');
            for (const expected of testCase.expected) {
                expect(result.code, testCase.filename).toContain(expected);
            }
        }
    });

    it('keeps Rust runtime helper output blocked in server components', () => {
        const prePlugin = createRustTransform();
        const source = `
            // leading comment before directive should not hide the server boundary
            'use server';
            export function Card({ styles, className }) {
                return <div className={className} sz={styles} />;
            }
        `;
        const id = join(REPO_ROOT, 'app/actions.tsx');

        if (!nativeRustAvailable) {
            expect(() => prePlugin.transform.call({ warn: vi.fn() }, source, id)).toThrow(
                'Use build.parser: "oxc" or "babel"',
            );
            return;
        }

        expect(() => prePlugin.transform.call({ warn: vi.fn() }, source, id)).toThrow(
            'csszyxRSCViolation: _sz imported in Server Component',
        );
    });
});
