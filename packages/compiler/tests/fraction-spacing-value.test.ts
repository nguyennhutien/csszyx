/**
 * A fraction on a spacing key that takes none (`p: '1/2'`).
 *
 * The bracket csszyx used to write, `p-[1/2]`, is `padding: 1/2`: a
 * declaration the browser drops, with nothing said. The class is now the one a
 * Tailwind author would write by hand, `p-1/2`, which produces no CSS either,
 * and every lane reports it as `off-scale-value` (form `fraction`) with the
 * percent to write instead (ADR 0036: a wrong value keeps its class and is
 * reported). Keys that take a fraction (`w`, `basis`, `inset`, `translateX`)
 * keep it as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { escapeUnsafeChars } from '../../core/tests/helpers/sz-fuzz.js';
import { __resetSzWarnDedupForTests, type SzObject, transform } from '../src/transform-core.js';
import { ENGINES } from './engine-parity-harness.js';
import { szCodeOf } from './helpers/sz-console-line.js';

/**
 * The source an engine lowers for one sz object.
 *
 * @param sz - The sz object.
 * @returns A one-element module with it on a `div`.
 */
function sourceOf(sz: Record<string, unknown>): string {
    return `export const A = () => <div sz={${escapeUnsafeChars(JSON.stringify(sz))}} />;`;
}

/**
 * The class and the codes each lane writes for one sz object: the runtime
 * core first, then each engine.
 *
 * @param sz - The sz object.
 * @returns One entry per lane.
 */
function lanes(sz: Record<string, unknown>): Array<{ className: string; codes: string[] }> {
    __resetSzWarnDedupForTests();
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((line: string) => {
        lines.push(line);
    });
    let className: string;
    try {
        className = transform(sz as SzObject).className;
    } finally {
        spy.mockRestore();
    }
    return [
        { className, codes: lines.map(szCodeOf) },
        ...ENGINES.map(([, engine]) => {
            const { code = '', issues = [] } = engine(sourceOf(sz), {
                filename: '/p/src/Fraction.tsx',
            });
            return {
                className: /className="([^"]*)"/.exec(code)?.[1] ?? '',
                codes: issues.map(issue => issue.code),
            };
        }),
    ];
}

describe('a fraction on a spacing key that takes none', () => {
    beforeEach(() => {
        __resetSzWarnDedupForTests();
    });

    it.each([
        [{ p: '1/2' }, 'p-1/2'],
        [{ m: '1/3' }, 'm-1/3'],
        [{ px: '2/4' }, 'px-2/4'],
        [{ gap: '1/2' }, 'gap-1/2'],
        [{ hover: { p: '1/2' } }, 'hover:p-1/2'],
        [{ p: '1/2!' }, 'p-1/2!'],
    ])('%j keeps the bare class and is reported on every lane', (sz, className) => {
        for (const lane of lanes(sz)) {
            expect(lane.className).toBe(className);
            expect(lane.codes).toEqual(['off-scale-value']);
        }
    });

    it.each([
        [{ w: '1/2' }, 'w-1/2'],
        [{ basis: '1/3' }, 'basis-1/3'],
        [{ inset: '1/2' }, 'inset-1/2'],
        [{ translateX: '1/2' }, 'translate-x-1/2'],
    ])('%j takes a fraction and is not reported', (sz, className) => {
        for (const lane of lanes(sz)) {
            expect(lane.className).toBe(className);
            expect(lane.codes).not.toContain('off-scale-value');
        }
    });

    it.each([
        // A grid line pair is valid CSS in the bracket: `grid-row: 1/3`.
        [{ row: '1/3' }, 'row-[1/3]'],
        // A zero denominator is no share of anything.
        [{ p: '1/0' }, 'p-[1/0]'],
    ])('%j keeps its bracket and is not reported', (sz, className) => {
        for (const lane of lanes(sz)) {
            expect(lane.className).toBe(className);
            expect(lane.codes).not.toContain('off-scale-value');
        }
    });

    it('is said once per key and value at runtime, and not at all in production', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            transform({ p: '1/2' });
            transform({ p: '1/2' });
            expect(warn.mock.calls.map(([line]) => szCodeOf(String(line)))).toEqual([
                'off-scale-value',
            ]);
            __resetSzWarnDedupForTests();
            warn.mockClear();
            vi.stubEnv('NODE_ENV', 'production');
            expect(transform({ m: '1/3' }).className).toBe('m-1/3');
            expect(warn).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllEnvs();
            warn.mockRestore();
        }
    });

    it.each(ENGINES)('names the percent to write on the %s engine', (_name, engine) => {
        const { issues = [] } = engine(sourceOf({ p: '1/2', m: '1/3' }), {
            filename: '/p/src/Fraction.tsx',
        });
        expect(
            issues.filter(issue => issue.code === 'off-scale-value').map(issue => issue.args),
        ).toEqual([
            { form: 'fraction', key: 'p', value: '1/2', percent: '50' },
            { form: 'fraction', key: 'm', value: '1/3', percent: '33.3333' },
        ]);
    });
});
