/**
 * When the project's stylesheets give no single prefix, the build stops.
 *
 * csszyx writes one prefix before every class it emits. Two entries that set
 * different prefixes mean every class is dead in one of them, and guessing
 * which one the app loads would ship the other half unstyled. So the build
 * names each entry and its prefix, and the option that says which stylesheets
 * the build loads.
 */
import { describe, expect, it } from 'vitest';

import {
    type ProjectStyleModel,
    type StyleEntry,
    styleModelError,
    styleModelWarning,
} from '../src/project-style-model.js';

const ROOT = '/app';

/**
 * A model over the given entries; only the entries matter to the verdict.
 *
 * @param entries - What each stylesheet was found to be.
 * @returns A model carrying them.
 */
function modelOf(entries: StyleEntry[]): ProjectStyleModel {
    return { entries, facts: null, unserved: () => [] };
}

/**
 * A root entry that settled the given prefix.
 *
 * @param file - Absolute stylesheet path.
 * @param prefix - The prefix its import line set.
 * @param important - Whether its import line forced `!important`.
 * @returns The entry.
 */
function root(file: string, prefix: string | null, important = false): StyleEntry {
    return { file, role: 'root', facts: { prefix, important } };
}

describe('styleModelError — entries that disagree on the prefix', () => {
    it('names each root and the prefix it sets, and the way out', () => {
        const message = styleModelError(
            modelOf([
                root('/app/src/index.css', 'tw'),
                root('/app/tests/fixtures/legacy.css', null),
            ]),
            ROOT,
        );

        expect(message).toContain('set different prefixes');
        expect(message).toMatch(/src\/index\.css\s+prefix\(tw\)/);
        expect(message).toMatch(/tests\/fixtures\/legacy\.css\s+no prefix/);
        expect(message).not.toContain('/app/');
        expect(message).toContain('help:');
        expect(message).toContain('`tailwindStylesheet`');
    });

    it('says nothing when every root sets the same prefix', () => {
        expect(
            styleModelError(
                modelOf([root('/app/src/a.css', 'tw'), root('/app/src/b.css', 'tw')]),
                ROOT,
            ),
        ).toBeNull();
    });

    it('says nothing when roots disagree only on important, which renames no class', () => {
        expect(
            styleModelError(
                modelOf([root('/app/src/a.css', null, true), root('/app/src/b.css', null)]),
                ROOT,
            ),
        ).toBeNull();
    });

    it('gives a stylesheet another root imports no vote of its own', () => {
        expect(
            styleModelError(
                modelOf([
                    root('/app/src/index.css', 'tw'),
                    { file: '/app/src/theme.css', role: 'imported' },
                    { file: '/app/src/plain.css', role: 'not-root' },
                ]),
                ROOT,
            ),
        ).toBeNull();
    });

    it('says nothing for a project with no root at all', () => {
        expect(styleModelError(modelOf([]), ROOT)).toBeNull();
    });
});

/**
 * An entry that did not compile.
 *
 * @param file - Absolute stylesheet path.
 * @param reachedTailwind - Whether the compile had reached Tailwind first.
 * @param kind - Why it could not be read.
 * @returns The entry.
 */
function failed(
    file: string,
    reachedTailwind: boolean,
    kind: 'stylesheet' | 'environment' = 'stylesheet',
): StyleEntry {
    return {
        file,
        role: 'failed',
        failure: {
            kind,
            reason: `the stylesheet did not compile: ENOENT: no such file, open './gone.css'\nRequire stack:\n- /app/package.json`,
            reachedTailwind,
        },
    };
}

describe('styleModelError — a stylesheet that reaches Tailwind did not compile', () => {
    it('stops the build and names the file with the first line of the reason', () => {
        const message = styleModelError(modelOf([failed('/app/src/index.css', true)]), ROOT);

        expect(message).toContain('did not compile');
        expect(message).toMatch(/src\/index\.css: ENOENT: no such file, open '\.\/gone\.css'/);
        expect(message).not.toContain('Require stack');
        expect(message).not.toContain('the stylesheet did not compile:');
        expect(message).toContain('`tailwindStylesheet`');
        expect(message).toContain('note:');
    });

    it('reports it before a prefix disagreement, whose facts it makes unreliable', () => {
        const message = styleModelError(
            modelOf([
                root('/app/src/a.css', 'tw'),
                root('/app/src/b.css', null),
                failed('/app/src/index.css', true),
            ]),
            ROOT,
        );

        expect(message).toContain('did not compile');
        expect(message).not.toContain('set different prefixes');
    });

    it('does not stop the build for a stylesheet that never reached Tailwind', () => {
        expect(styleModelError(modelOf([failed('/app/legacy/old.css', false)]), ROOT)).toBeNull();
    });

    it('does not stop the build when there was no Tailwind to ask', () => {
        expect(
            styleModelError(modelOf([failed('/app/src/index.css', true, 'environment')]), ROOT),
        ).toBeNull();
    });
});

describe('styleModelWarning — stylesheets that did not compile and never reached Tailwind', () => {
    it('names each one and what to do', () => {
        const message = styleModelWarning(
            modelOf([failed('/app/legacy/old.css', false), root('/app/src/index.css', 'tw')]),
            ROOT,
        );

        expect(message).toMatch(/legacy\/old\.css: ENOENT/);
        expect(message).not.toContain('Require stack');
        expect(message).toContain('help:');
        expect(message).toContain('`tailwindStylesheet`');
    });

    it('says nothing when every stylesheet compiled or reached Tailwind', () => {
        expect(
            styleModelWarning(
                modelOf([root('/app/src/index.css', 'tw'), failed('/app/src/b.css', true)]),
                ROOT,
            ),
        ).toBeNull();
    });

    it('says nothing for a skip with no Tailwind to ask', () => {
        expect(
            styleModelWarning(modelOf([failed('/app/src/b.css', false, 'environment')]), ROOT),
        ).toBeNull();
    });
});
