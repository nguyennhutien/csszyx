/**
 * A second writer of the engine's spans text, for tests: the grammar written
 * out plainly in JavaScript, so the decoder and the engine's writer each have
 * something independent to be checked against.
 *
 * Also the generator and shrinker the property tests draw spans from. The
 * alphabet holds every character the grammar gives a meaning to (`:` `,` and
 * digits), quotes and backslashes, controls, two- and three-byte text, an
 * astral character and both lone halves of a surrogate pair, which only a
 * JavaScript string can hold.
 */
import { createRng } from '../../../core/tests/helpers/sz-fuzz.js';

/** One file's spans, in the form a store keeps them. */
export interface WireSpans {
    issues: Array<{ code: string; start: number; args: object }>;
    mergeGroups: WireGroup[];
    singleClassGroups: WireGroup[];
    mergeOverrides: Array<{ start: number; base: string[]; over: string[] }>;
}

/** One group: index-parallel keys, key offsets and classes. */
export interface WireGroup {
    keys: string[];
    keyStarts: number[];
    classes: string[];
}

/**
 * `<length in UTF-16 units>:<text>`.
 *
 * @param text - Any string.
 * @returns It on the wire.
 */
function str(text: string): string {
    return `${text.length}:${text}`;
}

/**
 * `<decimal>,`.
 *
 * @param value - A whole number.
 * @returns It on the wire.
 */
function int(value: number): string {
    return `${value},`;
}

/**
 * The spans as the engine writes them, by the grammar in
 * `packages/core/src/transform/spans.rs`.
 *
 * @param spans - The spans.
 * @param format - The format number to write first.
 * @returns The text.
 */
export function encodeSpansWire(spans: WireSpans, format: number): string {
    let out = int(format) + int(spans.issues.length);
    for (const issue of spans.issues) out += str(issue.code) + int(issue.start);
    if (spans.issues.length > 0) out += str(JSON.stringify(spans.issues.map(issue => issue.args)));
    for (const groups of [spans.mergeGroups, spans.singleClassGroups]) {
        out += int(groups.length);
        for (const group of groups) {
            out += int(group.keys.length);
            group.keys.forEach((key, index) => {
                out +=
                    str(key) +
                    int(group.keyStarts[index] as number) +
                    str(group.classes[index] as string);
            });
        }
    }
    out += int(spans.mergeOverrides.length);
    for (const pair of spans.mergeOverrides) {
        out += int(pair.start) + int(pair.base.length) + pair.base.map(str).join('');
        out += int(pair.over.length) + pair.over.map(str).join('');
    }
    return out;
}

/** Characters the generator writes text from. */
const ALPHABET = [
    'a',
    'p',
    '-',
    '4',
    '0',
    '9',
    ':',
    ',',
    '"',
    "'",
    '\\',
    ' ',
    '[',
    ']',
    '\u0000',
    '\u001f',
    'é',
    '日',
    '😀',
    '\uD800',
    '\uDC00',
];

/**
 * A random spans value.
 *
 * @param seed - The generator's seed.
 * @returns Spans of every list, some empty, with text from {@link ALPHABET}.
 */
export function randomWireSpans(seed: number): WireSpans {
    const rng = createRng(seed);
    const below = (bound: number): number => Math.floor(rng() * bound);
    const text = (): string => {
        // Mostly short, now and then long enough to need several digits.
        const length = below(8) === 0 ? below(300) : below(8);
        let out = '';
        for (let index = 0; index < length; index++) out += ALPHABET[below(ALPHABET.length)];
        return out;
    };
    const offset = (): number => [0, 1, 9, 10, 4_294_967_295][below(6)] ?? below(100_000);
    const list = <T>(bound: number, item: () => T): T[] =>
        Array.from({ length: below(bound) }, item);
    const group = (): WireGroup => {
        const keys = list(5, text);
        return { keys, keyStarts: keys.map(offset), classes: keys.map(text) };
    };
    return {
        issues: list(4, () => ({
            code: text(),
            start: offset(),
            args: below(3) === 0 ? {} : { key: text(), count: below(1000), list: list(3, text) },
        })),
        mergeGroups: list(4, group),
        singleClassGroups: list(3, group),
        mergeOverrides: list(3, () => ({
            start: offset(),
            base: list(4, text),
            over: list(4, text),
        })),
    };
}

/**
 * Each value one step smaller than `spans`: one entry, one list item or one
 * character fewer.
 *
 * @param spans - The spans to shrink.
 * @returns The candidates, smallest change first.
 */
function smaller(spans: WireSpans): WireSpans[] {
    const out: WireSpans[] = [];
    const json = JSON.stringify(spans);
    const visit = (value: unknown, path: Array<string | number>): void => {
        if (Array.isArray(value)) {
            value.forEach((_, index) => {
                const copy = JSON.parse(json) as WireSpans;
                const parent = path.reduce<unknown>(
                    (at, key) => (at as Record<string | number, unknown>)[key],
                    copy,
                ) as unknown[];
                parent.splice(index, 1);
                out.push(copy);
            });
            for (const [index, item] of value.entries()) visit(item, [...path, index]);
        } else if (typeof value === 'object' && value !== null) {
            for (const [key, item] of Object.entries(value)) visit(item, [...path, key]);
        } else if (typeof value === 'string' && value.length > 0) {
            const copy = JSON.parse(json) as WireSpans;
            const parent = path
                .slice(0, -1)
                .reduce<unknown>(
                    (at, key) => (at as Record<string | number, unknown>)[key],
                    copy,
                ) as Record<string | number, unknown>;
            parent[path.at(-1) as string | number] = value.slice(1);
            out.push(copy);
        }
    };
    visit(spans, []);
    // A group's keys, offsets and classes stay index-parallel.
    return out.filter(candidate =>
        [...candidate.mergeGroups, ...candidate.singleClassGroups].every(
            group =>
                group.keys.length === group.keyStarts.length &&
                group.keys.length === group.classes.length,
        ),
    );
}

/**
 * The smallest spans that still fail, one step at a time.
 *
 * @param spans - A failing value.
 * @param fails - Whether a candidate still fails.
 * @returns The smallest failing value found.
 */
export function shrinkWireSpans(spans: WireSpans, fails: (spans: WireSpans) => boolean): WireSpans {
    let current = spans;
    for (let step = 0; step < 500; step++) {
        const next = smaller(current).find(fails);
        if (next === undefined) return current;
        current = next;
    }
    return current;
}
