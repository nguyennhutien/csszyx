/**
 * The production side of the `NODE_ENV` checks around the theme-token and szv
 * reports, which every other suite runs under `NODE_ENV=test` and so never
 * takes.
 *
 * `devWarn` refuses to print in production on its own, so watching
 * `console.warn` would stay green with the check deleted. This file replaces
 * it with a spy that refuses nothing: the only thing that can keep it uncalled
 * is the caller's own check — the one a bundler folds to drop the report and
 * the template it names. Each production case is paired with the same input
 * in development, where the spy is called, so a case cannot pass by never
 * reaching the report at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const devWarn = vi.fn();

vi.mock('../src/dev-warn.js', () => ({
    devWarn,
    resetDevWarnCache: () => {},
}));

const { clearSzcnGroups, getSzcnGroups, setSzcnGroups } = await import('../src/merge-groups.js');
const { __szvPick, __szvPick1 } = await import('../src/szv-pick.js');
const { szv } = await import('../src/variants.js');

/** `balance` shadows a built-in colour keyword; `brand` is both a colour and a size. */
const DECLARED = { colors: ['balance', 'brand', 'ocean'], textSizes: ['brand'] };

/** A pick table with one dimension and no defaults, as the build emits it. */
const TABLE = { base: 'inline-flex', d: { size: { sm: 'h-9' } } };

/**
 * Every report these inputs can reach, run against the current `NODE_ENV`.
 *
 * @returns The effective tokens and the classes each factory produced.
 */
function reachEveryReport(): Record<string, unknown> {
    setSzcnGroups(DECLARED, 'dev-warn-production');
    const groups = getSzcnGroups();
    // `variants.tone` is no table, which the config check reports.
    const buttonSz = szv({
        base: { display: 'flex' },
        variants: { size: { sm: { h: 9 } }, tone: 'loud' },
    } as never);
    return {
        colors: groups.colors,
        textSizes: groups.textSizes,
        szv: buttonSz({ size: 'xl', shape: 'round' } as never),
        pick: __szvPick(TABLE, { size: 'xl' }),
        pick1: __szvPick1(TABLE, 'size', 'xl'),
    };
}

beforeEach(() => {
    devWarn.mockClear();
});

afterEach(() => {
    clearSzcnGroups('dev-warn-production');
    process.env.NODE_ENV = 'test';
});

describe('theme-token and szv reports in a production build', () => {
    it('are never reached, and the tokens and classes come out the same', () => {
        process.env.NODE_ENV = 'production';
        expect(reachEveryReport()).toEqual({
            colors: ['ocean'],
            textSizes: [],
            szv: { display: 'flex' },
            pick: 'inline-flex',
            pick1: 'inline-flex',
        });
        expect(devWarn).not.toHaveBeenCalled();
    });

    it('are reached everywhere else', () => {
        process.env.NODE_ENV = 'development';
        expect(reachEveryReport()).toEqual({
            colors: ['ocean'],
            textSizes: [],
            szv: { display: 'flex' },
            pick: 'inline-flex',
            pick1: 'inline-flex',
        });
        const ids = devWarn.mock.calls.map(([options]) => options.diagnostic.id);
        expect(new Set(ids)).toEqual(
            new Set([
                'theme-collision',
                'theme-token-ambiguous',
                'szv-config-invalid',
                'szv-unknown-variant',
                'szv-unknown-variant-value',
            ]),
        );
    });
});
