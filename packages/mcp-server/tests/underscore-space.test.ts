/**
 * An assistant that asks before it writes an `sz` object hears what the build
 * would say about an `_` the project's Tailwind reads as a space: from
 * `csszyx_validate` and `csszyx_compile_preview`, asked of the stylesheets of
 * the project the server runs in (PROJECT-RULES §4).
 */
import { afterEach, describe, expect, it } from 'vitest';

import { handleCompilePreview } from '../src/tools/compile-preview';
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
        const source = `export const A = () => <p sz={${JSON.stringify(SZ)}} />;`;
        const reply = JSON.parse(
            (await handleCompilePreview({ source, filename: 'A.tsx' }, { cwd: tailwind() }))
                .content[0].text,
        );
        const lines = reply.diagnostics.filter((line: string) => line.includes('underscore-space'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`A.tsx:1:${source.indexOf('"content"') + 1}`);
        expect(reply).not.toHaveProperty('underscoreNote');
    });
});
