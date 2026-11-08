/**
 * An `_` the author wrote in an `sz` value, read as a space by the project's
 * Tailwind.
 *
 * csszyx writes a space in an arbitrary value as `_`, so `content: "'a b'"`
 * and `content: "'a_b'"` both lower to `content-['a_b']`, and Tailwind styles
 * `a b` for both. The engine names each class carrying an `_` the author wrote
 * (the `underscore-space` fact); whether Tailwind reads that `_` as a space is
 * asked of the project's Tailwind here (PROJECT-RULES §4), never of a table:
 * the class is compared with the same class with that one `_` escaped. Tailwind
 * keeps a `url()` and the name in `var()` as written, backslash included, so
 * once `\_` is read as `_` on both sides those two agree and nothing is said.
 *
 * @module
 */
import type { DeadClassReportInput } from './dead-class.js';
import type { LimitedFinding } from './diagnostic-limiter.js';
import { diagnosticMessage } from './diagnostic-message.js';
import { candidateDeclarationsFromCss } from './merge-signature.js';
import { channelOfLevel } from './transform-diagnostics.js';

/** The id a site is reported under. */
const UNDERSCORE_SPACE = 'underscore-space';

/** An `_` the author wrote, as the engine reports it. */
export interface UnderscoreFact {
    /** The `sz` key, or the property a `css` object sets. */
    key: string;
    /** The value as written. */
    value: string;
    /** The class it lowers into. */
    className: string;
}

/** What a message names for one fact. */
export interface UnderscoreFinding {
    /** The value as written, as a JS string literal. */
    literal: string;
    /** The value with every `_` Tailwind reads as a space written as one. */
    spaced: string;
    /** The value with every such `_` escaped, as a JS string literal. */
    escaped: string;
}

/**
 * Each root's CSS for a list of classes, index for index.
 *
 * @param classes - Class names.
 * @returns One array per root.
 */
export type CssPerRoot = (
    classes: readonly string[],
) => ReadonlyArray<ReadonlyArray<string | null>>;

/** One fact with the class positions of its bare `_`. */
interface Probed<T extends UnderscoreFact> {
    fact: T;
    /** Index in `value` of each bare `_`. */
    inValue: number[];
    /** Index in the batch of the class, then of each escaped probe. */
    first: number;
}

/**
 * The classes to ask the project's Tailwind about, for a set of facts: each
 * fact's class, then that class with one bare `_` escaped, per `_`.
 */
export interface UnderscoreProbes<T extends UnderscoreFact> {
    /** The classes, in the order {@link underscoreSpaceVerdicts} reads answers. */
    readonly classes: readonly string[];
    readonly probed: ReadonlyArray<Probed<T>>;
}

/**
 * The classes to ask about, for a caller that asks asynchronously; the
 * answers go to {@link underscoreSpaceVerdicts}.
 *
 * Cost: `n` is the total length of the facts' values; one pass per value finds
 * its bare `_` (O(n)), and the batch holds `facts + underscores` classes.
 *
 * @param facts - Facts from the engine.
 * @returns The classes, and where each fact's answers sit among them.
 */
export function underscoreSpaceProbes<T extends UnderscoreFact>(
    facts: readonly T[],
): UnderscoreProbes<T> {
    const classes: string[] = [];
    const probed: Probed<T>[] = [];
    for (const fact of facts) {
        const inValue = bareUnderscores(fact.value);
        const { written, at } = asWritten(fact.value);
        const start = fact.className.lastIndexOf(written);
        if (inValue.length === 0 || start < 0) continue;
        probed.push({ fact, inValue, first: classes.length });
        classes.push(fact.className);
        for (const index of inValue) {
            classes.push(escapeAt(fact.className, start + (at.get(index) as number)));
        }
    }
    return { classes, probed };
}

/** How the project's Tailwind reads one fact's value. */
export interface UnderscoreReading<T extends UnderscoreFact> {
    fact: T;
    /**
     * The value with each `_` every serving root reads as a space written as
     * one, every other `_` kept; the value as written when no `_` is.
     */
    reading: string;
    /** How many of its `_` every serving root reads as a space. */
    spaces: number;
}

/**
 * How every root that serves each fact's class reads its value, from each
 * root's CSS for {@link UnderscoreProbes.classes}: what `csszyx migrate`
 * writes for an arbitrary value, and what {@link underscoreSpaceVerdicts}
 * reports.
 *
 * A root serving nothing for the class has no say, and a fact no root serves
 * is left out: there is no answer to give. A value the class does not carry
 * verbatim (spaces as `_`) is not asked about. Each declaration comparison is
 * linear in that class's CSS.
 *
 * @param probes - What was asked.
 * @param roots - Each root's CSS for `probes.classes`, index for index.
 * @returns One reading per served fact, in the given order.
 */
export function underscoreSpaceReadings<T extends UnderscoreFact>(
    probes: UnderscoreProbes<T>,
    roots: ReadonlyArray<ReadonlyArray<string | null>>,
): Array<UnderscoreReading<T>> {
    const batch = probes.classes;
    const readings: Array<UnderscoreReading<T>> = [];
    for (const { fact, inValue, first } of probes.probed) {
        const serving = roots.filter(css => css[first] != null);
        if (serving.length === 0) continue;
        const spacedAt = inValue.filter((_, offset) => {
            const probe = first + 1 + offset;
            return serving.every(css =>
                readsAsSpace(
                    batch[first] as string,
                    // Index for index with the batch, so every entry is set.
                    css[first] as string | null,
                    batch[probe] as string,
                    css[probe] as string | null,
                ),
            );
        });
        readings.push({
            fact,
            reading: replaceAt(fact.value, spacedAt, ' '),
            spaces: spacedAt.length,
        });
    }
    return readings;
}

/**
 * The facts whose `_` every root that serves the class reads as a space,
 * with what to write instead ({@link underscoreSpaceReadings}).
 *
 * @param probes - What was asked.
 * @param roots - Each root's CSS for `probes.classes`, index for index.
 * @returns The reported facts, in the given order.
 */
export function underscoreSpaceVerdicts<T extends UnderscoreFact>(
    probes: UnderscoreProbes<T>,
    roots: ReadonlyArray<ReadonlyArray<string | null>>,
): Array<T & UnderscoreFinding> {
    return underscoreSpaceReadings(probes, roots)
        .filter(({ spaces }) => spaces > 0)
        .map(({ fact, reading }) => ({
            ...fact,
            literal: jsStringLiteral(fact.value),
            spaced: jsStringLiteral(reading),
            // The `_` read as a space are exactly those the reading turned.
            escaped: jsStringLiteral(escapeWhereSpaced(fact.value, reading)),
        }));
}

/**
 * @param value - A value as written.
 * @param reading - The same value with some `_` written as spaces.
 * @returns The value with each of those `_` escaped instead.
 */
function escapeWhereSpaced(value: string, reading: string): string {
    let out = '';
    for (let index = 0; index < value.length; index++) {
        out += value[index] === '_' && reading[index] === ' ' ? String.raw`\_` : value[index];
    }
    return out;
}

/**
 * The facts whose `_` the project's Tailwind reads as a space, with what to
 * write instead: {@link underscoreSpaceProbes}, asked in one batch, then
 * {@link underscoreSpaceVerdicts}.
 *
 * @param facts - Facts from the engine.
 * @param cssFor - Each root's CSS for a list of classes.
 * @returns The reported facts, in the given order.
 */
export function underscoreSpaceFindings<T extends UnderscoreFact>(
    facts: readonly T[],
    cssFor: CssPerRoot,
): Array<T & UnderscoreFinding> {
    const probes = underscoreSpaceProbes(facts);
    if (probes.probed.length === 0) return [];
    return underscoreSpaceVerdicts(probes, cssFor(probes.classes));
}

/** One character of Unicode White_Space, the set the engine splits on. */
const WHITE_SPACE = /^\p{White_Space}$/u;

/**
 * A value as the engine writes it into the class: each run of whitespace one
 * `_`, none at either end (`split_whitespace().join("_")` in `lower.rs`).
 *
 * @param value - The value as written.
 * @returns The written form, and where each `_` of the value sits in it.
 */
function asWritten(value: string): { written: string; at: Map<number, number> } {
    const at = new Map<number, number>();
    let written = '';
    let gap = false;
    for (let index = 0; index < value.length; index++) {
        const char = value[index] as string;
        // Unicode White_Space, Rust's `char::is_whitespace`: JavaScript's
        // `\s` also takes a BOM and leaves out a NEL.
        if (WHITE_SPACE.test(char)) {
            gap = written.length > 0;
            continue;
        }
        if (gap) written += '_';
        gap = false;
        if (char === '_') at.set(index, written.length);
        written += char;
    }
    return { written, at };
}

/**
 * Whether one root reads the `_` a probe escapes as a space: the class and the
 * probe set different declarations once `\_` reads as `_` on both sides.
 *
 * @param className - The class.
 * @param css - The root's CSS for it.
 * @param probe - The class with one `_` escaped.
 * @param probeCss - The root's CSS for the probe.
 * @returns False when either cannot be read: nothing is said without an answer.
 */
function readsAsSpace(
    className: string,
    css: string | null,
    probe: string,
    probeCss: string | null,
): boolean {
    const plain = candidateDeclarationsFromCss(className, css);
    const escaped = candidateDeclarationsFromCss(probe, probeCss);
    if (plain === null || escaped === null || plain.length === 0) return false;
    return comparable(plain) !== comparable(escaped);
}

/**
 * @param declarations - Declarations of one class.
 * @returns A string equal for two classes that set the same thing, `\_` read as `_`.
 */
function comparable(
    declarations: ReadonlyArray<{ context: string; property: string; value: string }>,
): string {
    return JSON.stringify(
        declarations.map(({ context, property, value }) => [
            context,
            property,
            value.replaceAll(String.raw`\_`, '_'),
        ]),
    );
}

/**
 * The `_` facts of one transform, as plain fields.
 *
 * A located fact resolves its line and column in getters, which a spread
 * drops, so every lane reads the facts through here. A result an older
 * engine or cache entry produced, or none at all, carries no facts.
 *
 * @param result - A transform result, or null when there is none.
 * @returns Each fact's key, value, class, line and column.
 */
export function underscoreFactsOf(
    result: {
        underscoreValues?: ReadonlyArray<
            UnderscoreFact & { readonly line: number; readonly column: number }
        >;
    } | null,
): Array<UnderscoreFact & { line: number; column: number }> {
    return (result?.underscoreValues ?? []).map(({ key, value, className, line, column }) => ({
        key,
        value,
        className,
        line,
        column,
    }));
}

/**
 * The `_` the author wrote bare. Tailwind reads `\_` as `_` wherever it sits,
 * a backslash before it included, and the engine reports a value by the same
 * rule (`has_bare_underscore` in `lower.rs`), so an `_` right after a
 * backslash is escaped here too.
 *
 * @param value - A value as written.
 * @returns The index of each `_` no backslash precedes.
 */
export function bareUnderscores(value: string): number[] {
    const found: number[] = [];
    for (let index = 0; index < value.length; index++) {
        if (value[index] === '_' && value[index - 1] !== '\\') found.push(index);
    }
    return found;
}

/**
 * @param text - A string.
 * @param index - Where to insert.
 * @returns The string with a backslash before `index`.
 */
function escapeAt(text: string, index: number): string {
    return `${text.slice(0, index)}\\${text.slice(index)}`;
}

/**
 * @param value - A value as written.
 * @param indexes - Indexes of single characters, ascending.
 * @param replacement - What each becomes.
 * @returns The value with those characters replaced.
 */
function replaceAt(value: string, indexes: readonly number[], replacement: string): string {
    let out = '';
    let from = 0;
    for (const index of indexes) {
        out += value.slice(from, index) + replacement;
        from = index + 1;
    }
    return out + value.slice(from);
}

/** A fact at the key it was written at, as a lane records it. */
export interface UnderscoreSite extends UnderscoreFact {
    /** Project-relative, forward slashes. */
    file: string;
    /** The line of the key, 1-based. */
    line: number;
    /** The column of the key, 1-based. */
    column: number;
}

/** One site reported, with what to write instead. */
export type UnderscoreSpaceFinding = UnderscoreSite & UnderscoreFinding;

/** How a lane reports, as the dead-class pass reads it. */
export type UnderscoreReportInput = DeadClassReportInput;

/**
 * The line a build prints for one site.
 *
 * @param finding - The site and what to write instead.
 * @returns The warning, in the registry's words.
 */
export function underscoreSpaceMessage(finding: UnderscoreSpaceFinding): string {
    const { key, value, className, literal, spaced, escaped, file, line, column } = finding;
    return diagnosticMessage(
        'underscore-space',
        { key, value, className, literal, spaced, escaped },
        `${file}:${line}:${column}`,
    );
}

/**
 * The lines to print for a lane's sites, under `underscore-space` in the
 * `dead-class` group: a level for that id, an override or `allow.classes`
 * reaches it, resolved for the site's own file. Each site is said once per
 * file version, through the lane's limiter, and a site held at `info` is
 * counted.
 *
 * @param findings - Sites {@link underscoreSpaceFindings} reported.
 * @param input - The policy and the run.
 * @returns The lines to list, and how many were held back.
 */
export function reportUnderscoreSpaces(
    findings: readonly UnderscoreSpaceFinding[],
    input: UnderscoreReportInput,
): { lines: string[]; held: number } {
    const lines: string[] = [];
    const present: LimitedFinding[] = [];
    let held = 0;
    for (const finding of findings) {
        if (input.policy.allowsClass(finding.className)) continue;
        const level = input.policy.levelOf({
            rule: 'dead-class',
            kind: UNDERSCORE_SPACE,
            file: finding.file,
        });
        const channel = channelOfLevel(level, input.quiet, input.holdInfo);
        if (channel === 'held') held++;
        if (channel !== 'list') continue;
        const limited = {
            id: UNDERSCORE_SPACE,
            file: finding.file,
            line: finding.line,
            column: finding.column,
            key: `${finding.key}\0${finding.value}`,
        };
        present.push(limited);
        if (input.limiter.admit(limited)) lines.push(underscoreSpaceMessage(finding));
    }
    input.limiter.retain(UNDERSCORE_SPACE, present);
    return { lines, held };
}

/**
 * A string as the author would write it in source: single quotes, double
 * quotes when the text holds a single quote and no double quote.
 *
 * @param text - The string.
 * @returns A JS string literal for it.
 */
export function jsStringLiteral(text: string): string {
    const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
    let out = quote;
    for (const char of text) {
        if (char === '\\' || char === quote) out += `\\${char}`;
        else if (char === '\n') out += String.raw`\n`;
        else if (char === '\r') out += String.raw`\r`;
        else if (char === '\t') out += String.raw`\t`;
        else out += char;
    }
    return out + quote;
}
