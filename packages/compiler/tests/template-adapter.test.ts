/**
 * The two steps every template adapter shares, kept in the kit so a new
 * adapter writes only how it reads its framework's file: lowering the `sz`
 * attributes it read, and the Vite plugin that runs its preprocess.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    lowerSzAttributes,
    type TemplateSzAttribute,
    templateVitePlugin,
} from '../src/template.js';

/** One `sz={{ p: 4 }}` attribute at the start of `file`. */
const FILE = '<div sz={{ p: 4 }}></div>';
const ATTRIBUTE: TemplateSzAttribute = {
    start: 5,
    end: 18,
    value: { source: '{ p: 4 }', start: 9 },
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('lowerSzAttributes', () => {
    it('rewrites the attributes it is given', () => {
        const lowered = lowerSzAttributes(
            { file: FILE, reading: { attributes: [ATTRIBUTE], diagnostics: [] }, label: 'x' },
            {},
        );
        expect(lowered.code).toBe('<div class="p-4"></div>');
        expect(lowered.count).toBe(1);
        expect(lowered.map).not.toBeNull();
        expect(lowered.diagnostics).toEqual([]);
    });

    it('leaves the file as written when the read failed or found nothing', () => {
        const failed = {
            severity: 'error',
            message: 'm',
            code: 'template-unparsable',
            args: {},
            line: 1,
            column: 1,
        } as const;
        expect(
            lowerSzAttributes(
                {
                    file: FILE,
                    reading: { attributes: [ATTRIBUTE], diagnostics: [failed] },
                    label: 'x',
                },
                {},
            ),
        ).toEqual({
            code: FILE,
            map: null,
            count: 0,
            diagnostics: [failed],
        });
        expect(
            lowerSzAttributes(
                { file: FILE, reading: { attributes: [], diagnostics: [] }, label: 'x' },
                {},
            ),
        ).toEqual({
            code: FILE,
            map: null,
            count: 0,
            diagnostics: [],
        });
    });

    it('logs each value and its class under the adapter label in debug mode only', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        lowerSzAttributes(
            { file: FILE, reading: { attributes: [ATTRIBUTE], diagnostics: [] }, label: 'x' },
            {},
        );
        expect(log).not.toHaveBeenCalled();
        lowerSzAttributes(
            { file: FILE, reading: { attributes: [ATTRIBUTE], diagnostics: [] }, label: 'svelte' },
            { debug: true },
        );
        expect(log).toHaveBeenCalledWith('[csszyx/svelte] { p: 4 } -> "p-4"');
    });
});

describe('templateVitePlugin', () => {
    const preprocess = vi.fn((source: string, filename: string) => ({
        code: `${source}<!-- ${filename} -->`,
        map: null,
        diagnostics: [],
    }));
    const plugin = templateVitePlugin({ name: 'csszyx-x', extension: '.x', preprocess });
    const reporter = { warn: vi.fn(), error: vi.fn() as never };

    it('runs before the framework plugin, under its name', () => {
        expect(plugin.name).toBe('csszyx-x');
        expect(plugin.enforce).toBe('pre');
    });

    it("runs the adapter's preprocess on a file of its extension that holds an sz", () => {
        expect(plugin.transform.call(reporter, FILE, '/a/B.x')).toEqual({
            code: `${FILE}<!-- /a/B.x -->`,
            map: null,
        });
        expect(plugin.transform.call(reporter, FILE, '/a/B.y')).toBeNull();
        expect(plugin.transform.call(reporter, '<div></div>', '/a/B.x')).toBeNull();
    });
});
