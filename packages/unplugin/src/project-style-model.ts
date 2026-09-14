/**
 * One compiled view of the project's own stylesheets.
 *
 * The build asks the same CSS three things: which classes this project's
 * Tailwind serves, what each one sets, and what the `@import "tailwindcss"`
 * line settled for all of them — a prefix renames every utility, `important`
 * forces every declaration. Two independent paths grew for those answers: a
 * regex scan over `@theme` blocks, and the design system Tailwind itself
 * compiles. Only the second sees a theme shipped inside a package, a `@plugin`
 * or a `@config`, so a feature wired to the first misses them without saying
 * so.
 *
 * This module is the one path. It compiles each entry stylesheet once and
 * answers from those compiles; `.agent/flows/css-design-system-pipeline.md`
 * carries the map, and `tests/css-reading-entry-points.test.ts` fails when a
 * new caller opens a second one.
 *
 * @module
 */
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
    createEmittedClassOracle,
    type OracleSkipKind,
    readStylesheetRole,
    type StylesheetFacts,
} from '@csszyx/tailwind-oracle';

/** What one stylesheet is to the project. */
export type StyleEntryRole =
    /** Generates utilities and no other root imports it: it decides the facts. */
    | 'root'
    /** Another root imports it, so that root's compile already includes it. */
    | 'imported'
    /** Generates no utilities: a theme, a partial, or plain CSS. */
    | 'not-root'
    /** Could not be compiled, and no root that did compile imports it. */
    | 'failed';

/** One stylesheet the build handed over, and what the model made of it. */
export interface StyleEntry {
    /** The stylesheet path as the caller gave it. */
    file: string;
    /** What it is to the project. */
    role: StyleEntryRole;
    /** What its `@import "tailwindcss"` line settled, for a root. */
    facts?: StylesheetFacts;
    /** Why it could not be compiled, for a failed entry. */
    failure?: { kind: OracleSkipKind; reason: string };
}

/** What the project's stylesheets say, from one compile of each root. */
export interface ProjectStyleModel {
    /** Every stylesheet handed over, in the order given. */
    entries: readonly StyleEntry[];
    /**
     * What the `@import "tailwindcss"` line settled for every class, or null
     * when no root compiled.
     *
     * Reported only when every root agrees. A project whose roots disagree has
     * no answer that is true of all of it, and guessing one would rename
     * classes for half the build.
     */
    facts: StylesheetFacts | null;
    /**
     * Which of these classes produce no CSS anywhere in the project.
     *
     * A class counts as unserved only when EVERY root agrees it is — one
     * stylesheet serving it is enough for the project to serve it. Empty when
     * no root compiled: there is nothing to ask.
     *
     * @param classes - Class names, without variants.
     * @returns The subset that styles nothing, in the given order.
     */
    unserved(classes: readonly string[]): string[];
}

/**
 * What the build must say when the project's Tailwind is configured in a way
 * csszyx does not emit for yet.
 *
 * A prefix renames every utility, so `p-4` — what the lowering emits — is not a
 * class the project serves; `important` makes every declaration `!important`,
 * so a `sz` class loses to the library class it is meant to override. Neither
 * is supported yet, and both fail the same way: a green build whose emitted
 * classes style nothing, with nothing in the log to search for.
 *
 * @param facts - What the project's import line settled.
 * @returns The message, or null when nothing is unsupported.
 */
export function unsupportedStylesheetFactsMessage(facts: StylesheetFacts): string | null {
    const settings: string[] = [];
    if (facts.prefix !== null) settings.push(`prefix(${facts.prefix})`);
    if (facts.important) settings.push('important');
    if (settings.length === 0) return null;

    const what = settings.join(' and ');
    const consequence =
        facts.prefix === null
            ? 'every utility is `!important`, so a class csszyx emits cannot override one the project already applies'
            : `every utility is renamed, so the classes csszyx emits (\`p-4\`, not \`${facts.prefix}:p-4\`) produce no CSS`;
    return (
        `[csszyx] your Tailwind entry sets ${what}, which csszyx does not emit for yet: ${consequence}.\n` +
        `  help: drop ${what} from the \`@import "tailwindcss"\` line, or keep it and style those elements with \`className\` until csszyx supports it.`
    );
}

/** One entry's compiled answers. */
interface CompiledEntry {
    facts: StylesheetFacts;
    findDead(classes: readonly string[]): string[];
}

/**
 * The facts every entry agrees on.
 *
 * Taking the first entry apart from the rest makes "at least one" part of the
 * signature, so there is no empty case to invent a default for.
 *
 * @param first - One compiled entry.
 * @param rest - The other compiled entries, possibly none.
 * @returns The shared facts, with a disagreement reported as the default.
 */
function agreedFacts(first: CompiledEntry, rest: readonly CompiledEntry[]): StylesheetFacts {
    const { facts } = first;
    return {
        prefix: rest.every(entry => entry.facts.prefix === facts.prefix) ? facts.prefix : null,
        important: rest.every(entry => entry.facts.important === facts.important)
            ? facts.important
            : false,
    };
}

/** Text a stylesheet must contain to reach Tailwind at all: an import or a directive. */
const MAY_REACH_TAILWIND = /@(?:import|tailwind)\b/;

/**
 * The path a stylesheet resolves to on disk, so one reached through a symlink
 * and one named directly compare equal.
 *
 * @param file - Stylesheet path.
 * @returns The real path, or the path itself when it cannot be resolved.
 */
function realPath(file: string): string {
    try {
        return realpathSync(file);
    } catch {
        return file;
    }
}

/**
 * Compile the project's stylesheets and answer from its roots.
 *
 * The caller has already walked the project for stylesheets, so the list is
 * handed over rather than globbed again — measured at 1 ms for one app against
 * 96 ms at the root of this monorepo, and the gap widens with the tree.
 *
 * A root is a stylesheet whose compile generates utilities, the rule
 * Tailwind's own bundler integrations use: an entry that reaches Tailwind
 * through a package stylesheet counts, a commented-out import and a
 * theme-only file do not. A root another root imports has no say of its own,
 * because Tailwind serves what the importing line settled.
 *
 * @param resolveFrom - Project directory whose `package.json` anchors resolution.
 * @param cssFiles - Stylesheet paths the caller already walked.
 * @returns The model, with every stylesheet accounted for.
 */
export async function openProjectStyleModel(
    resolveFrom: string,
    cssFiles: readonly string[],
): Promise<ProjectStyleModel> {
    const entries: StyleEntry[] = [];
    const roots: Array<{ index: number; css: string }> = [];
    const failed: number[] = [];
    const importedByRoots = new Set<string>();
    for (const file of cssFiles) {
        let css: string;
        try {
            css = await readFile(file, 'utf8');
        } catch {
            // A stylesheet that cannot be read cannot be an entry point.
            entries.push({ file, role: 'not-root' });
            continue;
        }
        if (!MAY_REACH_TAILWIND.test(css)) {
            entries.push({ file, role: 'not-root' });
            continue;
        }
        const role = await readStylesheetRole({ resolveFrom, css, cssBase: path.dirname(file) });
        if (!role.ok) {
            failed.push(
                entries.push({
                    file,
                    role: 'failed',
                    failure: { kind: role.kind, reason: role.reason },
                }) - 1,
            );
        } else if (!role.utilities) {
            entries.push({ file, role: 'not-root' });
        } else {
            roots.push({ index: entries.push({ file, role: 'root' }) - 1, css });
            for (const imported of role.imports) importedByRoots.add(realPath(imported));
        }
    }

    const compiled: CompiledEntry[] = [];
    for (const { index, css } of roots) {
        const { file } = entries[index] as StyleEntry;
        if (importedByRoots.has(realPath(file))) {
            entries[index] = { file, role: 'imported' };
            continue;
        }
        const oracle = await createEmittedClassOracle({
            resolveFrom,
            css,
            cssBase: path.dirname(file),
        });
        if (!oracle.ok) {
            entries[index] = {
                file,
                role: 'failed',
                failure: { kind: oracle.kind, reason: oracle.reason },
            };
            continue;
        }
        entries[index] = { file, role: 'root', facts: oracle.facts };
        compiled.push({ facts: oracle.facts, findDead: classes => oracle.findDead(classes) });
    }
    // A partial that fails on its own compiles as part of the root that imports
    // it, which is how the build reads it.
    for (const index of failed) {
        const { file } = entries[index] as StyleEntry;
        if (importedByRoots.has(realPath(file))) entries[index] = { file, role: 'imported' };
    }

    const [first, ...rest] = compiled;
    return {
        entries,
        facts: first === undefined ? null : agreedFacts(first, rest),
        unserved(classes) {
            if (compiled.length === 0) return [];
            const perEntry = compiled.map(entry => new Set(entry.findDead(classes)));
            return classes.filter(token => perEntry.every(dead => dead.has(token)));
        },
    };
}
