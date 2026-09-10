/**
 * Which authored class names the project's Tailwind serves nothing for.
 *
 * `classify` matches a token by class PREFIX and holds no knowledge of which
 * suffixes a prefix accepts, so an app's own `tab-items-wrapper` reads as a
 * `tab-size` utility and `splitBox` places it by a rule. A name nothing
 * classifies is placed by the fallback instead, which is the right treatment
 * for both -- they are the app's own vocabulary, and the two differ only by an
 * accident of prefix matching.
 *
 * The runtime cannot close that gap alone: Tailwind is a build tool and is not
 * present in the browser. The build can, because it holds both halves -- the
 * names an author wrote, and the project's compiled design system.
 *
 * Only the names that BOTH classify and produce no CSS are worth sending. A
 * name nothing classifies already falls back, so listing it would be payload
 * that changes nothing.
 *
 * @module
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sortStrings } from '@csszyx/compiler';
import { classify, normalizeBase, stripVariant } from '@csszyx/runtime/split';
import { createEmittedClassOracle, tailwindEntriesAmong } from '@csszyx/tailwind-oracle';

/**
 * The authored names the design system serves nothing for.
 *
 * @param authored - Class names as written in source, variants included.
 * @param findDead - Asks the design system; returns the names it serves nothing for.
 * @returns Base names, sorted, for the module the build emits.
 */
export function unservedAuthoredClasses(
    authored: Iterable<string>,
    findDead: (classes: readonly string[]) => string[],
): string[] {
    const bases = new Set<string>();
    for (const name of authored) {
        // The base is what `classify` reads and what the design system is asked
        // about, so a variant never splits one name into two questions.
        const base = normalizeBase(stripVariant(name));
        if (base === '' || bases.has(base)) continue;
        // No answer means the fallback already places it. Asking about it would
        // grow the question for a name whose treatment cannot change.
        if (classify(name) === undefined) continue;
        bases.add(base);
    }
    if (bases.size === 0) return [];
    // Sorted so two builds of the same project emit a byte-identical module,
    // which keeps the bundle hash stable across rebuilds.
    return sortStrings(findDead(sortStrings(bases)));
}

/** Asks the project's design systems which of these names produce no CSS. */
export type UnservedAsk = (classes: readonly string[]) => string[];

/**
 * Compile the project's design systems from stylesheets the caller already found.
 *
 * The plugin walks the project for `@theme` blocks before this runs, so its
 * result is handed over rather than globbed again: measured at 1 ms for one app
 * against 96 ms at the root of a monorepo, and the gap widens with the tree.
 *
 * A name counts as unserved only when EVERY compiled system agrees, matching
 * what `csszyx check` does -- a project with two stylesheets serves a class if
 * either one does. A stylesheet that will not compile is dropped rather than
 * allowed to answer, because a broken stylesheet is not evidence.
 *
 * @param resolveFrom - Project directory whose `package.json` anchors resolution.
 * @param cssFiles - Stylesheet paths the caller already walked.
 * @returns The ask, or null when nothing compiled and there is no answer.
 */
export async function openUnservedAsk(
    resolveFrom: string,
    cssFiles: readonly string[],
): Promise<UnservedAsk | null> {
    const ready: Array<(classes: readonly string[]) => string[]> = [];
    for (const entry of await tailwindEntriesAmong(cssFiles)) {
        const oracle = await createEmittedClassOracle({
            resolveFrom,
            css: await readFile(entry, 'utf8'),
            cssBase: path.dirname(entry),
        });
        if (oracle.ok) ready.push(classes => oracle.findDead(classes));
    }
    if (ready.length === 0) return null;
    return classes => {
        const perOracle = ready.map(findDead => new Set(findDead(classes)));
        return classes.filter(token => perOracle.every(dead => dead.has(token)));
    };
}
