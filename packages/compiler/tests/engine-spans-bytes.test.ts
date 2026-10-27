/**
 * Both engine artifacts hand JavaScript a file's spans — its diagnostics and
 * the lists a merge would read — as the same text from one writer in the
 * engine: a string from the native binding, a string field of its result
 * from the wasm build. This replays every corpus source through both bindings
 * and compares the text; checks that it starts with the format this compiler
 * reads; writes what the decoder read back out with the test's own writer and
 * compares that too, so the engine's writer and the decoder are each held to
 * an independent reading of the grammar; and runs generated keys and values
 * through both artifacts. Last, it reads non-ASCII sources through the shared
 * decoder, which places each key at its UTF-8 offset.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createRng, escapeUnsafeChars, fuzzBudget } from '../../core/tests/helpers/sz-fuzz.js';
import { decodeEngineSpans, ENGINE_SPANS_FORMAT, storeEngineSpans } from '../src/engine-spans.js';
import { transformRust } from '../src/transform-rust.js';
import { transformWasm } from '../src/transform-wasm.js';
import {
    ENGINES,
    engineSpansText,
    expectSpansTextEqual,
    RUST_LANE,
} from './engine-parity-harness.js';
import { extractCorpusSnippets } from './extracted-corpus.js';
import { encodeSpansWire, type WireSpans } from './helpers/engine-spans-wire.js';

/** The frozen corpus `parse_parity_corpus.rs` replays through the native binding. */
const parseCorpus = JSON.parse(
    readFileSync(
        fileURLToPath(
            new URL('../../core/tests/fixtures/parse-parity-corpus.json', import.meta.url),
        ),
        'utf8',
    ),
) as Array<{ source: string }>;

/** Keys behind multi-byte text, quoted keys and a variant key, on one line and across lines. */
const NON_ASCII = [
    "const t = 'é — 😀';\nexport const A = () => <div sz={{ pb: 2, 'p': 4, md: { m: 1 } }} />;",
    'export const A = () => <div title="日本語" sz={{ m: 1,\n  hover: { pb: 2 }, p: 4 }} />;',
    'export const A = () => <div className="ç pb-2" sz={{ p: 4 }} title=\'ü\' />;',
    'export const A = () => <><i sz={{ p: 1 }} />{"😀😀"}<b sz={{ wrokBreak: 1, m: 2 }} /></>;',
];

/** Every corpus source, named. */
const CORPUS: Array<[string, string]> = [
    ...extractCorpusSnippets().map(
        snippet =>
            [`extracted ${snippet.file}#${snippet.index}`, snippet.source] as [string, string],
    ),
    ...parseCorpus.map(
        (entry, index) => [`parse corpus #${index}`, entry.source] as [string, string],
    ),
    ...NON_ASCII.map(text => [JSON.stringify(text), text] as [string, string]),
];

/**
 * Each artifact's spans text for a source, as strings.
 *
 * @param text - Full module source.
 * @returns The text of each artifact that ran.
 */
function textsOf(text: string): Array<[string, string]> {
    const { wasm, rust } = engineSpansText(text);
    return [
        ['wasm', wasm as string],
        ...(RUST_LANE ? [['rust', rust as string] as [string, string]] : []),
    ];
}

/**
 * Assert the test's writer writes back what the decoder read from `spans`.
 *
 * @param text - The module the spans are for.
 * @param spans - One artifact's spans text.
 * @param label - What to name on failure.
 */
function expectRewritten(text: string, spans: string, label: string): void {
    const stored = storeEngineSpans(decodeEngineSpans(text, spans)) as WireSpans;
    expect(encodeSpansWire(stored, ENGINE_SPANS_FORMAT), label).toBe(spans);
}

describe('the spans text of both artifacts', () => {
    it.each(CORPUS)('is the same text for %s', (_, text) => {
        expectSpansTextEqual(text);
    });

    it.each(ENGINES.map(([name]) => [name]))(
        'starts with the format this compiler reads, on the %s artifact',
        name => {
            const [, spans] = textsOf('export const A = () => <div sz={{ p: 4 }} />;').find(
                ([lane]) => lane === name,
            ) as [string, string];

            expect(spans.slice(0, spans.indexOf(',') + 1)).toBe(`${ENGINE_SPANS_FORMAT},`);
        },
    );

    it('is what an independent writer writes for what the decoder read, on every corpus source', () => {
        for (const [label, text] of CORPUS) {
            for (const [lane, spans] of textsOf(text))
                expectRewritten(text, spans, `${lane} ${label}`);
        }
    });
});

describe('generated keys and values', () => {
    // Every character the grammar gives a meaning to, quotes and braces, and
    // text of every UTF-8 width. No lone surrogate: the wasm artifact's JSON
    // boundary refuses one.
    const CHARACTERS = [
        'a',
        'Z',
        '0',
        '9',
        ':',
        ',',
        '-',
        '"',
        "'",
        '\\',
        ' ',
        '{',
        ']',
        '\u0001',
        'é',
        '日',
        '😀',
    ];
    const { seed, cases } = fuzzBudget(150);

    it(`agree on both artifacts and read back through the decoder (seed ${seed}, ${cases} cases)`, () => {
        const rng = createRng(seed);
        const below = (bound: number): number => Math.floor(rng() * bound);
        const word = (min: number): string =>
            Array.from({ length: min + below(6) }, () => CHARACTERS[below(CHARACTERS.length)]).join(
                '',
            );
        for (let index = 0; index < cases; index++) {
            const key = escapeUnsafeChars(JSON.stringify(word(1)));
            const value = escapeUnsafeChars(JSON.stringify(word(0)));
            const bracketed = escapeUnsafeChars(JSON.stringify(`[${word(1)}]`));
            const text = `export const A = () => <div className="c-1 pb-2" sz={{ ${key}: ${value}, p: ${bracketed}, hover: { ${key}: 2, m: ${value} } }} />;`;
            const label = `seed ${seed}, case ${index}: ${text}`;
            expectSpansTextEqual(text);
            for (const [lane, spans] of textsOf(text))
                expectRewritten(text, spans, `${lane} ${label}`);
            if (!RUST_LANE) continue;
            expect(
                JSON.stringify(storeEngineSpans(transformRust(text, { filename: '/p/t.tsx' }))),
                label,
            ).toBe(JSON.stringify(storeEngineSpans(transformWasm(text, { filename: '/p/t.tsx' }))));
        }
    });
});

describe('keys read back from a non-ASCII source', () => {
    it.each(ENGINES.map(([name, transform]) => [name, transform]))(
        'are the keys as written on the %s lane',
        (_, transform) => {
            const result = transform(NON_ASCII[0] as string, { filename: '/p/t.tsx' });
            const [group] = result.mergeGroups ?? [];

            expect(group?.keys).toEqual(['pb', 'p', 'md']);
            expect(group?.classes).toEqual(['pb-2', 'p-4', 'md:m-1']);
            const line = (NON_ASCII[0] as string).split('\n')[1] as string;
            expect(group?.positions.map(({ line, column }) => [line, column])).toEqual(
                ['pb', "'p'", 'md'].map(key => [2, line.indexOf(key) + 1]),
            );
        },
    );

    it('are the same on both lanes, positions included, for every non-ASCII source', () => {
        for (const text of NON_ASCII) {
            const wasm = transformWasm(text, { filename: '/p/t.tsx' });
            if (!RUST_LANE) continue;
            const rust = transformRust(text, { filename: '/p/t.tsx' });
            expect(JSON.stringify(rust.mergeGroups), text).toBe(JSON.stringify(wasm.mergeGroups));
            expect(JSON.stringify(rust.singleClassGroups), text).toBe(
                JSON.stringify(wasm.singleClassGroups),
            );
            expect(JSON.stringify(rust.issues), text).toBe(JSON.stringify(wasm.issues));
        }
    });

    // Only the native binding takes a lone surrogate: the wasm artifact's JSON
    // boundary refuses one. The binding writes U+FFFD for it, three bytes.
    it.skipIf(!RUST_LANE)('are the keys as written after a lone surrogate', () => {
        const text = 'export const A = () => <div title="\uD800" sz={{ pb: 2, p: 4 }} />;';
        const [group] = transformRust(text, { filename: '/p/t.tsx' }).mergeGroups ?? [];

        expect(group?.keys).toEqual(['pb', 'p']);
        expect(group?.positions.map(({ column }) => column)).toEqual([
            text.indexOf('pb') + 1,
            text.indexOf('p:') + 1,
        ]);
    });
});
