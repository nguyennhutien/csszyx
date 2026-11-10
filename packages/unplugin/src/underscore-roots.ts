/**
 * How a project reads the `_` of a value when its stylesheets set different
 * prefixes, for the callers that ask outside a build: `csszyx migrate` and the
 * MCP tools. Its own module so the build entries, which ask one batch of every
 * root through `underscoreSpaceFindings`, do not carry it.
 *
 * @module
 */
import {
    findingOf,
    type UnderscoreFact,
    type UnderscoreFinding,
    underscoreSpaceProbes,
    underscoreSpaceReadings,
} from './underscore-space.js';

/** One compiled stylesheet, asked about a class under the prefix it sets. */
export interface UnderscoreRoot {
    /** The prefix its classes carry, or null for none. */
    readonly prefix: string | null;
    /**
     * Its CSS for these classes, index for index.
     *
     * @param classes - Class names, under its prefix.
     * @returns The CSS of each, null where it writes none.
     */
    cssFor(classes: readonly string[]): ReadonlyArray<string | null>;
}

/**
 * How a project reads each fact's value when its stylesheets may set
 * different prefixes: each stylesheet is asked about the class under its own
 * prefix, since its CSS names that class and serves no other, and an `_` is a
 * space only where every stylesheet that serves the class reads it as one.
 *
 * A class lowered under a prefix every stylesheet agrees on already carries
 * it; one lowered with none, because they disagree, gets each stylesheet's.
 *
 * Cost: one {@link underscoreSpaceReadings} per stylesheet, so `stylesheets`
 * times the batch {@link underscoreSpaceProbes} builds.
 *
 * @param facts - Facts from the engine.
 * @param roots - The project's compiled stylesheets.
 * @param lowered - The prefix the classes were lowered under, or null.
 * @returns Index for index with `facts`: the value with each `_` read as a
 *          space written as one, or undefined when no stylesheet serves the
 *          class.
 */
export function underscoreReadingsPerRoot<T extends UnderscoreFact>(
    facts: readonly T[],
    roots: readonly UnderscoreRoot[],
    lowered: string | null = null,
): Array<string | undefined> {
    const perRoot = roots.map(root => {
        const asked = facts.map(fact => ({
            ...fact,
            className: underPrefix(fact.className, root.prefix, lowered),
        }));
        const indexOf = new Map(asked.map((fact, index) => [fact, index]));
        const probes = underscoreSpaceProbes(asked);
        const readings: Array<string | undefined> = [];
        for (const { fact, reading } of underscoreSpaceReadings(probes, [
            root.cssFor(probes.classes),
        ])) {
            readings[indexOf.get(fact) as number] = reading;
        }
        return readings;
    });
    return facts.map((fact, index) => {
        const readings = perRoot.flatMap(readings => {
            const reading = readings[index];
            return reading === undefined ? [] : [reading];
        });
        return readings.length === 0 ? undefined : agreedReading(fact.value, readings);
    });
}

/**
 * The facts whose `_` every stylesheet that serves the class reads as a
 * space, each stylesheet asked under its own prefix
 * ({@link underscoreReadingsPerRoot}), with what to write instead; and the
 * facts with an `_` to ask about that no stylesheet serves, so a caller can
 * say they were not checked rather than read as clean.
 *
 * @param facts - Facts from the engine.
 * @param roots - The project's compiled stylesheets.
 * @param lowered - The prefix the classes were lowered under, or null.
 * @returns The reported facts and the unserved ones, each in the given order.
 */
export function underscoreSpaceVerdictsPerRoot<T extends UnderscoreFact>(
    facts: readonly T[],
    roots: readonly UnderscoreRoot[],
    lowered: string | null = null,
): { found: Array<T & UnderscoreFinding>; unserved: T[] } {
    const readings = underscoreReadingsPerRoot(facts, roots, lowered);
    const asked = new Set<UnderscoreFact>(underscoreSpaceProbes(facts).probed.map(p => p.fact));
    const found: Array<T & UnderscoreFinding> = [];
    const unserved: T[] = [];
    facts.forEach((fact, index) => {
        const reading = readings[index];
        if (reading === undefined) {
            if (asked.has(fact)) unserved.push(fact);
        } else if (reading !== fact.value) {
            // A reading only turns `_` into spaces, so it differs exactly when one did.
            found.push(findingOf(fact, reading));
        }
    });
    return { found, unserved };
}

/**
 * A class lowered under one prefix, as a stylesheet with another names it.
 * Told by the prefix the lowering used, never by the class's text: a prefix
 * may share a variant's name (`prefix(md)` and `md:p-4`).
 *
 * @param className - A class as lowered.
 * @param prefix - A stylesheet's prefix, or null.
 * @param lowered - The prefix the class was lowered under, or null.
 * @returns The class under the stylesheet's prefix.
 */
function underPrefix(className: string, prefix: string | null, lowered: string | null): string {
    if (prefix === lowered) return className;
    return prefix ? `${prefix}:${bareOf(className, lowered)}` : bareOf(className, lowered);
}

/**
 * A class without the prefix it was lowered under. The engine writes that
 * prefix first on every class it lowers; a class without it is kept whole
 * rather than cut.
 *
 * @param className - A class as lowered.
 * @param lowered - The prefix it was lowered under, or null.
 * @returns The class without that prefix.
 */
export function bareOf(className: string, lowered: string | null): string {
    return lowered && className.startsWith(`${lowered}:`)
        ? className.slice(lowered.length + 1)
        : className;
}

/**
 * The reading every stylesheet agrees on: an `_` is a space only where each
 * reading has one.
 *
 * @param value - The value as written.
 * @param readings - Each stylesheet's reading of it.
 * @returns The value with those `_` written as spaces.
 */
function agreedReading(value: string, readings: readonly string[]): string {
    let out = '';
    for (let index = 0; index < value.length; index++) {
        const spaced = readings.every(reading => reading[index] === ' ');
        out += value[index] === '_' && spaced ? ' ' : value[index];
    }
    return out;
}
