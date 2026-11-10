/**
 * What the tools show carries the prefix the project serves, or says it does
 * not. `csszyx_validate` showed `transformResult.className` without the
 * project's prefix beside a warning that named the prefixed class, and a
 * `csszyx_compile_preview` given a `classPrefix` the project does not set
 * showed classes the project serves nothing for, with no word about it.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { handleCompilePreview } from '../src/tools/compile-preview';
import { handleValidateInProject } from '../src/tools/validate';
import { project, removeProjects } from './helpers/project';
import { warmUp } from './helpers/warm-up';

warmUp(() => handleValidateInProject({ sz: { p: 4 } }, { cwd: tailwind('tw') }));

afterEach(() => {
    removeProjects();
});

/**
 * @param prefix - The prefix the stylesheet sets, or null.
 * @returns A project whose stylesheet imports Tailwind.
 */
function tailwind(prefix: string | null): string {
    const suffix = prefix ? ` prefix(${prefix})` : '';
    return project({ 'app.css': `@import "tailwindcss"${suffix};\n` });
}

const SOURCE = 'export const A = () => <p sz={{ p: 4, hover: { m: 2 } }} />;';

describe('csszyx_validate', () => {
    it('shows the classes under the prefix the project sets', async () => {
        const reply = JSON.parse(
            (
                await handleValidateInProject(
                    { sz: { p: 4, hover: { m: 2 } } },
                    { cwd: tailwind('tw') },
                )
            ).content[0].text,
        );
        expect(reply.transformResult).toEqual({ className: 'tw:p-4 tw:hover:m-2', classCount: 2 });
    });

    it('shows the important modifier and a negative value as the build writes them', async () => {
        const reply = JSON.parse(
            (await handleValidateInProject({ sz: { p: '4!', m: -2 } }, { cwd: tailwind('tw') }))
                .content[0].text,
        );
        expect(
            reply.transformResult.className.split(' ').every((c: string) => c.startsWith('tw:')),
        ).toBe(true);
        expect(reply.transformResult.classCount).toBe(2);
    });

    it('shows them bare where the project sets none', async () => {
        const reply = JSON.parse(
            (await handleValidateInProject({ sz: { p: 4 } }, { cwd: tailwind(null) })).content[0]
                .text,
        );
        expect(reply.transformResult).toEqual({ className: 'p-4', classCount: 1 });
    });
});

describe('csszyx_compile_preview', () => {
    it.each([
        ['ui', 'classPrefix `ui` was given'],
        ['', 'An empty classPrefix was given'],
    ])('says a classPrefix %j is not the prefix the project sets', async (given, opens) => {
        const reply = JSON.parse(
            (
                await handleCompilePreview(
                    { source: SOURCE, classPrefix: given },
                    { cwd: tailwind('tw') },
                )
            ).content[0].text,
        );
        expect(reply.note).toContain(opens);
        expect(reply.note).toContain("this project's build lowers its classes under `tw`");
    });

    it.each([
        ['a project with no prefix', () => tailwind(null)],
        ['a project with no stylesheet', () => project({})],
    ])(
        'says nothing about a given classPrefix in %s, which previews another',
        async (_what, cwd) => {
            const reply = JSON.parse(
                (await handleCompilePreview({ source: SOURCE, classPrefix: 'tw' }, { cwd: cwd() }))
                    .content[0].text,
            );
            expect(reply).not.toHaveProperty('note');
        },
    );

    it('names the prefix the build lowers under, not every stylesheet', async () => {
        // Two stylesheets, `tw` and `ui`, with the disagreement turned off: the
        // build lowers under the first, and the `ui` one still serves
        // `ui:p-4`, so the note says which prefix the build writes and claims
        // nothing about what no stylesheet serves.
        const cwd = project({
            'a.css': '@import "tailwindcss" prefix(tw);\n',
            'b.css': '@import "tailwindcss" prefix(ui);\n',
            'csszyx.config.mjs':
                "export default { diagnostics: { rules: { 'prefix-disagreement': 'off' } } };\n",
        });
        const reply = JSON.parse(
            (await handleCompilePreview({ source: SOURCE, classPrefix: 'ui' }, { cwd })).content[0]
                .text,
        );
        expect(reply.note).toContain("this project's build lowers its classes under `tw`");
        expect(reply.note).not.toContain('serves none');
    });

    it('says nothing when the given classPrefix is the project’s', async () => {
        const reply = JSON.parse(
            (
                await handleCompilePreview(
                    { source: SOURCE, classPrefix: 'tw' },
                    { cwd: tailwind('tw') },
                )
            ).content[0].text,
        );
        expect(reply).not.toHaveProperty('note');
    });
});
