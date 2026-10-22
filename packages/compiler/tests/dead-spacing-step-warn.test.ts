import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    __resetSzWarnDedupForTests,
    type SzObject,
    setSzWarnLocation,
    transform,
} from '../src/transform-core.js';
import { engineMessage, runtimeMessage } from './engine-message.js';
import { szCodeOf } from './helpers/sz-console-line.js';

/**
 * The body of the off-scale line for one key and value.
 *
 * @param key - The key.
 * @param value - The value, as written into the sentence.
 * @returns The sentence and the help.
 */
const offScale = (key: string, value: string) => [
    `\`${key}: ${value}\` is not on Tailwind's spacing scale, so the class produces no CSS.`,
    `help: use a quarter step such as \`1.25\`, \`1.5\` or \`1.75\`, or a unit value such as \`'${value}rem'\`.`,
];

/**
 * Tailwind's bare spacing syntax only accepts quarter steps (multiples of
 * 0.25) — `p-1.4` generates no CSS — and a unitless bracket is no escape
 * (`padding: 1.4` is invalid CSS). The dev warning is the only surface that
 * makes the silently-dropped class visible; these lock its trigger contract.
 *
 * Note: the warning de-dups per (key, value) at module scope, so each
 * signature is exercised in exactly one test.
 */
describe('dead spacing-step warning (dev)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const warns = (sz: SzObject): string[] => {
        const calls: string[] = [];
        const spy = vi.spyOn(console, 'warn').mockImplementation((m: string) => {
            calls.push(m);
        });
        transform(sz);
        spy.mockRestore();
        return calls.filter(c => szCodeOf(c) === 'off-scale-value');
    };

    it('warns on a non-quarter-step padding number and suggests fixes', () => {
        const w = warns({ p: 1.4 } as SzObject);
        expect(w).toEqual([runtimeMessage('off-scale-value', ...offScale('p', '1.4'))]);
    });

    it('stays quiet in production and when muted', () => {
        // A fresh dedup, so silence comes from the guard alone.
        __resetSzWarnDedupForTests();
        vi.stubEnv('NODE_ENV', 'production');
        expect(warns({ p: 1.6 } as SzObject)).toEqual([]);
        vi.unstubAllEnvs();
        vi.stubEnv('CSSZYX_QUIET_SZ_WARNINGS', '1');
        expect(warns({ p: 1.7 } as SzObject)).toEqual([]);
        vi.unstubAllEnvs();
    });

    it('warns on a numeric-string spacing value', () => {
        expect(warns({ m: '2.3' } as SzObject)).toEqual([
            runtimeMessage('off-scale-value', ...offScale('m', '2.3')),
        ]);
    });

    it('warns under a variant', () => {
        expect(warns({ hover: { gap: 3.1 } } as SzObject)).toEqual([
            runtimeMessage('off-scale-value', ...offScale('gap', '3.1')),
        ]);
    });

    it('stays silent for quarter steps, units, and non-spacing keys', () => {
        expect(warns({ p: 1.5 } as SzObject)).toHaveLength(0);
        expect(warns({ m: 0.75 } as SzObject)).toHaveLength(0);
        expect(warns({ w: '1.4rem' } as SzObject)).toHaveLength(0);
        // leading falls back to the unitless-ratio bracket instead.
        expect(warns({ leading: 1.4 } as SzObject)).toHaveLength(0);
        // opacity is not a spacing-scale utility.
        expect(warns({ opacity: 33.3 } as SzObject)).toHaveLength(0);
    });

    it('appends the source location when the build engine has set one', () => {
        setSzWarnLocation('src/App.tsx:12');
        try {
            expect(warns({ px: 2.2 } as SzObject)).toEqual([
                engineMessage('off-scale-value', 'src/App.tsx:12', ...offScale('px', '2.2')),
            ]);
        } finally {
            setSzWarnLocation(undefined);
        }
    });

    it('de-dups repeated signatures', () => {
        expect(warns({ pt: 1.9 } as SzObject)).toHaveLength(1);
        expect(warns({ pt: 1.9 } as SzObject)).toHaveLength(0);
    });
});
