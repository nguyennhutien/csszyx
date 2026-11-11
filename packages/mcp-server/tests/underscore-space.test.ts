/**
 * An assistant that asks before it writes an `sz` object hears what the build
 * would say about an `_` the project's Tailwind reads as a space: from
 * `csszyx_validate` and `csszyx_compile_preview`, asked of the stylesheets of
 * the project the server runs in (PROJECT-RULES §4).
 */
import { transformSource } from '@csszyx/compiler/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleCompilePreview } from '../src/tools/compile-preview';
import { handleMigrate } from '../src/tools/migrate';
import { handleReverse } from '../src/tools/reverse';
import { escapeUnsafeChars } from '../src/tools/source-literal';
import { underscoreSpaceAnswers } from '../src/tools/underscore-space';
import { handleValidateInProject } from '../src/tools/validate';
import { project, removeProjects } from './helpers/project';
import { warmUp } from './helpers/warm-up';

// The first call loads the engine and compiles Tailwind: kept out of a case's time.
warmUp(() => handleValidateInProject({ sz: { p: 4 } }, { cwd: tailwind() }));

afterEach(() => {
    removeProjects();
});

const SZ = { p: 4, content: "'a_b'", gridCols: '1fr 2fr', bgImg: 'url(/a_b.png)' };

/** @returns A project whose stylesheet imports Tailwind. */
function tailwind(): string {
    return project({ 'app.css': '@import "tailwindcss";\n' });
}

describe('csszyx_validate', () => {
    it('warns about the `_` the project reads as a space, with what to write', async () => {
        const reply = JSON.parse(
            (await handleValidateInProject({ sz: SZ }, { cwd: tailwind() })).content[0].text,
        );
        const found = (reply.warnings ?? []).filter(
            (warning: { code: string }) => warning.code === 'underscore-space',
        );
        expect(found).toEqual([
            expect.objectContaining({
                message: expect.stringContaining(`\`content: "'a_b'"\``),
                help: expect.stringContaining(`\`content: "'a b'"\``),
            }),
        ]);
        expect(reply.valid).toBe(true);
        expect(reply).not.toHaveProperty('underscoreNote');
    });

    it('reads the project prefix, as the build lowers the object', async () => {
        const cwd = project({ 'app.css': '@import "tailwindcss" prefix(tw);\n' });
        const reply = JSON.parse(
            (await handleValidateInProject({ sz: SZ }, { cwd })).content[0].text,
        );
        expect(
            (reply.warnings ?? []).filter(
                (warning: { code: string }) => warning.code === 'underscore-space',
            ),
        ).toHaveLength(1);
    });

    it('asks each stylesheet under its own prefix when they set different ones', async () => {
        // The prefixes disagree, so the object is lowered with none; each
        // stylesheet serves only its own prefixed class, and is asked that.
        const cwd = project({
            'a.css': '@import "tailwindcss" prefix(tw);\n',
            'b.css': '@import "tailwindcss" prefix(ui);\n',
        });
        const reply = JSON.parse(
            (await handleValidateInProject({ sz: SZ }, { cwd })).content[0].text,
        );
        expect(
            (reply.warnings ?? []).filter(
                (warning: { code: string }) => warning.code === 'underscore-space',
            ),
        ).toHaveLength(1);
        expect(reply).not.toHaveProperty('underscoreNote');
    });

    it('says the `_` was not checked when the project has no stylesheet to ask', async () => {
        const reply = JSON.parse(
            (await handleValidateInProject({ sz: SZ }, { cwd: project() })).content[0].text,
        );
        expect(reply.warnings ?? []).not.toContainEqual(
            expect.objectContaining({ code: 'underscore-space' }),
        );
        expect(reply.underscoreNote).toContain('was not checked');
    });

    it('says nothing about an object with no `_`', async () => {
        const reply = JSON.parse(
            (await handleValidateInProject({ sz: { content: "'a b'" } }, { cwd: project() }))
                .content[0].text,
        );
        expect(reply).not.toHaveProperty('underscoreNote');
        expect(reply).not.toHaveProperty('warnings');
    });
});

describe('csszyx_compile_preview', () => {
    it('lists the `_` the project reads as a space beside the other diagnostics', async () => {
        const source = `export const A = () => <p sz={${escapeUnsafeChars(JSON.stringify(SZ))}} />;`;
        const reply = JSON.parse(
            (await handleCompilePreview({ source, filename: 'A.tsx' }, { cwd: tailwind() }))
                .content[0].text,
        );
        const lines = reply.diagnostics.filter((line: string) => line.includes('underscore-space'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`A.tsx:1:${source.indexOf('"content"') + 1}`);
        expect(reply).not.toHaveProperty('underscoreNote');
    });

    it('asks the project under its own prefix when the preview names another', async () => {
        // `classPrefix: 'ui'` in a `prefix(tw)` project: the class is shown as
        // asked, and the project is asked about its own `tw:` class.
        const source = `export const A = () => <p sz={${escapeUnsafeChars(JSON.stringify(SZ))}} />;`;
        const cwd = project({ 'app.css': '@import "tailwindcss" prefix(tw);\n' });
        const reply = JSON.parse(
            (await handleCompilePreview({ source, filename: 'A.tsx', classPrefix: 'ui' }, { cwd }))
                .content[0].text,
        );
        expect(
            reply.diagnostics.filter((line: string) => line.includes('underscore-space')),
        ).toHaveLength(1);
        expect(reply).not.toHaveProperty('underscoreNote');
    });

    it('says the `_` was not checked when no stylesheet serves the class', async () => {
        // A stylesheet that serves nothing gives no reading: the reply names
        // the class rather than reading as clean.
        // Two elements with the same class, lowered under `tw`: named once,
        // without the prefix each stylesheet was asked under in its place.
        const result = transformSource(
            `export const A = () => <><p sz={{ content: "'a_b'" }} /><i sz={{ content: "'a_b'" }} /></>;`,
            { filename: 'A.tsx', classPrefix: 'tw' },
        );
        const answers = {
            stylesheets: async () => ({
                roots: [
                    {
                        prefix: null,
                        cssFor: (classes: readonly string[]) => classes.map(() => null),
                    },
                ],
                skipped: null,
            }),
        };
        expect(await underscoreSpaceAnswers(result, answers, 'A.tsx', 'tw')).toEqual({
            found: [],
            skipped:
                "no stylesheet serves `content-['a_b']` under the prefix it sets, so no CSS is written for it",
        });
    });

    it('reads an empty classPrefix as none', async () => {
        // `''` lowers with no prefix, so a project with none is asked about the
        // bare class and warns.
        const source = `export const A = () => <p sz={${escapeUnsafeChars(JSON.stringify(SZ))}} />;`;
        const reply = JSON.parse(
            (
                await handleCompilePreview(
                    { source, filename: 'A.tsx', classPrefix: '' },
                    { cwd: tailwind() },
                )
            ).content[0].text,
        );
        expect(
            reply.diagnostics.filter((line: string) => line.includes('underscore-space')),
        ).toHaveLength(1);
        expect(reply).not.toHaveProperty('underscoreNote');
    });

    it('asks a stylesheet whose prefix names a variant about the class it lowered', async () => {
        // `md` is a valid prefix and a variant: `md:content-[…]` lowered under
        // it is that stylesheet's class already, and is not prefixed twice.
        const source = `export const A = () => <p sz={${escapeUnsafeChars(JSON.stringify({ md: { content: "'a_b'" } }))}} />;`;
        const cwd = project({ 'app.css': '@import "tailwindcss" prefix(md);\n' });
        const reply = JSON.parse(
            (await handleCompilePreview({ source, filename: 'A.tsx' }, { cwd })).content[0].text,
        );
        expect(reply.classes).toEqual(["md:md:content-['a_b']"]);
        expect(
            reply.diagnostics.filter((line: string) => line.includes('underscore-space')),
        ).toHaveLength(1);
        expect(reply).not.toHaveProperty('underscoreNote');
    });
});

describe('csszyx_migrate and csszyx_reverse', () => {
    it('keep the `_` the project keeps, and write a space for the one it reads', async () => {
        const cwd = tailwind();
        const reversed = JSON.parse(
            (
                await handleReverse(
                    { classes: "bg-[url(/a_b.png)] grid-cols-[1fr_2fr] content-['a\\_b']" },
                    { cwd },
                )
            ).content[0].text,
        );
        expect(reversed.szObject).toMatchObject({
            bg: 'url(/a_b.png)',
            gridCols: '1fr 2fr',
            content: String.raw`"a\_b"`,
        });

        const migrated = JSON.parse(
            (
                await handleMigrate(
                    { code: 'export const A = () => <div className="bg-[url(/a_b.png)]" />;' },
                    { cwd },
                )
            ).content[0].text,
        );
        expect(migrated.code).toContain(`'url(/a_b.png)'`);
    });
});

describe('the note when the project could not be asked about `_`', () => {
    it('says each `_` was written as a space, and why', async () => {
        const cwd = project();
        const reversed = JSON.parse(
            (await handleReverse({ classes: 'bg-[url(/a_b.png)]' }, { cwd })).content[0].text,
        );
        expect(reversed.szObject).toEqual({ bg: 'url(/a b.png)' });
        expect(reversed.note).toContain('`url(/a_b.png)`');
        expect(reversed.note).toContain('as a space');

        const migrated = JSON.parse(
            (
                await handleMigrate(
                    { code: 'export const A = () => <div className="bg-[url(/a_b.png)]" />;' },
                    { cwd },
                )
            ).content[0].text,
        );
        expect(migrated.note).toContain('`url(/a_b.png)`');
    });

    it('says nothing about `_` the project answered', async () => {
        const reversed = JSON.parse(
            (await handleReverse({ classes: 'bg-[url(/a_b.png)]' }, { cwd: tailwind() })).content[0]
                .text,
        );
        expect(reversed.note ?? '').not.toContain('as a space');
    });
});

describe('the project a tool reads, when none is named', () => {
    it('is the directory the server runs in', async () => {
        vi.spyOn(process, 'cwd').mockReturnValue(tailwind());
        try {
            const reply = JSON.parse((await handleValidateInProject({ sz: SZ })).content[0].text);
            expect(
                (reply.warnings ?? []).filter(
                    (warning: { code: string }) => warning.code === 'underscore-space',
                ),
            ).toHaveLength(1);
        } finally {
            vi.restoreAllMocks();
        }
    });
});

describe('csszyx_compile_preview with no stylesheet to ask', () => {
    it('says the `_` was not checked', async () => {
        const source = `export const A = () => <p sz={${escapeUnsafeChars(JSON.stringify(SZ))}} />;`;
        const reply = JSON.parse(
            (await handleCompilePreview({ source, filename: 'A.tsx' }, { cwd: project() }))
                .content[0].text,
        );
        expect(reply.underscoreNote).toContain('was not checked');
        expect(
            reply.diagnostics.filter((line: string) => line.includes('underscore-space')),
        ).toEqual([]);
    });
});
