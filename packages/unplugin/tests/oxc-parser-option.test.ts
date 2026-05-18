import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

type TransformHook = {
    transform: (this: { warn: (message: string) => void }, code: string, id: string) => unknown;
};

const ORIGINAL_ENV = process.env.CSSZYX_PARSER;

afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
        delete process.env.CSSZYX_PARSER;
    } else {
        process.env.CSSZYX_PARSER = ORIGINAL_ENV;
    }
});

describe('csszyx parser selection', () => {
    it('uses oxc by default', () => {
        const [prePlugin] = vitePlugin() as TransformHook[];
        const warn = vi.fn();
        const result = prePlugin.transform.call(
            { warn },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('const App=()=>');
        expect(result.code).toContain('className="p-4"');
        expect(result.code).not.toContain(' sz=');
        expect(warn).not.toHaveBeenCalled();
    });

    it('lets build.parser opt back into Babel', () => {
        const [prePlugin] = vitePlugin({ build: { parser: 'babel' } }) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('const App = () =>');
        expect(result.code).toContain('className="p-4"');
    });

    it('lets CSSZYX_PARSER=babel override the default', () => {
        process.env.CSSZYX_PARSER = 'babel';
        const [prePlugin] = vitePlugin() as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('const App = () =>');
        expect(result.code).toContain('className="p-4"');
    });

    it('lets CSSZYX_PARSER=oxc override build.parser=babel', () => {
        process.env.CSSZYX_PARSER = 'oxc';
        const [prePlugin] = vitePlugin({ build: { parser: 'babel' } }) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('const App=()=>');
        expect(result.code).toContain('className="p-4"');
    });

    it('lets build.parser opt into the Rust scaffold explicitly', () => {
        const [prePlugin] = vitePlugin({ build: { parser: 'rust' } }) as TransformHook[];

        expect(() =>
            prePlugin.transform.call(
                { warn: vi.fn() },
                'const App=()=> <div sz={{ p: 4 }} />;',
                '/repo/src/App.tsx',
            ),
        ).toThrow('transformRust: not implemented yet');
    });

    it('lets CSSZYX_PARSER=rust override build.parser=babel', () => {
        process.env.CSSZYX_PARSER = 'rust';
        const [prePlugin] = vitePlugin({ build: { parser: 'babel' } }) as TransformHook[];

        expect(() =>
            prePlugin.transform.call(
                { warn: vi.fn() },
                'const App=()=> <div sz={{ p: 4 }} />;',
                '/repo/src/App.tsx',
            ),
        ).toThrow('transformRust: not implemented yet');
    });
});
