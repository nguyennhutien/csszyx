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
 * Shared by both engine artifacts' result mapping (`transform-rust.ts`,
 * `transform-wasm.ts`), so the two cannot place one diagnostic differently.
 *
 * @module engine-spans
 */

import type { SzDiagnosticCode } from './diagnostic-codes.generated.js';

/** A 1-based line and a 1-based column counted in UTF-16 code units. */
export interface SourcePosition {
    line: number;
    column: number;
}

/** What one engine diagnostic reports, and where; index-parallel to `diagnostics`. */
export interface SzDiagnosticIssue extends SourcePosition {
    /** The kind of problem, as `csszyx check --rule` names it. */
    code: SzDiagnosticCode;
}

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
 * The UTF-8 length of the code point read at an index, with a surrogate pair
 * counted where it starts.
 *
 * @param code - The code point `codePointAt` read there.
 * @returns Bytes it contributes: 1–4, or 0 for the second half of a pair.
 */
function utf8Length(code: number): number {
    if (code < 0x80) return 1;
    if (code < 0x800) return 2;
    if (code > 0xffff) return 4;
    // The second half of a pair, read on its own: the code point read at the
    // first half already counted all four bytes.
    if (code >= 0xdc00 && code <= 0xdfff) return 0;
    // Anything else, a lone first half included, which an encoder writes as
    // U+FFFD.
    return 3;
}

/**
 * A locator for one source text, building its line index on the first call.
 *
 * `O(n)` once for the index, then `O(log lines + line length)` per lookup. An
 * offset past the end resolves to the end, as the engine's own clamp does.
 *
 * @param source - The module the engine was given.
 * @returns The locator.
 */
export function createByteOffsetLocator(source: string): ByteOffsetLocator {
    // Byte and UTF-16 start of each line, built on first use.
    let byteStarts: number[] | undefined;
    let unitStarts: number[] = [];
    const build = (): number[] => {
        const bytes = [0];
        const units = [0];
        let byte = 0;
        for (let index = 0; index < source.length; index++) {
            // At a pair's first half the code point counts all four bytes;
            // the second half, read on its own, counts none.
            const code = source.codePointAt(index) as number;
            byte += utf8Length(code);
            if (code === 0x0a) {
                bytes.push(byte);
                units.push(index + 1);
            }
        }
        unitStarts = units;
        return bytes;
    };
    return offset => {
        byteStarts ??= build();
        let low = 0;
        let high = byteStarts.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if ((byteStarts[middle] as number) <= offset) low = middle;
            else high = middle - 1;
        }
        let byte = byteStarts[low] as number;
        let unit = unitStarts[low] as number;
        while (unit < source.length && byte < offset) {
            const code = source.codePointAt(unit) as number;
            byte += utf8Length(code);
            // A surrogate pair is one character: step over both halves.
            unit += code > 0xffff ? 2 : 1;
        }
        return { line: low + 1, column: unit - (unitStarts[low] as number) + 1 };
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

    /**
     * @param code - The diagnostic's code.
     * @param start - The byte offset.
     * @param locate - The file's locator.
     */
    constructor(code: SzDiagnosticCode, start: number, locate: ByteOffsetLocator) {
        super(start, locate);
        this.code = code;
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

/** One diagnostic as the engine reports it. */
interface RawIssue {
    code: string;
    start: number;
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

/** The raw spans one engine result carries, in either artifact's spelling. */
export interface RawEngineSpans {
    issues: ReadonlyArray<RawIssue>;
    mergeGroups: ReadonlyArray<RawMergeGroup>;
    mergeOverrides: ReadonlyArray<RawMergeOverride>;
}

/** The located spans of one result. */
export interface LocatedEngineSpans {
    issues: SzDiagnosticIssue[];
    mergeGroups: SzMergeGroup[];
    mergeOverrides: SzMergeOverride[];
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
        mergeOverrides: raw.mergeOverrides.map(pair => locateOverride(pair, locate)),
    };
}

/**
 * @param issue - The diagnostic as reported.
 * @param locate - The file's locator.
 * @returns It located.
 */
function locateIssue(issue: RawIssue, locate: ByteOffsetLocator): SzDiagnosticIssue {
    return new LocatedIssue(issue.code as SzDiagnosticCode, issue.start, locate);
}

/**
 * @param group - The merge group as reported.
 * @param locate - The file's locator.
 * @returns It located.
 */
function locateGroup(group: RawMergeGroup, locate: ByteOffsetLocator): SzMergeGroup {
    const { keys, keyStarts, classes } = group;
    return { keys, positions: keyStarts.map(start => new LocatedSpan(start, locate)), classes };
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
    mergeOverrides?: Array<RawMergeOverride | SzMergeOverride>;
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
            return start === undefined ? issue : { code: issue.code, start };
        });
    }
    if (spans.mergeGroups) {
        stored.mergeGroups = spans.mergeGroups.map(group => {
            const keyStarts = group.positions.map(position => LocatedSpan.startOf(position));
            return keyStarts.every(start => start !== undefined)
                ? { keys: group.keys, keyStarts, classes: group.classes }
                : group;
        });
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
    if (stored.mergeGroups) {
        restored.mergeGroups = stored.mergeGroups.map(group =>
            'keyStarts' in group ? locateGroup(group, locate) : group,
        );
    }
    if (stored.mergeOverrides) {
        restored.mergeOverrides = stored.mergeOverrides.map(pair =>
            'start' in pair ? locateOverride(pair, locate) : pair,
        );
    }
    return restored;
}
