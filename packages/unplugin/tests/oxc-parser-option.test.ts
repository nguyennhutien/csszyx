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
    it('uses oxc when build.parser opts in', () => {
        const [prePlugin] = vitePlugin({ build: { parser: 'oxc' } }) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App = () => <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('className="p-4"');
        expect(result.code).not.toContain(' sz=');
    });

    it('lets CSSZYX_PARSER=oxc fall back to Babel for unported oxc cases', () => {
        process.env.CSSZYX_PARSER = 'oxc';
        const warn = vi.fn();
        const [prePlugin] = vitePlugin() as TransformHook[];
        const result = prePlugin.transform.call(
            { warn },
            'const App = ({ padVal }) => <div className="base" sz={{ p: padVal }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('style=');
        expect(result.code).toContain('--_sz-p');
        expect(result.code).toContain('base');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('fell back to Babel'));
    });
});
