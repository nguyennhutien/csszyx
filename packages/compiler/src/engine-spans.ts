/**
 * Turn the engine's byte offsets into the lines and columns a reader wants.
 *
 * The engine reports where a diagnostic or a merge group sits as a byte offset
 * into the UTF-8 source, because computing a line costs a pass over the file
 * and most results are never asked for one (ADR 0011). This module does that
 * pass here, once per file and only when a position is first read: each
 * located entry's `line` and `column` are prototype getters over one lazily
 * built index, so a result nobody reads a position from pays nothing, and
 * `JSON.stringify` still writes them as ordinary fields.
 *
 * A store that keeps results across builds asks for the offsets back
 * ({@link storeEngineSpans}) rather than serialising the getters: writing a
 * line and column for every class resolved each position and grew a transform
 * cache entry by ~45%, while the source is at hand again when it is read
 * ({@link restoreEngineSpans}).
 *
 * Both engine artifacts hand a file's spans over as the same text, written by
 * one writer in the engine (`packages/core/src/transform/spans.rs`), and
 * {@link decodeEngineSpans} is the one reader of it for both
 * (`transform-rust.ts`, `transform-wasm.ts`), so the two cannot place one
 * diagnostic differently.
 *
 * @module engine-spans
 */

import type { SzDiagnosticArgsByCode, SzDiagnosticCode } from './diagnostic-codes.generated.js';

/** A 1-based line and a 1-based column counted in UTF-16 code units. */
export interface SourcePosition {
    line: number;
    column: number;
}

/** What one engine diagnostic reports, and where; index-parallel to `diagnostics`. */
export interface SzDiagnosticIssue<C extends SzDiagnosticCode = SzDiagnosticCode>
    extends SourcePosition {
    /** The kind of problem, as `csszyx check --rule` names it. */
    code: C;
    /**
     * What the sentence names, as data: the key, the value, the form of the
     * sentence. Read these, never the English, which the registry rewords.
     */
    args: SzDiagnosticArgsByCode[C];
}

/** A diagnostic whose `args` narrow by `code`. */
export type SzIssue = { [C in SzDiagnosticCode]: SzDiagnosticIssue<C> }[SzDiagnosticCode];

/**
 * One static object a merge would read, from a pass with no merge table.
 *
 * @internal Read by the bundler plugin and `csszyx check`; not a stable shape.
 */
export interface SzMergeGroup {
    /** The key each class was lowered from, index-parallel to `classes`. */
    keys: string[];
    /**
     * Where the key each class was lowered from is written, index-parallel to
     * `classes`: a removed class is reported on its own key's line, and a
     * variant key's nested classes on the variant key's.
     */
    positions: SourcePosition[];
    /** The classes, as emitted. */
    classes: string[];
}

/**
 * A static class name and the static `sz` classes beside it on one element,
 * placed at the class-name attribute.
 *
 * @internal Read by the bundler plugin and `csszyx check`; not a stable shape.
 */
export interface SzMergeOverride extends SourcePosition {
    /** The class name's classes, as written. */
    base: string[];
    /** The `sz` classes, as emitted. */
    over: string[];
}

/** Resolve a UTF-8 byte offset into the source to its position. */
export type ByteOffsetLocator = (offset: number) => SourcePosition;

/**
 * The last code point one UTF-16 unit holds. `codePointAt` reads past it only
 * where a first half of a pair is followed by a second half; either half
 * anywhere else reads as itself, a lone half.
 */
const LAST_SINGLE_UNIT = 0xffff;

/**
 * The UTF-8 length of one UTF-16 unit that is not part of a pair.
 *
 * A lone half of a pair, either one, is three bytes: the native binding and
 * `TextEncoder` both write U+FFFD in its place.
 *
 * @param code - The unit.
 * @returns 1, 2 or 3.
 */
function utf8Length(code: number): number {
    if (code < 0x80) return 1;
    if (code < 0x800) return 2;
    return 3;
}

/** Bytes between two marks inside one line, at least. */
const MARK_STRIDE = 64;

/**
 * A locator for one source text, building its index on the first call.
 *
 * The index marks each line start and, within a line, one character boundary
 * every {@link MARK_STRIDE} bytes or so, with the line each mark is on. A
 * lookup finds the last mark at or before the offset by binary search and
 * walks from there, so it reads at most a stride of text: `O(n)` once for
 * the index, then `O(log n)` per lookup, however long the line. A minified
 * module on one line with thousands of diagnostics walked that line up to
 * each of them when a lookup started at the line.
 *
 * An offset past the end resolves to the end, as the engine's own clamp does;
 * one inside a character, to the character after it.
 *
 * @param source - The module the engine was given.
 * @returns The locator.
 */
export function createByteOffsetLocator(source: string): ByteOffsetLocator {
    // Each mark's byte offset, UTF-16 index and line; each line's UTF-16
    // start. Built on first use.
    let markBytes: number[] | undefined;
    let markUnits: number[] = [];
    let markLines: number[] = [];
    let lineUnits: number[] = [];
    const build = (): number[] => {
        const bytes = [0];
        const units = [0];
        const lines = [0];
        const starts = [0];
        let byte = 0;
        let next = MARK_STRIDE;
        for (let index = 0; index < source.length; ) {
            const code = source.codePointAt(index) as number;
            if (code > LAST_SINGLE_UNIT) {
                byte += 4;
                index += 2;
            } else {
                byte += utf8Length(code);
                index += 1;
            }
            if (code === 0x0a) {
                starts.push(index);
            } else if (byte < next) {
                continue;
            }
            bytes.push(byte);
            units.push(index);
            lines.push(starts.length - 1);
            next = byte + MARK_STRIDE;
        }
        markUnits = units;
        markLines = lines;
        lineUnits = starts;
        return bytes;
    };
    return offset => {
        markBytes ??= build();
        let low = 0;
        let high = markBytes.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if ((markBytes[middle] as number) <= offset) low = middle;
            else high = middle - 1;
        }
        let byte = markBytes[low] as number;
        let unit = markUnits[low] as number;
        while (unit < source.length && byte < offset) {
            // A surrogate pair is one character: step over both halves.
            const code = source.codePointAt(unit) as number;
            if (code > LAST_SINGLE_UNIT) {
                byte += 4;
                unit += 2;
            } else {
                byte += utf8Length(code);
                unit += 1;
            }
        }
        const line = markLines[low] as number;
        return { line: line + 1, column: unit - (lineUnits[line] as number) + 1 };
    };
}

/**
 * A place in one file, resolved from its byte offset on the first read.
 *
 * `line` and `column` are getters on the prototype, sharing the file's locator,
 * so locating an entry costs one allocation and no closure: a result read back
 * from the transform cache places thousands of keys and reads few of them.
 * Being accessors, they are not own fields — a spread (`{ ...issue }`) or
 * `Object.keys` does not carry them; `JSON.stringify` does, through `toJSON`,
 * for a consumer that hands results on as JSON.
 */
class LocatedSpan implements SourcePosition {
    readonly #start: number;
    readonly #locate: ByteOffsetLocator;
    #position: SourcePosition | undefined;

    /**
     * @param start - The byte offset the engine reported.
     * @param locate - The file's locator.
     */
    constructor(start: number, locate: ByteOffsetLocator) {
        this.#start = start;
        this.#locate = locate;
    }

    /** @returns The 1-based line. */
    get line(): number {
        return LocatedSpan.#positionOf(this)?.line as number;
    }

    /** @returns The 1-based column, in UTF-16 code units. */
    get column(): number {
        return LocatedSpan.#positionOf(this)?.column as number;
    }

    /**
     * An entry's position, resolved once.
     *
     * A copy made with this prototype but not by this constructor
     * (`Object.create` plus an own-field copy, as deep-clone helpers do) has no
     * offset to resolve, and reads as having no position instead of throwing
     * on a private field it lacks.
     *
     * @param entry - The receiver of a getter.
     * @returns The position, or `undefined` on such a copy.
     */
    static #positionOf(entry: object): SourcePosition | undefined {
        if (!(#start in entry)) return undefined;
        entry.#position ??= entry.#locate(entry.#start);
        return entry.#position;
    }

    /** @returns The entry's own fields with its position, as plain data. */
    toJSON(): SourcePosition {
        return { ...this, line: this.line, column: this.column };
    }

    /**
     * @param entry - Any entry.
     * @returns The offset it was located from, or `undefined` for one built elsewhere.
     */
    static startOf(entry: object): number | undefined {
        return #start in entry ? entry.#start : undefined;
    }
}

/** A located diagnostic. */
class LocatedIssue extends LocatedSpan implements SzDiagnosticIssue {
    code: SzDiagnosticCode;
    args: SzDiagnosticArgsByCode[SzDiagnosticCode];

    /**
     * @param code - The diagnostic's code.
     * @param args - Its named values.
     * @param start - The byte offset.
     * @param locate - The file's locator.
     */
    constructor(
        code: SzDiagnosticCode,
        args: SzDiagnosticArgsByCode[SzDiagnosticCode],
        start: number,
        locate: ByteOffsetLocator,
    ) {
        super(start, locate);
        this.code = code;
        this.args = args;
    }
}

/** A located merge pair. */
class LocatedOverride extends LocatedSpan implements SzMergeOverride {
    base: string[];
    over: string[];

    /**
     * @param base - The class name's classes.
     * @param over - The `sz` classes.
     * @param start - The byte offset.
     * @param locate - The file's locator.
     */
    constructor(base: string[], over: string[], start: number, locate: ByteOffsetLocator) {
        super(start, locate);
        this.base = base;
        this.over = over;
    }
}

/**
 * A located merge group: its positions are built on the first read, from the
 * key offsets the engine reported.
 *
 * A group per static object, and a position per class, made on every
 * transform; most are never read — the build reads one only for a dead class
 * it names, and a store keeps the offsets ({@link storeEngineSpans}). `keys`
 * and `classes` stay own fields; `positions` is an accessor, which
 * `JSON.stringify` writes through `toJSON`.
 */
class LocatedGroup implements SzMergeGroup {
    keys: string[];
    classes: string[];
    readonly #keyStarts: number[];
    readonly #locate: ByteOffsetLocator;
    #positions: SourcePosition[] | undefined;

    /**
     * @param keys - The key behind each class.
     * @param keyStarts - The byte offset of each key, index-parallel.
     * @param classes - The classes.
     * @param locate - The file's locator.
     */
    constructor(keys: string[], keyStarts: number[], classes: string[], locate: ByteOffsetLocator) {
        this.keys = keys;
        this.classes = classes;
        this.#keyStarts = keyStarts;
        this.#locate = locate;
    }

    /** @returns Where each class's key is written, index-parallel to `classes`. */
    get positions(): SourcePosition[] {
        this.#positions ??= this.#keyStarts.map(start => new LocatedSpan(start, this.#locate));
        return this.#positions;
    }

    /** @returns The group as plain data, positions resolved. */
    toJSON(): SzMergeGroup {
        return { keys: this.keys, positions: this.positions, classes: this.classes };
    }

    /**
     * @param group - Any group.
     * @returns The key offsets it was located from, or `undefined` for one built elsewhere.
     */
    static keyStartsOf(group: object): readonly number[] | undefined {
        return #keyStarts in group ? group.#keyStarts : undefined;
    }
}

/**
 * The byte offset each class's key is written at, for a group this module
 * located; `undefined` for one built elsewhere, which carries only positions.
 *
 * Offsets order like positions within one file, and reading them resolves
 * nothing.
 *
 * @internal Read by the bundler plugin's dead-class report.
 * @param group - A group a result carries.
 * @returns Its key offsets, index-parallel to `classes`, or `undefined`.
 */
export function szMergeGroupKeyStarts(group: SzMergeGroup): readonly number[] | undefined {
    return LocatedGroup.keyStartsOf(group);
}

/** One diagnostic as the engine reports it. */
interface RawIssue {
    code: string;
    start: number;
    /** The values the diagnostic names; absent from a hand-built one. */
    args?: object;
}

/** One merge group as the engine reports it. */
interface RawMergeGroup {
    keys: string[];
    keyStarts: number[];
    classes: string[];
}

/** One merge pair as the engine reports it. */
interface RawMergeOverride {
    start: number;
    base: string[];
    over: string[];
}

/** The raw spans of one engine result, as a store or a test writes them. */
export interface RawEngineSpans {
    issues: ReadonlyArray<RawIssue>;
    mergeGroups: ReadonlyArray<RawMergeGroup>;
    /** Absent from a store written before one-class groups. */
    singleClassGroups?: ReadonlyArray<RawMergeGroup>;
    mergeOverrides: ReadonlyArray<RawMergeOverride>;
}

/** The located spans of one result. */
export interface LocatedEngineSpans {
    issues: SzDiagnosticIssue[];
    mergeGroups: SzMergeGroup[];
    singleClassGroups: SzMergeGroup[];
    mergeOverrides: SzMergeOverride[];
}

/**
 * The spans text format this compiler reads: the first number of every
 * spans text. The engine keeps its own number for what it writes
 * (`SPANS_FORMAT` in `packages/core/src/transform/spans.rs`); a test holds
 * the two equal in one release, and text in any other format is refused.
 */
export const ENGINE_SPANS_FORMAT = 1;

/**
 * Thrown when an engine's spans text cannot be read: it is in another format,
 * or it breaks the grammar. Only an engine from another build, or a csszyx
 * bug, writes either; each lane reports it as an `internal-error`.
 */
export class EngineSpansWireError extends Error {
    /**
     * @param detail - What could not be read.
     */
    constructor(detail: string) {
        super(detail);
        this.name = 'EngineSpansWireError';
    }
}

/** `,` ends a number, `:` a string's length. */
const COMMA = 44;
const COLON = 58;

/** The largest number the engine writes: offsets and counts are `u32`. */
const MAX_NUMBER = 0xffffffff;

/**
 * The text being read and the cursor into it. Module state rather than a
 * closure per call: one file's spans are read on every transform, and the
 * closures cost more young-generation collections than the reading did.
 */
let wire = '';
let at = 0;

/**
 * Refuse the text being read.
 *
 * @param what - What was found where the grammar wants something else.
 * @throws {EngineSpansWireError} always.
 */
function malformed(what: string): never {
    throw new EngineSpansWireError(
        `the engine's spans text has ${what} at character ${at} of ${wire.length}`,
    );
}

/**
 * `<digits><end>`: a whole number of at most {@link MAX_NUMBER}. Past the end
 * reads as `-1`, which is neither a digit nor `end`.
 *
 * @param end - The character that ends it.
 * @returns The number.
 */
function readNumber(end: number): number {
    let code = wire.codePointAt(at) ?? -1;
    // 48 to 57: `0` to `9`.
    if (!(code >= 48 && code <= 57)) malformed('no digit');
    let value = 0;
    do {
        value = value * 10 + code - 48;
        if (value > MAX_NUMBER) malformed('a number past 32 bits');
        code = wire.codePointAt(++at) ?? -1;
    } while (code >= 48 && code <= 57);
    if (code !== end) malformed(end === COMMA ? 'no `,` after a number' : 'no `:` after a length');
    at++;
    return value;
}

/**
 * `<count>,`, refused when the rest of the text cannot hold that many items:
 * each takes at least one character, so no array is ever sized past the
 * text's own length.
 *
 * @returns The count.
 */
function readCount(): number {
    const count = readNumber(COMMA);
    if (count > wire.length - at) malformed('a count the rest cannot hold');
    return count;
}

/**
 * `<length>:`, the length of a string in UTF-16 units, refused when it runs
 * past the end.
 *
 * @returns The length.
 */
function readLength(): number {
    const length = readNumber(COLON);
    if (length > wire.length - at) malformed('a string past the end');
    return length;
}

/** Slots in {@link seen}: a power of two, so a hash masks into one. */
const SEEN_SLOTS = 4096;

/**
 * The names this reader has made, by a hash of their characters, so a key or
 * class read again is the string read before rather than a fresh copy.
 * `JSON.parse` gets the same from V8, which internalizes string values under
 * 10 characters; a slice of the text internalizes nothing. Direct-mapped, as
 * msgpackr's `keyCache` is: a collision replaces the slot's name. It only
 * decides which equal string is returned, never what is read.
 */
const seen: Array<string | undefined> = /* @__PURE__ */ new Array(SEEN_SLOTS).fill(undefined);

/**
 * `<length>:<text>`, through {@link seen}.
 *
 * @returns The string.
 */
function readName(): string {
    const length = readLength();
    const end = at + length;
    let hash = length;
    for (let index = at; index < end; index++) {
        hash = (Math.imul(hash, 31) + (wire.codePointAt(index) as number)) | 0;
    }
    const slot = hash & (SEEN_SLOTS - 1);
    let name = seen[slot];
    if (name?.length !== length || !wire.startsWith(name, at)) {
        name = wire.slice(at, end);
        seen[slot] = name;
    }
    at = end;
    return name;
}

/** The file's locator, while its text is read. */
let wireLocate: ByteOffsetLocator;

/**
 * `<count>,` then that many items, each read by `item`.
 *
 * @param item - The reader of one item.
 * @returns The items.
 */
function readList<T>(item: () => T): T[] {
    const count = readCount();
    const items = new Array<T>(count);
    for (let index = 0; index < count; index++) items[index] = item();
    return items;
}

/**
 * The args of every issue of the file, one JSON list read with one parse:
 * a parse per issue cost a fixed quarter microsecond each.
 *
 * @param issues - The file's issues, in order.
 */
function readArgs(issues: LocatedIssue[]): void {
    const length = readLength();
    const text = wire.slice(at, at + length);
    at += length;
    let args: unknown;
    try {
        args = JSON.parse(text);
    } catch {
        malformed('args that are not JSON');
    }
    if (!Array.isArray(args) || args.length !== issues.length) {
        malformed('args that are not one entry per issue');
    }
    for (let index = 0; index < issues.length; index++) {
        const entry: unknown = args[index];
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
            malformed('args that are not an object');
        }
        (issues[index] as LocatedIssue).args = entry as SzDiagnosticArgsByCode[SzDiagnosticCode];
    }
}

/**
 * One group: `<count>,` entries of key, key offset and class.
 *
 * @returns The group, located.
 */
function readGroup(): SzMergeGroup {
    const size = readCount();
    const keys = new Array<string>(size);
    const keyStarts = new Array<number>(size);
    const classes = new Array<string>(size);
    for (let index = 0; index < size; index++) {
        keys[index] = readName();
        keyStarts[index] = readNumber(COMMA);
        classes[index] = readName();
    }
    return new LocatedGroup(keys, keyStarts, classes, wireLocate);
}

/**
 * One issue: its code and offset; its args come after every issue's.
 *
 * @returns The issue, located.
 */
function readIssue(): LocatedIssue {
    const code = readName() as SzDiagnosticCode;
    // Its args are set once the file's list of them is read.
    return new LocatedIssue(code, undefined as never, readNumber(COMMA), wireLocate);
}

/**
 * One class-name pair: its offset, the class name's classes, the `sz` ones.
 *
 * @returns The pair, located.
 */
function readPair(): SzMergeOverride {
    const start = readNumber(COMMA);
    const base = readList(readName);
    return new LocatedOverride(base, readList(readName), start, wireLocate);
}

/**
 * The format number the text starts with, refused unless it is
 * {@link ENGINE_SPANS_FORMAT}.
 */
function readFormat(): void {
    let format: number;
    try {
        format = readNumber(COMMA);
    } catch {
        throw new EngineSpansWireError(
            `the engine's spans text starts with no format number; this compiler reads format ${ENGINE_SPANS_FORMAT}`,
        );
    }
    if (format !== ENGINE_SPANS_FORMAT) {
        throw new EngineSpansWireError(
            `the engine wrote its spans in format ${format}; this compiler reads format ${ENGINE_SPANS_FORMAT}`,
        );
    }
}

/**
 * Read one engine result's spans, located against the source lazily: the
 * text both artifacts write for a file, the native binding as `spans` and
 * the wasm build as its result's `spans` field.
 *
 * The text, all numbers decimal:
 *
 * ```text
 * spans    = format "," issues groups groups overrides   (merge, then one-class groups)
 * issues   = count "," { str(code) num(start) } [ str(args) ]   (args when count > 0)
 * groups   = count "," { count "," { str(key) num(keyStart) str(class) } }
 * overrides= count "," { num(start) count "," { str(base) } count "," { str(over) } }
 * num(n)   = digits ","          str(s) = utf16Length(s) ":" s
 * ```
 *
 * `args` is one JSON list, an object per issue. A string is counted, never
 * escaped, so any character may appear in a key or a class.
 *
 * `n` is the length of the text: `O(n)` time — every character is read once
 * and a name hashed and compared once more — and no array is made longer
 * than the text, whatever a count says. The worst case is a text of
 * distinct long names that all land in one cache slot: each is still read,
 * hashed and compared once.
 *
 * Every list is present in what this returns, empty when the file has none:
 * an absent `mergeGroups` reads as "the whole file is one group" to the
 * plugin, which no engine result means.
 *
 * @param source - The module the engine was given.
 * @param spans - The spans text the engine wrote.
 * @returns The located spans.
 * @throws {EngineSpansWireError} when the text is in another format or breaks
 *         the grammar.
 */
export function decodeEngineSpans(source: string, spans: string): LocatedEngineSpans {
    wire = spans;
    at = 0;
    readFormat();
    wireLocate = createByteOffsetLocator(source);
    const issues = readList(readIssue);
    if (issues.length > 0) readArgs(issues);
    const mergeGroups = readList(readGroup);
    const singleClassGroups = readList(readGroup);
    const mergeOverrides = readList(readPair);
    if (at !== wire.length) malformed('text after the last list');
    wire = '';
    return { issues, mergeGroups, singleClassGroups, mergeOverrides };
}

/**
 * Locate every span of one engine result against its source.
 *
 * @param source - The module the engine was given.
 * @param raw - The spans the engine reported.
 * @returns The same entries, with `line` and `column` in place of each offset.
 */
export function locateEngineSpans(source: string, raw: RawEngineSpans): LocatedEngineSpans {
    const locate = createByteOffsetLocator(source);
    return {
        issues: raw.issues.map(issue => locateIssue(issue, locate)),
        mergeGroups: raw.mergeGroups.map(group => locateGroup(group, locate)),
        singleClassGroups: (raw.singleClassGroups ?? []).map(group => locateGroup(group, locate)),
        mergeOverrides: raw.mergeOverrides.map(pair => locateOverride(pair, locate)),
    };
}

/**
 * @param issue - The diagnostic as reported.
 * @param locate - The file's locator.
 * @returns It located.
 */
function locateIssue(issue: RawIssue, locate: ByteOffsetLocator): SzDiagnosticIssue {
    // The engine writes each code's args as the registry names them.
    const args = (issue.args ?? {}) as SzDiagnosticArgsByCode[SzDiagnosticCode];
    return new LocatedIssue(issue.code as SzDiagnosticCode, args, issue.start, locate);
}

/**
 * @param group - The merge group as reported.
 * @param locate - The file's locator.
 * @returns It located.
 */
function locateGroup(group: RawMergeGroup, locate: ByteOffsetLocator): SzMergeGroup {
    return new LocatedGroup(group.keys, group.keyStarts, group.classes, locate);
}

/**
 * @param pair - The merge pair as reported.
 * @param locate - The file's locator.
 * @returns It located.
 */
function locateOverride(pair: RawMergeOverride, locate: ByteOffsetLocator): SzMergeOverride {
    return new LocatedOverride(pair.base, pair.over, pair.start, locate);
}

/** Located spans as some of a result carries them; each field may be absent. */
export type PartialLocatedEngineSpans = Partial<LocatedEngineSpans>;

/**
 * Spans in the form a store keeps: each entry this module located goes back to
 * the offset it came from, and any other entry — one built by hand, with a
 * plain `line` and `column` — stays as it is.
 *
 * @internal Read and written by the bundler plugin's transform cache.
 */
export interface StoredEngineSpans {
    issues?: Array<RawIssue | SzDiagnosticIssue>;
    mergeGroups?: Array<RawMergeGroup | SzMergeGroup>;
    singleClassGroups?: Array<RawMergeGroup | SzMergeGroup>;
    mergeOverrides?: Array<RawMergeOverride | SzMergeOverride>;
}

/**
 * A group in the form a store keeps.
 *
 * @param group - A group as a result carries it.
 * @returns Its offsets in place of the positions this module made, or the
 *          group unchanged when one of them was built elsewhere.
 */
function storeGroup(group: SzMergeGroup): RawMergeGroup | SzMergeGroup {
    const located = LocatedGroup.keyStartsOf(group);
    if (located !== undefined) {
        return { keys: group.keys, keyStarts: [...located], classes: group.classes };
    }
    const keyStarts = group.positions.map(position => LocatedSpan.startOf(position));
    return keyStarts.every(start => start !== undefined)
        ? { keys: group.keys, keyStarts: keyStarts as number[], classes: group.classes }
        : group;
}

/**
 * The form to store located spans in, without resolving a single position.
 *
 * @param spans - The spans a result carries.
 * @returns The same entries, offsets in place of the positions this module made.
 */
export function storeEngineSpans(spans: PartialLocatedEngineSpans): StoredEngineSpans {
    const stored: StoredEngineSpans = {};
    if (spans.issues) {
        stored.issues = spans.issues.map(issue => {
            const start = LocatedSpan.startOf(issue);
            return start === undefined ? issue : { code: issue.code, start, args: issue.args };
        });
    }
    if (spans.mergeGroups) stored.mergeGroups = spans.mergeGroups.map(storeGroup);
    if (spans.singleClassGroups) {
        stored.singleClassGroups = spans.singleClassGroups.map(storeGroup);
    }
    if (spans.mergeOverrides) {
        stored.mergeOverrides = spans.mergeOverrides.map(pair => {
            const start = LocatedSpan.startOf(pair);
            return start === undefined ? pair : { start, base: pair.base, over: pair.over };
        });
    }
    return stored;
}

/**
 * Read stored spans back against the source they were reported for.
 *
 * @param source - The module the spans were reported for.
 * @param stored - What {@link storeEngineSpans} returned.
 * @returns The spans located again, lazily, as {@link locateEngineSpans} would.
 */
export function restoreEngineSpans(
    source: string,
    stored: StoredEngineSpans,
): PartialLocatedEngineSpans {
    const locate = createByteOffsetLocator(source);
    const restored: PartialLocatedEngineSpans = {};
    if (stored.issues) {
        restored.issues = stored.issues.map(issue =>
            'start' in issue ? locateIssue(issue, locate) : issue,
        );
    }
    const restoreGroup = (group: RawMergeGroup | SzMergeGroup): SzMergeGroup =>
        'keyStarts' in group ? locateGroup(group, locate) : group;
    if (stored.mergeGroups) restored.mergeGroups = stored.mergeGroups.map(restoreGroup);
    if (stored.singleClassGroups) {
        restored.singleClassGroups = stored.singleClassGroups.map(restoreGroup);
    }
    if (stored.mergeOverrides) {
        restored.mergeOverrides = stored.mergeOverrides.map(pair =>
            'start' in pair ? locateOverride(pair, locate) : pair,
        );
    }
    return restored;
}
