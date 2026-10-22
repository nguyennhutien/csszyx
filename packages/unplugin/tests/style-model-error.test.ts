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
    missingTailwindStylesheetError,
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
    return { entries, facts: null, imports: [], unserved: () => [] };
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

        expect(message).toMatchObject({
            code: 'prefix-disagreement',
            args: {
                form: 'build',
                entries: [
                    '`src/index.css` with `prefix(tw)`',
                    '`tests/fixtures/legacy.css` with none',
                ],
                setting: 'the csszyx `tailwindStylesheet` option',
            },
            message:
                '[csszyx] prefix-disagreement:\n' +
                '  The Tailwind stylesheets of this project set different prefixes (`src/index.css` with `prefix(tw)`, `tests/fixtures/legacy.css` with none), so no class csszyx emits is served by all of them.\n' +
                '  help: give every Tailwind stylesheet the same `@import "tailwindcss"` line, or list the stylesheets this build loads with the csszyx `tailwindStylesheet` option.\n' +
                '  note: no module was transformed, and nothing was written.\n' +
                '  docs: https://csszyx.com/e/prefix-disagreement',
        });
    });

    it('names the setting that leaves a directory out, on a lane that has one', () => {
        const message = styleModelError(
            modelOf([root('/app/a.css', 'tw'), root('/app/b.css', null)]),
            ROOT,
            'the `--tailwind-stylesheet` flag',
            'the `--ignore` flag',
        );

        expect(message?.args).toMatchObject({ form: 'next', ignoreSetting: 'the `--ignore` flag' });
        expect(message?.message).toContain(
            '  help: give every Tailwind stylesheet the same `@import "tailwindcss"` line, list the stylesheets this build loads with the `--tailwind-stylesheet` flag, or leave another app\'s directory out with the `--ignore` flag.\n',
        );
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

        expect(message).toMatchObject({
            code: 'tailwind-stylesheet-broken',
            args: {
                stylesheets: ["src/index.css: ENOENT: no such file, open './gone.css'"],
                setting: 'the csszyx `tailwindStylesheet` option',
            },
            message:
                '[csszyx] tailwind-stylesheet-broken:\n' +
                '  A Tailwind stylesheet did not compile, so csszyx cannot read the Tailwind prefix and transforms no module.\n' +
                '  help: fix the stylesheet; if this build does not load it, list the stylesheets it does load with the csszyx `tailwindStylesheet` option.\n' +
                '  note: each failure, as Tailwind reported it:\n' +
                "    src/index.css: ENOENT: no such file, open './gone.css'\n" +
                '  docs: https://csszyx.com/e/tailwind-stylesheet-broken',
        });
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

        expect(message?.code).toBe('tailwind-stylesheet-broken');
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

describe('the setting a message names, for a lane that is not configured through the plugin', () => {
    const FLAG = 'the `--tailwind-stylesheet` flag';

    it('names it in the help for entries that disagree', () => {
        const message = styleModelError(
            modelOf([root('/app/src/index.css', 'tw'), root('/app/legacy/old.css', null)]),
            ROOT,
            FLAG,
        );

        expect(message?.message).toContain(`list the stylesheets this build loads with ${FLAG}.`);
        expect(message?.message).not.toContain('`tailwindStylesheet` option');
    });

    it('names it in the help for an entry that did not compile, and for one that never reached Tailwind', () => {
        const failed = (file: string, reachedTailwind: boolean): StyleEntry => ({
            file,
            role: 'failed',
            failure: { kind: 'stylesheet', reason: 'boom', reachedTailwind },
        });

        expect(
            styleModelError(modelOf([failed('/app/a.css', true)]), ROOT, FLAG)?.message,
        ).toContain(`it does load with ${FLAG}.`);
        expect(styleModelWarning(modelOf([failed('/app/b.css', false)]), ROOT, FLAG)).toContain(
            FLAG,
        );
    });

    it('names it as what lists a stylesheet that is not there', () => {
        expect(missingTailwindStylesheetError(['app/gone.css', 'b.css'], ROOT, FLAG)).toMatchObject(
            {
                code: 'tailwind-stylesheet-missing',
                args: { setting: FLAG, missing: ['app/gone.css', 'b.css'], root: ROOT },
                message:
                    '[csszyx] tailwind-stylesheet-missing:\n' +
                    `  The stylesheet(s) \`app/gone.css\`, \`b.css\` named by ${FLAG} do not exist under \`/app\`, so the build stops.\n` +
                    '  help: list the Tailwind stylesheet this build loads, relative to the project root.\n' +
                    '  docs: https://csszyx.com/e/tailwind-stylesheet-missing',
            },
        );
    });
});
