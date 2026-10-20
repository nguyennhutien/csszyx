/**
 * The runtime lowering names a bare state name the Tailwind csszyx builds
 * with serves no variant for (`unserved-variant`, ADR 0031 item 17).
 *
 * `{ hidden: { p: 4 } }` lowers to `hidden:p-4`, and Tailwind has no bare
 * `hidden` variant: the class styles nothing. The runtime cannot read the
 * project's stylesheet, so it answers from the table generated on the pinned
 * Tailwind (`state-variants.generated.ts`), and only for a name csszyx knows
 * as an ARIA state. Any other name is an open variant a
 * project may define with `@custom-variant`, which only `csszyx check` can
 * see, so the runtime says nothing about it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetSzWarnDedupForTests, type SzObject, transform } from '../src/transform-core.js';
import { szBodyOf, szCodeOf } from './helpers/sz-console-line.js';

const CODE = 'unserved-variant';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    __resetSzWarnDedupForTests();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

/**
 * The lines one lowering reported under the code.
 *
 * @param sz - The object to lower.
 * @returns The class it emitted and each reported line.
 */
function lower(sz: SzObject): { className: string; lines: string[] } {
    warn.mockClear();
    const { className } = transform(sz);
    const lines = warn.mock.calls
        .map(call => String(call[0]))
        .filter(line => szCodeOf(line) === CODE);
    return { className, lines };
}

describe('unserved-variant at runtime', () => {
    it('names a bare HTML attribute that is also an ARIA state, and keeps the class', () => {
        const { className, lines } = lower({ hidden: { p: 4 } });

        expect(className).toBe('hidden:p-4');
        expect(lines).toHaveLength(1);
        const body = szBodyOf(lines[0] as string);
        expect(body).toContain('`hidden:p-4`');
        expect(body).toContain("`{ '[hidden]': { … } }`");
        expect(body).toContain('`aria: { hidden: { … } }`');
        expect(body).toContain('@custom-variant');
    });

    it('points an ARIA-only state at `aria` alone', () => {
        const [line] = lower({ expanded: { w: 1 } }).lines;

        expect(szBodyOf(line as string)).toContain('`aria: { expanded: { … } }`');
        expect(szBodyOf(line as string)).not.toContain("'[expanded]'");
    });

    it('names it under another variant, with the class as emitted', () => {
        const [line] = lower({ md: { readonly: { p: 1 } } }).lines;

        expect(szBodyOf(line as string)).toContain('`md:readonly:p-1`');
    });

    it.each<[string, SzObject]>([
        ['a state Tailwind serves bare', { checked: { p: 2 } }],
        ['a camelCase state whose kebab name is served', { readOnly: { p: 1 } }],
        ['the attribute in brackets', { '[hidden]': { p: 4 } }],
        ['the ARIA state under aria', { aria: { hidden: { p: 4 } } }],
        ['a name no list knows, which a project may define', { hovr: { p: 4 } }],
        ['a custom breakpoint', { tablet: { p: 4 } }],
    ])('says nothing of %s', (_what, sz) => {
        expect(lower(sz).lines).toEqual([]);
    });

    it('says each name once', () => {
        expect(lower({ hidden: { p: 4 } }).lines).toHaveLength(1);
        expect(lower({ hidden: { m: 2 } }).lines).toEqual([]);
    });

    it('says nothing in production', () => {
        vi.stubEnv('NODE_ENV', 'production');

        expect(lower({ selected: { p: 4 } })).toEqual({ className: 'selected:p-4', lines: [] });
    });
});
