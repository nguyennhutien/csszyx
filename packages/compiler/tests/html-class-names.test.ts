/**
 * The class names of an HTML page, on both artifacts. The webpack lane
 * mangles the names this reads and migrate converts the attributes the same
 * Rust reads, so each artifact must read what parse5 reads (the shared
 * fixture), and the read must stay linear in the page: a build reads every
 * page it emits.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { cpuMsPerCall } from '../../core/tests/helpers/cpu-time.js';
import { htmlClassNames, htmlClassNamesRust, htmlClassNamesWasm } from '../src/engine.js';
import { RUST_LANE } from './engine-parity-harness.js';

/** The cases `packages/core/src/html_text.rs` runs too, answered by parse5. */
/** One `class` attribute parse5 reads. */
interface Found {
    start: number;
    end: number;
    value: string;
    /** Holds `&name;` with a name the reader cannot tell: migrate leaves it alone. */
    undecoded?: true;
    /** Then, the names a mangle still reads: all but those holding that reference. */
    names?: string[];
}

const CASES: Array<{
    case: string;
    html: string;
    found: Found[];
    /** parse5 with scripting off, where it reads differently (`noscript`). */
    foundScriptingOff?: Found[];
}> = JSON.parse(
    readFileSync(
        new URL('../../core/tests/fixtures/html-class-cases.json', import.meta.url),
        'utf8',
    ),
);

/** Where HTML splits a class list. */
const HTML_SPACE = /[\t\n\f\r ]+/;

const ARTIFACTS = [
    ['wasm', htmlClassNamesWasm],
    ...(RUST_LANE ? [['rust', htmlClassNamesRust] as const] : []),
] as const;

/**
 * How much longer the read of `large` takes than the read of `small`, in CPU
 * time per read (`cpuMsPerCall`), each walked in turn after a warm-up and kept at its
 * fastest, so a stretch of load slows both sides instead of one.
 *
 * @param read - The reader.
 * @param small - HTML text.
 * @param large - The same shape, longer.
 * @returns The ratio of the fastest reads.
 */
function growth(read: (html: string) => unknown, small: string, large: string): number {
    const best = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    for (let run = 0; run < 5; run++) {
        [small, large].forEach((text, side) => {
            const ms = cpuMsPerCall(() => read(text));
            if (run > 0) best[side] = Math.min(best[side], ms);
        });
    }
    return best[1] / best[0];
}

describe.each(ARTIFACTS)('the %s artifact', (_artifact, read) => {
    // The names a mangle rewrites, read with scripting off: a page's
    // `noscript` markup is what a browser without scripts renders.
    it.each(CASES.map(c => [c.case, c] as const))('%s', (_case, c) => {
        const { html } = c;
        const found = c.foundScriptingOff ?? c.found;
        const names = read(html);
        const expected = found.flatMap(
            at => at.names ?? at.value.split(HTML_SPACE).filter(Boolean),
        );
        expect(names.map(n => n.name)).toEqual(expected);
        for (const { start, end, name } of names) {
            // Each spelling lies inside an attribute parse5 reads, and one
            // with no reference in it is the name itself.
            expect(found.some(at => at.start <= start && end <= at.end)).toBe(true);
            const spelled = html.slice(start, end);
            if (!spelled.includes('&')) expect(spelled).toBe(name);
        }
    });

    // Four times the text reads in about four times the time (×4.0 to ×4.1
    // alone, on both artifacts), a quadratic read in sixteen. Not sixteen
    // times the text: there the small read of a shape that builds many
    // names took about a millisecond, and under a full verify on the host it
    // read ×70 to ×100 by the clock, measured again or not. Here it takes 4
    // to 8 ms, counted in CPU time.
    it.each([
        ['tags with a class each', '', '<i class=a>'],
        ['one tag repeating its class', '<i', ' class=a'],
        ['names between non-ASCII text', '', '<b class="é a">ü😀</b>'],
        ['near-miss end tags in a script', '<script>', '</scrip'],
        ['dashes in a comment that never closes', '<!--', '<!-- -'],
        ['a quote that never closes', '<i class="', 'a '],
        ['nested svg', '', '<svg><g class=a>'],
        ['character references', '', '<i class="a&#32;b&amp;c">'],
    ])(
        'reads %s in linear time',
        (_case, prefix, unit) => {
            const fill = (size: number): string =>
                prefix + unit.repeat(Math.ceil(size / unit.length));
            expect(growth(read, fill(250_000), fill(1_000_000))).toBeLessThan(10);
        },
        30_000,
    );
});

describe.each(['wasm', ...(RUST_LANE ? ['rust'] : [])] as const)(
    'the %s artifact a build names',
    parser => {
        it('reads the class names on it', () => {
            expect(htmlClassNames('<p class="a b">', { parser })).toEqual([
                { start: 10, end: 11, name: 'a' },
                { start: 12, end: 13, name: 'b' },
            ]);
        });
    },
);
