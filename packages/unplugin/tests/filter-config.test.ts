import { describe, expect, it } from 'vitest';

import { unplugin, vitePlugin } from '../src/unplugin.js';

describe('csszyx plugin include/exclude filters', () => {
    function hugeSzSource(): string {
        const literals = Array.from({ length: 60_000 }, (_, i) => i).join(', ');
        return `const data = [${literals}]; const App = () => <div sz={{ p: 1 }}>x</div>;`;
    }

    it('excludes matching source files before AST parsing', () => {
        const [prePlugin] = vitePlugin({ exclude: [/generated\/icons\.tsx$/] }) as Array<{
            transformInclude(id: string): boolean;
            transform(code: string, id: string): unknown;
        }>;
        const file = '/project/src/generated/icons.tsx';

        expect(prePlugin.transformInclude(file)).toBe(false);
        expect(() => prePlugin.transform(hugeSzSource(), file)).not.toThrow();
        // unplugin v3 short-circuits excluded files to undefined before the
        // handler runs; bundlers treat undefined and null the same (no-op).
        expect(prePlugin.transform(hugeSzSource(), file)).toBeUndefined();
    });

    it('keeps non-excluded source files eligible for transform', () => {
        const [prePlugin] = vitePlugin({ exclude: [/generated/] }) as Array<{
            transformInclude(id: string): boolean;
        }>;

        expect(prePlugin.transformInclude('/project/src/App.tsx')).toBe(true);
        expect(prePlugin.transformInclude('/project/src/generated/icons.tsx')).toBe(false);
    });

    it('leaves a module it neither styles nor lowers alone when the hook is driven by hand', () => {
        // `unplugin.raw` hands the handler over without `transformInclude` in
        // front of it, so the handler itself must refuse such a module.
        const prePlugin = [
            unplugin.raw({}, {
                framework: 'rollup',
            } as never),
        ]
            .flat()
            .find(plugin => plugin.name === 'csszyx:pre') as unknown as {
            transform(this: unknown, code: string, id: string): unknown;
        };
        const ctx = { warn() {}, error() {}, addWatchFile() {} };
        const plain = 'export const A = () => <div className="p-1">x</div>;';
        const sz = 'export const A = () => <div sz={{ p: 1 }}>x</div>;';

        // A module it does transform hands its classes on.
        expect(prePlugin.transform.call(ctx, plain, '/project/src/App.tsx')).toEqual({
            code: plain,
            map: null,
        });
        // Neither a stylesheet nor a source, nor a dependency, whatever it holds.
        for (const id of ['/project/src/notes.txt', '/project/node_modules/pkg/index.tsx']) {
            expect(prePlugin.transform.call(ctx, plain, id)).toBeNull();
            expect(prePlugin.transform.call(ctx, sz, id)).toBeNull();
        }
    });
});
